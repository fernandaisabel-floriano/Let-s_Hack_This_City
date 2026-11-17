#!/usr/bin/env python3
"""Zona piloto: filtro "imagem da zona" e polígono de avaliação.

A zona é definida por um GeoJSON de vias (config `rua_geojson`; uma ou mais
LineStrings com a propriedade "via"). Zona v3: Rua dos Santos Mártires +
rotunda + Cais dos Santos Mártires.

  * street_filter: câmara a ≤ dist_max_m de qualquer via E heading alinhado
    com o troço mais próximo (± heading_tol_graus, qualquer sentido). Serve para escolher imagens de teste/avaliação; a recolha
    continua mais larga (buffer_rua_m).
  * zone_contains(lon, lat): a posição calculada de um elemento (M5) cai dentro do
    polígono de avaliação (eixo da rua + buffer). Usado na M10 e no catálogo final.

Uso (gera o GeoJSON do polígono e lista as imagens da rua):
    python pipeline/zona.py              # polígono + resumo
    python pipeline/zona.py cobertura    # imagens da zona por via, sequência e data
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, bearing, haversine, load_config, zone_dir  # noqa: E402

DEFAULTS = {"dist_max_m": 10.0, "heading_tol_graus": 35.0,
            "buffer_avaliacao_m": 15.0, "pontas": "planas",
            "rotunda_raio_m": 25.0, "rotunda_tol_graus": 45.0}


def _cfg(cfg: dict) -> dict:
    return {**DEFAULTS, **(cfg.get("zona_piloto") or {})}


def _lines(cfg: dict) -> list[tuple[str, list]]:
    """[(via, coordenadas)] do GeoJSON das vias (propriedade "via" ou "name")."""
    feats = json.loads((ROOT / cfg["rua_geojson"]).read_text())["features"]
    return [(f["properties"].get("via") or f["properties"].get("name") or "rua",
             f["geometry"]["coordinates"]) for f in feats]


def street_filter(cfg: dict):
    """Devolve f(lon, lat, heading) -> (passa, distancia_m, desvio_graus, via).

    Distância e alinhamento medidos contra o troço mais próximo de qualquer via.
    """
    z = _cfg(cfg)
    lines = _lines(cfg)
    lat0 = sum(c[1] for _, ln in lines for c in ln) / sum(len(ln) for _, ln in lines)
    kx, ky = 111320 * math.cos(math.radians(lat0)), 111320
    segs = [(via, a, b, bearing(a[0], a[1], b[0], b[1]))
            for via, ln in lines for a, b in zip(ln, ln[1:])]

    # Rotundas (propriedade tipo=rotunda): o alinhamento com o troço não faz
    # sentido num anel de ~7 m de raio — as imagens úteis são as das ruas de
    # acesso a OLHAR para a rotunda. Regra extra: câmara a ≤ rotunda_raio_m do
    # centro e centro dentro de ± rotunda_tol_graus do heading.
    feats = json.loads((ROOT / cfg["rua_geojson"]).read_text())["features"]
    rot: dict[str, list] = {}
    for ft in feats:
        if ft["properties"].get("tipo") == "rotunda":
            rot.setdefault(ft["properties"].get("via", "Rotunda"), []).extend(ft["geometry"]["coordinates"])
    centros = {v: (sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs))
               for v, cs in rot.items()}

    def f(lon: float, lat: float, heading: float | None):
        res = _align(lon, lat, heading)
        if res[0] or heading is None or z.get("rotunda_raio_m") is None:
            return res
        for via, (cx, cy) in centros.items():
            if (haversine(lon, lat, cx, cy) <= z["rotunda_raio_m"] and
                    abs((bearing(lon, lat, cx, cy) - heading + 180) % 360 - 180) <= z["rotunda_tol_graus"]):
                return True, res[1], res[2], via
        return res

    def _align(lon: float, lat: float, heading: float | None):
        px, py = lon * kx, lat * ky
        best_d, best_b, best_v = float("inf"), None, None
        for via, a, b, br in segs:
            ax, ay, bx, by = a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d < best_d:
                best_d, best_b, best_v = d, br, via
        if heading is None:
            return False, best_d, None, best_v
        diff = abs((heading - best_b + 180) % 360 - 180)
        diff = min(diff, 180 - diff)  # qualquer dos sentidos
        return (best_d <= z["dist_max_m"] and diff <= z["heading_tol_graus"]), best_d, diff, best_v

    return f


def evaluation_polygon(cfg: dict):
    """Polígono (shapely, WGS84) = eixo da rua + buffer, calculado em PT-TM06."""
    from pyproj import Transformer
    from shapely.geometry import LineString
    from shapely.ops import linemerge, transform, unary_union
    z = _cfg(cfg)
    crs = cfg.get("crs_local", "EPSG:3763")
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    # linemerge junta troços contíguos (a rotunda fica um anel fechado), para que
    # as pontas planas só existam onde as vias acabam e não nas junções.
    lines = linemerge(unary_union([transform(fwd, LineString(ln)) for _, ln in _lines(cfg)]))
    poly = lines.buffer(float(z["buffer_avaliacao_m"]), cap_style=2 if z["pontas"] == "planas" else 1)
    return transform(inv, poly)


def zone_contains(cfg: dict):
    """Devolve f(lon, lat) -> bool (dentro do polígono de avaliação)."""
    from shapely.geometry import Point
    from shapely.prepared import prep
    p = prep(evaluation_polygon(cfg))
    return lambda lon, lat: p.contains(Point(lon, lat))


def main() -> None:
    from collections import defaultdict

    from shapely.geometry import mapping
    cfg = load_config(ROOT / "config/municipio.yaml")
    z = _cfg(cfg)
    out = ROOT / cfg.get("zona_avaliacao_geojson", "config/ruas/zona.geojson")
    poly = evaluation_polygon(cfg)
    from pyproj import Transformer
    from shapely.ops import transform
    area = transform(Transformer.from_crs("EPSG:4326", cfg.get("crs_local", "EPSG:3763"),
                                          always_xy=True).transform, poly).area
    out.write_text(json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"zona": cfg["zona"], "vias": sorted({v for v, _ in _lines(cfg)}),
                       "buffer_m": z["buffer_avaliacao_m"], "pontas": z["pontas"],
                       "area_m2": round(area), "origem": f"{cfg['rua_geojson']} (OSM, ODbL)"},
        "geometry": mapping(poly)}]}, ensure_ascii=False))
    print(f"polígono de avaliação ({area:.0f} m²) → {out.relative_to(ROOT)}")

    f = street_filter(cfg)
    rows = []
    for csvp in sorted(zone_dir(cfg).glob("**/images.csv")):
        rows += list(csv.DictReader(open(csvp)))
    if not rows:
        return
    res = [(r, f(float(r["lon"]), float(r["lat"]), float(r["heading"]))) for r in rows]
    ok = [(r, x) for r, x in res if x[0]]
    print(f"imagens da zona (≤{z['dist_max_m']} m de uma via, ±{z['heading_tol_graus']}°): "
          f"{len(ok)} de {len(rows)}")
    if "cobertura" in sys.argv[1:]:
        por_via = defaultdict(lambda: defaultdict(list))
        for r, x in ok:
            por_via[x[3]][(r["fonte"], r["sequence"], r["captured_at"][:10])].append(r)
        rep = {}
        for via in sorted(por_via):
            seqs = por_via[via]
            print(f"\n  {via}: {sum(len(v) for v in seqs.values())} imagens")
            rep[via] = []
            for (fonte, seq, dia), rs in sorted(seqs.items(), key=lambda t: t[0][2]):
                print(f"     {dia}  {fonte:13s} {seq}  {len(rs):3d}")
                rep[via].append({"fonte": fonte, "sequencia": seq, "data": dia, "imagens": len(rs)})
        (zone_dir(cfg) / "cobertura_zona.json").write_text(json.dumps(
            {"vias": rep, "total": len(ok), "recolhidas": len(rows)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
