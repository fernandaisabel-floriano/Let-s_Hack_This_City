#!/usr/bin/env python3
"""Teste de prompts do YOLO-World (M3).

Amostra: as imagens que passam o filtro "imagem da zona" (pipeline/zona.py),
de qualquer fonte em data/clean/<municipio>/<zona>/ (Mapillary e vídeo).

Fases:
  run    — corre cada prompt sozinho em cada imagem (conf ≥ CONF_MIN), agrupa
           caixas do mesmo objeto (mesma imagem e classe, IoU ≥ 0,4) e gera
           folhas de recortes numerados SÓ para os objetos ainda sem rótulo.
  label  — `label sinal:1,4,7 candeeiro:2 contentor:` marca como reais os
           objetos indicados (os restantes por rotular ficam como falsos) e
           acrescenta-os a labels.json (rótulos por caixa, reaproveitáveis).
  score  — tabela por prompt e limiar (certos / falsos / duplicados), por
           combinação de prompts, e imagens anotadas.

Saída em reports/yolo_world_test/<versao>/ (por omissão v3_zona; v1/v2 ficam para referência).
"wheelie bin" foi descartado na v3 (17 falsos positivos em 15 imagens na v2).
"""
from __future__ import annotations

import csv
import itertools
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from zona import street_filter  # noqa: E402

BASE = ROOT / "reports/yolo_world_test"
LABELS = BASE / "labels.json"
MODEL = ROOT / "models/yolov8s-worldv2.pt"
CONF_MIN = 0.05
IMGSZ = 1280
THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.3]

PROMPTS = {
    "sinal": ["traffic sign", "stop sign", "road sign"],
    "candeeiro": ["street lamp", "lamp post", "street light"],
    "contentor": ["recycling container", "waste container", "garbage bin",
                  "underground waste bin", "trash can", "dumpster",
                  "recycling bins", "igloo recycling container",
                  "colored recycling containers"],
}


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def out_dir() -> Path:
    v = _arg("versao", "v3_zona")
    p = BASE / v
    p.mkdir(parents=True, exist_ok=True)
    return p


def _arg(name: str, default=None):
    return next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{name}=")), default)


def sample_rows() -> list[dict]:
    """Imagens "da zona" (caminho absoluto em _path).

    --fonte=video_proprio  só uma fonte;  --cada=N  uma imagem em cada N por sequência.
    """
    cfg = load_config(ROOT / "config/municipio.yaml")
    f = street_filter(cfg)
    fonte, cada = _arg("fonte"), int(_arg("cada", 1))
    rows = []
    for csvp in sorted(zone_dir(cfg).glob("**/images.csv")):
        seq_rows = [r for r in csv.DictReader(open(csvp))
                    if (fonte is None or r["fonte"] == fonte)
                    and f(float(r["lon"]), float(r["lat"]), float(r["heading"]))[0]]
        for r in seq_rows[::cada]:
            r["_path"] = str(csvp.parent / r["ficheiro"])
            rows.append(r)
    return rows


def active_prompts() -> dict:
    """--so-fixos: sinais e candeeiros só com os prompts fixados na M3 (config m3)."""
    if "--so-fixos" not in sys.argv:
        return PROMPTS
    m3 = load_config(ROOT / "config/municipio.yaml")["m3"]["prompts"]
    return {"sinal": list(m3["sinal"]), "candeeiro": list(m3["candeeiro"]), "contentor": PROMPTS["contentor"]}


def load_labels() -> list[dict]:
    return json.load(open(LABELS))["caixas"] if LABELS.exists() else []


def match_label(o: dict, labels: list[dict]):
    best, bi = None, 0.5
    for lb in labels:
        if lb["image"] == o["image"] and lb["grupo"] == o["grupo"]:
            v = iou(lb["bbox"], o["bbox"])
            if v >= bi:
                best, bi = lb, v
    return None if best is None else best["real"]


def run() -> None:
    from ultralytics import YOLOWorld
    out = out_dir()
    rows = sample_rows()
    print(f"amostra: {len(rows)} imagens da rua")
    imgs = {r["id"]: cv2.imread(r["_path"]) for r in rows}
    model = YOLOWorld(str(MODEL))
    dets, n, t0 = [], 0, time.time()
    for grupo, prompts in active_prompts().items():
        for p in prompts:
            model.set_classes([p])
            for iid, im in imgs.items():
                r = model.predict(im, imgsz=IMGSZ, conf=CONF_MIN, verbose=False)[0]
                n += 1
                for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()):
                    dets.append({"image": iid, "grupo": grupo, "prompt": p,
                                 "bbox": [round(v, 1) for v in b], "conf": round(c, 4)})
    secs = (time.time() - t0) / n

    objs: list[dict] = []
    for d in sorted(dets, key=lambda d: -d["conf"]):
        best = next((o for o in objs if o["image"] == d["image"] and o["grupo"] == d["grupo"]
                     and iou(o["bbox"], d["bbox"]) >= 0.4), None)
        if best is None:
            best = {"obj": len(objs), "image": d["image"], "grupo": d["grupo"],
                    "bbox": d["bbox"], "max_conf": d["conf"]}
            objs.append(best)
        d["obj"] = best["obj"]

    labels = load_labels()
    todo = [o for o in objs if match_label(o, labels) is None]
    json.dump({"segundos_por_imagem": round(secs, 3), "imgsz": IMGSZ, "conf_min": CONF_MIN,
               "imagens": [r["id"] for r in rows], "deteccoes": dets, "objetos": objs},
              open(out / "raw_detections.json", "w"), indent=1)
    print(f"{len(dets)} deteções, {len(objs)} objetos, {len(todo)} por rotular, "
          f"{secs:.2f} s/imagem/prompt")

    sheets = out / "_rotular"
    sheets.mkdir(exist_ok=True)
    for f in sheets.glob("*.jpg"):
        f.unlink()
    for grupo in PROMPTS:
        go = [o for o in todo if o["grupo"] == grupo]
        tiles = []
        for o in go:
            im = imgs[o["image"]]
            x1, y1, x2, y2 = map(int, o["bbox"])
            pw, ph = max(40, (x2 - x1) // 2), max(40, (y2 - y1) // 2)
            X1, Y1 = max(0, x1 - pw), max(0, y1 - ph)
            X2, Y2 = min(im.shape[1], x2 + pw), min(im.shape[0], y2 + ph)
            crop = im[Y1:Y2, X1:X2].copy()
            cv2.rectangle(crop, (x1 - X1, y1 - Y1), (x2 - X1, y2 - Y1), (0, 0, 255), 2)
            s = 240 / max(crop.shape[:2])
            crop = cv2.resize(crop, None, fx=s, fy=s)
            tile = np.zeros((270, 240, 3), np.uint8)
            tile[30:30 + crop.shape[0], :crop.shape[1]] = crop
            cv2.putText(tile, f"#{o['obj']} {o['max_conf']:.2f}", (4, 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            tiles.append(tile)
        for k in range(0, len(tiles), 30):
            chunk = tiles[k:k + 30]
            while len(chunk) % 6:
                chunk.append(np.zeros_like(tiles[0]))
            sheet = np.vstack([np.hstack(chunk[j:j + 6]) for j in range(0, len(chunk), 6)])
            cv2.imwrite(str(sheets / f"{grupo}_{k // 30}.jpg"), sheet)
        print(f"  {grupo}: {sum(o['grupo'] == grupo for o in objs)} objetos, {len(go)} por rotular")


def label() -> None:
    out = out_dir()
    raw = json.load(open(out / "raw_detections.json"))
    reais, grupos = set(), set()
    for a in sys.argv[2:]:
        if ":" in a and not a.startswith("--"):
            g, ids = a.split(":", 1)
            grupos.add(g)
            reais |= {int(i) for i in ids.split(",") if i}
    labels = load_labels()
    novos = 0
    for o in raw["objetos"]:
        # só rotula as classes indicadas (as outras ficam por rotular)
        if o["grupo"] in grupos and match_label(o, labels) is None:
            labels.append({"image": o["image"], "grupo": o["grupo"], "bbox": o["bbox"],
                           "real": o["obj"] in reais})
            novos += 1
    data = json.load(open(LABELS)) if LABELS.exists() else {}
    data["caixas"] = labels
    json.dump(data, open(LABELS, "w"), indent=0, ensure_ascii=False)
    print(f"{novos} rótulos novos ({len(reais)} reais); total {len(labels)}")


def score() -> None:
    out = out_dir()
    raw = json.load(open(out / "raw_detections.json"))
    labels = load_labels()
    objs = {o["obj"]: o for o in raw["objetos"]}
    lab = {k: match_label(o, labels) for k, o in objs.items()}
    if any(v is None for v in lab.values()):
        sys.exit("há objetos por rotular — corra `label` primeiro")
    dets = raw["deteccoes"]
    gt = {g: sum(1 for o in objs.values() if o["grupo"] == g and lab[o["obj"]]) for g in PROMPTS}

    res = {}
    for grupo, prompts in active_prompts().items():
        for p in prompts:
            res[p] = {"grupo": grupo}
            for t in THRESHOLDS:
                seen, tp, fp, dup = set(), 0, 0, 0
                for d in sorted((d for d in dets if d["prompt"] == p and d["conf"] >= t),
                                key=lambda d: -d["conf"]):
                    if not lab[d["obj"]]:
                        fp += 1
                    elif d["obj"] in seen:
                        dup += 1
                    else:
                        seen.add(d["obj"]); tp += 1
                res[p][str(t)] = {"tp": tp, "fp": fp, "dup": dup}

    combos = {}
    for grupo, prompts in active_prompts().items():
        rows = []
        for k in range(1, min(3, len(prompts)) + 1):
            for c in itertools.combinations(prompts, k):
                for t in THRESHOLDS:
                    hit = {d["obj"] for d in dets if d["prompt"] in c and d["conf"] >= t}
                    tp = sum(lab[o] for o in hit)
                    rows.append({"prompts": list(c), "limiar": t, "tp": tp, "fp": len(hit) - tp})
        combos[grupo] = rows

    json.dump({"imagens": len(raw["imagens"]), "objetos_reais_encontrados": gt,
               "segundos_por_imagem": raw["segundos_por_imagem"], "por_prompt": res,
               "combinacoes": combos}, open(out / "resultados.json", "w"), indent=1, ensure_ascii=False)

    print(f"{len(raw['imagens'])} imagens | objetos reais encontrados por algum prompt: {gt}\n")
    print("prompt".ljust(30) + "".join(f"≥{t:<5}".ljust(13) for t in THRESHOLDS) + "  (certos/falsos/dup)")
    for p, r in res.items():
        print(p.ljust(30) + "".join(
            f"{r[str(t)]['tp']}/{r[str(t)]['fp']}/{r[str(t)]['dup']}".ljust(13) for t in THRESHOLDS))

    colors = {"sinal": (255, 128, 0), "candeeiro": (0, 200, 255), "contentor": (0, 200, 0)}
    for r in sample_rows():
        im = cv2.imread(r["_path"])
        for d in [d for d in dets if d["image"] == r["id"] and d["conf"] >= 0.1]:
            x1, y1, x2, y2 = map(int, d["bbox"])
            ok = lab[d["obj"]]
            col = colors[d["grupo"]] if ok else (0, 0, 255)
            cv2.rectangle(im, (x1, y1), (x2, y2), col, 3 if ok else 2)
            cv2.putText(im, f"{d['prompt']} {d['conf']:.2f}{'' if ok else ' X'}",
                        (x1, max(15, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
        cv2.imwrite(str(out / f"{r['id']}.jpg"), im, [cv2.IMWRITE_JPEG_QUALITY, 85])


if __name__ == "__main__":
    {"run": run, "label": label, "score": score}[sys.argv[1] if len(sys.argv) > 1 else "run"]()
