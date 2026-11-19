#!/usr/bin/env python3
"""Etapa 5 — cria uma zona nova a partir das vias escolhidas na app (ou do polígono de um bairro).

Escreve:
    config/ruas/<id>.geojson            vias (LineStrings com a propriedade "via"), OSM (ODbL)
    config/ruas/<id>-zona.geojson       polígono de avaliação: vias + buffer (como a zona piloto,
                                        zona.py), ou o polígono do bairro
    config/ruas/<id>-edificios.geojson  edifícios do OSM (Overpass) — opcional: se o Overpass não
                                        responder, a zona fica sem eles (o fuse.py avisa e segue)
    config/zonas/<id>.yaml              a config da zona (junta-se ao municipio.yaml com CTRLF_ZONA=<id>)

Depois: CTRLF_ZONA=<id> python pipeline/fetch_mapillary.py && CTRLF_ZONA=<id> python pipeline/run_all.py
(é o que a página Importação → Nova zona faz).

Uso:
    python pipeline/nova_zona.py --id av-lourenco-peixinho --nome "Av. Dr. Lourenço Peixinho" --vias vias.geojson
    python pipeline/nova_zona.py --id gloria --nome "Glória" --vias vias.geojson --poligono bairro.geojson
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, ZONAS_DIR, load_config  # noqa: E402

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]
AGENTE = "ctrlf-inventario/0.1 (inventario municipal; pedidos raros)"
MARGEM_M = 30.0


def slug(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48]


def _linhas(fc: dict) -> list[dict]:
    out = []
    for f in fc.get("features", []):
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        via = p.get("via") or p.get("name") or "via"
        parts = [g["coordinates"]] if g.get("type") == "LineString" else g.get("coordinates", []) if g.get("type") == "MultiLineString" else []
        for c in parts:
            if len(c) >= 2:
                out.append({"type": "Feature", "properties": {k: v for k, v in {"via": via, "osm_id": p.get("osm_id"),
                            "highway": p.get("highway")}.items() if v is not None}, "geometry": {"type": "LineString", "coordinates": c}})
    return out


def edificios(bbox: list[float], tentativas: int = 1, timeout_s: int = 30) -> list[dict] | None:
    """Opcional: no máximo tentativas × servidores × timeout_s (~1,5 min); sem resposta, a zona fica sem edifícios."""
    w, s, e, n = bbox
    q = f'[out:json][timeout:25];way["building"]({s},{w},{n},{e});out geom;'
    for k in range(tentativas):
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                             headers={"User-Agent": AGENTE})
                with urllib.request.urlopen(req, timeout=timeout_s) as r:
                    d = json.load(r)
                feats = []
                for el in d.get("elements", []):
                    geom = el.get("geometry") or []
                    if len(geom) >= 4:
                        feats.append({"type": "Feature", "properties": {"osm_id": el["id"], "building": el.get("tags", {}).get("building", "yes")},
                                      "geometry": {"type": "Polygon", "coordinates": [[[p["lon"], p["lat"]] for p in geom]]}})
                return feats
            except Exception as ex:  # rede, 429, 504, JSON inválido: tenta o próximo
                print(f"  overpass {url.split('/')[2]}: {type(ex).__name__}", flush=True)
        time.sleep(5 * (k + 1))
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--id")
    ap.add_argument("--nome", required=True)
    ap.add_argument("--vias", type=Path, required=True, help="GeoJSON com as vias (LineString/MultiLineString, propriedade name ou via)")
    ap.add_argument("--poligono", type=Path, help="GeoJSON com o polígono do bairro (opcional)")
    ap.add_argument("--sem-edificios", action="store_true")
    args = ap.parse_args()
    if not args.vias:
        sys.exit("é preciso --vias (o polígono do bairro é opcional: só delimita a zona)")

    # a zona ainda não existe: a config de base é a do município (ignora CTRLF_ZONA, que a app já define)
    os.environ.pop("CTRLF_ZONA", None)
    base = load_config()
    zid = args.id or slug(args.nome)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,47}", zid):
        sys.exit(f"id inválido: {zid!r} (minúsculas, números e hífens)")
    if zid == base["zona"]:
        sys.exit(f"{zid} é a zona por omissão (municipio.yaml)")

    from pyproj import Transformer
    from shapely.geometry import mapping, shape
    from shapely.ops import transform, unary_union
    crs = base.get("crs_local", "EPSG:3763")
    fwd = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
    inv = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform

    ruas_dir = ROOT / "config/ruas"
    vias = _linhas(json.loads(args.vias.read_text(encoding="utf-8"))) if args.vias else []
    rua_path = ruas_dir / f"{zid}.geojson"
    zona_path = ruas_dir / f"{zid}-zona.geojson"
    edif_path = ruas_dir / f"{zid}-edificios.geojson"

    poligono = None
    if args.poligono:
        fc = json.loads(args.poligono.read_text(encoding="utf-8"))
        geoms = [shape(f["geometry"]) for f in (fc.get("features") or [fc]) if f.get("geometry", f).get("type") in ("Polygon", "MultiPolygon")]
        if not geoms:
            sys.exit("--poligono sem Polygon/MultiPolygon")
        poligono = unary_union(geoms)
    if not vias:
        sys.exit("o GeoJSON das vias não tem LineStrings")

    if vias:
        rua_path.write_text(json.dumps({"type": "FeatureCollection", "features": vias}, ensure_ascii=False), encoding="utf-8")
    cfg_zona = {
        "zona": zid, "nome_zona": args.nome,
        "rua_geojson": str(rua_path.relative_to(ROOT)),
        "zona_avaliacao_geojson": str(zona_path.relative_to(ROOT)),
        # as exceções de pontas da zona piloto referem vias pelo nome: aqui não se aplicam
        "zona_piloto": {"pontas_redondas": []},
        # a contagem manual (M10) e a referência são da zona piloto
        "m10": {"contagem": None, "referencia": None},
    }

    # polígono: o do bairro, ou vias + buffer com a regra da zona piloto (zona.py)
    if poligono is None:
        import zona as Z
        cfg_tmp = {**base, **{k: v for k, v in cfg_zona.items() if v is not None},
                   "zona_piloto": {**(base.get("zona_piloto") or {}), "pontas_redondas": []}}
        poligono = Z.evaluation_polygon(cfg_tmp)
    area = transform(fwd, poligono).area
    zona_path.write_text(json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": {"zona": zid, "nome": args.nome, "area_m2": round(area),
                                          "vias": sorted({v["properties"]["via"] for v in vias}), "origem": "OSM (ODbL)"},
        "geometry": mapping(poligono)}]}, ensure_ascii=False), encoding="utf-8")

    caixa = transform(inv, transform(fwd, poligono).buffer(MARGEM_M)).bounds
    cfg_zona["bbox"] = [round(caixa[0], 6), round(caixa[1], 6), round(caixa[2], 6), round(caixa[3], 6)]

    if args.sem_edificios:
        cfg_zona["m6"] = {"edificios_geojson": None}
    else:
        print("edifícios do OSM (Overpass)…", flush=True)
        ed = edificios(cfg_zona["bbox"])
        if ed is None:
            print("  AVISO: Overpass indisponível — a zona fica sem edifícios (os pontos não são afastados das fachadas)")
            cfg_zona["m6"] = {"edificios_geojson": None}
        else:
            edif_path.write_text(json.dumps({"type": "FeatureCollection", "features": ed}, ensure_ascii=False), encoding="utf-8")
            cfg_zona["m6"] = {"edificios_geojson": str(edif_path.relative_to(ROOT))}
            print(f"  {len(ed)} edifícios")

    ZONAS_DIR.mkdir(parents=True, exist_ok=True)
    zf = ZONAS_DIR / f"{zid}.yaml"
    zf.write_text(f"# Zona criada por pipeline/nova_zona.py. Junta-se ao municipio.yaml com CTRLF_ZONA={zid}.\n"
                  # listas numa linha (bbox: [o, s, e, n]): o servidor da app lê as chaves de topo com regex
                  + yaml.safe_dump(cfg_zona, allow_unicode=True, sort_keys=False, default_flow_style=None), encoding="utf-8")
    print(f"zona {zid} ({args.nome}): {len(vias)} troços de via, polígono {area:.0f} m², bbox {cfg_zona['bbox']}")
    print(f"→ {zf.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
