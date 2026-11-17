#!/usr/bin/env python3
"""P1.1 — Vídeo próprio + GPX → imagens desfocadas no mesmo formato da M1.

Extrai 1 frame a cada ~`video.passo_m` metros percorridos (não por tempo),
interpola a posição pelo timestamp, calcula o heading pela direção do
movimento e aplica o mesmo desfoque da M1 antes de gravar.

Relógios:
    hora_gpx = início_do_vídeo + t_no_vídeo + offset_s
  * início_do_vídeo vem do creation_time do ficheiro (lido com PyAV) ou de --inicio.
  * Muitos Android gravam creation_time no FIM da gravação: usar --relogio-fim.
  * --offset-s corrige o desfasamento entre o relógio do telemóvel que filma
    e o do GPS (positivo se o GPX está adiantado em relação ao vídeo).
    Truque para medir: filmar o ecrã da app de GPS com a hora visível.

Uso:
    python pipeline/ingest_video.py VIDEO.mp4 TRACK.gpx [--offset-s 2.5] [--nome sentido_norte]

Saída em data/clean/<municipio>/<zona>/video/<nome>/ (formato schema.IMAGE_FIELDS).
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import gpxpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from anonymize import Anonymizer, write_jpg  # noqa: E402
from common import (ROOT, bearing, blur_totals, count_by, haversine,  # noqa: E402
                    load_blur_log, load_config, save_blur_log, write_catalog, zone_dir)

log = logging.getLogger("ingest_video")

VIDEO_DEFAULTS = {"passo_m": 2.0, "fov_horizontal_deg": 68.0, "heading_offset_deg": 0.0,
                  "janela_heading_m": 6.0, "velocidade_min_ms": 0.5, "max_px": 2048,
                  "autor": "equipa"}


# ------------------------------------------------------------------- relógios

def video_creation_time(path: Path) -> tuple[datetime | None, float | None]:
    """(creation_time UTC, duração em s) via PyAV (traz o ffmpeg; não precisa de ffprobe)."""
    import av
    try:
        with av.open(str(path)) as c:
            dur = c.duration / 1_000_000 if c.duration else None
            ct = c.metadata.get("creation_time")
            if not ct:
                for s in c.streams:
                    ct = s.metadata.get("creation_time")
                    if ct:
                        break
    except Exception as exc:  # noqa: BLE001
        log.warning("não foi possível ler metadados do vídeo: %s", exc)
        return None, None
    if not ct:
        return None, dur
    dt = datetime.fromisoformat(ct.replace("Z", "+00:00"))
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)), dur


def parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------------ GPX

class Track:
    """Trajeto GPX com interpolação por tempo e por distância percorrida."""

    def __init__(self, gpx_path: Path, v_min: float):
        g = gpxpy.parse(gpx_path.read_text())
        pts = [(p.time, p.longitude, p.latitude)
               for trk in g.tracks for seg in trk.segments for p in seg.points if p.time]
        pts += [(p.time, p.longitude, p.latitude) for p in g.waypoints if p.time] if not pts else []
        if len(pts) < 2:
            raise SystemExit(f"GPX sem pontos com hora suficientes: {gpx_path}")
        pts.sort(key=lambda p: p[0])
        t, lon, lat = [], [], []
        for tm, lo, la in pts:
            ts = (tm if tm.tzinfo else tm.replace(tzinfo=timezone.utc)).timestamp()
            if t and ts <= t[-1]:
                continue  # horas repetidas
            t.append(ts); lon.append(lo); lat.append(la)
        self.t, self.lon, self.lat = np.array(t), np.array(lon), np.array(lat)

        # Distância acumulada; segmentos abaixo de v_min contam como parado
        # (o ruído do GPS parado não gera frames).
        d = [0.0]
        self.parado = 0.0
        for i in range(1, len(t)):
            seg = haversine(lon[i - 1], lat[i - 1], lon[i], lat[i])
            dt = t[i] - t[i - 1]
            if seg / dt < v_min:
                self.parado += dt
                seg = 0.0
            d.append(d[-1] + seg)
        self.d = np.array(d)
        # Para interpolar por distância: só pontos onde a distância avança.
        keep = np.concatenate([[True], np.diff(self.d) > 0])
        self.dk, self.lonk, self.latk = self.d[keep], self.lon[keep], self.lat[keep]

    @property
    def inicio(self) -> float:
        return float(self.t[0])

    @property
    def fim(self) -> float:
        return float(self.t[-1])

    def at_time(self, ts: float) -> tuple[float, float, float]:
        """(lon, lat, distância acumulada) no instante ts."""
        return (float(np.interp(ts, self.t, self.lon)), float(np.interp(ts, self.t, self.lat)),
                float(np.interp(ts, self.t, self.d)))

    def heading_at(self, dist: float, janela: float) -> float | None:
        if len(self.dk) < 2:
            return None
        a = max(self.dk[0], dist - janela / 2)
        b = min(self.dk[-1], dist + janela / 2)
        if b - a < 0.5:
            return None
        lo1, la1 = np.interp(a, self.dk, self.lonk), np.interp(a, self.dk, self.latk)
        lo2, la2 = np.interp(b, self.dk, self.lonk), np.interp(b, self.dk, self.latk)
        return bearing(lo1, la1, lo2, la2)


# ----------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video", type=Path)
    ap.add_argument("gpx", type=Path)
    ap.add_argument("--offset-s", type=float, default=0.0,
                    help="hora_gpx = início_vídeo + t + offset (positivo se o GPX está adiantado)")
    ap.add_argument("--inicio", help="hora de início do vídeo em ISO 8601 (sobrepõe o ficheiro)")
    ap.add_argument("--relogio-fim", action="store_true",
                    help="o creation_time do ficheiro é o FIM da gravação (comum em Android)")
    ap.add_argument("--nome", help="nome da sequência (por omissão: nome do ficheiro)")
    ap.add_argument("--config", type=Path, default=ROOT / "config/municipio.yaml")
    ap.add_argument("--zona")
    ap.add_argument("--out-root", type=Path)
    ap.add_argument("--max-frames", type=int, help="parar após N frames extraídos (testes)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(message)s")

    cfg = load_config(args.config)
    vcfg = {**VIDEO_DEFAULTS, **(cfg.get("video") or {})}
    nome = args.nome or args.video.stem
    out = zone_dir(cfg, args.zona, args.out_root) / "video" / nome
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    # --- relógio do vídeo
    ct, dur = video_creation_time(args.video)
    if args.inicio:
        inicio, inicio_fonte = parse_iso(args.inicio), "--inicio"
    elif ct:
        inicio, inicio_fonte = ct, "creation_time"
        if args.relogio_fim:
            if dur is None:
                sys.exit("--relogio-fim precisa da duração do vídeo")
            inicio, inicio_fonte = ct - timedelta(seconds=dur), "creation_time - duração"
    else:
        sys.exit("O vídeo não tem creation_time: indique --inicio AAAA-MM-DDTHH:MM:SSZ")
    t0_gpx = inicio.timestamp() + args.offset_s

    track = Track(args.gpx, float(vcfg["velocidade_min_ms"]))
    log.info("vídeo %s → GPX %s .. %s (offset %+.2fs)",
             datetime.fromtimestamp(t0_gpx, timezone.utc).isoformat(timespec="seconds"),
             datetime.fromtimestamp(track.inicio, timezone.utc).isoformat(timespec="seconds"),
             datetime.fromtimestamp(track.fim, timezone.utc).isoformat(timespec="seconds"),
             args.offset_s)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        sys.exit(f"não foi possível abrir {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    passo = float(vcfg["passo_m"])
    fov = float(vcfg["fov_horizontal_deg"])
    max_px = int(vcfg["max_px"])
    blur_log = load_blur_log(out)
    anon = None
    st = {"frames_lidos": 0, "fora_do_gpx": 0, "extraidos": 0, "existentes": 0,
          "sem_heading": 0}
    recs: list[dict] = []
    next_mark: float | None = None
    t_start = time.time()
    idx = -1

    while True:
        if not cap.grab():
            break
        idx += 1
        st["frames_lidos"] += 1
        pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
        t_v = pos_ms / 1000.0 if pos_ms and pos_ms > 0 else idx / fps
        ts = t0_gpx + t_v
        if ts < track.inicio or ts > track.fim:
            st["fora_do_gpx"] += 1
            continue
        lon, lat, dist = track.at_time(ts)
        if next_mark is None:
            next_mark = dist
        if dist < next_mark:
            continue
        next_mark = math.floor(dist / passo) * passo + passo  # sem rajadas após saltos

        head = track.heading_at(dist, float(vcfg["janela_heading_m"]))
        if head is None:
            st["sem_heading"] += 1
            continue
        head = (head + float(vcfg["heading_offset_deg"])) % 360.0

        rid = f"{nome}_{idx:06d}"
        path = img_dir / f"{rid}.jpg"
        if path.exists():
            st["existentes"] += 1
            from PIL import Image
            with Image.open(path) as im:
                w, h = im.size
        else:
            ok, frame = cap.retrieve()
            if not ok:
                continue
            s = max_px / max(frame.shape[:2])
            if s < 1:
                frame = cv2.resize(frame, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            if anon is None:
                anon = Anonymizer(cfg.get("desfoque"), ROOT)
            clean, counts = anon(frame)
            del frame  # o original não sai daqui
            write_jpg(path, clean)
            blur_log[rid] = counts
            h, w = clean.shape[:2]
            st["extraidos"] += 1
            if st["extraidos"] % 20 == 0:
                log.info("%d frames extraídos (%.0f m)", st["extraidos"], dist)
                save_blur_log(out, blur_log)

        focal_px = (w / 2) / math.tan(math.radians(fov / 2))
        recs.append({
            "id": rid, "image_id": rid, "view": None, "fonte": "video_proprio",
            "lon": lon, "lat": lat, "coord_fonte": "gpx",
            "heading": head, "heading_fonte": "movimento",
            "captured_at": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
            "is_pano": False, "fov_deg": fov, "focal_norm": focal_px / max(w, h),
            "sequence": nome, "camera_type": "perspective", "camera_parameters": None,
            "width": w, "height": h, "ficheiro": f"images/{rid}.jpg",
            "autor": vcfg["autor"], "autor_id": "", "licenca": "", "atribuicao": "",
            "url_origem": f"video:{args.video.name}#t={t_v:.3f}",
            "_dist": dist, **blur_log.get(rid, {}),
        })
        if args.max_frames and len(recs) >= args.max_frames:
            break
    cap.release()
    save_blur_log(out, blur_log)
    write_catalog(out, recs)

    gaps = [haversine(a["lon"], a["lat"], b["lon"], b["lat"]) for a, b in zip(recs, recs[1:])]
    resumo = {
        "municipio": cfg["municipio"], "zona": args.zona or cfg["zona"],
        "fonte": "video_proprio", "sequencia": nome,
        "video": args.video.name, "gpx": args.gpx.name,
        "executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duracao_s": round(time.time() - t_start, 1),
        "inicio_video": inicio.isoformat(), "inicio_fonte": inicio_fonte,
        "offset_s": args.offset_s,
        "gpx_inicio": datetime.fromtimestamp(track.inicio, timezone.utc).isoformat(),
        "gpx_fim": datetime.fromtimestamp(track.fim, timezone.utc).isoformat(),
        "gpx_pontos": len(track.t), "gpx_tempo_parado_s": round(track.parado, 1),
        "fps": round(fps, 3), "passo_m": passo,
        **st,
        "imagens": len(recs),
        "distancia_percorrida_m": round(recs[-1]["_dist"] - recs[0]["_dist"], 1) if recs else 0,
        "espacamento_m": {"medio": round(float(np.mean(gaps)), 2),
                          "min": round(min(gaps), 2), "max": round(max(gaps), 2)} if gaps else None,
        "heading_fonte": count_by(recs, "heading_fonte"),
        "desfoque_total": blur_totals(recs),
    }
    (out / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2))
    print(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
