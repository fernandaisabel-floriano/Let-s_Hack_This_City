"""Sinais e contentores sintéticos (BGR, 200×200) para os testes da M4.

Desenhados à mão com as cores e formas do RST; não são imagens reais.
"""
from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

RED, WHITE, BLUE, BLACK, GREY = (30, 30, 200), (245, 245, 245), (170, 80, 20), (20, 20, 20), (150, 150, 150)
FONTE = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FUNDO = (120, 140, 110)


def _fundo(S=200):
    return np.full((S, S, 3), FUNDO, np.uint8)


def _texto(im, s, size, center, color=BLACK):
    pil = Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)
    try:
        f = ImageFont.truetype(FONTE, size)
    except OSError:
        f = ImageFont.load_default()
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=f)
    d.text((center[0] - (x1 - x0) / 2 - x0, center[1] - (y1 - y0) / 2 - y0), s, font=f, fill=color[::-1])
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def limite(v):
    im = _fundo()
    cv2.circle(im, (100, 100), 92, RED, -1, cv2.LINE_AA)
    cv2.circle(im, (100, 100), 74, WHITE, -1, cv2.LINE_AA)
    return _texto(im, str(v), 78 if len(str(v)) < 3 else 58, (100, 102))


def stop():
    im = _fundo()
    pts = np.array([[100 + 92 * math.cos(math.radians(22.5 + 45 * k)),
                     100 + 92 * math.sin(math.radians(22.5 + 45 * k))] for k in range(8)], np.int32)
    cv2.fillPoly(im, [pts], WHITE)
    cv2.fillPoly(im, [((pts - 100) * 0.9 + 100).astype(np.int32)], RED)
    return _texto(im, "STOP", 44, (100, 100), WHITE)


def cedencia():
    im = _fundo()
    p = np.array([[12, 25], [188, 25], [100, 180]], np.int32)
    cv2.fillPoly(im, [p], RED)
    cv2.fillPoly(im, [((p - [100, 77]) * 0.62 + [100, 77]).astype(np.int32)], WHITE)
    return im


def perigo():
    im = _fundo()
    p = np.array([[12, 175], [188, 175], [100, 20]], np.int32)
    cv2.fillPoly(im, [p], RED)
    cv2.fillPoly(im, [((p - [100, 123]) * 0.62 + [100, 123]).astype(np.int32)], WHITE)
    return _texto(im, "!", 60, (100, 130))


def sentido_proibido():
    im = _fundo()
    cv2.circle(im, (100, 100), 92, RED, -1, cv2.LINE_AA)
    cv2.rectangle(im, (35, 85), (165, 115), WHITE, -1)
    return im


def estacionamento_proibido():
    im = _fundo()
    cv2.circle(im, (100, 100), 92, RED, -1, cv2.LINE_AA)
    cv2.circle(im, (100, 100), 74, BLUE, -1, cv2.LINE_AA)
    cv2.line(im, (48, 48), (152, 152), RED, 16)
    return im


def proibido_pesados():
    im = _fundo()
    cv2.circle(im, (100, 100), 92, RED, -1, cv2.LINE_AA)
    cv2.circle(im, (100, 100), 74, WHITE, -1, cv2.LINE_AA)
    cv2.rectangle(im, (55, 80), (135, 120), BLACK, -1)
    cv2.circle(im, (70, 125), 9, BLACK, -1)
    cv2.circle(im, (120, 125), 9, BLACK, -1)
    return im


def informacao():
    im = _fundo()
    cv2.rectangle(im, (15, 15), (185, 185), BLUE, -1)
    return _texto(im, "P", 100, (100, 100), WHITE)


def costas():
    im = _fundo()
    cv2.circle(im, (100, 100), 92, GREY, -1)
    return im


def contentor_ilha():
    im = _fundo()
    for k, cor in enumerate([(40, 140, 40), (40, 180, 220), (200, 120, 40)]):
        cv2.rectangle(im, (10 + k * 62, 40), (66 + k * 62, 195), cor, -1)
    return im


def papeleira():
    im = _fundo()
    cv2.rectangle(im, (70, 60), (130, 190), (60, 60, 60), -1)
    return im


CASOS = {
    "limite_30": lambda: limite(30), "limite_40": lambda: limite(40), "limite_50": lambda: limite(50),
    "limite_20": lambda: limite(20), "limite_60": lambda: limite(60), "limite_80": lambda: limite(80),
    "limite_90": lambda: limite(90), "limite_100": lambda: limite(100),
    "stop": stop, "cedencia": cedencia, "perigo": perigo, "sentido_proibido": sentido_proibido,
    "estacionamento_proibido": estacionamento_proibido, "proibido_pesados": proibido_pesados,
    "informacao": informacao, "costas": costas,
}


def degradar(im, lado, blur, seed):
    """Reduz a `lado` px, desfoca, muda o brilho, junta ruído e comprime em JPEG."""
    rng = np.random.default_rng(seed)
    s = cv2.resize(im, (lado, lado), interpolation=cv2.INTER_AREA)
    if blur:
        s = cv2.GaussianBlur(s, (0, 0), blur)
    s = np.clip(s.astype(float) * rng.uniform(0.7, 1.1) + rng.normal(0, 6, s.shape), 0, 255).astype(np.uint8)
    _, j = cv2.imencode(".jpg", s, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return cv2.imdecode(j, 1)
