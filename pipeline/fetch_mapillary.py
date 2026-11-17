#!/usr/bin/env python3
"""M1 — Descarrega imagens Mapillary (posição + direção da câmara) para uma bbox.

As imagens são desfocadas (rostos, matrículas, cabeças) em memória ANTES de
qualquer escrita em disco. As panorâmicas são cortadas em 4 vistas planas
(FOV 90°, heading da panorâmica + 0/90/180/270°); a equiretangular nunca é gravada.

Uso:
    python pipeline/fetch_mapillary.py                      # usa config/municipio.yaml
    python pipeline/fetch_mapillary.py --bbox -8.648,40.6425,-8.646,40.644
    python pipeline/fetch_mapillary.py --config config/outro.yaml --zona rua_x

Saída em data/clean/<municipio>/<zona>/mapillary/ (formato em schema.IMAGE_FIELDS):
    images/<id>.jpg     imagens desfocadas (as já existentes não se voltam a processar)
    images.geojson      pontos com metadados
    images.csv          o mesmo em tabela, com licença e atribuição
    desfoque.json       regiões desfocadas por imagem (persistente entre execuções)
    resumo.json         contagens, fontes usadas e totais de desfoque

Imagens Mapillary: licença CC BY-SA 4.0, com atribuição ao autor.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from anonymize import write_jpg

import requests

from common import (ROOT, blur_totals, count_by, load_blur_log, load_config,
                    save_blur_log, street_distance_fn, write_catalog, zone_dir)

API_URL = "https://graph.mapillary.com/images"
FIELDS = [
    "id", "captured_at", "computed_geometry", "geometry",
    "computed_compass_angle", "compass_angle", "is_pano", "sequence",
    "camera_type", "camera_parameters", "width", "height",
    "thumb_2048_url", "thumb_original_url", "creator",
]
LICENCA = "CC BY-SA 4.0"
LICENCA_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
MIN_TILE = 0.0001  # ~10 m; abaixo disto não se subdivide mais
SPLIT_FRACTION = 0.25  # só para avisar no quadrado mínimo
RETRY_STATUS = {429, 500, 502, 503, 504}

log = logging.getLogger("fetch_mapillary")


# ---------------------------------------------------------------- config / env

def load_token(env_path: Path) -> str:
    """Lê MAPILLARY_TOKEN do ambiente ou de .env (aceita o token com '|' sem aspas)."""
    tok = os.environ.get("MAPILLARY_TOKEN")
    if not tok and env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("MAPILLARY_TOKEN="):
                tok = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not tok:
        sys.exit("Falta MAPILLARY_TOKEN no ambiente ou em .env")
    return tok


def parse_bbox(s: str) -> list[float]:
    parts = [float(x) for x in s.replace(" ", "").split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("bbox = oeste,sul,este,norte")
    return parts


def validate_bbox(b: list[float]) -> None:
    w, s, e, n = b
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        sys.exit(f"bbox inválida (esperado oeste<este, sul<norte): {b}")


# ------------------------------------------------------------------------ HTTP

class Client:
    def __init__(self, token: str, max_retries: int = 6):
        self.s = requests.Session()
        # Token no cabeçalho para não aparecer em URLs/logs.
        self.s.headers["Authorization"] = f"OAuth {token}"
        self.max_retries = max_retries
        self.n_requests = 0
        self.n_retries = 0

    def get(self, url: str, params: dict | None = None, stream: bool = False,
            auth: bool = True) -> requests.Response:
        delay = 1.0
        for attempt in range(self.max_retries + 1):
            self.n_requests += 1
            try:
                if auth:
                    r = self.s.get(url, params=params, timeout=60, stream=stream)
                else:  # URLs de CDN já vêm assinadas
                    r = requests.get(url, timeout=60, stream=stream)
            except (requests.ConnectionError, requests.Timeout) as exc:
                r, err = None, str(exc)
            else:
                if r.status_code not in RETRY_STATUS:
                    r.raise_for_status()
                    return r
                err = f"HTTP {r.status_code}"
            if attempt == self.max_retries:
                raise RuntimeError(f"Falhou após {attempt + 1} tentativas: {err}")
            wait = delay
            if r is not None and r.headers.get("Retry-After", "").isdigit():
                wait = max(wait, float(r.headers["Retry-After"]))
            log.warning("%s — nova tentativa em %.0fs", err, wait)
            self.n_retries += 1
            time.sleep(wait)
            delay = min(delay * 2, 60)
        raise AssertionError("unreachable")


# ------------------------------------------------------------- pesquisa em grelha

def tiles(bbox: list[float], step: float):
    w, s, e, n = bbox
    y = s
    while y < n - 1e-12:
        x = w
        y2 = min(y + step, n)
        while x < e - 1e-12:
            x2 = min(x + step, e)
            yield [x, y, x2, y2]
            x = x2
        y = y2


def split4(b: list[float]) -> list[list[float]]:
    w, s, e, n = b
    mx, my = (w + e) / 2, (s + n) / 2
    return [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]


def _api(cli: Client, b: list[float], limit: int, extra: dict,
         stats: dict) -> list[dict]:
    params = {
        "fields": ",".join(FIELDS),
        "bbox": ",".join(f"{v:.7f}" for v in b),
        "limit": limit,
        **extra,
    }
    stats["pedidos_api"] += 1
    return cli.get(API_URL, params=params).json().get("data", [])


def query_tile(cli: Client, b: list[float], limit: int, extra: dict,
               stats: dict, data: list[dict] | None = None) -> list[dict]:
    """Devolve todas as imagens do quadrado b, subdividindo quando preciso.

    A API não é fiável a dizer se truncou: com mais imagens do que cabem, devolve
    um número aleatório *abaixo* do limit (medido: 6–90%), e isso acontece até
    com o total abaixo do limit. Quando o resultado está completo, é estável.
    Por isso um quadrado só se aceita se os 4 sub-quadrados não trouxerem
    nenhum id novo; senão desce-se um nível (reaproveitando as respostas).
    """
    if data is None:
        data = _api(cli, b, limit, extra, stats)
    if not data:
        return data
    if (b[2] - b[0]) <= MIN_TILE:
        if len(data) >= limit * SPLIT_FRACTION:
            stats["quadrados_truncados"] += 1
            log.warning("quadrado mínimo muito cheio, podem faltar imagens: %s", b)
        return data
    kids = [(sb, _api(cli, sb, limit, extra, stats)) for sb in split4(b)]
    ids = {x["id"] for x in data}
    if all(x["id"] in ids for _, kd in kids for x in kd):
        return data  # confirmado completo
    stats["subdivisoes"] += 1
    log.info("quadrado incompleto (%d) — a subdividir %s", len(data), b)
    out: list[dict] = []
    for sb, kd in kids:
        out.extend(query_tile(cli, sb, limit, extra, stats, kd))
    return out


# ------------------------------------------------------------------ normalização

def iso(ms: int | None) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def normalize(img: dict) -> dict:
    """Metadados Mapillary → registo base (computed_* com fallback para o original)."""
    cg, g = img.get("computed_geometry"), img.get("geometry")
    if cg and cg.get("coordinates"):
        lon, lat = cg["coordinates"][:2]
        coord_src = "computed"
    elif g and g.get("coordinates"):
        lon, lat = g["coordinates"][:2]
        coord_src = "original"
    else:
        lon = lat = None
        coord_src = None

    if img.get("computed_compass_angle") is not None:
        heading, head_src = float(img["computed_compass_angle"]) % 360.0, "computed"
    elif img.get("compass_angle") is not None:
        heading, head_src = float(img["compass_angle"]) % 360.0, "original"
    else:
        heading, head_src = None, None

    creator = img.get("creator") or {}
    autor = creator.get("username") or creator.get("id") or "desconhecido"
    seq = img.get("sequence")
    if isinstance(seq, dict):
        seq = seq.get("id")

    return {
        "image_id": str(img["id"]),
        "fonte": "mapillary",
        "lon": lon,
        "lat": lat,
        "coord_fonte": coord_src,
        "heading": heading,
        "heading_fonte": head_src,
        "captured_at": iso(img.get("captured_at")),
        "is_pano": bool(img.get("is_pano")),
        "sequence": seq,
        "camera_type": img.get("camera_type"),
        "camera_parameters": img.get("camera_parameters"),
        "autor": autor,
        "autor_id": creator.get("id"),
        "licenca": LICENCA,
        "atribuicao": f"© {autor} / Mapillary, {LICENCA}",
        "url_origem": f"https://www.mapillary.com/app/?pKey={img['id']}",
        "_thumb": img.get("thumb_2048_url"),
        "_thumb_original": img.get("thumb_original_url"),
    }


def expand(base: dict, pcfg: dict) -> list[dict]:
    """Uma imagem de origem → linhas de saída (1 para planas, N vistas para panorâmicas)."""
    if not base["is_pano"]:
        r = dict(base, id=base["image_id"], view=None)
        cp = base.get("camera_parameters")
        if base.get("camera_type") == "perspective" and isinstance(cp, list) and cp and cp[0]:
            r["focal_norm"] = float(cp[0])  # Mapillary: focal / max(w, h)
            r["fov_deg"] = round(math.degrees(2 * math.atan(0.5 / float(cp[0]))), 2)
        r["ficheiro"] = f"images/{r['id']}.jpg"
        return [r]
    fov = float(pcfg["fov_deg"])
    out = []
    for k, u in enumerate(pcfg["vistas"]):
        r = dict(base, id=f"{base['image_id']}_v{k}", view=k,
                 heading=(base["heading"] + u) % 360.0,
                 fov_deg=fov, focal_norm=0.5 / math.tan(math.radians(fov / 2)),
                 _u_deg=u)
        r["ficheiro"] = f"images/{r['id']}.jpg"
        out.append(r)
    return out


# ----------------------------------------------------------------- processamento

def fetch_bytes(cli: Client, rows: list[dict], usar_original: bool) -> bytes:
    b = rows[0]
    url = (b["_thumb_original"] if b["is_pano"] and usar_original else None) or b["_thumb"]
    if not url:
        raise RuntimeError("sem URL de imagem")
    return cli.get(url, auth=False).content


def process_source(data: bytes, rows: list[dict], pcfg: dict, anon, img_dir: Path,
                   blur_log: dict) -> None:
    """Descodifica em memória, corta (se panorâmica), desfoca e só então grava."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("imagem inválida")
    if rows[0]["is_pano"]:
        import py360convert
        sz = int(pcfg["tamanho_px"])
        views = [py360convert.e2p(img, fov_deg=(r["fov_deg"], r["fov_deg"]), u_deg=r["_u_deg"],
                                  v_deg=0, out_hw=(sz, sz), mode="bilinear") for r in rows]
    else:
        views = [img]
    del img, data  # o original não sai daqui
    for r, v in zip(rows, views):
        clean, counts = anon(np.ascontiguousarray(v))
        write_jpg(img_dir / f"{r['id']}.jpg", clean)
        blur_log[r["id"]] = counts


# ------------------------------------------------------------------------ main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", type=Path, default=ROOT / "config/municipio.yaml")
    ap.add_argument("--bbox", type=parse_bbox, help="oeste,sul,este,norte (sobrepõe o config)")
    ap.add_argument("--zona", help="nome da zona (sobrepõe o config)")
    ap.add_argument("--out-root", type=Path, help="raiz de saída (por omissão: saida do config)")
    ap.add_argument("--sem-rua", action="store_true", help="não filtrar pela distância à rua")
    ap.add_argument("--max-imagens", type=int, help="limitar n.º de imagens de origem (testes)")
    ap.add_argument("--sem-imagens", action="store_true", help="só metadados")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(message)s")
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    cfg = load_config(args.config)
    mcfg = cfg.get("mapillary", {})
    pcfg = {"fov_deg": 90, "vistas": [0, 90, 180, 270], "tamanho_px": 1024,
            "usar_original": True, **cfg.get("panoramicas", {})}
    bbox = args.bbox or cfg["bbox"]
    validate_bbox(bbox)
    zona = args.zona or cfg["zona"]
    incluir_pano = bool(cfg.get("incluir_panoramicas", False))
    desde = cfg.get("desde", cfg.get("data_minima"))
    rua = None if (args.sem_rua or args.bbox) else cfg.get("rua_geojson")
    buffer_m = float(cfg.get("buffer_rua_m", 30))
    dist = street_distance_fn(ROOT / rua) if rua else None

    out = zone_dir(cfg, zona, args.out_root) / "mapillary"
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    cli = Client(load_token(ROOT / ".env"))
    extra = {}
    if desde:
        extra["start_captured_at"] = f"{desde}T00:00:00Z"
    if not incluir_pano:
        extra["is_pano"] = "false"

    stats = {"pedidos_api": 0, "subdivisoes": 0, "quadrados_truncados": 0}
    t0 = time.time()
    raw: list[dict] = []
    tl = list(tiles(bbox, float(mcfg.get("tile_graus", 0.002))))
    log.info("bbox %s → %d quadrados", bbox, len(tl))
    for b in tl:
        raw.extend(query_tile(cli, b, int(mcfg.get("limit", 2000)), extra, stats))

    by_id: dict[str, dict] = {}
    for img in raw:
        by_id.setdefault(str(img["id"]), img)
    duplicados = len(raw) - len(by_id)

    # Filtros também do lado do cliente (a API nem sempre os respeita).
    w, s, e, n = bbox
    excl = {"panoramicas": 0, "antes_desde": 0, "sem_coordenadas": 0,
            "sem_heading": 0, "fora_bbox": 0, "longe_da_rua": 0}
    min_ms = (datetime.fromisoformat(desde).replace(tzinfo=timezone.utc)
              .timestamp() * 1000) if desde else None
    bases = []
    for img in by_id.values():
        if not incluir_pano and img.get("is_pano"):
            excl["panoramicas"] += 1; continue
        if min_ms and (img.get("captured_at") or 0) < min_ms:
            excl["antes_desde"] += 1; continue
        b = normalize(img)
        if b["lon"] is None:
            excl["sem_coordenadas"] += 1; continue
        if b["heading"] is None:
            excl["sem_heading"] += 1; continue
        # A API filtra pela geometria original; recorta-se pela corrigida.
        if not (w <= b["lon"] <= e and s <= b["lat"] <= n):
            excl["fora_bbox"] += 1; continue
        if dist and dist(b["lon"], b["lat"]) > buffer_m:
            excl["longe_da_rua"] += 1; continue
        bases.append(b)
    # Prioridade às mais recentes.
    bases.sort(key=lambda b: b["captured_at"] or "", reverse=True)
    if args.max_imagens:
        bases = bases[:args.max_imagens]
    groups = [expand(b, pcfg) for b in bases]

    blur_log = load_blur_log(out)
    proc = {"processadas": 0, "existentes": 0, "erro": 0}
    pending = [g for g in groups
               if not all((img_dir / f"{r['id']}.jpg").exists() for r in g)]
    proc["existentes"] = len(groups) - len(pending)
    if pending and not args.sem_imagens:
        from anonymize import Anonymizer
        anon = Anonymizer(cfg.get("desfoque"), ROOT)
        usar_orig = bool(pcfg["usar_original"])
        with ThreadPoolExecutor(int(mcfg.get("workers_download", 8))) as ex:
            futs = [(g, ex.submit(fetch_bytes, cli, g, usar_orig)) for g in pending]
            for i, (g, fut) in enumerate(futs, 1):
                try:
                    process_source(fut.result(), g, pcfg, anon, img_dir, blur_log)
                    proc["processadas"] += 1
                except Exception as exc:  # noqa: BLE001
                    log.error("falhou %s: %s", g[0]["image_id"], exc)
                    proc["erro"] += 1
                if i % 10 == 0 or i == len(futs):
                    log.info("%d/%d imagens de origem processadas", i, len(futs))
                    save_blur_log(out, blur_log)
        save_blur_log(out, blur_log)

    # Catálogo = só linhas cujo ficheiro desfocado existe.
    from PIL import Image
    recs = []
    for g in groups:
        for r in g:
            p = img_dir / f"{r['id']}.jpg"
            if not p.exists():
                continue
            with Image.open(p) as im:
                r["width"], r["height"] = im.size
            r.update(blur_log.get(r["id"], {}))
            recs.append(r)
    recs.sort(key=lambda r: (str(r["sequence"]), r["captured_at"] or "", r["id"]))
    write_catalog(out, recs)

    caps = sorted(r["captured_at"] for r in recs if r["captured_at"])
    novos = {r["id"] for g in pending for r in g}
    resumo = {
        "municipio": cfg["municipio"],
        "zona": zona,
        "fonte": "mapillary",
        "bbox": bbox,
        "desde": desde,
        "rua_geojson": rua,
        "buffer_rua_m": buffer_m if rua else None,
        "incluir_panoramicas": incluir_pano,
        "executado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duracao_s": round(time.time() - t0, 1),
        "quadrados": len(tl),
        **stats,
        "tentativas_repetidas": cli.n_retries,
        "devolvidas_api": len(raw),
        "duplicados_removidos": duplicados,
        "excluidas": excl,
        "imagens_origem": len(groups),
        "imagens_origem_planas": sum(not g[0]["is_pano"] for g in groups),
        "imagens_origem_panoramicas": sum(g[0]["is_pano"] for g in groups),
        "imagens": len(recs),
        "sequencias": len({r["sequence"] for r in recs}),
        "autores": count_by(recs, "autor"),
        "coord_fonte": count_by(recs, "coord_fonte"),
        "heading_fonte": count_by(recs, "heading_fonte"),
        "camera_type": count_by(recs, "camera_type"),
        "captura_de": caps[0] if caps else None,
        "captura_ate": caps[-1] if caps else None,
        "processamento": proc,
        "desfoque_total": blur_totals(recs),
        "desfoque_nesta_execucao": blur_totals([r for r in recs if r["id"] in novos]),
        "licenca": LICENCA,
        "licenca_url": LICENCA_URL,
    }
    (out / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2))
    print(json.dumps(resumo, ensure_ascii=False, indent=2))
    if proc["erro"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
