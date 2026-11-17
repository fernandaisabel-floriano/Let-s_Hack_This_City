#!/usr/bin/env python3
"""M4 — Classificação dos sinais detetados (STOP, cedência, limites de velocidade).

Versão MVP: classificação sem treino com o CLIP (ViT-B/32, o mesmo que o
YOLO-World usa, já local em weights/clip). Escolhida em vez do GTSRB para o
primeiro percurso de ponta a ponta porque o GTSRB não tem 40 km/h nem o sinal
de passadeira português e exigia treino. A interface (classify(recortes) →
(subclasse, confiança)) permite trocar por um classificador GTSRB depois.

Atualiza deteccoes.json: subclasse ∈ {stop, cedencia_passagem, limite_NN,
outro_sinal} e extra.confianca_classificacao / extra.descricao_sinal.

Uso:
    python pipeline/classify_signs.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402

# frase CLIP → (subclasse, descrição)
LABELS = [
    ("a red octagonal STOP traffic sign", "stop", "STOP"),
    ("a red and white inverted triangle yield traffic sign", "cedencia_passagem", "cedência de passagem"),
] + [
    (f"a round speed limit traffic sign with the number {v}", f"limite_{v}", f"limite {v} km/h")
    for v in (20, 30, 40, 50, 60, 70, 80, 90, 100, 120)
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


class ClipSignClassifier:
    def __init__(self):
        import clip
        import torch
        self.torch = torch
        self.model, self.pre = clip.load("ViT-B/32", device="cpu", download_root=str(ROOT / "weights/clip"))
        with torch.no_grad():
            t = clip.tokenize([f"a photo of {s}" for s, _, _ in LABELS])
            self.text = self.model.encode_text(t).float()
            self.text /= self.text.norm(dim=-1, keepdim=True)

    def classify(self, paths: list[Path]) -> list[tuple[str, float, str]]:
        from PIL import Image
        torch = self.torch
        out = []
        for k in range(0, len(paths), 32):
            batch = torch.stack([self.pre(Image.open(p).convert("RGB")) for p in paths[k:k + 32]])
            with torch.no_grad():
                im = self.model.encode_image(batch).float()
                im /= im.norm(dim=-1, keepdim=True)
                probs = (100.0 * im @ self.text.T).softmax(dim=-1).numpy()
            for pr in probs:
                agg: dict[str, float] = {}
                for (_, sub, _), p in zip(LABELS, pr):
                    agg[sub] = agg.get(sub, 0.0) + float(p)
                # A subclasse é a da frase mais provável. (Somar as 10 frases de
                # "outro sinal" fazia essa classe ganhar sempre às específicas.)
                _, sub, desc = LABELS[int(pr.argmax())]
                out.append((sub, agg[sub], desc))
        return out


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    limiar = float((cfg.get("m4") or {}).get("limiar", 0.25))
    zdir = zone_dir(cfg)
    p = zdir / "deteccoes/deteccoes.json"
    dets = json.load(open(p))
    sinais = [d for d in dets if d["classe"] == "sinal"]
    res = ClipSignClassifier().classify([zdir / d["recorte"] for d in sinais])
    for d, (sub, conf, desc) in zip(sinais, res):
        if sub != "outro_sinal" and conf < limiar:
            sub = "outro_sinal"
        d["subclasse"] = sub
        d["extra"]["confianca_classificacao"] = round(conf, 3)
        d["extra"]["descricao_sinal"] = desc
        d["extra"]["classificador"] = "clip-vit-b32-zero-shot"
    json.dump(dets, open(p, "w"), ensure_ascii=False, indent=0)
    from collections import Counter
    print(f"{len(sinais)} sinais classificados: {dict(Counter(d['subclasse'] for d in sinais))}")
    print(f"   descrições: {dict(Counter(d['extra']['descricao_sinal'] for d in sinais))}")


if __name__ == "__main__":
    main()
