#!/usr/bin/env python3
"""Testes da fusão coerente (pipeline/fuse.py, etapa 2) com raios sintéticos.

    python tests/test_fusao_coerente.py      (ou: pytest tests/)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
sys.path[:0] = [str(AQUI.parent / "pipeline")]

import fuse  # noqa: E402

PROJ = fuse.Proj("EPSG:3763")
EDIF = fuse.Edificios(None, PROJ)
P = {**fuse.DEFAULTS, "fundir_dist_m": 8, "fundir_tol_m": 1.5, "fundir_sobreposicao_x": 0.7}
X0, Y0 = -44330.0, 107890.0   # zona piloto, em metros (PT-TM06)


def raio(cam_xy, alvo_xy, img, bbox=(100, 100, 140, 200)):
    c, t = np.array(cam_xy, float), np.array(alvo_xy, float)
    u = (t - c) / np.linalg.norm(t - c)
    return {"c": c, "u": u, "img": img, "det": {"bbox": list(bbox)}}


def elemento(classe, ponto_xy, raios):
    lon, lat = PROJ.ll(*ponto_xy)
    return {"classe": classe, "lon": lon, "lat": lat, "metodo": "triangulado", "membros": raios, "ajustado_edificio": False}


def objeto(alvo, cams, prefixo, classe="candeeiro", desvio=(0.0, 0.0)):
    """Elemento triangulado com raios para `alvo`, mas com o ponto calculado deslocado."""
    rs = [raio(c, alvo, f"{prefixo}{k}") for k, c in enumerate(cams)]
    return elemento(classe, (alvo[0] + desvio[0], alvo[1] + desvio[1]), rs)


ALVO = (X0, Y0)
CAMS_A = [(X0 - 15, Y0 - 6), (X0 - 10, Y0 - 6), (X0 - 5, Y0 - 6)]   # uma sequência
CAMS_B = [(X0 + 6, Y0 - 7), (X0 + 11, Y0 - 7)]                     # outra sequência


def test_mesmo_objeto_partido_em_dois_junta():
    a = objeto(ALVO, CAMS_A, "a", desvio=(-2.5, 0))
    b = objeto(ALVO, CAMS_B, "b", desvio=(2.5, 0))
    out, n = fuse.fundir_coerentes([a, b], P, PROJ, EDIF)
    assert n == 1 and len(out) == 1 and len(out[0]["membros"]) == 5
    x, y = PROJ.xy(out[0]["lon"], out[0]["lat"])
    assert math.hypot(x - X0, y - Y0) < 0.5   # o ponto comum é o objeto


def test_dois_objetos_vizinhos_nao_juntam():
    """Dois candeeiros a 6 m: as direções não se cruzam num só ponto."""
    a = objeto(ALVO, CAMS_A, "a")
    b = objeto((X0 + 6, Y0), CAMS_B, "b")
    out, n = fuse.fundir_coerentes([a, b], P, PROJ, EDIF)
    assert n == 0 and len(out) == 2


def test_classes_diferentes_nao_juntam():
    a = objeto(ALVO, CAMS_A, "a", desvio=(-1, 0))
    b = objeto(ALVO, CAMS_B, "b", classe="sinal", desvio=(1, 0))
    assert fuse.fundir_coerentes([a, b], P, PROJ, EDIF)[1] == 0


def test_mesma_foto_mesma_direcao_junta():
    """O detetor marcou o mesmo candeeiro duas vezes na mesma foto (cabeça e poste): junta."""
    a = objeto(ALVO, CAMS_A, "a", desvio=(-1, 0))
    b = objeto(ALVO, CAMS_B, "b", desvio=(1, 0))
    comum = raio(CAMS_A[0], ALVO, "a0", bbox=(105, 60, 135, 120))   # caixa sobreposta na horizontal
    b["membros"].append(comum)
    out, n = fuse.fundir_coerentes([a, b], P, PROJ, EDIF)
    assert n == 1


def test_mesma_foto_direcoes_diferentes_nao_junta():
    """Duas caixas em lados diferentes da mesma foto são dois objetos, mesmo que os raios batam."""
    a = objeto(ALVO, CAMS_A, "a", desvio=(-1, 0))
    b = objeto(ALVO, CAMS_B, "b", desvio=(1, 0))
    b["membros"].append(raio(CAMS_A[0], ALVO, "a0", bbox=(600, 100, 640, 200)))
    assert fuse.fundir_coerentes([a, b], P, PROJ, EDIF)[1] == 0


def test_desligado():
    a = objeto(ALVO, CAMS_A, "a", desvio=(-2.5, 0))
    b = objeto(ALVO, CAMS_B, "b", desvio=(2.5, 0))
    assert fuse.fundir_coerentes([a, b], {**P, "fundir_dist_m": 0}, PROJ, EDIF)[1] == 0


def test_uma_so_imagem_nao_junta():
    """Com uma só imagem num dos lados, dois raios cruzam-se sempre algures: não se arrisca."""
    a = objeto(ALVO, CAMS_A, "a", desvio=(-1, 0))
    b = objeto(ALVO, CAMS_B[:1], "b", desvio=(1, 0))
    assert fuse.fundir_coerentes([a, b], P, PROJ, EDIF)[1] == 0


if __name__ == "__main__":
    testes = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in testes:
        f()
        print(f"ok  {n}")
    print(f"{len(testes)} testes ok")
