#!/usr/bin/env python3
"""Fotografias importadas (telemóvel, câmara) → imagens desfocadas no formato da M1.

Para cada foto:
  * posição: GPS do EXIF (obrigatório);
  * direção da câmara: GPSImgDirection do EXIF (obrigatório — sem ela não é
    possível georreferenciar o que está na foto; a foto fica de fora e é
    listada em resumo.json como "a rever");
  * FOV: FocalLengthIn35mmFilm do EXIF, se existir; senão video.fov_lado_maior_deg;
  * desfoque de rostos, matrículas e cabeças ANTES de gravar (mesmo Anonymizer da M1);
    o original só existe em memória.

Saída em data/clean/<municipio>/<zona>/fotos/<nome>/ (images.csv, images.geojson,
desfoque.json, resumo.json). O detect.py lê-a como qualquer outra fonte.

Uso:
    python pipeline/ingest_fotos.py PASTA_COM_FOTOS --nome recolha_rua_x [--rua "Rua dos Santos Mártires"]
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, blur_totals, load_blur_log, load_config, save_blur_log, write_catalog, zone_dir  # noqa: E402

log = logging.getLogger("ingest_fotos")

EXTENSOES = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
EXIF_IFD, GPS_IFD = 0x8769, 0x8825


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(v[0]) / float(v[1])


def _dms(v, ref) -> float:
    d, m, s = (_num(x) for x in v)
    x = d + m / 60 + s / 3600
    return -x if ref in ("S", "W") else x


def ler_exif(im) -> dict:
    """GPS (lat, lon), direção, data e focal 35 mm a partir do EXIF (Pillow)."""
    ex = im.getexif()
    gps = ex.get_ifd(GPS_IFD) or {}
    sub = ex.get_ifd(EXIF_IFD) or {}
    out: dict = {}
    if 2 in gps and 4 in gps:
        out["lat"] = _dms(gps[2], gps.get(1, "N"))
        out["lon"] = _dms(gps[4], gps.get(3, "E"))
    if 17 in gps:  # GPSImgDirection
        out["heading"] = _num(gps[17]) % 360
    data = sub.get(36867) or ex.get(306)  # DateTimeOriginal / DateTime
    if data:
        try:
            out["captured_at"] = datetime.strptime(str(data), "%Y:%m:%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    if sub.get(41989):  # FocalLengthIn35mmFilm
        out["focal35"] = _num(sub[41989])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pasta", type=Path)
    ap.add_argument("--nome", required=True, help="nome da recolha (subpasta de fotos/)")
    ap.add_argument("--rua", default="", help="rua ou zona indicada pelo técnico (só metadados)")
    ap.add_argument("--autor", default="Câmara Municipal de Aveiro")
    ap.add_argument("--config", type=Path, default=ROOT / "config/municipio.yaml")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    import cv2  # noqa: E402  (pesado; só depois de validar os argumentos)
    import numpy as np
    from PIL import Image, ImageOps

    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pillow_heif = None

    from anonymize import Anonymizer, write_jpg

    cfg = load_config(args.config)
    vcfg = cfg.get("video") or {}
    fov_omissao = float(vcfg.get("fov_lado_maior_deg", 68.0))
    max_px = int(vcfg.get("max_px", 2048))
    out = zone_dir(cfg) / "fotos" / args.nome
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    fotos = sorted(f for f in args.pasta.rglob("*") if f.suffix.lower() in EXTENSOES)
    if not fotos:
        sys.exit(f"nenhuma fotografia em {args.pasta}")

    anon = Anonymizer(cfg.get("desfoque"), ROOT)
    blur_log = load_blur_log(out)
    recs: list[dict] = []
    rever: list[dict] = []
    for i, f in enumerate(fotos, 1):
        print(f"[{i}/{len(fotos)}] {f.name}", flush=True)
        try:
            with Image.open(f) as im:
                meta = ler_exif(im)
                im = ImageOps.exif_transpose(im).convert("RGB")
                frame = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
        except Exception as exc:  # noqa: BLE001
            rever.append({"ficheiro": f.name, "motivo": f"não foi possível ler ({exc})"})
            continue
        if "lat" not in meta:
            rever.append({"ficheiro": f.name, "motivo": "sem GPS no EXIF: não é possível localizar"})
            continue
        if "heading" not in meta:
            rever.append({"ficheiro": f.name, "motivo": "sem direção da câmara (GPSImgDirection): não é possível georreferenciar os objetos"})
            continue

        s = max_px / max(frame.shape[:2])
        if s < 1:
            frame = cv2.resize(frame, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        clean, counts = anon(frame)
        del frame  # o original não sai daqui
        rid = f"{args.nome}_{i:05d}"
        write_jpg(img_dir / f"{rid}.jpg", clean)
        blur_log[rid] = counts
        h, w = clean.shape[:2]
        fov = 2 * math.degrees(math.atan(36 / (2 * meta["focal35"]))) if meta.get("focal35") else fov_omissao
        focal_px = (max(w, h) / 2) / math.tan(math.radians(fov / 2))
        recs.append({
            "id": rid, "image_id": rid, "view": None, "fonte": "fotos",
            "lon": meta["lon"], "lat": meta["lat"], "coord_fonte": "exif",
            "heading": meta["heading"], "heading_fonte": "exif",
            "captured_at": meta.get("captured_at", ""),
            "is_pano": False, "fov_deg": round(math.degrees(2 * math.atan((w / 2) / focal_px)), 2),
            "focal_norm": focal_px / max(w, h), "sequence": args.nome, "camera_type": "perspective",
            "camera_parameters": None, "width": w, "height": h, "ficheiro": f"images/{rid}.jpg",
            "autor": args.autor, "autor_id": "", "licenca": "", "atribuicao": "",
            "url_origem": f"foto:{f.name}", **counts,
        })

    save_blur_log(out, blur_log)
    write_catalog(out, recs)
    resumo = {
        "municipio": cfg["municipio"], "zona": cfg["zona"], "fonte": "fotos", "recolha": args.nome,
        "rua": args.rua, "executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fotos": len(fotos), "aceites": len(recs), "a_rever": rever, "desfoque": blur_totals(recs),
    }
    (out / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in resumo.items() if k != "a_rever"}, ensure_ascii=False))
    if rever:
        print(f"{len(rever)} fotos ficaram de fora (ver resumo.json, a_rever)")
    if not recs:
        sys.exit("nenhuma fotografia com GPS e direção da câmara: nada para processar")


if __name__ == "__main__":
    main()
