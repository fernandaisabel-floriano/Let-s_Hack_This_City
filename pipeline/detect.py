#!/usr/bin/env python3
"""M3 — Deteção de sinais, candeeiros e contentores com YOLO-World.

Lê as imagens limpas de todas as fontes da zona (data/clean/<municipio>/<zona>/
*/images.csv), corre os prompts do config (m3.prompts) numa só passagem por
imagem, aplica o limiar de cada prompt, faz NMS dentro de cada grupo (várias
frases para o mesmo objeto → uma caixa) e grava:

    <zona>/deteccoes/deteccoes.json   lista de schema.Detection
    <zona>/deteccoes/recortes/<id>.jpg

Os caminhos (recorte, extra.imagem) são relativos à pasta da zona.

Uso:
    python pipeline/detect.py
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from schema import Detection  # noqa: E402


def load_images(zdir: Path) -> list[dict]:
    rows = []
    for csvp in sorted(zdir.glob("*/images.csv")) + sorted(zdir.glob("video/*/images.csv")):
        for r in csv.DictReader(open(csvp)):
            r["_path"] = csvp.parent / r["ficheiro"]
            r["_rel"] = str(r["_path"].relative_to(zdir))
            rows.append(r)
    return rows


def nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area = lambda b: (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])  # noqa: E731
        ov = inter / (area(boxes[[i]]) + area(boxes[order[1:]]) - inter + 1e-9)
        order = order[1:][ov < iou]
    return keep


def main() -> None:
    from ultralytics import YOLOWorld
    cfg = load_config(ROOT / "config/municipio.yaml")
    m3 = cfg["m3"]
    zdir = zone_dir(cfg)
    out = zdir / "deteccoes"
    (out / "recortes").mkdir(parents=True, exist_ok=True)
    for f in (out / "recortes").glob("*.jpg"):
        f.unlink()

    prompts, grupo_de, limiar_de = [], {}, {}
    for grupo, ps in m3["prompts"].items():
        for p, t in ps.items():
            prompts.append(p)
            grupo_de[p], limiar_de[p] = grupo, float(t)
    model = YOLOWorld(str(ROOT / m3["modelo"]))
    model.set_classes(prompts)
    cmin = min(limiar_de.values())

    rows = load_images(zdir)
    dets: list[dict] = []
    t0 = time.time()
    for k, r in enumerate(rows, 1):
        im = cv2.imread(str(r["_path"]))
        res = model.predict(im, imgsz=m3["imgsz"], conf=cmin, verbose=False)[0]
        b = res.boxes.xyxy.cpu().numpy()
        c = res.boxes.conf.cpu().numpy()
        cl = res.boxes.cls.cpu().numpy().astype(int)
        ok = np.array([c[i] >= limiar_de[prompts[cl[i]]] for i in range(len(c))], bool)
        b, c, cl = b[ok], c[ok], cl[ok]
        for grupo in m3["prompts"]:
            idx = np.array([i for i in range(len(c)) if grupo_de[prompts[cl[i]]] == grupo], int)
            if not idx.size:
                continue
            for j in nms(b[idx], c[idx], float(m3["nms_iou"])):
                i = idx[j]
                x1, y1, x2, y2 = [float(v) for v in b[i]]
                if x2 - x1 < 2 or y2 - y1 < 2:
                    continue
                did = f"{r['id']}_{len(dets):05d}"
                pad = max(8, int(0.15 * max(x2 - x1, y2 - y1)))
                crop = im[max(0, int(y1) - pad):int(y2) + pad, max(0, int(x1) - pad):int(x2) + pad]
                cv2.imwrite(str(out / "recortes" / f"{did}.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
                d = Detection(
                    id=did, image_id=r["image_id"],
                    view=int(r["view"]) if r.get("view") not in (None, "") else None,
                    bbox=[round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                    classe=grupo, subclasse=None, confianca=round(float(c[i]), 4),
                    recorte=f"deteccoes/recortes/{did}.jpg",
                    heading_camara=float(r["heading"]),
                    lat_camara=float(r["lat"]), lon_camara=float(r["lon"]),
                    extra={"prompt": prompts[cl[i]], "fonte": r["fonte"], "imagem": r["_rel"],
                           "imagem_id": r["id"], "width": int(r["width"]), "height": int(r["height"]),
                           "focal_norm": float(r["focal_norm"]) if r.get("focal_norm") else None,
                           "fov_deg": float(r["fov_deg"]) if r.get("fov_deg") else None,
                           "captured_at": r["captured_at"], "sequence": r["sequence"],
                           "atribuicao": r.get("atribuicao") or ""})
                dets.append(d.to_dict())
        if k % 10 == 0 or k == len(rows):
            print(f"  {k}/{len(rows)} imagens, {len(dets)} deteções")
    json.dump(dets, open(out / "deteccoes.json", "w"), ensure_ascii=False, indent=0)
    from collections import Counter
    print(f"{len(dets)} deteções em {len(rows)} imagens ({(time.time() - t0) / max(1, len(rows)):.2f} s/imagem): "
          f"{dict(Counter(d['classe'] for d in dets))} → {out.relative_to(ROOT)}/deteccoes.json")


if __name__ == "__main__":
    main()
