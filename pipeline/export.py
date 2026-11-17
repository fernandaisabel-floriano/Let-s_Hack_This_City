#!/usr/bin/env python3
"""M9 — Exportação do catálogo para SIG (GeoJSON + CSV).

    catalogo.geojson   WGS84 (EPSG:4326), campos schema.EXPORT_FIELDS
    catalogo.csv       lat/lon WGS84 + x/y no sistema local (crs_local) + epsg_local
    fora_da_zona.geojson  elementos fora do polígono de avaliação (para depuração)
    resumo.json

Só entram no catálogo os elementos dentro do polígono de avaliação
(m9.so_dentro_da_zona) e que não estejam rejeitados.

Uso:
    python pipeline/export.py
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from schema import EXPORT_FIELDS  # noqa: E402
from zona import zone_contains  # noqa: E402


def feature(e: dict, props: dict) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [e["lon"], e["lat"]]},
            "properties": props}


def main() -> None:
    from pyproj import Transformer
    cfg = load_config(ROOT / "config/municipio.yaml")
    crs = cfg.get("crs_local", "EPSG:3763")
    epsg = int(crs.split(":")[1])
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    out = zone_dir(cfg) / "catalogo"
    els = json.load(open(out / "elementos.json"))
    inside = zone_contains(cfg)
    so_zona = bool((cfg.get("m9") or {}).get("so_dentro_da_zona", True))

    cat, fora = [], []
    for e in els:
        x, y = tr.transform(e["lon"], e["lat"])
        row = {**e, "x": round(x, 2), "y": round(y, 2), "epsg_local": epsg}
        (cat if (inside(e["lon"], e["lat"]) or not so_zona) and e["estado"] != "rejeitado" else fora).append(row)

    def props(r):
        p = {k: r.get(k) for k in EXPORT_FIELDS if k not in ("lat", "lon")}
        p.update(recorte=r.get("recorte"), espalhamento_m=r.get("espalhamento_m"))
        return p

    (out / "catalogo.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "name": f"{cfg['municipio']}_{cfg['zona']}",
         "features": [feature(r, props(r)) for r in cat]}, ensure_ascii=False, indent=1))
    (out / "fora_da_zona.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": [feature(r, props(r)) for r in fora]},
        ensure_ascii=False, indent=1))
    with open(out / "catalogo.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in cat:
            w.writerow(r)

    resumo = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "municipio": cfg["municipio"], "zona": cfg["zona"], "crs_local": crs,
        "elementos_total": len(els), "no_catalogo": len(cat), "fora_da_zona": len(fora),
        "por_tipo": dict(Counter(r["tipo"] for r in cat)),
        "por_estado": dict(Counter(r["estado"] for r in cat)),
        "por_subtipo_sinal": dict(Counter(r["subtipo"] for r in cat if r["tipo"] == "sinal")),
        "por_fonte": dict(Counter(r["fonte"] for r in cat)),
        "vistas_por_elemento": dict(sorted(Counter(min(r["n_vistas"], 5) for r in cat).items())),
    }
    (out / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1))
    print(json.dumps(resumo, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
