#!/usr/bin/env python3
"""Testes da sonda e da variante p6 (pipeline/classify_signs.py, pipeline/retreino.py).

    python tests/test_m4_sonda.py      (ou: pytest tests/)
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path[:0] = [str(Path(__file__).resolve().parent.parent / "pipeline")]

from classify_signs import CLASSES_SONDA, DEFAULTS, LABELS_FAM, Sonda, decide_p6  # noqa: E402
from retreino import prob, treinar  # noqa: E402

M4 = {**DEFAULTS, "sonda": {**DEFAULTS["sonda"], "especifica_min": 0.9, "nao_sinal_min": 0.5, "sugere_min": 0.5}}


def ctx(fam_clip="outro_sinal", forma="nenhuma", sonda=None, prompt="traffic sign", lado=80, num=None):
    p = np.array([1.0 if f == fam_clip else 0.0 for _, f, _, _ in LABELS_FAM])
    c = {"p_fam": p / p.sum(), "forma": {"forma": forma}, "prompt": prompt, "lado": lado, "num": num or {}}
    if sonda:
        c["p_sonda"] = {k: sonda.get(k, 0.0) for k in CLASSES_SONDA}
    return c


def test_sem_sonda_igual_a_p5():
    assert decide_p6(ctx(), M4)["subclasse"] == "outro_sinal"


def test_forma_abre_a_porta_mesmo_com_sonda_contra():
    r = decide_p6(ctx(fam_clip="stop", forma="stop", sonda={"nao_sinal": 0.99}), M4)
    assert r["subclasse"] == "stop" and not r["incerto"]


def test_nao_e_sinal_abstem_se():
    r = decide_p6(ctx(sonda={"nao_sinal": 0.8}), M4)
    assert r["subclasse"] == "outro_sinal" and r["incerto"]


def test_sonda_confiante_da_especifico():
    r = decide_p6(ctx(sonda={"cedencia_passagem": 0.95}), M4)
    assert r["subclasse"] == "cedencia_passagem" and not r["incerto"]


def test_sonda_media_so_sugere():
    r = decide_p6(ctx(sonda={"stop": 0.7}), M4)
    assert r["subclasse"] == "outro_sinal" and r["incerto"] and "possível stop" in r["motivo"]


def test_limite_sem_valor_fica_por_ler():
    r = decide_p6(ctx(sonda={"limite": 0.95}), M4)
    assert r["subclasse"] == "limite_desconhecido" and r["incerto"]
    r = decide_p6(ctx(sonda={"limite": 0.95}, num={"valor": 40, "score": 0.9}), M4)
    assert r["subclasse"] == "limite_40" and not r["incerto"]


def test_treino_separa_e_guarda():
    rng = np.random.default_rng(0)
    X = np.vstack([rng.normal(k, 0.1, (10, 4)) for k in range(len(CLASSES_SONDA))])
    y = np.repeat(np.arange(len(CLASSES_SONDA)), 10)
    W, b = treinar(X, y, 1e-4)
    assert (prob(X, W, b).argmax(1) == y).mean() == 1.0
    with tempfile.TemporaryDirectory() as d:
        s = Sonda(W, b, CLASSES_SONDA, {"x": 1})
        s.guardar(Path(d) / "s.npz")
        t = Sonda.carregar(Path(d) / "s.npz")
        assert t.classes == CLASSES_SONDA and t.meta == {"x": 1} and np.allclose(t.probs(X), s.probs(X), atol=1e-4)


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
