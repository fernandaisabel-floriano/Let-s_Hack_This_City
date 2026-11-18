#!/usr/bin/env python3
"""Relatório de cobertura Mapillary para a zona do config (não descarrega imagens).

Imagens por ano, planas vs. panorâmicas, n.º de sequências, e quantas ficam
a partir da data `desde` e a menos de X m do eixo da rua (se houver rua_geojson).

Uso:
    python pipeline/coverage_report.py [--config ...] [--bbox o,s,e,n] [--buffer 30]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, street_distance_fn  # noqa: E402
from fetch_mapillary import (Client, load_token, normalize, parse_bbox,  # noqa: E402
                             query_tile, tiles, validate_bbox)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", type=Path, default=ROOT / "config/municipio.yaml")
    ap.add_argument("--bbox", type=parse_bbox)
    ap.add_argument("--buffer", type=float, default=30.0, help="metros ao eixo da rua")
    ap.add_argument("--out-root", type=Path, default=ROOT / "data/clean")
    args = ap.parse_args()

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    bbox = args.bbox or cfg["bbox"]
    validate_bbox(bbox)
    desde = cfg.get("desde")
    desde_ms = (datetime.fromisoformat(desde).replace(tzinfo=timezone.utc).timestamp() * 1000
                if desde else None)
    mcfg = cfg.get("mapillary", {})
    rua = cfg.get("rua_geojson")
    dist = street_distance_fn(ROOT / rua) if rua else None

    cli = Client(load_token(ROOT / ".env"))
    stats = {"pedidos_api": 0, "subdivisoes": 0, "quadrados_truncados": 0}
    raw: dict[str, dict] = {}
    for b in tiles(bbox, float(mcfg.get("tile_graus", 0.002))):
        for img in query_tile(cli, b, int(mcfg.get("limit", 2000)), {}, stats):
            raw.setdefault(str(img["id"]), img)

    w, s, e, n = bbox
    recs = []
    for img in raw.values():
        r = normalize(img)
        if r["lon"] is None or not (w <= r["lon"] <= e and s <= r["lat"] <= n):
            continue
        r["id"] = r["image_id"]
        r["ano"] = r["captured_at"][:4] if r["captured_at"] else "?"
        r["tipo"] = "panoramica" if r["is_pano"] else "plana"
        r["recente"] = desde_ms is None or (img.get("captured_at") or 0) >= desde_ms
        r["dist_rua_m"] = round(dist(r["lon"], r["lat"]), 1) if dist else None
        r["perto"] = dist is None or r["dist_rua_m"] <= args.buffer
        recs.append(r)

    def bloco(rs):
        por_ano = defaultdict(Counter)
        seqs = defaultdict(set)
        for r in rs:
            por_ano[r["ano"]][r["tipo"]] += 1
            seqs[r["ano"]].add(r["sequence"])
        anos = {a: {"plana": c["plana"], "panoramica": c["panoramica"],
                    "sequencias": len(seqs[a])} for a, c in sorted(por_ano.items())}
        return {
            "imagens": len(rs),
            "planas": sum(r["tipo"] == "plana" for r in rs),
            "panoramicas": sum(r["tipo"] == "panoramica" for r in rs),
            "sequencias": len({r["sequence"] for r in rs}),
            "autores": dict(Counter(r["autor"] for r in rs).most_common()),
            "sem_heading": sum(r["heading"] is None for r in rs),
            "por_ano": anos,
        }

    sel = [r for r in recs if r["recente"] and r["perto"]]
    rep = {
        "municipio": cfg["municipio"], "zona": cfg["zona"], "bbox": bbox,
        "desde": desde, "buffer_rua_m": args.buffer if dist else None,
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **stats,
        "bbox_todas": bloco(recs),
        "bbox_desde": bloco([r for r in recs if r["recente"]]),
        "rua_desde": bloco(sel),
        "rua_desde_vistas_planas": sum(1 if r["tipo"] == "plana" else 4 for r in sel),
        "rua_desde_sequencias": [
            {"sequence": sq, "imagens": len(g), "tipo": g[0]["tipo"], "autor": g[0]["autor"],
             "de": min(x["captured_at"] for x in g), "ate": max(x["captured_at"] for x in g)}
            for sq, g in sorted(
                ((sq, [r for r in sel if r["sequence"] == sq]) for sq in {r["sequence"] for r in sel}),
                key=lambda t: max(x["captured_at"] for x in t[1]), reverse=True)
        ],
    }
    out = args.out_root / cfg["municipio"] / cfg["zona"]
    out.mkdir(parents=True, exist_ok=True)
    (out / "cobertura.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")

    # Tabela legível
    print(f"Zona {cfg['zona']}  bbox {bbox}  ({stats['pedidos_api']} pedidos)\n")
    for nome, k in [("Toda a bbox", "bbox_todas"), (f"bbox, desde {desde}", "bbox_desde"),
                    (f"≤{args.buffer:.0f} m da rua, desde {desde}", "rua_desde")]:
        b = rep[k]
        print(f"{nome}: {b['imagens']} imagens ({b['planas']} planas, {b['panoramicas']} pano), "
              f"{b['sequencias']} sequências")
        print("   ano   planas  pano  seqs")
        for a, c in b["por_ano"].items():
            print(f"   {a}  {c['plana']:6d} {c['panoramica']:5d} {c['sequencias']:5d}")
        print()
    print(f"Vistas planas após cortar panorâmicas em 4 (rua, desde {desde}): "
          f"{rep['rua_desde_vistas_planas']}")
    print("\nSequências na rua (mais recentes primeiro):")
    for sq in rep["rua_desde_sequencias"]:
        print(f"   {sq['ate'][:10]}  {sq['tipo']:10s} {sq['imagens']:4d} img  {sq['autor']}")
    print(f"\nGravado em {out / 'cobertura.json'}")


if __name__ == "__main__":
    main()
