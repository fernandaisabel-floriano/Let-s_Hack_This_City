#!/usr/bin/env python3
"""M5 — Coordenadas de cada deteção.

    direção = heading da câmara + atan((cx − W/2) / f)
    distância:
      sinal                → f · tamanho_placa / altura_da_caixa_px
      candeeiro/contentor  → ponto de contacto com o chão (fundo da caixa),
                             câmara horizontal à altura h:  d = f · h / (y2 − H/2)
    posição = ponto à distância d na direção calculada, a partir da câmara.

f (px) = focal_norm · max(W, H) quando há focal (Mapillary); senão a partir do
FOV horizontal; senão FOV de 70°. Deteções fora de [dist_min, dist_max] ou com
o fundo da caixa acima do horizonte ficam com extra.posicao_valida = false e
não entram na fusão (M6).

Uso:
    python pipeline/geolocate.py
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402

R = 6371000.0


def destination(lon: float, lat: float, bearing_deg: float, dist_m: float) -> tuple[float, float]:
    b = math.radians(bearing_deg)
    dlat = dist_m * math.cos(b) / R
    dlon = dist_m * math.sin(b) / (R * math.cos(math.radians(lat)))
    return lon + math.degrees(dlon), lat + math.degrees(dlat)


def focal_px(e: dict) -> float:
    W, H = e["width"], e["height"]
    if e.get("focal_norm"):
        return e["focal_norm"] * max(W, H)
    fov = e.get("fov_deg") or 70.0
    return (W / 2) / math.tan(math.radians(fov / 2))


def locate(d: dict, m5: dict) -> dict:
    e = d["extra"]
    W, H = e["width"], e["height"]
    f = focal_px(e)
    x1, y1, x2, y2 = d["bbox"]
    off = math.degrees(math.atan(((x1 + x2) / 2 - W / 2) / f))
    bearing = (d["heading_camara"] + off) % 360
    alturas = m5["camera_altura_m"]
    if d["classe"] == "sinal":
        h_px = y2 - y1
        dist = f * float(m5["sinal_tamanho_m"]) / h_px / math.cos(math.radians(off))
        metodo = "tamanho_placa"
    else:
        h_cam = float(alturas.get(e["fonte"], alturas["default"]))
        dy = y2 - H / 2
        if dy <= 1:
            return {"posicao_valida": False, "motivo": "fundo acima do horizonte", "bearing": round(bearing, 1)}
        dist = f * h_cam / dy / math.cos(math.radians(off))
        metodo = f"contacto_chao(h={h_cam})"
    valida = float(m5["dist_min_m"]) <= dist <= float(m5["dist_max_m"])
    lon, lat = destination(d["lon_camara"], d["lat_camara"], bearing, dist)
    return {"posicao_valida": valida, "motivo": None if valida else "distância fora dos limites",
            "lon_obj": round(lon, 7), "lat_obj": round(lat, 7), "dist_m": round(dist, 1),
            "bearing": round(bearing, 1), "metodo_dist": metodo}


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m5 = cfg["m5"]
    p = zone_dir(cfg) / "deteccoes/deteccoes.json"
    dets = json.load(open(p))
    for d in dets:
        for k in ("lon_obj", "lat_obj", "dist_m", "metodo_dist", "motivo"):
            d["extra"].pop(k, None)
        d["extra"].update(locate(d, m5))
    json.dump(dets, open(p, "w"), ensure_ascii=False, indent=0)
    ok = [d for d in dets if d["extra"]["posicao_valida"]]
    print(f"{len(ok)}/{len(dets)} deteções com posição válida; inválidas: "
          f"{dict(Counter(d['extra']['motivo'] for d in dets if not d['extra']['posicao_valida']))}")
    for c in ("sinal", "candeeiro", "contentor"):
        ds = sorted(d["extra"]["dist_m"] for d in ok if d["classe"] == c)
        if ds:
            print(f"  {c:9s} {len(ds):3d} válidas, distância mediana {ds[len(ds) // 2]:.1f} m "
                  f"(p10 {ds[len(ds) // 10]:.1f}, p90 {ds[9 * len(ds) // 10]:.1f})")


if __name__ == "__main__":
    main()
