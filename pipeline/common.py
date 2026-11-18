"""Utilitários partilhados: config, geometria da rua, catálogo de imagens."""
from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

import yaml

from schema import IMAGE_FIELDS

ROOT = Path(__file__).resolve().parent.parent


def load_config(path: Path) -> dict:
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


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
    feats = json.loads(Path(geojson_path).read_text(encoding="utf-8"))["features"]
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


# ------------------------------------------------------------------ catálogo

BLUR_KEYS = ("rostos", "matriculas", "cabecas")


def load_blur_log(out: Path) -> dict:
    p = out / "desfoque.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def save_blur_log(out: Path, log: dict) -> None:
    (out / "desfoque.json").write_text(json.dumps(log, indent=0, sort_keys=True), encoding="utf-8")


def write_catalog(out: Path, recs: list[dict]) -> None:
    """images.geojson + images.csv com IMAGE_FIELDS (caminhos relativos a `out`)."""
    feats = [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
        "properties": {k: r.get(k) for k in IMAGE_FIELDS if k not in ("lon", "lat")},
    } for r in recs]
    (out / "images.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, ensure_ascii=False, indent=1), encoding="utf-8")

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
