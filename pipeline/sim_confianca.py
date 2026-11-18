#!/usr/bin/env python3
"""Simulação da confiança do elemento fundido (M6 → M8).

Compara fórmulas para `confianca_elemento` e quantos elementos entram direto
no catálogo com o limiar do config (m8.limiar_auto).

Dados reais: confianças por objeto rotulado nos testes do YOLO-World
(reports/yolo_world_test/*/raw_detections.json + labels.json), com os prompts
recomendados (sinal: 3 prompts, deteção ≥ 0,05; candeeiro: "street lamp", ≥ 0,1).

Pressupostos (explícitos, a substituir por dados reais da M6):
  * cada elemento tem uma confiança "base" tirada da distribuição real
    (reais ou falsos); em cada vista a confiança varia log-normalmente (σ=0,35);
  * vistas Mapillary independentes; frames de vídeo correlacionados (AR(1), ρ=0,8);
  * n.º de vistas onde o elemento está ao alcance: Mapillary 1–5, vídeo 6–18;
  * 70 % dos falsos positivos são persistentes (estruturas reais: postes,
    antenas, armários — vistos como um objeto real); 30 % transitórios (1 vista);
  * proporção falsos/reais igual à observada nos testes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT  # noqa: E402
from confianca import m8_cfg  # noqa: E402
from test_yolo_world_prompts import iou  # noqa: E402

BASE = ROOT / "reports/yolo_world_test"
OUT = ROOT / "reports/confianca_sim"
SETS = {"sinal": (["traffic sign", "stop sign", "road sign"], 0.05),
        "candeeiro": (["street lamp"], 0.10)}
RNG = np.random.default_rng(42)
LIMIAR = m8_cfg()["limiar_auto"]


def empirical() -> dict:
    labels = json.load(open(BASE / "labels.json", encoding="utf-8"))["caixas"]
    out = {g: {"real": [], "falso": []} for g in SETS}
    vistos = set()  # a mesma imagem pode estar em v1, v2 e v3
    for raw_p in sorted(BASE.glob("*/raw_detections.json")):
        raw = json.load(open(raw_p, encoding="utf-8"))
        for o in raw["objetos"]:
            if o["grupo"] not in SETS:
                continue
            prompts, thr = SETS[o["grupo"]]
            cs = [d["conf"] for d in raw["deteccoes"] if d.get("obj") == o["obj"] and d["prompt"] in prompts]
            if not cs or max(cs) < thr:
                continue
            lb = next((lb for lb in labels if lb["image"] == o["image"] and lb["grupo"] == o["grupo"]
                       and iou(lb["bbox"], o["bbox"]) >= 0.5), None)
            key = (o["image"], o["grupo"], tuple(round(v) for v in o["bbox"]))
            if lb is not None and key not in vistos:
                vistos.add(key)
                out[o["grupo"]]["real" if lb["real"] else "falso"].append(max(cs))
    return out


def fit_logistic(c_real, c_false) -> tuple[float, float]:
    """P(real | c) = σ(a + b·logit(c)), ajustado por Newton (calibração de Platt)."""
    c = np.clip(np.r_[c_real, c_false], 1e-4, 1 - 1e-4)
    x = np.log(c / (1 - c))
    y = np.r_[np.ones(len(c_real)), np.zeros(len(c_false))]
    w = np.zeros(2)
    X = np.c_[np.ones_like(x), x]
    for _ in range(50):
        p = 1 / (1 + np.exp(-X @ w))
        H = X.T @ (X * (p * (1 - p))[:, None]) + 1e-6 * np.eye(2)
        w -= np.linalg.solve(H, X.T @ (p - y))
    return float(w[0]), float(w[1])


def calibrated(c, ab):
    c = np.clip(c, 1e-4, 1 - 1e-4)
    return 1 / (1 + np.exp(-(ab[0] + ab[1] * np.log(c / (1 - c)))))


def views(base: float, n: int, rho: float, thr: float) -> np.ndarray:
    """Confianças das vistas em que o elemento é detetado (≥ limiar de deteção)."""
    e = np.empty(n)
    e[0] = RNG.normal()
    for i in range(1, n):
        e[i] = rho * e[i - 1] + np.sqrt(1 - rho ** 2) * RNG.normal()
    c = np.clip(base * np.exp(0.35 * e), 0, 0.99)
    return c[c >= thr]


def formulas(c: np.ndarray, ab) -> dict:
    n = len(c)
    nor = 1 - np.prod(1 - c)
    top = np.sort(c)[::-1][:3]
    return {
        "A_noisy_or": nor,
        "B_noisy_or_limitado": min(nor, 1 - 0.5 ** n),       # 1 vista ≤ 0,5; 2 ≤ 0,75; 3 ≤ 0,875
        "C_calibrada_top3_n2": float(calibrated(top.mean(), ab)) if n >= 2 else 0.0,
    }


def simulate(g: str, emp: dict, ab, fonte: str, n_real=2000) -> dict:
    _, thr = SETS[g]
    rho, nmin, nmax = (0.0, 1, 5) if fonte == "mapillary" else (0.8, 6, 18)
    ratio = len(emp["falso"]) / len(emp["real"])
    res = {k: {"reais_auto": 0, "falsos_auto": 0} for k in ("A_noisy_or", "B_noisy_or_limitado", "C_calibrada_top3_n2")}
    reais = falsos = 0
    for kind, count in (("real", n_real), ("falso", int(n_real * ratio))):
        for _ in range(count):
            base = RNG.choice(emp[kind])
            n = RNG.integers(nmin, nmax + 1)
            if kind == "falso" and RNG.random() < 0.3:
                n = 1  # transitório
            c = views(base, n, rho, thr)
            if len(c) == 0:
                continue  # nunca detetado → não existe como elemento
            reais += kind == "real"; falsos += kind == "falso"
            for k, v in formulas(c, ab).items():
                if v >= LIMIAR:
                    res[k]["reais_auto" if kind == "real" else "falsos_auto"] += 1
    for k, r in res.items():
        tot = r["reais_auto"] + r["falsos_auto"]
        r["pct_reais_auto"] = round(100 * r["reais_auto"] / reais, 1)
        r["pct_falsos_auto"] = round(100 * r["falsos_auto"] / max(1, falsos), 1)
        r["precisao_auto"] = round(r["reais_auto"] / tot, 3) if tot else None
        r["fila_por_100_reais"] = round(100 * ((reais - r["reais_auto"]) + (falsos - r["falsos_auto"])) / reais, 1)
    return {"elementos_reais": reais, "elementos_falsos": falsos, "formulas": res}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    emp = empirical()
    report = {"limiar": LIMIAR, "classes": {}}
    for g in SETS:
        ab = fit_logistic(emp[g]["real"], emp[g]["falso"])
        report["classes"][g] = {
            "objetos_rotulados": {"reais": len(emp[g]["real"]), "falsos": len(emp[g]["falso"])},
            "calibracao_platt": {"a": round(ab[0], 3), "b": round(ab[1], 3),
                                 "c_para_limiar": round(float(1 / (1 + np.exp(-((np.log(LIMIAR / (1 - LIMIAR)) - ab[0]) / ab[1])))), 3)},
            "mapillary": simulate(g, emp[g], ab, "mapillary"),
            "video": simulate(g, emp[g], ab, "video"),
        }
    (OUT / "resultados.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    for g, r in report["classes"].items():
        print(f"\n{g}: {r['objetos_rotulados']}  calibração: c={r['calibracao_platt']['c_para_limiar']} ↔ P(real)={LIMIAR}")
        for fonte in ("mapillary", "video"):
            s = r[fonte]
            print(f"  {fonte} ({s['elementos_reais']} reais, {s['elementos_falsos']} falsos)")
            for k, f in s["formulas"].items():
                print(f"    {k:22s} reais auto {f['pct_reais_auto']:5.1f}%   falsos auto {f['pct_falsos_auto']:5.1f}%"
                      f"   precisão auto {f['precisao_auto']}   fila/100 reais {f['fila_por_100_reais']}")


if __name__ == "__main__":
    main()
