#!/usr/bin/env python3
"""M10 — Métrica do catálogo contra a contagem manual (referencia.csv).

Regra de correspondência (decidida a 18/11):
  * mesma classe (tipo), distância ≤ m10.dist_max_m (8 m);
  * só elementos e referências dentro do polígono de avaliação v3;
  * papeleiras não contam (referências com subtipo "papeleira" são ignoradas);
  * um a um: cada elemento real é encontrado no máximo uma vez (os pares mais
    próximos primeiro); outros elementos do catálogo a ≤ dist_max_m de uma
    referência já encontrada contam como duplicados, os restantes como falsos.

Resultados por classe e por metodo_posicao, com a distribuição do erro de
posição (metros) dos encontrados.

Uso:
    python pipeline/evaluate.py                     # catalogo/elementos.json vs referencia.csv
    python pipeline/evaluate.py --referencia X.csv --elementos Y.json
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from zona import zone_contains  # noqa: E402

CLASSES = ("sinal", "candeeiro", "contentor")


def dist_m(lon1, lat1, lon2, lat2) -> float:
    kx = 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111320.0)


def load_reference(path: Path, inside) -> tuple[list[dict], Counter]:
    refs, ignored = [], Counter()
    for r in csv.DictReader(open(path, encoding="utf-8")):
        tipo = (r.get("tipo") or "").strip().lower()
        sub = (r.get("subtipo") or "").strip().lower()
        if not r.get("lat") or not r.get("lon"):
            ignored["sem_coordenadas"] += 1
            continue
        if tipo not in CLASSES:
            ignored[f"tipo_desconhecido:{tipo or '(vazio)'}"] += 1
            continue
        if sub == "papeleira":
            ignored["papeleira"] += 1
            continue
        lat, lon = float(r["lat"]), float(r["lon"])
        if not inside(lon, lat):
            ignored["fora_da_zona"] += 1
            continue
        refs.append({**r, "tipo": tipo, "lat": lat, "lon": lon})
    return refs, ignored


def match(els: list[dict], refs: list[dict], dmax: float) -> dict:
    """Correspondência um a um gulosa pelos pares mais próximos, por classe."""
    res = {"pares": [], "duplicados": [], "falsos": [], "em_falta": []}
    for c in CLASSES:
        E = [e for e in els if e["tipo"] == c]
        R = [r for r in refs if r["tipo"] == c]
        pairs = sorted((dist_m(e["lon"], e["lat"], r["lon"], r["lat"]), i, j)
                       for i, e in enumerate(E) for j, r in enumerate(R))
        used_e, used_r = set(), set()
        for d, i, j in pairs:
            if d > dmax:
                break
            if i in used_e or j in used_r:
                continue
            used_e.add(i)
            used_r.add(j)
            res["pares"].append({"elemento": E[i], "referencia": R[j], "erro_m": d})
        for i, e in enumerate(E):
            if i in used_e:
                continue
            near = any(dist_m(e["lon"], e["lat"], R[j]["lon"], R[j]["lat"]) <= dmax for j in used_r)
            res["duplicados" if near else "falsos"].append(e)
        res["em_falta"] += [r for j, r in enumerate(R) if j not in used_r]
    return res


def dist_stats(errs: list[float]) -> dict | None:
    if not errs:
        return None
    a = np.array(errs)
    return {"n": len(a), "mediana": round(float(np.median(a)), 2), "media": round(float(a.mean()), 2),
            "p90": round(float(np.percentile(a, 90)), 2), "max": round(float(a.max()), 2),
            "histograma_m": {f"{lo}-{hi}": int(((a >= lo) & (a < hi)).sum())
                             for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 5), (5, 8), (8, 99))}}


def summarize(res: dict, n_refs: Counter) -> dict:
    out = {}
    groups = {"todas": lambda x: True, **{c: (lambda c: lambda t: t == c)(c) for c in CLASSES}}
    for g, f in groups.items():
        tp = [p for p in res["pares"] if f(p["elemento"]["tipo"])]
        fp = [e for e in res["falsos"] if f(e["tipo"])]
        dup = [e for e in res["duplicados"] if f(e["tipo"])]
        fn = [r for r in res["em_falta"] if f(r["tipo"])]
        n_cat = len(tp) + len(fp) + len(dup)
        out[g] = {"referencia": len(tp) + len(fn), "catalogo": n_cat,
                  "encontrados": len(tp), "falsos": len(fp), "duplicados": len(dup), "em_falta": len(fn),
                  "precisao": round(len(tp) / n_cat, 3) if n_cat else None,
                  "recall": round(len(tp) / (len(tp) + len(fn)), 3) if tp or fn else None,
                  "erro_posicao_m": dist_stats([p["erro_m"] for p in tp])}
    por_metodo = defaultdict(lambda: {"encontrados": 0, "falsos": 0, "duplicados": 0, "erros": []})
    for p in res["pares"]:
        m = por_metodo[p["elemento"].get("metodo_posicao") or "?"]
        m["encontrados"] += 1
        m["erros"].append(p["erro_m"])
    for k in ("falsos", "duplicados"):
        for e in res[k]:
            por_metodo[e.get("metodo_posicao") or "?"][k] += 1
    out["por_metodo_posicao"] = {
        m: {"encontrados": v["encontrados"], "falsos": v["falsos"], "duplicados": v["duplicados"],
            "precisao": round(v["encontrados"] / max(1, v["encontrados"] + v["falsos"] + v["duplicados"]), 3),
            "erro_posicao_m": dist_stats(v["erros"])}
        for m, v in sorted(por_metodo.items())}
    return out


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m10 = {"dist_max_m": 8.0, **(cfg.get("m10") or {})}
    zdir = zone_dir(cfg)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--referencia", type=Path, default=ROOT / m10.get("referencia", zdir / "referencia.csv"))
    ap.add_argument("--elementos", type=Path, default=zdir / "catalogo/elementos.json")
    ap.add_argument("--saida", type=Path, default=zdir / "catalogo/metrica.json")
    args = ap.parse_args()

    inside = zone_contains(cfg)
    refs, ign = load_reference(args.referencia, inside)
    els = [e for e in json.load(open(args.elementos))
           if inside(e["lon"], e["lat"]) and e.get("estado") != "rejeitado"]
    if not refs:
        sys.exit(f"referência sem linhas utilizáveis em {args.referencia} (ignoradas: {dict(ign)})")
    res = match(els, refs, float(m10["dist_max_m"]))
    s = summarize(res, Counter(r["tipo"] for r in refs))
    s["referencias_ignoradas"] = dict(ign)
    s["regra"] = {"dist_max_m": m10["dist_max_m"], "um_a_um": True, "papeleiras": "excluídas",
                  "zona": cfg.get("zona_avaliacao_geojson")}
    s["detalhe"] = {
        "encontrados": [{"elemento": p["elemento"]["id"], "referencia": p["referencia"].get("id"),
                         "erro_m": round(p["erro_m"], 2)} for p in res["pares"]],
        "falsos": [e["id"] for e in res["falsos"]], "duplicados": [e["id"] for e in res["duplicados"]],
        "em_falta": [r.get("id") for r in res["em_falta"]]}
    args.saida.write_text(json.dumps(s, ensure_ascii=False, indent=1))

    print(f"{'classe':10s} {'ref':>4s} {'cat':>4s} {'encontr.':>8s} {'falsos':>6s} {'dupl.':>5s} "
          f"{'falta':>5s} {'precisão':>8s} {'recall':>6s}  erro mediana / p90 (m)")
    for g in ("todas",) + CLASSES:
        r = s[g]
        e = r["erro_posicao_m"] or {}
        print(f"{g:10s} {r['referencia']:4d} {r['catalogo']:4d} {r['encontrados']:8d} {r['falsos']:6d} "
              f"{r['duplicados']:5d} {r['em_falta']:5d} {str(r['precisao']):>8s} {str(r['recall']):>6s}  "
              f"{e.get('mediana', '—')} / {e.get('p90', '—')}")
    print("\npor metodo_posicao:")
    for m, r in s["por_metodo_posicao"].items():
        e = r["erro_posicao_m"] or {}
        print(f"  {m:12s} encontrados {r['encontrados']:3d}  falsos {r['falsos']:3d}  duplicados {r['duplicados']:3d}"
              f"  precisão {r['precisao']}  erro mediana {e.get('mediana', '—')} m, p90 {e.get('p90', '—')} m")
    if ign:
        print(f"\nreferências ignoradas: {dict(ign)}")
    print(f"→ {args.saida.relative_to(ROOT) if args.saida.resolve().is_relative_to(ROOT) else args.saida}")


if __name__ == "__main__":
    main()
