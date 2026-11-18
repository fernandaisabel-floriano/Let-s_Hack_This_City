#!/usr/bin/env python3
"""M10 — Preenche data/clean/<municipio>/<zona>/referencia.csv (contagem manual).

Colunas: id, tipo, subtipo, descricao_local, lat, lon, foto, notas
A equipa preenche tipo, subtipo, descricao_local e notas; este script só dá
coordenadas. Nunca apaga nem reescreve o que já lá está: acrescenta linhas
novas e só preenche lat/lon que estejam vazios.

Modos:
  fotos       lê o GPS do EXIF das fotos do terreno (JPEG; HEIC se pillow-heif
              estiver instalado) e acrescenta uma linha por foto (coluna foto).
                python pipeline/referencia.py fotos data/incoming/fotos_terreno
  geojsonio   converte o que se exporta do geojson.io (GeoJSON, ou CSV com
              colunas lat/lon) — as propriedades com o mesmo nome das colunas
              (tipo, subtipo, descricao_local, foto, notas) são copiadas.
                python pipeline/referencia.py geojsonio ~/Downloads/map.geojson
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402

COLS = ["id", "tipo", "subtipo", "descricao_local", "lat", "lon", "foto", "notas"]
IMG_EXT = {".jpg", ".jpeg", ".heic", ".heif", ".png", ".tif", ".tiff"}


def ref_path() -> Path:
    return zone_dir(load_config(ROOT / "config/municipio.yaml")) / "referencia.csv"


def load(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [dict(r) for r in csv.DictReader(open(p, encoding="utf-8"))]


def save(p: Path, rows: list[dict]) -> None:
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in COLS})


def next_id(rows: list[dict]) -> str:
    n = max([int(r["id"].split("_")[-1]) for r in rows if r.get("id", "").startswith("ref_")] + [0])
    return f"ref_{n + 1:03d}"


# ---------------------------------------------------------------------- EXIF

def _dms(v, ref) -> float:
    d, m, s = (float(x) for x in v)
    x = d + m / 60 + s / 3600
    return -x if ref in ("S", "W") else x


def exif_gps(path: Path) -> tuple[float, float] | None:
    from PIL import Image
    if path.suffix.lower() in (".heic", ".heif"):
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            print(f"  {path.name}: HEIC precisa de `pip install pillow-heif` — ignorada")
            return None
    try:
        with Image.open(path) as im:
            gps = im.getexif().get_ifd(0x8825)
    except Exception as exc:  # noqa: BLE001
        print(f"  {path.name}: não foi possível ler ({exc})")
        return None
    if not gps or 2 not in gps or 4 not in gps:
        return None
    return _dms(gps[2], gps.get(1, "N")), _dms(gps[4], gps.get(3, "E"))


def from_photos(folder: Path) -> None:
    p = ref_path()
    rows = load(p)
    by_foto = {r["foto"]: r for r in rows if r.get("foto")}
    fotos = sorted(f for f in Path(folder).rglob("*") if f.suffix.lower() in IMG_EXT)
    if not fotos:
        sys.exit(f"nenhuma foto em {folder}")
    novas = sem_gps = preenchidas = 0
    for f in fotos:
        rel = str(f.relative_to(ROOT)) if f.resolve().is_relative_to(ROOT) else str(f)
        ll = exif_gps(f)
        if ll is None:
            sem_gps += 1
        r = by_foto.get(rel)
        if r is None:
            r = {"id": next_id(rows), "foto": rel}
            rows.append(r)
            by_foto[rel] = r
            novas += 1
        if ll and not (r.get("lat") and r.get("lon")):
            r["lat"], r["lon"] = f"{ll[0]:.7f}", f"{ll[1]:.7f}"
            preenchidas += 1
    save(p, rows)
    print(f"{len(fotos)} fotos: {novas} linhas novas, {preenchidas} com lat/lon preenchidos, "
          f"{sem_gps} sem GPS no EXIF → {p.relative_to(ROOT)}")
    if sem_gps:
        print("  As fotos sem GPS ficam com lat/lon vazios: dá-lhes coordenadas no geojson.io "
              "(modo geojsonio) ou à mão.")


# ------------------------------------------------------------------ geojson.io

def from_geojsonio(path: Path) -> None:
    p = ref_path()
    rows = load(p)
    pts = []
    if path.suffix.lower() in (".geojson", ".json"):
        for ft in json.loads(path.read_text())["features"]:
            if (ft.get("geometry") or {}).get("type") != "Point":
                continue
            lon, lat = ft["geometry"]["coordinates"][:2]
            pts.append({**(ft.get("properties") or {}), "lat": lat, "lon": lon})
    else:
        for r in csv.DictReader(open(path, encoding="utf-8")):
            k = {c.lower(): c for c in r}
            lat = next((r[k[c]] for c in ("lat", "latitude", "y") if c in k), None)
            lon = next((r[k[c]] for c in ("lon", "lng", "long", "longitude", "x") if c in k), None)
            if lat and lon:
                pts.append({**r, "lat": float(lat), "lon": float(lon)})
    ignorados = {"guia": 0, "sem_tipo_valido": 0}
    validos = []
    for pt in pts:
        # o guia.geojson (frames, trajeto, polígono) vem misturado na exportação
        if str(pt.get("guia", "")).lower() in ("true", "1", "sim"):
            ignorados["guia"] += 1
            continue
        if str(pt.get("tipo") or "").strip().lower() not in ("sinal", "candeeiro", "contentor"):
            ignorados["sem_tipo_valido"] += 1
            continue
        validos.append(pt)
    pts = validos
    for pt in pts:
        r = {c: str(pt.get(c) or "") for c in COLS if c not in ("id", "lat", "lon")}
        r["tipo"] = r["tipo"].strip().lower()
        r.update(id=next_id(rows), lat=f"{float(pt['lat']):.7f}", lon=f"{float(pt['lon']):.7f}")
        # geojson.io usa "name"/"description" por omissão
        r["descricao_local"] = r["descricao_local"] or str(pt.get("name") or "")
        r["notas"] = r["notas"] or str(pt.get("description") or "")
        rows.append(r)
    save(p, rows)
    print(f"{len(pts)} pontos acrescentados de {path.name} → {p.relative_to(ROOT)}; "
          f"ignorados: {ignorados['guia']} do guia, {ignorados['sem_tipo_valido']} sem tipo "
          f"sinal/candeeiro/contentor")
    if ignorados["sem_tipo_valido"]:
        print("  Pontos sem tipo não entram — confirme no geojson.io se falta preencher o tipo.")


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("fotos", "geojsonio"):
        sys.exit(__doc__)
    {"fotos": from_photos, "geojsonio": from_geojsonio}[sys.argv[1]](Path(sys.argv[2]))
