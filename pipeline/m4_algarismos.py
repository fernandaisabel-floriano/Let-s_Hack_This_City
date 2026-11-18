#!/usr/bin/env python3
"""M4, opção C — leitura do valor do limite de velocidade por templates.

Só corre dentro da família limite (anel vermelho do filtro A). Isola a tinta
escura dentro do disco branco, separa-a em algarismos pelas colunas vazias e
compara cada algarismo com templates de 0–9 (correlação normalizada):

    exatamente 2 algarismos, o 2.º é "0", o 1.º ganha aos outros 9 com margem
    → valor = 1.º × 10, aceite só se estiver em m4.algarismos.aceites
      (30/40/50 para começar)
    qualquer outra coisa → None → "limite (valor desconhecido)"

Comparar o número inteiro não funciona: o "0" comum a todos os valores
domina a correlação (medido em sinais sintéticos: 50 vs 60 com margem 0,05).

Templates em config/m4/algarismos/<algarismo>__<origem>.png (tinta preta em
fundo branco, recortados à tinta). Os de origem "fonte" são gerados a partir
de tipos de letra livres próximos do RST; podem acrescentar-se algarismos
recortados de sinais reais com o mesmo esquema (p.ex. 4__real_01.png).

Uso:
    python pipeline/m4_algarismos.py gerar      # (re)gera os templates de fonte
    python pipeline/m4_algarismos.py ler recorte.jpg [...]
"""
from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT  # noqa: E402

TEMPL_DIR = ROOT / "config/m4/algarismos"
ALGARISMOS = list("0123456789")
FONTES = [  # tipos de letra livres de traço largo, próximos da letra dos sinais
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
TH = 40  # altura de comparação, px

DEFAULTS = {"aceites": [30, 40, 50], "score_min": 0.55, "margem_min": 0.08, "zero_min": 0.5,
            "fracao_interior": 0.74, "contraste_min": 18}


def _cfg(cfg: dict | None) -> dict:
    return {**DEFAULTS, **(cfg or {})}


def _tinta(mask: np.ndarray) -> np.ndarray | None:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def gerar() -> None:
    from PIL import Image, ImageDraw, ImageFont
    TEMPL_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for fp in FONTES:
        if not Path(fp).exists():
            print(f"  (sem {fp})")
            continue
        font = ImageFont.truetype(fp, 120)
        for v in ALGARISMOS:
            im = Image.new("L", (400, 200), 255)
            ImageDraw.Draw(im).text((20, 20), v, font=font, fill=0)
            t = _tinta(np.array(im) < 128)
            cv2.imwrite(str(TEMPL_DIR / f"{v}__fonte_{Path(fp).stem}.png"), np.where(t, 0, 255).astype(np.uint8))
            n += 1
    print(f"{n} templates → {TEMPL_DIR.relative_to(ROOT)}")


@lru_cache(maxsize=1)
def templates() -> list[tuple[str, np.ndarray]]:
    out = []
    for p in sorted(TEMPL_DIR.glob("*.png")):
        m = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) < 128
        t = _tinta(m)
        if t is not None:
            out.append((p.name.split("__")[0], t))
    if not out:
        raise FileNotFoundError(f"sem templates em {TEMPL_DIR}; correr: python pipeline/m4_algarismos.py gerar")
    return out


def isolar_algarismos(img: np.ndarray, circulo, c: dict) -> tuple[np.ndarray | None, str | None]:
    """Máscara (recortada) da tinta escura dentro do disco branco do sinal."""
    cx, cy, r = circulo
    rin = c["fracao_interior"] * r
    H, W = img.shape[:2]
    yy, xx = np.mgrid[:H, :W]
    dd = np.hypot(xx - cx, yy - cy)
    disc = dd <= rin
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    vals = gray[disc]
    if vals.size < 50 or vals.std() < c["contraste_min"]:
        return None, "sem contraste no disco"
    thr, _ = cv2.threshold(vals.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    nao_cor = hsv[..., 1] < 110
    dark = (gray < thr) & disc & nao_cor
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), 8)
    keep = np.zeros_like(dark)
    for i in range(1, n):
        comp = lab == i
        if st[i, cv2.CC_STAT_AREA] < 0.004 * disc.sum():
            continue
        if dd[comp].max() > 0.97 * rin:          # toca no bordo: resto do anel / sombra
            continue
        if st[i, cv2.CC_STAT_HEIGHT] < 0.35 * rin:
            continue
        keep |= comp
    t = _tinta(keep)
    if t is None:
        return None, "sem algarismos"
    return t, None


def separar(tinta: np.ndarray) -> list[np.ndarray]:
    """Divide a tinta em algarismos pelas colunas vazias (cada um recortado à tinta)."""
    h = tinta.shape[0]
    cols = tinta.any(axis=0)
    segs, x = [], 0
    while x < len(cols):
        if cols[x]:
            x0 = x
            while x < len(cols) and cols[x]:
                x += 1
            if x - x0 >= max(1, 0.08 * h) or tinta[:, x0:x].sum() >= 0.02 * h * h:
                segs.append(_tinta(tinta[:, x0:x]))
        else:
            x += 1
    segs = [s for s in segs if s is not None and s.shape[0] >= 0.6 * h]
    # Desfoque/baixa resolução colam os dois algarismos: uma só mancha com a
    # proporção de dois algarismos corta-se na coluna com menos tinta do meio.
    if len(segs) == 1 and 1.0 <= segs[0].shape[1] / segs[0].shape[0] <= 2.0:
        m = segs[0]
        w = m.shape[1]
        a, b = int(0.35 * w), int(0.65 * w) + 1
        x = a + int(np.argmin(m[:, a:b].sum(axis=0)))
        partes = [_tinta(m[:, :x]), _tinta(m[:, x:])]
        if all(p is not None and p.shape[0] >= 0.6 * m.shape[0] for p in partes):
            segs = partes
    return segs


def comparar(alg: np.ndarray) -> dict[str, float]:
    """Melhor correlação de um algarismo com cada um dos templates 0–9."""
    asp_in = alg.shape[1] / alg.shape[0]
    a = alg.astype(np.float32)
    best: dict[str, float] = {}
    for v, t in templates():
        asp_t = t.shape[1] / t.shape[0]
        if abs(np.log(asp_in / asp_t)) > np.log(1.6):
            continue
        tw = max(4, round(TH * asp_t))
        x = cv2.resize(a, (tw, TH), interpolation=cv2.INTER_AREA)
        y = cv2.resize(t.astype(np.float32), (tw, TH), interpolation=cv2.INTER_AREA)
        s = float(cv2.matchTemplate(x, y, cv2.TM_CCOEFF_NORMED)[0, 0])
        best[v] = max(best.get(v, -1.0), s)
    return best


def ler_valor(img128: np.ndarray, circulo, cfg: dict | None = None) -> dict:
    """{valor (int|None), score, margem, melhor, motivo}. valor None = desconhecido."""
    c = _cfg(cfg)
    vazio = {"valor": None, "score": 0.0, "margem": 0.0, "melhor": None}
    tinta, motivo = isolar_algarismos(img128, circulo, c)
    if tinta is None:
        return vazio | {"motivo": motivo}
    algs = separar(tinta)
    if len(algs) != 2:
        return vazio | {"motivo": f"{len(algs)} algarismos (esperados 2)"}
    s1 = sorted(comparar(algs[0]).items(), key=lambda kv: -kv[1])
    s2 = comparar(algs[1])
    if not s1:
        return vazio | {"motivo": "proporção do 1.º algarismo não bate"}
    d, s = s1[0]
    margem = s - (s1[1][1] if len(s1) > 1 else 0.0)
    zero = s2.get("0", -1.0)
    res = {"score": round(s, 3), "margem": round(margem, 3), "melhor": f"{d}0", "score_zero": round(zero, 3)}
    if zero < c["zero_min"] or max(s2, key=s2.get) != "0":
        return res | {"valor": None, "melhor": None, "motivo": "2.º algarismo não é 0"}
    if int(d) * 10 not in {int(a) for a in c["aceites"]}:
        return res | {"valor": None, "motivo": f"melhor é {d}0 (fora dos aceites)"}
    if s < c["score_min"]:
        return res | {"valor": None, "motivo": "correlação baixa"}
    if margem < c["margem_min"]:
        return res | {"valor": None, "motivo": f"ambíguo ({d} vs {s1[1][0]})"}
    return res | {"valor": int(d) * 10, "motivo": None}


if __name__ == "__main__":
    if sys.argv[1:2] == ["gerar"]:
        gerar()
    elif sys.argv[1:2] == ["ler"]:
        from m4_forma import analisar, para_analise
        for p in sys.argv[2:]:
            im = cv2.imread(p)
            f = analisar(im)
            print(p, f["forma"], ler_valor(para_analise(im), f["circulo"]) if f.get("circulo") else f["motivo"])
    else:
        sys.exit(__doc__)
