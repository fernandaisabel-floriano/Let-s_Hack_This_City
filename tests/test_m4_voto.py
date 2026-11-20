#!/usr/bin/env python3
"""Testes do voto do subtipo por elemento (pipeline/m4_voto.py).

    python tests/test_m4_voto.py      (ou: pytest tests/)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent.parent / "pipeline")]

from m4_voto import votar_subtipo  # noqa: E402

M4 = {"voto": "especifico", "voto_lado_max_px": 100, "voto_min_fracao": 0.6}


def vista(sub, conf=0.8, lado=80, incerto=False):
    return {"subclasse": sub, "bbox": [0, 0, lado, lado],
            "extra": {"confianca_classificacao": conf, "m4_incerto": incerto}}


def test_stop_em_minoria_vai_para_a_fila_como_stop():
    # poste com STOP + várias placas (sin_0001): antes ficava "outro_sinal" sem fila
    vs = [vista("stop")] + [vista("outro_sinal")] * 6
    sub, _, incerto, _ = votar_subtipo(vs, M4)
    assert (sub, incerto) == ("stop", True)
    assert votar_subtipo(vs, {**M4, "voto": "maioria"})[0] == "outro_sinal"


def test_especifico_em_maioria_entra_certo():
    sub, frac, incerto, _ = votar_subtipo([vista("cedencia_passagem")] * 3 + [vista("outro_sinal")], M4)
    assert (sub, incerto) == ("cedencia_passagem", False) and frac >= 0.6


def test_especifico_incerto_nao_conta():
    # CLIP stop vetado pela forma (m4_incerto) não é prova
    sub, _, incerto, _ = votar_subtipo([vista("stop", incerto=True)] + [vista("outro_sinal")] * 3, M4)
    assert (sub, incerto) == ("outro_sinal", False)


def test_familias_especificas_em_conflito_ficam_incertas():
    sub, _, incerto, _ = votar_subtipo([vista("stop"), vista("cedencia_passagem")], M4)
    assert (sub, incerto) == ("outro_sinal", True)


def test_limite_com_valor_e_valores_em_conflito():
    assert votar_subtipo([vista("limite_40")] * 2, M4)[:3:2] == ("limite_40", False)
    sub, _, incerto, _ = votar_subtipo([vista("limite_40"), vista("limite_50")], M4)
    assert (sub, incerto) == ("limite_desconhecido", True)


def test_anel_sem_valor_vai_para_a_fila_como_limite():
    vs = [vista("limite_desconhecido", incerto=True)] + [vista("outro_sinal")] * 5
    assert votar_subtipo(vs, M4)[:3:2] == ("limite_desconhecido", True)


def test_so_outro_sinal_fica_igual():
    vs = [vista("outro_sinal")] * 3 + [vista("costas")]
    assert votar_subtipo(vs, M4) == votar_subtipo(vs, {**M4, "voto": "maioria"})


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
