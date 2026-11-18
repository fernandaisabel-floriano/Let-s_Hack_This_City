"""CLIP FALSO — responde o que um "oráculo" manda, para testar o percurso da M4.

Só entra com PYTHONPATH=tests/fakes (tests/percurso_m4.py). Nunca em produção.

O oráculo (JSON em $CTRLF_CLIP_ORACULO) liga a impressão digital de cada
imagem que o classificador vê (recorte largo ou justo) a massas de
probabilidade por palavra-chave das frases, p.ex. {"STOP": 0.7}. A massa de
cada palavra-chave divide-se pelas frases que a contêm; o resto espalha-se pelas
outras. Imagem desconhecida → distribuição uniforme (e conta em DESCONHECIDAS).

A imagem é reduzida a 32×32 no "preprocess"; a impressão digital é o md5
desses píxeis (impressao_digital), que o gerador dos dados falsos calcula da
mesma maneira.
"""
from __future__ import annotations

import atexit
import hashlib
import json
import os
import sys

import numpy as np

from torch import T

D = 256
DESCONHECIDAS = [0]
_frases: list[str] = []


@atexit.register
def _aviso():
    if DESCONHECIDAS[0]:
        print(f"CLIP FALSO: {DESCONHECIDAS[0]} imagens fora do oráculo", file=sys.stderr)


def reduzir(pil):
    from PIL import Image
    return np.asarray(pil.convert("RGB").resize((32, 32), Image.BILINEAR))


def impressao_digital(arr: np.ndarray) -> str:
    return hashlib.md5(np.ascontiguousarray(arr, dtype=np.uint8).tobytes()).hexdigest()


def tokenize(frases):
    return list(frases)


class _Modelo:
    def __init__(self):
        p = os.environ.get("CTRLF_CLIP_ORACULO")
        self.oraculo = json.load(open(p, encoding="utf-8")) if p else {}

    def encode_text(self, frases):
        rows = []
        for f in frases:
            if f not in _frases:
                _frases.append(f)
            v = np.zeros(D)
            v[_frases.index(f)] = 1.0
            rows.append(v)
        return T(np.array(rows))

    def encode_image(self, batch: T):
        out = []
        for arr in batch.a:
            spec = self.oraculo.get(impressao_digital(arr))
            if spec is None:
                DESCONHECIDAS[0] += 1
                spec = {}
            n = len(_frases)
            p = np.zeros(n)
            livres = np.ones(n, bool)
            for chave, massa in spec.items():
                idx = [i for i, f in enumerate(_frases) if chave in f]
                for i in idx:
                    p[i] += massa / len(idx)
                    livres[i] = False
            resto = max(0.0, 1.0 - p.sum())
            p[livres] += resto / max(1, livres.sum())
            p = np.clip(p, 1e-6, None)
            # logit = 100·v·t = log p  →  v_i = log(p_i)/100; dimensão de folga para |v| = 1
            v = np.zeros(D)
            v[:n] = np.log(p) / 100.0
            v[D - 1] = np.sqrt(max(0.0, 1.0 - (v[:n] ** 2).sum()))
            out.append(v)
        return T(np.array(out))


def load(nome, device="cpu", download_root=None):
    return _Modelo(), lambda pil: T(reduzir(pil))
