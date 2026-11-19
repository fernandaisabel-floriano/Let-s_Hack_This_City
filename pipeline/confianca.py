#!/usr/bin/env python3
"""Confiança do elemento fundido (M6 → M8) e recalibração com o uso (P1.3).

    confianca_elemento = P(real) = σ(a + b · logit(média das top_k confianças das vistas))

com (a, b) ajustados por classe (calibração de Platt). Entra direto no
catálogo se confianca_elemento ≥ limiar_auto E n_vistas ≥ min_vistas;
caso contrário vai para a fila do técnico. Classe sem calibração (poucos
rótulos) → None → vai sempre para a fila.

A calibração vive em config/calibracao.json e é reajustada com as validações
do técnico: validado → real; rejeitado → falso; corrigido → real se só mudou a
posição (P1.4), falso para a classe original se mudou de tipo (`classe_corrigida`). As validações juntam-se aos rótulos iniciais
(testes do YOLO-World), por isso a calibração melhora a cada validação.

Uso:
    python pipeline/confianca.py inicial                 # a partir dos testes
    python pipeline/confianca.py recalibrar VALIDACOES.json
        VALIDACOES.json = [{"classe": "sinal", "confiancas_vistas": [0.4, 0.2],
                            "estado": "validado|corrigido|rejeitado",
                            "classe_corrigida": "candeeiro"  # opcional}, ...]
    python pipeline/confianca.py mostrar
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config  # noqa: E402

DEFAULTS = {"top_k": 3, "min_vistas": 2, "limiar_auto": 0.9,
            "calibracao": "config/calibracao.json", "min_rotulos_por_lado": 10}
EPS = 1e-4


def m8_cfg(cfg: dict | None = None) -> dict:
    cfg = cfg or load_config(ROOT / "config/municipio.yaml")
    return {**DEFAULTS, **(cfg.get("m8") or {})}


# ------------------------------------------------------------------ calibração

def _logit(c):
    c = np.clip(np.asarray(c, float), EPS, 1 - EPS)
    return np.log(c / (1 - c))


def fit_platt(confs, reais) -> tuple[float, float]:
    """Ajusta P(real|c) = σ(a + b·logit(c)) por Newton (com regularização leve)."""
    x = _logit(confs)
    y = np.asarray(reais, float)
    X = np.c_[np.ones_like(x), x]
    w = np.zeros(2)
    for _ in range(100):
        p = 1 / (1 + np.exp(-X @ w))
        H = X.T @ (X * (p * (1 - p))[:, None]) + 1e-3 * np.eye(2)
        step = np.linalg.solve(H, X.T @ (p - y) + 1e-3 * w)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return float(w[0]), float(w[1])


def feature(confs_vistas, top_k: int) -> float:
    c = sorted((float(x) for x in confs_vistas), reverse=True)[:top_k]
    return float(np.mean(c))


def load_calibration(m8: dict) -> dict:
    p = ROOT / m8["calibracao"]
    return json.loads(p.read_text()) if p.exists() else {"classes": {}, "rotulos": []}


def confianca_elemento(confs_vistas, classe: str, calib: dict, m8: dict) -> float | None:
    """P(real) do elemento; None se a classe ainda não tem calibração."""
    cal = calib["classes"].get(classe)
    if cal is None or not len(confs_vistas):
        return None
    f = feature(confs_vistas, m8["top_k"])
    return float(1 / (1 + np.exp(-(cal["a"] + cal["b"] * _logit(f)))))


def estado_inicial(confianca: float | None, n_vistas: int, m8: dict) -> str:
    """'auto' (entra direto no catálogo) ou 'fila' (vai para validação)."""
    if confianca is not None and confianca >= m8["limiar_auto"] and n_vistas >= m8["min_vistas"]:
        return "auto"
    return "fila"


def refit(calib: dict, m8: dict, fonte: str) -> dict:
    """Reajusta (a, b) por classe com todos os rótulos acumulados."""
    out = {}
    for classe in sorted({r["classe"] for r in calib["rotulos"]}):
        rs = [r for r in calib["rotulos"] if r["classe"] == classe]
        n1 = sum(r["real"] for r in rs)
        n0 = len(rs) - n1
        if min(n0, n1) < m8["min_rotulos_por_lado"]:
            print(f"  {classe}: só {n1} reais / {n0} falsos — sem calibração (tudo para a fila)")
            continue
        a, b = fit_platt([r["f"] for r in rs], [r["real"] for r in rs])
        # Valor da característica que dá P = limiar_auto (útil para explicar).
        L = m8["limiar_auto"]
        f_lim = 1 / (1 + np.exp(-((np.log(L / (1 - L)) - a) / b))) if b > 0 else None
        out[classe] = {"a": round(a, 4), "b": round(b, 4), "n_reais": n1, "n_falsos": n0,
                       "media_top_k_para_limiar": round(float(f_lim), 3) if f_lim is not None else None}
        print(f"  {classe}: {n1} reais / {n0} falsos → a={a:.3f} b={b:.3f}; "
              f"entra direto se média top-{m8['top_k']} ≥ {out[classe]['media_top_k_para_limiar']}")
    calib["classes"] = out
    calib["atualizado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    calib["ultima_fonte"] = fonte
    return calib


def save_calibration(calib: dict, m8: dict) -> None:
    (ROOT / m8["calibracao"]).write_text(json.dumps(calib, ensure_ascii=False, indent=1))


# ----------------------------------------------------------------------- CLI

def inicial() -> None:
    """Rótulos dos testes do YOLO-World (uma vista por objeto, prompts recomendados)."""
    from test_yolo_world_prompts import iou
    sets = {"sinal": (["traffic sign", "stop sign", "road sign"], 0.05),
            "candeeiro": (["street lamp"], 0.10),
            "contentor": (["dumpster", "recycling bins", "colored recycling containers",
                           "recycling container", "waste container", "trash can"], 0.10)}
    base = ROOT / "reports/yolo_world_test"
    labels = json.load(open(base / "labels.json"))["caixas"]
    rot, vistos = [], set()
    for raw_p in sorted(base.glob("*/raw_detections.json")):
        raw = json.load(open(raw_p))
        for o in raw["objetos"]:
            prompts, thr = sets[o["grupo"]]
            cs = [d["conf"] for d in raw["deteccoes"] if d.get("obj") == o["obj"] and d["prompt"] in prompts]
            if not cs or max(cs) < thr:
                continue
            lb = next((lb for lb in labels if lb["image"] == o["image"] and lb["grupo"] == o["grupo"]
                       and iou(lb["bbox"], o["bbox"]) >= 0.5), None)
            key = (o["image"], o["grupo"], tuple(round(v) for v in o["bbox"]))
            if lb is None or key in vistos:  # a mesma imagem pode estar em v1 e v2
                continue
            vistos.add(key)
            rot.append({"classe": o["grupo"], "f": round(max(cs), 4), "real": bool(lb["real"]),
                        "fonte": f"teste:{raw_p.parent.name}"})
    m8 = m8_cfg()
    calib = refit({"rotulos": rot}, m8, "testes YOLO-World")
    save_calibration(calib, m8)
    print(f"{len(rot)} rótulos → {m8['calibracao']}")


def recalibrar(path: Path) -> None:
    m8 = m8_cfg()
    calib = load_calibration(m8)
    vals = json.loads(Path(path).read_text())
    for v in vals:
        if v["estado"] not in ("validado", "corrigido", "rejeitado"):
            continue
        # duplicado de outro elemento: é um objeto real, mas não um elemento novo — não é rótulo
        # nem de real nem de falso para a calibração
        if v.get("duplicado_de"):
            continue
        f = round(feature(v["confiancas_vistas"], m8["top_k"]), 4)
        nova = v.get("classe_corrigida")
        mudou_tipo = v["estado"] == "corrigido" and nova and nova != v["classe"]
        # corrigido só na posição (P1.4) continua a ser um elemento real
        real = v["estado"] == "validado" or (v["estado"] == "corrigido" and not mudou_tipo)
        calib["rotulos"].append({"classe": v["classe"], "f": f, "real": real, "fonte": "validacao"})
    calib = refit(calib, m8, f"validações ({len(vals)})")
    save_calibration(calib, m8)


def mostrar() -> None:
    m8 = m8_cfg()
    calib = load_calibration(m8)
    print(json.dumps({k: v for k, v in calib.items() if k != "rotulos"}, ensure_ascii=False, indent=1))
    print(f"{len(calib.get('rotulos', []))} rótulos acumulados")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "mostrar"
    if cmd == "inicial":
        inicial()
    elif cmd == "recalibrar":
        recalibrar(Path(sys.argv[2]))
    else:
        mostrar()
