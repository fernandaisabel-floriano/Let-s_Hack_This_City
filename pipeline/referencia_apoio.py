#!/usr/bin/env python3
"""Material de apoio para marcar a referência da M10 à mão (reports/referencia_apoio/).

  * frames do vídeo próprio a cada ~10 m (já desfocados), V###_<lat>_<lon>_h<heading>.jpg
  * imagens Mapillary da zona que cobrem o Cais e a rotunda (o vídeo não passa lá),
    M###_<via>_<lat>_<lon>_h<heading>.jpg  (+ ATRIBUICAO.txt, CC BY-SA 4.0)
  * guia.geojson para o geojson.io: polígono de avaliação, trajeto do vídeo e, por
    imagem, a posição da câmara e uma linha curta na direção para onde aponta.
    Todos os objetos do guia têm "guia": true (referencia.py geojsonio ignora-os).

O heading do vídeo inclui a calibração (video/<seq>/calibracao.json), se existir.

Uso:
    python pipeline/referencia_apoio.py
"""
from __future__ import annotations

import csv
import json
import math
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, haversine, load_config, zone_dir  # noqa: E402
from zona import street_filter  # noqa: E402

OUT = ROOT / "reports/referencia_apoio"
PASSO_VIDEO_M = 10.0
SETA_M = 12.0
VIAS_MAPILLARY = ("Cais dos Santos Mártires", "Rotunda")
SLUG = {"Cais dos Santos Mártires": "cais", "Rotunda": "rotunda", "Rua dos Santos Mártires": "rua"}


def ahead(lon: float, lat: float, heading: float, m: float) -> list[float]:
    b = math.radians(heading)
    return [lon + m * math.sin(b) / (111320 * math.cos(math.radians(lat))), lat + m * math.cos(b) / 111320]


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    zdir = zone_dir(cfg)
    f = street_filter(cfg)
    if OUT.exists():
        for p in OUT.glob("*.jpg"):
            p.unlink()
    OUT.mkdir(parents=True, exist_ok=True)

    feats: list[dict] = []
    zona = json.loads((ROOT / cfg["zona_avaliacao_geojson"]).read_text())["features"][0]
    feats.append({"type": "Feature", "geometry": zona["geometry"],
                  "properties": {"guia": True, "title": "Zona de avaliação (só marcar aqui dentro)",
                                 "stroke": "#1f7a6d", "stroke-width": 2, "fill": "#1f7a6d", "fill-opacity": 0.08}})

    lista = []
    # --- vídeo: um frame a cada ~10 m
    n = 0
    for csvp in sorted(zdir.glob("video/*/images.csv")):
        seq = csvp.parent.name
        cal = csvp.parent / "calibracao.json"
        delta = json.loads(cal.read_text())["delta_heading_graus"] if cal.exists() else 0.0
        rows = list(csv.DictReader(open(csvp)))
        feats.append({"type": "Feature", "properties": {
            "guia": True, "title": f"Trajeto do vídeo {seq}", "stroke": "#2f6fb3", "stroke-width": 3},
            "geometry": {"type": "LineString", "coordinates": [[float(r["lon"]), float(r["lat"])] for r in rows]}})
        last = None
        for r in rows:
            lon, lat = float(r["lon"]), float(r["lat"])
            if last and haversine(last[0], last[1], lon, lat) < PASSO_VIDEO_M:
                continue
            last = (lon, lat)
            n += 1
            h = (float(r["heading"]) + delta) % 360
            nome = f"V{n:03d}_{lat:.6f}_{lon:.6f}_h{h:03.0f}.jpg"
            shutil.copy2(csvp.parent / r["ficheiro"], OUT / nome)
            lista.append((nome, lon, lat, h, "#2f6fb3", f"V{n:03d}", r["captured_at"], seq, ""))
    n_video = n

    # --- Mapillary no Cais e na rotunda
    n = 0
    csvp = zdir / "mapillary/images.csv"
    for r in sorted(csv.DictReader(open(csvp)), key=lambda r: (r["sequence"], r["captured_at"])):
        lon, lat, h = float(r["lon"]), float(r["lat"]), float(r["heading"])
        ok, _, _, via = f(lon, lat, h)
        if not ok or via not in VIAS_MAPILLARY:
            continue
        n += 1
        nome = f"M{n:03d}_{SLUG[via]}_{lat:.6f}_{lon:.6f}_h{h:03.0f}.jpg"
        shutil.copy2(csvp.parent / r["ficheiro"], OUT / nome)
        lista.append((nome, lon, lat, h, "#d07a12", f"M{n:03d}", r["captured_at"], via, r["atribuicao"]))
    n_map = n

    for nome, lon, lat, h, cor, rot, quando, origem, _ in lista:
        props = {"guia": True, "title": rot, "description": f"{nome} · {quando[:10]} · {origem}",
                 "ficheiro": nome, "heading": round(h, 1)}
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {**props, "marker-color": cor, "marker-size": "small"}})
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": [[lon, lat], ahead(lon, lat, h, SETA_M)]},
                      "properties": {**props, "title": f"{rot} → direção da câmara", "stroke": cor, "stroke-width": 2}})

    (OUT / "guia.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                 ensure_ascii=False, indent=1))
    with open(OUT / "ATRIBUICAO.txt", "w", encoding="utf-8") as fh:
        fh.write("Imagens M###: Mapillary, licença CC BY-SA 4.0 "
                 "(https://creativecommons.org/licenses/by-sa/4.0/).\n"
                 "Desfocadas (rostos, matrículas, cabeças) pelo pipeline Ctrl+F Aveiro.\n\n")
        for nome, *_, atrib in lista:
            if atrib:
                fh.write(f"{nome}: {atrib}\n")
    print(f"{n_video} frames de vídeo (a cada ~{PASSO_VIDEO_M:.0f} m) + {n_map} imagens Mapillary "
          f"(Cais e rotunda) → {OUT.relative_to(ROOT)}/  (guia.geojson: {len(feats)} objetos)")


if __name__ == "__main__":
    main()
