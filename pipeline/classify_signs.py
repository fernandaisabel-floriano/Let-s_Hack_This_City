#!/usr/bin/env python3
"""M4 — Classificação dos sinais detetados, em cascata, com prioridade à precisão.

O que não tiver certeza fica "outro_sinal" (incerto) ou "limite_desconhecido"
e vai para a fila do técnico (fuse.py força estado "pendente").

Variantes (cumulativas; m4.variante, ou --variante; m4_medir.py compara todas):

  atual  CLIP sem treino sobre o recorte largo; frase mais provável; limiar 0,25.
  p1     recorte quadrado e justo (m4.recorte_margem, 3–5 %) só para classificar
         (o recorte largo continua a ser o que o técnico vê); decide primeiro a
         família (stop / cedência / limite / outro / de costas) com um limiar por
         família e só depois, dentro de "limite", o número (m4.limiar_numero).
  p3     + filtro A (m4_forma.py) como porta de entrada e veto:
           octógono vermelho → stop; triângulo invertido → cedência (diretos);
           CLIP stop/cedência sem a forma → incerto;
           sem anel vermelho nunca é limite (CLIP limite sem anel → incerto).
  p4     + valor do limite por templates dos algarismos (m4_algarismos.py) em
         vez do CLIP; lado < m4.lado_min_numero_px →
         limite_desconhecido. Anel + algarismos lidos com certeza também resolvem
         um CLIP indeciso (mas nunca contrariam um CLIP confiante noutra família).
  p5     + prompt "stop sign" do YOLO-World (m4.prompt_stop) como indício forte
         de STOP: com octógono vermelho é STOP (como em p4); sem octógono o
         filtro A veta e o sinal vai para a fila, exceto se a forma for a
         cedência (forma exclusiva do RST, decide ela). E: "outro sinal" com a
         cedência em 2.º lugar no CLIP (P ≥ m4.cedencia_segunda_min) → fila.

Valores de limite: em p1–p5 só os de m4.algarismos.aceites (30/40/50); qualquer
outro valor → limite_desconhecido. A variante "atual" fica como estava (linha
de base, pode dar 20–120).

Saída em deteccoes.json: subclasse ∈ {stop, cedencia_passagem, limite_NN,
limite_desconhecido, outro_sinal, costas}; extra.confianca_classificacao,
extra.descricao_sinal, extra.m4_incerto, extra.m4_motivo, extra.m4_forma.

Uso:
    python pipeline/classify_signs.py [--variante atual|p1|p3|p4|p5]
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, lado_px, load_config, zone_dir  # noqa: E402

VARIANTES = ("atual", "p1", "p3", "p4", "p5")
FAMILIAS = ("stop", "cedencia_passagem", "limite", "outro_sinal", "costas")
VALORES_LIMITE = (20, 30, 40, 50, 60, 70, 80, 90, 100, 120)

# Frases da variante "atual" — NÃO mudar (é a linha de base da medição).
# frase CLIP → (subclasse, descrição)
LABELS = [
    ("a red octagonal STOP traffic sign", "stop", "STOP"),
    ("a red and white inverted triangle yield traffic sign", "cedencia_passagem", "cedência de passagem"),
] + [
    (f"a round speed limit traffic sign with the number {v}", f"limite_{v}", f"limite {v} km/h")
    for v in VALORES_LIMITE
] + [
    ("a blue square pedestrian crossing traffic sign", "outro_sinal", "passadeira"),
    ("a blue round roundabout traffic sign with white arrows", "outro_sinal", "rotunda"),
    ("a blue round bicycle and pedestrian path traffic sign", "outro_sinal", "via ciclável/pedonal"),
    ("a red round no entry traffic sign", "outro_sinal", "sentido proibido"),
    ("a blue and red no parking traffic sign", "outro_sinal", "estacionamento proibido"),
    ("a red and white triangular warning traffic sign", "outro_sinal", "perigo"),
    ("a red round prohibition traffic sign", "outro_sinal", "proibição"),
    ("a rectangular direction sign with place names and arrows", "outro_sinal", "direção"),
    ("a blue square information traffic sign", "outro_sinal", "informação"),
    ("the grey metal back of a traffic sign", "outro_sinal", "de costas"),
]

# Frases das variantes p1–p5: as mesmas da "atual", cada uma com a sua família.
# (Havia mais duas frases de "de costas"; medidas contra os rótulos a 18/11 davam
# precisão 0,19 em "costas" — 49 sinais de frente tomados por costas — e foram
# retiradas: precisão 0,64, recall dos "outro de frente" 0,57 → 0,98.)
LABELS_FAM = [
    (frase, "costas" if desc == "de costas" else
     ("limite" if sub.startswith("limite_") else sub), sub, desc)
    for frase, sub, desc in LABELS
]

DEFAULTS = {
    "variante": "p5",
    "prompt_stop": "stop sign",
    "cedencia_segunda_min": 0.3,
    "limiar": 0.25,
    "recorte_margem": 0.04,
    "limiar_familia": {"stop": 0.45, "cedencia_passagem": 0.45, "limite": 0.45, "outro_sinal": 0.45, "costas": 0.45},
    "limiar_numero": 0.6,
    "lado_min_numero_px": 30,
    "forma": {},
    "algarismos": {},
}


def m4_cfg(cfg: dict) -> dict:
    m4 = {**DEFAULTS, **(cfg.get("m4") or {})}
    m4["limiar_familia"] = {**DEFAULTS["limiar_familia"], **((cfg.get("m4") or {}).get("limiar_familia") or {})}
    return m4


# ------------------------------------------------------------------ recortes

def recorte_justo(img: np.ndarray, bbox, margem: float) -> np.ndarray:
    """Quadrado centrado na caixa, lado = lado maior × (1 + 2·margem); repete a borda fora da imagem."""
    x1, y1, x2, y2 = bbox
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    lado = max(x2 - x1, y2 - y1) * (1 + 2 * margem)
    a0, b0 = int(round(cx - lado / 2)), int(round(cy - lado / 2))
    n = max(2, int(round(lado)))
    H, W = img.shape[:2]
    pad = max(0, -a0, -b0, a0 + n - W, b0 + n - H)
    if pad:
        img = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    return img[b0 + pad:b0 + pad + n, a0 + pad:a0 + pad + n]


# ---------------------------------------------------------------------- CLIP

class ClipSignClassifier:
    def __init__(self):
        import clip
        import torch
        self.torch = torch
        self.model, self.pre = clip.load("ViT-B/32", device="cpu", download_root=str(ROOT / "weights/clip"))
        self.text = {k: self._text([lb[0] for lb in labels]) for k, labels in
                     (("atual", LABELS), ("fam", LABELS_FAM))}

    def _text(self, frases):
        import clip
        with self.torch.no_grad():
            t = self.model.encode_text(clip.tokenize([f"a photo of {s}" for s in frases])).float()
        return t / t.norm(dim=-1, keepdim=True)

    def probs(self, imgs_bgr: list[np.ndarray], conjunto: str) -> np.ndarray:
        """Probabilidades (softmax) de cada frase do conjunto ("atual" | "fam")."""
        from PIL import Image
        torch = self.torch
        out = []
        for k in range(0, len(imgs_bgr), 32):
            batch = torch.stack([self.pre(Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)))
                                 for im in imgs_bgr[k:k + 32]])
            with torch.no_grad():
                im = self.model.encode_image(batch).float()
                im /= im.norm(dim=-1, keepdim=True)
                out.append((100.0 * im @ self.text[conjunto].T).softmax(dim=-1).numpy())
        return np.concatenate(out) if out else np.zeros((0, len(LABELS if conjunto == "atual" else LABELS_FAM)))


# ------------------------------------------------------------------ contexto

def contextos(dets: list[dict], zdir: Path, m4: dict, clip: ClipSignClassifier,
              variantes=VARIANTES) -> list[dict]:
    """Tudo o que as variantes precisam, calculado uma vez por deteção."""
    from m4_algarismos import ler_valor
    from m4_forma import analisar, para_analise
    precisa_largo = "atual" in variantes
    precisa_justo = any(v != "atual" for v in variantes)
    precisa_forma = any(v in ("p3", "p4", "p5") for v in variantes)
    ctx = [{"lado": lado_px(d["bbox"]), "prompt": d["extra"].get("prompt")} for d in dets]

    if precisa_largo:
        largos = [cv2.imread(str(zdir / d["recorte"])) for d in dets]
        for c, p in zip(ctx, clip.probs(largos, "atual")):
            c["p_atual"] = p
    if precisa_justo:
        justos, cache = [], {}
        for d in dets:
            ip = zdir / d["extra"]["imagem"]
            if ip not in cache:
                cache = {ip: cv2.imread(str(ip))}  # deteções vêm agrupadas por imagem
            justos.append(recorte_justo(cache[ip], d["bbox"], float(m4["recorte_margem"])))
        for c, p, im in zip(ctx, clip.probs(justos, "fam"), justos):
            c["p_fam"] = p
            c["justo"] = im
        if precisa_forma:
            for c, im in zip(ctx, justos):
                f = analisar(im, m4["forma"])
                c["forma"] = f
                if f.get("circulo"):
                    c["num"] = ler_valor(para_analise(im), f["circulo"], m4["algarismos"])
    return ctx


# ----------------------------------------------------------------- variantes

def _res(sub, conf, desc, incerto=False, motivo=None):
    return {"subclasse": sub, "conf": round(float(conf), 3), "desc": desc, "incerto": incerto, "motivo": motivo}


def decide_atual(c: dict, m4: dict) -> dict:
    pr = c["p_atual"]
    agg: dict[str, float] = {}
    for (_, sub, _), p in zip(LABELS, pr):
        agg[sub] = agg.get(sub, 0.0) + float(p)
    # A subclasse é a da frase mais provável. (Somar as 10 frases de
    # "outro sinal" fazia essa classe ganhar sempre às específicas.)
    _, sub, desc = LABELS[int(pr.argmax())]
    conf = agg[sub]
    if sub != "outro_sinal" and conf < float(m4["limiar"]):
        sub = "outro_sinal"
    return _res("costas" if desc == "de costas" else sub, conf, desc)


def familias(pr: np.ndarray) -> dict[str, float]:
    f = dict.fromkeys(FAMILIAS, 0.0)
    for (_, fam, _, _), p in zip(LABELS_FAM, pr):
        f[fam] += float(p)
    return f


def numero_clip(pr: np.ndarray) -> tuple[str | None, float]:
    """Valor mais provável dentro da família limite, e P(valor | limite)."""
    idx = [i for i, lb in enumerate(LABELS_FAM) if lb[1] == "limite"]
    p = pr[idx] / max(1e-9, pr[idx].sum())
    j = int(p.argmax())
    return LABELS_FAM[idx[j]][2], float(p[j])


def _familia(c: dict, m4: dict) -> tuple[str | None, float, dict]:
    """Família do CLIP (None = abaixo do limiar dessa família)."""
    pf = familias(c["p_fam"])
    fam = max(pf, key=pf.get)
    if pf[fam] < float(m4["limiar_familia"][fam]):
        return None, pf[fam], pf
    return fam, pf[fam], pf


def _por_familia(fam: str, conf: float, c: dict, m4: dict, numero) -> dict:
    if fam == "outro_sinal":
        return _res("outro_sinal", conf, "outro sinal")
    if fam == "costas":
        return _res("costas", conf, "de costas")
    if fam == "stop":
        return _res("stop", conf, "STOP")
    if fam == "cedencia_passagem":
        return _res("cedencia_passagem", conf, "cedência de passagem")
    return numero(c, conf)


def aceites(m4: dict) -> set[int]:
    """Valores de limite que o sistema pode dar (m4.algarismos.aceites); os outros → desconhecido."""
    return {int(v) for v in (m4.get("algarismos") or {}).get("aceites", [30, 40, 50])}


def _numero_p1(c: dict, conf: float, m4: dict) -> dict:
    sub, pv = numero_clip(c["p_fam"])
    v = int(sub.split("_")[1])
    if v not in aceites(m4):
        return _res("limite_desconhecido", conf, "limite (valor desconhecido)", True,
                    f"CLIP diz {v} (fora dos aceites)")
    if pv >= float(m4["limiar_numero"]):
        return _res(sub, conf * pv, f"limite {v} km/h")
    return _res("limite_desconhecido", conf, "limite (valor desconhecido)", True, f"valor incerto (CLIP {pv:.2f})")


def decide_p1(c: dict, m4: dict) -> dict:
    fam, conf, pf = _familia(c, m4)
    if fam is None:
        top = max(pf, key=pf.get)
        return _res("outro_sinal", conf, "incerto", True, f"família incerta ({top} {conf:.2f})")
    return _por_familia(fam, conf, c, m4, lambda c_, k: _numero_p1(c_, k, m4))


def _p3p4(c: dict, m4: dict, numero) -> dict:
    forma = c["forma"]["forma"]
    fam, conf, pf = _familia(c, m4)
    # porta de entrada: formas exclusivas do RST decidem diretamente
    if forma == "stop":
        return _res("stop", 0.5 + 0.5 * pf["stop"], "STOP", motivo="octógono vermelho")
    if forma == "cedencia":
        return _res("cedencia_passagem", 0.5 + 0.5 * pf["cedencia_passagem"], "cedência de passagem",
                    motivo="triângulo invertido")
    # veto: CLIP diz uma família cuja forma o filtro A não vê
    if fam in ("stop", "cedencia_passagem"):
        return _res("outro_sinal", conf, "incerto", True, f"veto da forma (CLIP {fam}, forma {forma})")
    if fam == "limite" and forma != "anel_vermelho":
        return _res("outro_sinal", conf, "incerto", True, "veto da forma (CLIP limite, sem anel vermelho)")
    if fam is None:
        r = numero(c, conf, resgate=True) if forma == "anel_vermelho" else None
        if r is not None:
            return r
        top = max(pf, key=pf.get)
        return _res("outro_sinal", conf, "incerto", True, f"família incerta ({top} {conf:.2f})")
    return _por_familia(fam, conf, c, m4, lambda c_, k: numero(c_, k))


def decide_p3(c: dict, m4: dict) -> dict:
    def numero(c_, conf, resgate=False):
        return None if resgate else _numero_p1(c_, conf, m4)
    return _p3p4(c, m4, numero)


def decide_p4(c: dict, m4: dict) -> dict:
    def numero(c_, conf, resgate=False):
        n = c_.get("num") or {}
        if c_["lado"] < float(m4["lado_min_numero_px"]):
            return None if resgate else _res("limite_desconhecido", conf, "limite (valor desconhecido)", True,
                                             f"sinal pequeno ({c_['lado']:.0f} px)")
        if n.get("valor"):
            v = n["valor"]
            return _res(f"limite_{v}", n["score"], f"limite {v} km/h",
                        motivo="algarismos (resgate de CLIP indeciso)" if resgate else "algarismos")
        if resgate:
            return None
        return _res("limite_desconhecido", conf, "limite (valor desconhecido)", True,
                    f"algarismos: {n.get('motivo') or 'sem leitura'}")
    return _p3p4(c, m4, numero)


def decide_p5(c: dict, m4: dict) -> dict:
    r = _decide_p5(c, m4)
    # cedências com o bordo escuro/desbotado escapam ao filtro A e o CLIP dá-as como
    # "outro sinal" com confiança: se a cedência for a 2.ª família com P ≥ X, vai para a fila.
    # (18/11, 194 rótulos: apanha 1 das 4 cedências perdidas; fila +2; 0 erros.)
    pmin = m4.get("cedencia_segunda_min")
    if pmin is not None and r["subclasse"] == "outro_sinal" and not r["incerto"] and "p_fam" in c:
        pf = familias(c["p_fam"])
        ordem = sorted(pf, key=pf.get, reverse=True)
        if ordem[1] == "cedencia_passagem" and pf["cedencia_passagem"] >= float(pmin):
            return _res("outro_sinal", r["conf"], "incerto", True,
                        f"cedência em 2.º lugar no CLIP ({pf['cedencia_passagem']:.2f})")
    return r


def _decide_p5(c: dict, m4: dict) -> dict:
    if c.get("prompt") == m4.get("prompt_stop", "stop sign"):
        forma = c["forma"]["forma"]
        if forma == "stop":
            return _res("stop", 0.5 + 0.5 * familias(c["p_fam"])["stop"], "STOP",
                        motivo="octógono vermelho + prompt stop sign")
        if forma != "cedencia":
            return _res("outro_sinal", familias(c["p_fam"])["stop"], "incerto", True,
                        f"veto da forma (prompt stop sign, forma {forma})")
    return decide_p4(c, m4)


DECIDE = {"atual": decide_atual, "p1": decide_p1, "p3": decide_p3, "p4": decide_p4, "p5": decide_p5}


# ---------------------------------------------------------------------- main

def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m4 = m4_cfg(cfg)
    variante = sys.argv[sys.argv.index("--variante") + 1] if "--variante" in sys.argv else m4["variante"]
    if variante not in VARIANTES:
        sys.exit(f"variante inválida: {variante} (uma de {VARIANTES})")
    zdir = zone_dir(cfg)
    p = zdir / "deteccoes/deteccoes.json"
    dets = json.load(open(p, encoding="utf-8"))
    sinais = [d for d in dets if d["classe"] == "sinal"]
    ctx = contextos(sinais, zdir, m4, ClipSignClassifier(), variantes=(variante,))
    for d, c in zip(sinais, ctx):
        r = DECIDE[variante](c, m4)
        d["subclasse"] = r["subclasse"]
        e = d["extra"]
        e.update(confianca_classificacao=r["conf"], descricao_sinal=r["desc"], m4_incerto=r["incerto"],
                 m4_motivo=r["motivo"], classificador=f"m4-{variante}", lado_px=round(c["lado"], 1))
        if "forma" in c:
            e["m4_forma"] = c["forma"]["forma"]
        if "num" in c:
            e["m4_algarismos"] = c["num"]
    json.dump(dets, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"{len(sinais)} sinais classificados (variante {variante}): {dict(Counter(d['subclasse'] for d in sinais))}")
    print(f"   incertos (para a fila): {sum(bool(d['extra']['m4_incerto']) for d in sinais)}")


if __name__ == "__main__":
    main()
