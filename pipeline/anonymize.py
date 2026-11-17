"""Desfoque de rostos, matrículas e cabeças de pessoas — só modelos locais.

Usado pela M1 e pelo ingest de vídeo *antes* de qualquer escrita em disco:
a imagem original só existe em memória.

Modelos (descarregados para models/ na primeira utilização):
  * rostos:     YuNet (OpenCV Zoo, MIT)
  * matrículas: YOLOv11s afinado para matrículas (morsetechlab, AGPL-3.0)
  * pessoas:    YOLO11n COCO (Ultralytics, AGPL-3.0) — desfoca a zona da cabeça
                de cada pessoa como rede de segurança quando o rosto não é detetado
"""
from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("anonymize")

DEFAULTS = {
    "margem": 0.25,
    "rostos": {
        "modelo": "models/face_detection_yunet_2023mar.onnx",
        "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "confianca": 0.6,
        "altura_max": 0.25,     # fração da altura da imagem
    },
    "matriculas": {
        "modelo": "models/license-plate-finetune-v1s.pt",
        "url": "https://huggingface.co/morsetechlab/yolov11-license-plate-detection/resolve/main/license-plate-finetune-v1s.pt",
        "confianca": 0.25,
        "imgsz": 1280,
        "aspeto_min": 1.2,      # largura/altura mínima
        "largura_max": 0.25,    # fração da largura da imagem
        "altura_max": 0.12,     # fração da altura da imagem
    },
    "cabecas_pessoas": {
        "ativo": True,
        "modelo": "models/yolo11n.pt",
        "url": "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt",
        "confianca": 0.15,
        "imgsz": 1280,
        "fracao_altura": 0.25,   # topo da caixa da pessoa considerado cabeça
    },
}


def _merge(base: dict, over: dict | None) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def _ensure(root: Path, rel: str, url: str) -> Path:
    p = root / rel
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        log.info("a descarregar modelo %s", p.name)
        tmp = p.with_suffix(p.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(p)
    return p


def blur_region(img: np.ndarray, box, margem: float) -> None:
    """Desfoque forte (pixelização + gaussiano) in place, com margem."""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1 = int(max(0, x1 - bw * margem)); x2 = int(min(w, x2 + bw * margem))
    y1 = int(max(0, y1 - bh * margem)); y2 = int(min(h, y2 + bh * margem))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return
    roi = img[y1:y2, x1:x2]
    rw, rh = roi.shape[1], roi.shape[0]
    small = cv2.resize(roi, (max(1, rw // 10), max(1, rh // 10)), interpolation=cv2.INTER_AREA)
    roi = cv2.resize(small, (rw, rh), interpolation=cv2.INTER_NEAREST)
    k = max(3, (min(rw, rh) // 3) | 1)
    img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)


class Anonymizer:
    def __init__(self, cfg: dict | None, root: Path):
        self.cfg = _merge(DEFAULTS, cfg)
        c = self.cfg
        face_path = _ensure(root, c["rostos"]["modelo"], c["rostos"]["url"])
        self.face = cv2.FaceDetectorYN.create(str(face_path), "", (320, 320),
                                              float(c["rostos"]["confianca"]), 0.3, 5000)
        from ultralytics import YOLO  # import tardio: é pesado
        self.plate = YOLO(str(_ensure(root, c["matriculas"]["modelo"], c["matriculas"]["url"])))
        cp = c["cabecas_pessoas"]
        self.person = YOLO(str(_ensure(root, cp["modelo"], cp["url"]))) if cp["ativo"] else None

    def detect(self, img: np.ndarray) -> dict[str, list]:
        h, w = img.shape[:2]
        c = self.cfg
        self.face.setInputSize((w, h))
        _, faces = self.face.detect(img)
        # Rostos maiores do que altura_max × altura da imagem são falsos positivos
        # (medido: parede tremida numa imagem noturna). As pessoas reais próximas
        # continuam cobertas pela rede de segurança das cabeças (detetor de pessoas).
        hmax = c["rostos"]["altura_max"] * h
        rostos = [] if faces is None else [
            (f[0], f[1], f[0] + f[2], f[1] + f[3]) for f in faces if f[3] <= hmax]
        self.rostos_descartados = 0 if faces is None else len(faces) - len(rostos)

        cm = c["matriculas"]
        r = self.plate.predict(img, imgsz=cm["imgsz"], conf=cm["confianca"], verbose=False)[0]
        # O modelo dá falsos positivos enormes em fachadas (conf. até 0,74).
        # Uma matrícula é pequena e mais larga do que alta: filtra-se pela forma.
        matriculas, self.descartadas = [], 0
        for x1, y1, x2, y2 in r.boxes.xyxy.cpu().numpy().tolist():
            bw, bh = x2 - x1, y2 - y1
            if (bw / max(bh, 1) >= cm["aspeto_min"] and bw <= cm["largura_max"] * w
                    and bh <= cm["altura_max"] * h):
                matriculas.append((x1, y1, x2, y2))
            else:
                self.descartadas += 1

        cabecas = []
        if self.person is not None:
            cp = c["cabecas_pessoas"]
            r = self.person.predict(img, imgsz=cp["imgsz"], conf=cp["confianca"],
                                    classes=[0], verbose=False)[0]
            for x1, y1, x2, y2 in r.boxes.xyxy.cpu().numpy().tolist():
                cabecas.append((x1, y1, x2, y1 + (y2 - y1) * cp["fracao_altura"]))
        return {"rostos": rostos, "matriculas": matriculas, "cabecas": cabecas}

    def __call__(self, img: np.ndarray) -> tuple[np.ndarray, dict[str, int]]:
        """Devolve (imagem desfocada, contagens). Não altera a imagem de entrada."""
        found = self.detect(img)
        out = img.copy()
        for boxes in found.values():
            for b in boxes:
                blur_region(out, b, self.cfg["margem"])
        return out, {k: len(v) for k, v in found.items()}


def write_jpg(path: Path, img: np.ndarray, quality: int = 92) -> None:
    """Escrita atómica (tmp + rename) de uma imagem já desfocada."""
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError(f"falhou a codificar {path}")
    tmp = path.with_suffix(".jpg.part")
    tmp.write_bytes(buf.tobytes())
    tmp.replace(path)
