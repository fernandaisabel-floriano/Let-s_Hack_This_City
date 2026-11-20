"""Utilitários partilhados: config, geometria da rua, catálogo de imagens."""
from __future__ import annotations

import csv
import json
import math
import os
from collections import Counter
from pathlib import Path

import yaml

from schema import IMAGE_FIELDS

ROOT = Path(__file__).resolve().parent.parent


CONFIG = ROOT / "config/municipio.yaml"


ZONAS_DIR = ROOT / "config/zonas"


def _juntar(base: dict, extra: dict) -> dict:
    """Junta extra em base (dicionários aninhados); um valor null apaga a chave."""
    out = dict(base)
    for k, v in extra.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _juntar(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: Path = CONFIG, zona: str | None = None) -> dict:
    """Lê a config. CTRLF_CONFIG=outro.yaml substitui a config por omissão
    (usado pelos testes em tests/, para não tocar em data/ nem em reports/).

    Etapa 5 (várias zonas): CTRLF_ZONA=<id> (ou `zona`) junta config/zonas/<id>.yaml à config do
    município — zona, nome_zona, bbox, rua_geojson, zona_avaliacao_geojson, m6.edificios_geojson…
    Sem isso (ou com a zona do municipio.yaml), fica a zona por omissão."""
    if Path(path).resolve() == CONFIG and os.environ.get("CTRLF_CONFIG"):
        path = Path(os.environ["CTRLF_CONFIG"])
    cfg = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    zona = zona or os.environ.get("CTRLF_ZONA")
    if zona and zona != cfg.get("zona"):
        f = ZONAS_DIR / f"{zona}.yaml"
        if not f.exists():
            raise SystemExit(f"zona desconhecida: {zona} (falta {f.relative_to(ROOT)})")
        cfg = _juntar(cfg, yaml.safe_load(f.read_text(encoding="utf-8")) or {})
    return cfg


def zonas_disponiveis(cfg_base: dict | None = None) -> list[dict]:
    """A zona do municipio.yaml e as de config/zonas/*.yaml: [{id, nome, bbox}]."""
    base = cfg_base or yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    out = [{"id": base["zona"], "nome": base.get("nome_zona") or base["zona"], "bbox": base.get("bbox")}]
    for f in sorted(ZONAS_DIR.glob("*.yaml")):
        z = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        if z.get("zona") and z["zona"] != base["zona"]:
            out.append({"id": z["zona"], "nome": z.get("nome_zona") or z["zona"], "bbox": z.get("bbox")})
    return out


def zone_dir(cfg: dict, zona: str | None = None, out_root: Path | None = None) -> Path:
    root = out_root or ROOT / cfg.get("saida", "data/clean")
    return Path(root) / cfg["municipio"] / (zona or cfg["zona"])


# ----------------------------------------------------------------- geometria

R_TERRA = 6371000.0


def haversine(lon1, lat1, lon2, lat2) -> float:
    f1, f2 = math.radians(lat1), math.radians(lat2)
    df, dl = f2 - f1, math.radians(lon2 - lon1)
    a = math.sin(df / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * R_TERRA * math.asin(math.sqrt(a))


def bearing(lon1, lat1, lon2, lat2) -> float:
    """Rumo de 1 para 2 em graus (0 = norte, sentido horário)."""
    f1, f2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(f2)
    y = math.cos(f1) * math.sin(f2) - math.sin(f1) * math.cos(f2) * math.cos(dl)
    return math.degrees(math.atan2(x, y)) % 360.0


def street_distance_fn(geojson_path: Path):
    """Devolve f(lon, lat) -> distância em metros ao eixo da rua (LineStrings)."""
    feats = json.loads(Path(geojson_path).read_text())["features"]
    lines = [f["geometry"]["coordinates"] for f in feats]
    lat0 = sum(c[1] for ln in lines for c in ln) / sum(len(ln) for ln in lines)
    kx, ky = 111320 * math.cos(math.radians(lat0)), 111320

    segs = [((a[0] * kx, a[1] * ky), (b[0] * kx, b[1] * ky))
            for ln in lines for a, b in zip(ln, ln[1:])]

    def dist(lon, lat):
        px, py = lon * kx, lat * ky
        best = float("inf")
        for (ax, ay), (bx, by) in segs:
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
        return best

    return dist


# ------------------------------------------------------------------ recortes

def recorte_largo_janela(bbox, W: int, H: int) -> tuple[int, int, int, int]:
    """Janela [x0, y0, x1, y1] do recorte largo gravado pela M3 (o que o técnico vê).

    Margem de 15 % do lado maior (mínimo 8 px), cortada aos limites da imagem.
    """
    x1, y1, x2, y2 = bbox
    pad = max(8, int(0.15 * max(x2 - x1, y2 - y1)))
    return max(0, int(x1) - pad), max(0, int(y1) - pad), min(W, int(x2) + pad), min(H, int(y2) + pad)


def lado_px(bbox) -> float:
    """Lado maior da caixa, em px."""
    return max(bbox[2] - bbox[0], bbox[3] - bbox[1])


# ------------------------------------------------------------------ catálogo

BLUR_KEYS = ("rostos", "matriculas", "cabecas")


def load_blur_log(out: Path) -> dict:
    p = out / "desfoque.json"
    return json.loads(p.read_text()) if p.exists() else {}


def save_blur_log(out: Path, log: dict) -> None:
    (out / "desfoque.json").write_text(json.dumps(log, indent=0, sort_keys=True))


def write_catalog(out: Path, recs: list[dict]) -> None:
    """images.geojson + images.csv com IMAGE_FIELDS (caminhos relativos a `out`)."""
    feats = [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
        "properties": {k: r.get(k) for k in IMAGE_FIELDS if k not in ("lon", "lat")},
    } for r in recs]
    (out / "images.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, ensure_ascii=False, indent=1))

    with open(out / "images.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=IMAGE_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in recs:
            row = {k: r.get(k) for k in IMAGE_FIELDS}
            cp = row.get("camera_parameters")
            row["camera_parameters"] = json.dumps(cp) if cp not in (None, "") else ""
            w.writerow(row)


def count_by(recs: list[dict], key: str) -> dict:
    return dict(Counter(str(r.get(key)) for r in recs).most_common())


def blur_totals(recs: list[dict]) -> dict:
    return {k: sum(int(r.get(k) or 0) for r in recs) for k in BLUR_KEYS} | {
        "imagens_com_desfoque": sum(any(int(r.get(k) or 0) for k in BLUR_KEYS) for r in recs)}
