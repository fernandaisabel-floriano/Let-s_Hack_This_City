"""M4, filtro A — forma e cor do sinal com OpenCV (porta de entrada e veto).

Sobre o recorte quadrado e justo do sinal:

    octógono vermelho cheio            → "stop"
    triângulo invertido, bordo vermelho → "cedencia"
    anel vermelho com interior branco  → "anel_vermelho" (família limite possível)
    outra coisa                         → "nenhuma"  (nunca é limite)

Regras do RST usadas: o único sinal em triângulo invertido é a cedência (B1);
o único octógono é o STOP (B2); os limites de velocidade (C13) são um disco
branco com anel vermelho. Discos vermelhos cheios (sentido proibido), discos
azuis com bordo vermelho (estacionamento) e triângulos de vértice para cima
(perigo) caem em "nenhuma".

Uso isolado (depuração):
    python pipeline/m4_forma.py recorte.jpg [...]
"""
from __future__ import annotations

import math
import sys

import cv2
import numpy as np

S = 128  # lado da imagem de análise

DEFAULTS = {
    "vermelho_h": [10, 160],   # H ≤ 10 ou H ≥ 160 (OpenCV: 0–180)
    "vermelho_s_min": 80,
    "vermelho_v_min": 50,
    "area_min": 0.04,          # contorno vermelho ≥ 4 % do recorte
    "lado_min": 0.40,          # caixa do contorno ≥ 40 % do recorte
    "branco_s_max": 70,
    "branco_v_min": 110,
    # anel vermelho (limites): sinais vistos de lado são elipses. Medido nos
    # dados reais (18/11): com 0,75 / 0,80 o limite 40 inclinado falhava.
    "anel_aspeto_min": 0.65,         # largura/altura entre isto e 1/isto
    "anel_circularidade_min": 0.75,
}


def _cfg(cfg: dict | None) -> dict:
    return {**DEFAULTS, **(cfg or {})}


def para_analise(crop: np.ndarray) -> np.ndarray:
    interp = cv2.INTER_CUBIC if max(crop.shape[:2]) < S else cv2.INTER_AREA
    return cv2.resize(crop, (S, S), interpolation=interp)


def mascaras(img: np.ndarray, c: dict) -> tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    lo, hi = c["vermelho_h"]
    red = ((h <= lo) | (h >= hi)) & (s >= c["vermelho_s_min"]) & (v >= c["vermelho_v_min"])
    red = cv2.morphologyEx(red.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    white = ((s <= c["branco_s_max"]) & (v >= c["branco_v_min"])).astype(np.uint8)
    return red.astype(bool), white.astype(bool)


def _r_ratio(hull: np.ndarray, cx: float, cy: float) -> float:
    """min/máx da distância centro→contorno em 72 direções (círculo ≈ 1; octógono ≈ 0,92)."""
    pts = hull.reshape(-1, 2).astype(float)
    # amostra o contorno do polígono convexo (interpolação ao longo das arestas)
    dens = []
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        for t in np.linspace(0, 1, 12, endpoint=False):
            dens.append(a + t * (b - a))
    dens = np.array(dens)
    ang = np.arctan2(dens[:, 1] - cy, dens[:, 0] - cx)
    r = np.hypot(dens[:, 0] - cx, dens[:, 1] - cy)
    bins = ((ang + math.pi) / (2 * math.pi) * 72).astype(int) % 72
    rb = np.array([r[bins == k].max() for k in range(72) if (bins == k).any()])
    return float(rb.min() / max(rb.max(), 1e-9))


def analisar(crop: np.ndarray, cfg: dict | None = None) -> dict:
    """Classifica a forma do sinal. Devolve {forma, motivo, circulo?, medidas}."""
    c = _cfg(cfg)
    img = para_analise(crop)
    red, white = mascaras(img, c)
    out = {"forma": "nenhuma", "motivo": None}

    n, lab, stats, _ = cv2.connectedComponentsWithStats(red.astype(np.uint8), 8)
    if n <= 1:
        return out | {"motivo": "sem vermelho"}
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    comp = (lab == k).astype(np.uint8)
    if stats[k, cv2.CC_STAT_AREA] < c["area_min"] * S * S:
        return out | {"motivo": "pouco vermelho"}
    cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(max(cnts, key=cv2.contourArea))
    x, y, w, h = cv2.boundingRect(hull)
    if min(w, h) < c["lado_min"] * S:
        return out | {"motivo": "vermelho pequeno no recorte"}

    hmask = np.zeros((S, S), np.uint8)
    cv2.drawContours(hmask, [hull], -1, 1, -1)
    hmask = hmask.astype(bool)
    a_hull = float(hmask.sum())
    peri = cv2.arcLength(hull, True)
    fill = float((red & hmask).sum()) / a_hull           # fração vermelha dentro do contorno
    circ = 4 * math.pi * a_hull / max(peri * peri, 1e-9)
    approx = cv2.approxPolyDP(hull, 0.04 * peri, True).reshape(-1, 2)
    (ccx, ccy), cr = cv2.minEnclosingCircle(hull)
    m = cv2.moments(hmask.astype(np.uint8))
    gx, gy = m["m10"] / m["m00"], m["m01"] / m["m00"]

    # interior: contorno encolhido em direção ao centróide (no triângulo mais,
    # porque o bordo vermelho ocupa proporcionalmente mais e o desfoque espalha-o)
    def interior(f: float):
        m_ = np.zeros((S, S), np.uint8)
        cv2.drawContours(m_, [((hull.reshape(-1, 2) - [gx, gy]) * f + [gx, gy]).astype(np.int32)], -1, 1, -1)
        m_ = m_.astype(bool)
        n_ = max(1.0, float(m_.sum()))
        return m_, float((red & m_).sum()) / n_, float((white & m_).sum()) / n_

    inner, red_in, white_in = interior(0.45 if len(approx) == 3 else 0.6)

    med = {"vertices": int(len(approx)), "fill": round(fill, 3), "circularidade": round(circ, 3),
           "vermelho_interior": round(red_in, 3), "branco_interior": round(white_in, 3),
           "aspeto": round(w / max(h, 1), 3)}
    out["medidas"] = med

    # --- cedência: triângulo de vértice para baixo, bordo vermelho, interior branco
    if len(approx) == 3:
        ys = sorted(approx[:, 1])
        baixo = approx[np.argmax(approx[:, 1])]
        topo = approx[np.argsort(approx[:, 1])[:2]]
        nivelado = abs(int(topo[0, 1]) - int(topo[1, 1])) <= 0.15 * h
        para_baixo = (ys[2] - ys[1]) > 0.5 * h and min(topo[:, 0]) < baixo[0] < max(topo[:, 0])
        if nivelado and para_baixo and 0.12 <= fill <= 0.75 and red_in <= 0.25 and white_in >= 0.45:
            return out | {"forma": "cedencia", "motivo": "triângulo invertido"}
        return out | {"motivo": "triângulo de vértice para cima" if not para_baixo else "triângulo sem interior branco"}

    aspeto_ok = 0.75 <= w / max(h, 1) <= 1.33

    # --- STOP: octógono vermelho cheio, com letras brancas (não uma barra única)
    if aspeto_ok and fill >= 0.55 and 7 <= len(approx) <= 9:
        rr = _r_ratio(hull, gx, gy)
        med["r_ratio"] = round(rr, 3)
        barra = _barra_unica(~red & inner)
        if rr <= 0.955 and not barra:
            return out | {"forma": "stop", "motivo": "octógono vermelho"}
        return out | {"motivo": "disco vermelho (sentido proibido?)" if barra else "vermelho cheio mas circular"}

    # --- anel vermelho: disco com bordo vermelho e interior branco
    am = float(c["anel_aspeto_min"])
    anel_aspeto_ok = am <= w / max(h, 1) <= 1 / am
    if (anel_aspeto_ok and circ >= float(c["anel_circularidade_min"]) and 0.12 <= fill <= 0.62
            and red_in <= 0.15 and white_in >= 0.40):
        return out | {"forma": "anel_vermelho", "motivo": "anel vermelho",
                      "circulo": [round(ccx, 1), round(ccy, 1), round(cr, 1)]}
    return out | {"motivo": "forma não reconhecida"}


def _barra_unica(mask: np.ndarray) -> bool:
    """Interior não vermelho é uma só barra horizontal larga (sentido proibido)."""
    n, _, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    comps = [st[i] for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 0.01 * S * S]
    if len(comps) != 1:
        return False
    w, h, a = comps[0][cv2.CC_STAT_WIDTH], comps[0][cv2.CC_STAT_HEIGHT], comps[0][cv2.CC_STAT_AREA]
    return w / max(h, 1) >= 2.5 and a / max(w * h, 1) >= 0.75


if __name__ == "__main__":
    for p in sys.argv[1:]:
        im = cv2.imread(p)
        print(p, analisar(im) if im is not None else "não abre")
