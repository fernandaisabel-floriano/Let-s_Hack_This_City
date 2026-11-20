#!/usr/bin/env python3
"""M5 + M6 num só passo: juntar deteções por direção (raios) e só depois calcular o ponto.

Cada deteção é um raio: origem = câmara, direção = heading + ângulo da caixa
(extra.bearing, calculado em geolocate.py). Por classe:

 1. Triangulação (metodo_posicao = "triangulado"): pares de raios de imagens
    diferentes que se cruzam à frente das duas câmaras, entre dist_min e
    dist_max, com ângulo ≥ angulo_min_graus e câmaras a ≥ base_min_m (vídeo:
    base_video_min_m). Cada ponto candidato recebe os raios que passam a
    ≤ max(tol_m, tol_frac · distância) — no máximo um por imagem. Guloso: o
    candidato com mais raios ganha, o ponto é refinado por mínimos quadrados e
    esses raios saem do jogo. Um ponto precisa de ≥ min_raios raios; com só 2
    é aceite apenas se o alcance bater (± tol_dist_estimada) com a distância por
    tamanho/contacto com o chão — dois raios de objetos diferentes cruzam-se
    sempre algures, e sem esta regra aparecem elementos fantasma.
 2. Raios que sobram juntam-se a um elemento triangulado se passarem perto dele.
 3. Vistas únicas:
      fontes a pé/bicicleta → interseção com a paralela ao trajeto, do lado do
        objeto na imagem, a lado_m (metodo "trajeto");
      fontes de carro → interseção com a linha do lancil da via OSM mais
        próxima: meia largura típica por highway=* (ou lanes × largura_via_m)
        + margem (metodo "via");
      senão, a distância por tamanho/contacto com o chão de geolocate.py
        (metodo "tamanho").
    As vistas únicas da mesma classe a ≤ raio_fusao_m (por classe) juntam-se.
 4. Nenhum ponto fica dentro de um edifício do OSM: é puxado ao longo do raio
    (ou para a fachada mais próxima, se triangulado) até ficar fora.

Calibração de cada vídeo (antes de tudo, se houver elementos vistos também no
Mapillary): desvio constante de heading δ e desvio residual de tempo τ que
minimizam a distância entre os raios do vídeo e a posição Mapillary do mesmo
elemento. Guardado em <zona>/video/<seq>/calibracao.json e aplicado.

Subtipo (M4, m4_voto.py): voto das vistas por elemento; subtipo incerto →
sempre "pendente". Deteções com extra.clip_rejeitado (filtro CLIP dos
contentores) não entram.

Saída: <zona>/catalogo/elementos.json (com metodo_posicao por elemento).

Ids estáveis (ids.py): cada elemento herda o id do elemento da execução anterior
da mesma classe a ≤ raio_fusao_m, para as decisões dos técnicos não se perderem.
O campo estado é só a sugestão dos limiares (config/limiares.json); a app e o
export.py recalculam-no com as decisões (estado.py).

Uso:
    python pipeline/fuse.py
"""
from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from confianca import confianca_elemento, feature, load_calibration, m8_cfg  # noqa: E402
from estado import estado_atual, estado_auto, ler_limiares, ler_registo, limiares_zona  # noqa: E402
from ids import herdar_ids, ler_registo_ids, relatorio  # noqa: E402
from m4_voto import subtipo, usar_deteccao  # noqa: E402

DEFAULTS = {
    "raio_fusao_m": {"sinal": 8, "candeeiro": 8, "contentor": 8},
    "angulo_min_graus": 10, "base_min_m": 2.0, "base_video_min_m": 8.0,
    "min_raios": 3, "tol_dist_estimada": 0.35,
    "dist_min_m": 2.0, "dist_max_m": 40.0, "tol_m": 1.0, "tol_frac": 0.05,
    "modo_por_fonte": {"mapillary": "carro", "video_proprio": "pe"},
    "lado_m": 2.0, "angulo_lado_min_graus": 5.0,
    "largura_via_m": 3.0, "margem_lancil_m": 0.5,
    "largura_por_highway": {"primary": 10, "secondary": 8, "tertiary": 7, "residential": 6,
                            "unclassified": 6, "living_street": 5, "service": 4, "pedestrian": 4},
    "via_max_dist_camera_m": 15.0,
    "edificios_geojson": None,
    "calibrar_video": True, "calib_min_elementos": 5, "calib_tau_min_elementos": 10,
}


# ------------------------------------------------------------------ geometria

class Proj:
    """WGS84 ↔ PT-TM06 (metros)."""

    def __init__(self, crs: str):
        from pyproj import Transformer
        self.f = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        self.i = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

    def xy(self, lon, lat):
        return self.f.transform(lon, lat)

    def ll(self, x, y):
        return self.i.transform(x, y)


def unit(bearing_deg: float) -> np.ndarray:
    b = math.radians(bearing_deg)
    return np.array([math.sin(b), math.cos(b)])


def cross(a, b):
    return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]


def ls_point(C: np.ndarray, U: np.ndarray) -> np.ndarray:
    """Ponto que minimiza a soma das distâncias perpendiculares² aos raios."""
    A = np.zeros((2, 2))
    b = np.zeros(2)
    for c, u in zip(C, U):
        M = np.eye(2) - np.outer(u, u)
        A += M
        b += M @ c
    return np.linalg.solve(A + 1e-9 * np.eye(2), b)


# --------------------------------------------------------------------- dados

def load_rays(dets: list[dict], proj: Proj, calib_video: dict) -> list[dict]:
    """Uma entrada por deteção com câmara (x, y), direção u e metadados."""
    rays = []
    for d in dets:
        e = d["extra"]
        if e.get("bearing") is None:
            continue
        cx, cy = proj.xy(d["lon_camara"], d["lat_camara"])
        heading = d["heading_camara"]
        bearing = e["bearing"]
        cal = calib_video.get(e.get("sequence")) if e["fonte"] == "video_proprio" else None
        if cal:
            bearing = (bearing + cal["delta_heading_graus"]) % 360
            heading = (heading + cal["delta_heading_graus"]) % 360
            shift = cal["tau_s"] * e.get("velocidade_ms", 0.0)
            cx += shift * math.sin(math.radians(heading))
            cy += shift * math.cos(math.radians(heading))
        rays.append({"det": d, "c": np.array([cx, cy]), "u": unit(bearing),
                     "heading": heading, "off": ((bearing - heading + 180) % 360) - 180,
                     "img": e["imagem_id"], "fonte": e["fonte"], "classe": d["classe"],
                     "conf": d["confianca"]})
    return rays


def frame_speeds(zdir: Path) -> dict[str, float]:
    """Velocidade (m/s) de cada frame de vídeo, pelos frames vizinhos (para τ)."""
    from common import haversine
    out = {}
    for csvp in zdir.glob("video/*/images.csv"):
        rows = list(csv.DictReader(open(csvp)))
        t = [datetime.fromisoformat(r["captured_at"]).timestamp() for r in rows]
        for i, r in enumerate(rows):
            a, b = max(0, i - 1), min(len(rows) - 1, i + 1)
            dt = t[b] - t[a]
            dd = haversine(float(rows[a]["lon"]), float(rows[a]["lat"]), float(rows[b]["lon"]), float(rows[b]["lat"]))
            out[r["id"]] = dd / dt if dt > 0 else 0.0
    return out


# -------------------------------------------------------------- triangulação

def triangulate(rays: list[dict], p: dict) -> tuple[list[dict], set[int]]:
    """Devolve (elementos triangulados [{ponto, membros}], índices usados)."""
    n = len(rays)
    if n < 2:
        return [], set()
    C = np.array([r["c"] for r in rays])
    U = np.array([r["u"] for r in rays])
    imgs = np.array([r["img"] for r in rays])
    video = np.array([r["fonte"] == "video_proprio" for r in rays])
    sin_min = math.sin(math.radians(p["angulo_min_graus"]))
    dmin, dmax = p["dist_min_m"], p["dist_max_m"]

    # candidatos: interseções de pares
    I, J = np.triu_indices(n, 1)
    keep = imgs[I] != imgs[J]
    base = np.linalg.norm(C[I] - C[J], axis=1)
    bmin = np.where(video[I] & video[J], p["base_video_min_m"], p["base_min_m"])
    keep &= (base >= bmin) & (base <= 2 * dmax)
    I, J = I[keep], J[keep]
    cr = cross(U[I], U[J])
    ok = np.abs(cr) >= sin_min
    I, J, cr = I[ok], J[ok], cr[ok]
    dC = C[J] - C[I]
    t1 = cross(dC, U[J]) / cr
    t2 = cross(dC, U[I]) / cr
    ok = (t1 >= dmin) & (t1 <= dmax) & (t2 >= dmin) & (t2 <= dmax)
    I, J, t1 = I[ok], J[ok], t1[ok]
    if not len(I):
        return [], set()
    P = C[I] + t1[:, None] * U[I]

    def support(pt: np.ndarray, livres: np.ndarray) -> list[int]:
        d = pt - C
        t = (d * U).sum(1)
        perp = np.abs(cross(d, U))
        ok = livres & (t >= dmin) & (t <= dmax) & (perp <= np.maximum(p["tol_m"], p["tol_frac"] * t))
        best: dict[str, tuple[float, int]] = {}
        for k in np.nonzero(ok)[0]:
            if imgs[k] not in best or perp[k] < best[imgs[k]][0]:
                best[imgs[k]] = (perp[k], int(k))
        return [k for _, k in best.values()]

    # distância estimada por tamanho/contacto com o chão (geolocate), quando válida
    dest = np.array([r["det"]["extra"]["dist_m"] if r["det"]["extra"].get("posicao_valida") else np.nan
                     for r in rays])

    def aceita(pt: np.ndarray, m: list[int]) -> bool:
        """≥ min_raios raios; com 2, só se o alcance bater com a distância estimada.
        (Dois raios de objetos diferentes cruzam-se sempre: sem isto há fantasmas.)"""
        if len(m) >= p["min_raios"]:
            return True
        if len(m) < 2:
            return False
        for k in m:
            if not np.isnan(dest[k]):
                t = float((pt - C[k]) @ U[k])
                if abs(t - dest[k]) <= p["tol_dist_estimada"] * dest[k]:
                    return True
        return False

    livres = np.ones(n, bool)
    # ordem inicial: n.º de raios que cada candidato junta (calculado uma vez)
    score = np.empty(len(P))
    for s in range(0, len(P), 4000):
        Pc = P[s:s + 4000][:, None, :] - C[None, :, :]
        t = (Pc * U[None]).sum(2)
        perp = np.abs(cross(Pc, U[None]))
        okk = (t >= dmin) & (t <= dmax) & (perp <= np.maximum(p["tol_m"], p["tol_frac"] * t))
        score[s:s + 4000] = okk.sum(1)
    order = np.argsort(-score)
    out, used = [], set()
    for q in order:
        if score[q] < 2:
            break
        if not (livres[I[q]] and livres[J[q]]):
            continue
        m = support(P[q], livres)
        if len(m) < 2:
            continue
        pt = ls_point(C[m], U[m])
        m = support(pt, livres)
        if len(m) < 2:
            continue
        pt = ls_point(C[m], U[m])
        if not aceita(pt, m):
            continue
        out.append({"ponto": pt, "membros": m})
        livres[m] = False
        used.update(m)
    return out, used


# -------------------------------------------------------------- vista única

class Ruas:
    def __init__(self, cfg: dict, proj: Proj, p: dict):
        feats = json.loads((ROOT / cfg["rua_geojson"]).read_text())["features"]
        self.segs = []
        for f in feats:
            hw = f["properties"].get("highway")
            lanes = f["properties"].get("lanes")
            w = float(lanes) * p["largura_via_m"] if lanes else float(p["largura_por_highway"].get(hw, 6))
            pts = [np.array(proj.xy(*c)) for c in f["geometry"]["coordinates"]]
            for a, b in zip(pts, pts[1:]):
                self.segs.append((a, b, w / 2 + p["margem_lancil_m"]))

    def nearest(self, c: np.ndarray):
        best = (float("inf"), None)
        for a, b, off in self.segs:
            ab = b - a
            t = np.clip(np.dot(c - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
            d = np.linalg.norm(c - (a + t * ab))
            if d < best[0]:
                best = (d, (a, b, off))
        return best


def single_point(r: dict, p: dict, ruas: Ruas, proj: Proj):
    modo = p["modo_por_fonte"].get(r["fonte"], "carro")
    c, u = r["c"], r["u"]
    if modo == "pe":
        if abs(r["off"]) >= p["angulo_lado_min_graus"]:
            t = p["lado_m"] / abs(math.sin(math.radians(r["off"])))
            if p["dist_min_m"] <= t <= p["dist_max_m"]:
                return c + t * u, "trajeto"
    else:
        d, seg = ruas.nearest(c)
        if seg is not None and d <= p["via_max_dist_camera_m"]:
            a, b, off = seg
            dirv = (b - a) / np.linalg.norm(b - a)
            nrm = np.array([-dirv[1], dirv[0]])
            ts = []
            for s in (1, -1):
                q = a + s * off * nrm  # ponto na linha do lancil
                den = cross(u, dirv)
                if abs(den) > 1e-6:
                    t = cross(q - c, dirv) / den
                    if p["dist_min_m"] <= t <= p["dist_max_m"]:
                        ts.append(t)
            if ts:
                return c + min(ts) * u, "via"
    e = r["det"]["extra"]
    if e.get("posicao_valida"):
        return np.array(proj.xy(e["lon_obj"], e["lat_obj"])), "tamanho"
    return None, None


# --------------------------------------------------------------- edifícios

class Edificios:
    def __init__(self, path: Path | None, proj: Proj):
        self.polys = []
        if path and path.exists():
            from shapely.geometry import Polygon
            from shapely.prepared import prep
            for f in json.loads(path.read_text())["features"]:
                pg = Polygon([proj.xy(*c) for c in f["geometry"]["coordinates"][0]]).buffer(0)
                if pg.is_valid and pg.area > 0:
                    self.polys.append((pg, prep(pg)))
        from shapely.strtree import STRtree
        self.tree = STRtree([pg for pg, _ in self.polys]) if self.polys else None

    def fix(self, pt: np.ndarray, origem: np.ndarray | None) -> tuple[np.ndarray, bool]:
        """Se o ponto cai num edifício: recua ao longo do raio (origem→ponto) até à
        fachada, ou vai para a fachada mais próxima. Devolve (ponto, ajustado)."""
        if self.tree is None:
            return pt, False
        from shapely.geometry import LineString, Point
        P = Point(*pt)
        for k in self.tree.query(P):
            pg, pr = self.polys[int(k)]
            if not pr.contains(P):
                continue
            if origem is not None and not pg.contains(Point(*origem)):
                inter = LineString([tuple(origem), tuple(pt)]).intersection(pg.exterior)
                pts = [np.array(g.coords[0]) for g in getattr(inter, "geoms", [inter]) if not g.is_empty]
                if pts:
                    q = min(pts, key=lambda v: np.linalg.norm(v - origem))
                    v = q - origem
                    return q - 0.3 * v / max(np.linalg.norm(v), 1e-9), True
            q = np.array(pg.exterior.interpolate(pg.exterior.project(P)).coords[0])
            v = q - pt
            return q + 0.3 * v / max(np.linalg.norm(v), 1e-9), True
        return pt, False


# ------------------------------------------------------------------ elementos

def build_elements(rays: list[dict], p: dict, ruas: Ruas, edif: Edificios, proj: Proj) -> list[dict]:
    els = []
    for classe in ("sinal", "candeeiro", "contentor"):
        R = [r for r in rays if r["classe"] == classe]
        tri, used = triangulate(R, p)
        tri_pts = [t["ponto"] for t in tri]
        groups = [{"membros": list(t["membros"]), "ponto": t["ponto"], "metodo": "triangulado"} for t in tri]
        # 2. raios livres que passam perto de um elemento triangulado
        sobras = []
        for k, r in enumerate(R):
            if k in used:
                continue
            best = None
            for g, pt in zip(groups, tri_pts):
                if any(R[m]["img"] == r["img"] for m in g["membros"]):
                    continue
                d = pt - r["c"]
                t = float(d @ r["u"])
                perp = abs(float(cross(d, r["u"])))
                if p["dist_min_m"] <= t <= p["dist_max_m"] and perp <= max(p["tol_m"], p["tol_frac"] * t):
                    if best is None or perp < best[0]:
                        best = (perp, g)
            if best:
                best[1]["membros"].append(k)
            else:
                sobras.append(k)
        # 3. vistas únicas → ponto próprio → junção por distância
        raio = float(p["raio_fusao_m"].get(classe, 8)) if isinstance(p["raio_fusao_m"], dict) else float(p["raio_fusao_m"])
        singles = []
        for k in sorted(sobras, key=lambda k: -R[k]["conf"]):
            pt, metodo = single_point(R[k], p, ruas, proj)
            if pt is None:
                continue
            pt, _ = edif.fix(pt, R[k]["c"])
            best = None
            for g in singles:
                if any(R[m]["img"] == R[k]["img"] for m in g["membros"]):
                    continue
                dd = float(np.linalg.norm(g["ponto"] - pt))
                if dd <= raio and (best is None or dd < best[0]):
                    best = (dd, g)
            if best:
                g = best[1]
                g["membros"].append(k)
                g["pts"].append(pt)
                g["metodos"].append(metodo)
                w = np.array([R[m]["conf"] for m in g["membros"]])
                g["ponto"] = (np.array(g["pts"]) * w[:, None]).sum(0) / w.sum()
            else:
                singles.append({"membros": [k], "pts": [pt], "metodos": [metodo], "ponto": pt})
        # vistas únicas a ≤ raio de um elemento triangulado juntam-se a ele (o
        # ponto triangulado mantém-se: é o mais fiável)
        restantes = []
        for g in singles:
            imgs_g = {R[m]["img"] for m in g["membros"]}
            best = None
            for t in groups:
                if imgs_g & {R[m]["img"] for m in t["membros"]}:
                    continue
                dd = float(np.linalg.norm(t["ponto"] - g["ponto"]))
                if dd <= raio and (best is None or dd < best[0]):
                    best = (dd, t)
            if best:
                best[1]["membros"].extend(g["membros"])
            else:
                restantes.append(g)
        singles = restantes
        for g in groups:
            g["ponto"], g["ajustado_edificio"] = edif.fix(g["ponto"], None)
        for g in singles:
            g["metodo"] = Counter(g["metodos"]).most_common(1)[0][0]
            g["ajustado_edificio"] = False
        for g in groups + singles:
            lon, lat = proj.ll(*g["ponto"])
            els.append({"classe": classe, "lon": lon, "lat": lat, "metodo": g["metodo"],
                        "membros": [R[m] for m in g["membros"]],
                        "ajustado_edificio": g.get("ajustado_edificio", False)})
    return els


def fundir_coerentes(els: list[dict], p: dict, proj: Proj, edif: "Edificios") -> tuple[list[dict], int]:
    """Etapa 2: junta dois elementos da mesma classe quando as direções de TODAS as fotos dos dois se
    cruzam num só ponto — o mesmo objeto partido em dois pela triangulação gulosa (19/11: 16 dos 29
    duplicados confirmados eram Mapillary + Mapillary, triangulados).

    Condições (m6.fundir_*): os dois com ≥ 2 imagens, a ≤ fundir_dist_m, o ponto comum com resíduo
    mediano ≤ fundir_tol_m em CADA um dos dois grupos, à frente de todas as câmaras e dentro do alcance. Gulosa: o par com menor
    resíduo primeiro.

    Imagens com vista nos dois: só se as caixas apontarem na mesma direção (intervalos horizontais
    sobrepostos ≥ fundir_sobreposicao_x da mais estreita) — o detetor marcou duas vezes o mesmo objeto
    (ex.: cabeça e poste do candeeiro). Medido a 19/11: 14 dos 15 duplicados confirmados que a
    triangulação deixou separados partilhavam imagens assim. Caixas em direções diferentes = dois objetos."""
    sob_min = float(p.get("fundir_sobreposicao_x", 0.5))

    def compativeis(a: dict, b: dict, comuns: set) -> bool:
        for img in comuns:
            ba = [r["det"]["bbox"] for r in a["membros"] if r["img"] == img]
            bb = [r["det"]["bbox"] for r in b["membros"] if r["img"] == img]
            ok = any(min(x[2], y[2]) - max(x[0], y[0]) >= sob_min * min(x[2] - x[0], y[2] - y[0]) for x in ba for y in bb)
            if not ok:
                return False
        return True

    dmax, tol = float(p.get("fundir_dist_m", 0)), float(p.get("fundir_tol_m", 1.0))
    if dmax <= 0:
        return els, 0
    n_fund = 0
    while True:
        best = None
        for i, a in enumerate(els):
            ia = {r["img"] for r in a["membros"]}
            if len(ia) < 2:
                continue
            pa = np.array(proj.xy(a["lon"], a["lat"]))
            for j in range(i + 1, len(els)):
                b = els[j]
                if b["classe"] != a["classe"]:
                    continue
                ib = {r["img"] for r in b["membros"]}
                if len(ib) < 2 or not compativeis(a, b, ia & ib):
                    continue
                pb = np.array(proj.xy(b["lon"], b["lat"]))
                dab = float(np.linalg.norm(pa - pb))
                if dab > dmax:
                    continue
                R = a["membros"] + b["membros"]
                C, U = np.array([r["c"] for r in R]), np.array([r["u"] for r in R])
                pt = ls_point(C, U)
                v = pt - C
                t = (v * U).sum(1)
                if (t <= p["dist_min_m"] * 0.5).any() or (t > p["dist_max_m"]).any():
                    continue
                # o ponto comum de um duplicado fica entre os dois; o de dois objetos vizinhos fica atrás
                # de um deles (os raios cruzam-se depois de passar pelo objeto)
                if max(np.linalg.norm(pt - pa), np.linalg.norm(pt - pb)) > 0.6 * dab + 0.75:
                    continue
                # os DOIS grupos têm de passar pelo ponto comum (com a mediana de todos os raios,
                # dois candeeiros vizinhos juntavam-se: 2 de 5 raios podiam estar longe)
                d = np.abs(cross(v, U))
                na = len(a["membros"])
                res = max(float(np.median(d[:na])), float(np.median(d[na:])))
                if res <= tol and (best is None or res < best[0]):
                    best = (res, i, j, pt)
        if best is None:
            return els, n_fund
        _, i, j, pt = best
        pt, ajust = edif.fix(pt, None)
        lon, lat = proj.ll(*pt)
        a, b = els[i], els[j]
        novo = {**a, "lon": lon, "lat": lat, "metodo": "triangulado", "membros": a["membros"] + b["membros"],
                "ajustado_edificio": ajust}
        els = [e for k, e in enumerate(els) if k not in (i, j)] + [novo]
        n_fund += 1


def element_dict(i: int, g: dict, calib: dict, m8: dict, proj: Proj, m4: dict | None = None,
                 lim: dict[str, dict] | None = None) -> dict:
    membros = [r["det"] for r in g["membros"]]
    classe = g["classe"]
    por_imagem: dict[str, float] = defaultdict(float)
    for m in membros:
        por_imagem[m["extra"]["imagem_id"]] = max(por_imagem[m["extra"]["imagem_id"]], m["confianca"])
    confs = sorted(por_imagem.values(), reverse=True)
    conf = confianca_elemento(confs, classe, calib, m8)
    # contentores: 2.ª opinião do CLIP (contentores_clip.py), melhor por imagem, média das top-k imagens
    clip_img: dict[str, float] = {}
    for m in membros:
        c = m["extra"].get("clip_contentor")
        if c is not None:
            clip_img[m["extra"]["imagem_id"]] = max(clip_img.get(m["extra"]["imagem_id"], 0.0), float(c))
    conf_clip = round(feature(list(clip_img.values()), m8["top_k"]), 3) if clip_img else None
    subclasse, conf_cls, incerto, motivo_sub = subtipo(classe, membros, m4)
    ex, ey = proj.xy(g["lon"], g["lat"])
    dist = {id(r): float(np.linalg.norm(np.array([ex, ey]) - r["c"])) for r in g["membros"]}
    # etapa 1: a imagem escolhida vem de uma vista boa (as fracas só ajudam a geometria)
    boas = [r for r in g["membros"] if not r["det"]["extra"].get("fraca")]
    melhor = max(boas or g["membros"], key=lambda r: r["conf"] / max(dist[id(r)], 5.0))["det"]
    n_boas = len({r["img"] for r in boas})
    datas = sorted(m["extra"]["captured_at"] for m in membros)
    fontes = sorted({m["extra"]["fonte"] for m in membros})
    atrib = sorted({m["extra"]["atribuicao"] for m in membros if m["extra"].get("atribuicao")})
    # resíduo: distância perpendicular média dos raios ao ponto (qualidade da posição)
    res = [abs(float(cross(np.array([ex, ey]) - r["c"], r["u"]))) for r in g["membros"]]
    return {
        "id": f"{classe[:3]}_{i:04d}", "tipo": classe, "subtipo": subclasse,
        "lon": round(g["lon"], 7), "lat": round(g["lat"], 7),
        "confianca": None if conf is None else round(conf, 3),
        "confianca_max_vista": round(confs[0], 3), "confianca_clip": conf_clip, "confianca_subtipo": conf_cls,
        "subtipo_incerto": incerto, "subtipo_motivo": motivo_sub,
        "n_vistas": len(confs),
        "estado": None,  # preenchido em main() com estado_auto (limiares da zona)
        "primeira_vista": datas[0], "ultima_vista": datas[-1],
        "imagem": melhor["extra"]["imagem"], "recorte": melhor["recorte"],
        "fonte": "+".join(fontes), "atribuicao": "; ".join(atrib),
        "metodo_posicao": g["metodo"], "ajustado_edificio": g["ajustado_edificio"],
        "residuo_raios_m": round(float(np.median(res)), 2),
        "deteccoes": [m["id"] for m in membros],
        "n_vistas_boas": n_boas,
        "so_vistas_fracas": n_boas == 0,
        "nitidez_imagem": ((melhor["extra"].get("qualidade") or {}).get("nitidez")),
    }


# -------------------------------------------------------- calibração do vídeo

def calibrate_video(els: list[dict], p: dict, zdir: Path) -> dict:
    """δ heading e τ tempo por sequência de vídeo, contra posições Mapillary."""
    out = {}
    por_seq: dict[str, list] = defaultdict(list)
    for g in els:
        mp = [r for r in g["membros"] if r["fonte"] == "mapillary"]
        vd = [r for r in g["membros"] if r["fonte"] == "video_proprio"]
        if not mp or not vd:
            continue
        # posição só com o Mapillary
        if len(mp) >= 2:
            ang = max(abs(float(cross(a["u"], b["u"]))) for a in mp for b in mp)
            if ang >= math.sin(math.radians(p["angulo_min_graus"])):
                ref = ls_point(np.array([r["c"] for r in mp]), np.array([r["u"] for r in mp]))
            else:
                continue
        else:
            continue
        for r in vd:
            por_seq[r["det"]["extra"]["sequence"]].append((ref, r))
    for seq, items in por_seq.items():
        def err(delta, tau):
            e = []
            for ref, r in items:
                h = math.radians(r["heading"] + delta)
                b = math.radians(r["det"]["extra"]["bearing"] + delta)
                c = r["c"] + tau * r["det"]["extra"].get("velocidade_ms", 0.0) * np.array([math.sin(h), math.cos(h)])
                u = np.array([math.sin(b), math.cos(b)])
                d = ref - c
                e.append(abs(float(cross(d, u))) if d @ u > 0 else float(np.linalg.norm(d)))
            return float(np.median(e))
        n_el = len({id(ref) for ref, _ in items})
        if n_el < p["calib_min_elementos"]:
            print(f"calibração {seq}: só {n_el} elementos partilhados com o Mapillary — não aplicada")
            continue
        # τ e δ compensam-se com poucos elementos (17/11: τ ia para o limite da
        # grelha). τ só se estima com elementos suficientes; senão fica 0.
        taus = np.arange(-3, 3.01, 0.25) if n_el >= p["calib_tau_min_elementos"] else [0.0]
        grid = [(err(dl, tu), dl, tu) for dl in np.arange(-20, 20.01, 0.5) for tu in taus]
        best = min(grid)
        out[seq] = {"delta_heading_graus": float(best[1]), "tau_s": float(best[2]),
                    "tau_estimado": len(taus) > 1,
                    "erro_mediano_antes_m": round(err(0, 0), 2), "erro_mediano_depois_m": round(best[0], 2),
                    "n_raios": len(items), "n_elementos": n_el}
        (zdir / "video" / seq / "calibracao.json").write_text(json.dumps(out[seq], indent=1))
    return out


# ----------------------------------------------------------------------- main

def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    p = {**DEFAULTS, **(cfg.get("m6") or {})}
    if isinstance(p["raio_fusao_m"], (int, float)):
        p["raio_fusao_m"] = {c: float(p["raio_fusao_m"]) for c in ("sinal", "candeeiro", "contentor")}
    m8 = m8_cfg(cfg)
    calib = load_calibration(m8)
    zdir = zone_dir(cfg)
    proj = Proj(cfg.get("crs_local", "EPSG:3763"))
    ruas = Ruas(cfg, proj, p)
    edif = Edificios(ROOT / p["edificios_geojson"] if p.get("edificios_geojson") else None, proj)
    if edif.tree is None:
        print("AVISO: sem edifícios do OSM — a restrição 'fora de edifícios' não se aplica")
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json")) if usar_deteccao(d)]
    vel = frame_speeds(zdir)
    for d in dets:
        d["extra"]["velocidade_ms"] = vel.get(d["extra"]["imagem_id"], 0.0)

    cal_video = {}
    if p["calibrar_video"] and any(d["extra"]["fonte"] == "video_proprio" for d in dets):
        els0 = build_elements(load_rays(dets, proj, {}), p, ruas, edif, proj)
        cal_video = calibrate_video(els0, p, zdir)
        for seq, c in cal_video.items():
            print(f"calibração {seq}: δ heading {c['delta_heading_graus']:+.1f}°, τ {c['tau_s']:+.2f} s — "
                  f"erro mediano {c['erro_mediano_antes_m']} → {c['erro_mediano_depois_m']} m "
                  f"({c['n_raios']} raios, {c['n_elementos']} elementos com posição Mapillary)")
        if not cal_video:
            print("calibração do vídeo: não há elementos com posição Mapillary triangulada e vistas de vídeo")

    # etapa 1: as vistas fracas (qualidade.py) entram na geometria — medido a 19/11, tirá-las do
    # agrupamento desfazia duplicados juntados (contentores: 6 → 1 de 9) e perdia reais. Ficam de
    # lado onde confundem: não são a imagem escolhida e não contam para a entrada automática
    # (n_vistas_boas); um objeto só com vistas fracas vai sempre para a fila.
    groups = build_elements(load_rays(dets, proj, cal_video), p, ruas, edif, proj)
    groups, n_fund = fundir_coerentes(groups, p, proj, edif)
    if n_fund:
        print(f"fusão coerente: {n_fund} pares de elementos juntados (as direções das fotos cruzam-se num só ponto)")
    n_fracas = sum(bool(d["extra"].get("fraca")) for d in dets)
    if n_fracas:
        print(f"qualidade: {n_fracas} de {len(dets)} vistas fracas (só geometria: não são imagem nem confirmação)")
    els = [element_dict(i, g, calib, m8, proj, cfg.get("m4")) for i, g in enumerate(groups, 1)]
    lim = limiares_zona(ler_limiares(cfg=cfg), cfg["zona"])
    for e in els:
        e["estado"] = estado_auto(e, lim[e["tipo"]])
    out = zdir / "catalogo"
    out.mkdir(exist_ok=True)

    # D1: herdar os ids da execução anterior (as decisões dos técnicos estão guardadas por id)
    anterior = out / "elementos.json"
    antigos = json.load(open(anterior)) if anterior.exists() else []
    todas_dets = {d["id"] for d in json.load(open(zdir / "deteccoes/deteccoes.json"))}
    els, reg_ids = herdar_ids(els, antigos, p["raio_fusao_m"], ler_registo_ids(out / "ids.json"), todas_dets)
    (out / "ids.json").write_text(json.dumps(reg_ids, ensure_ascii=False, indent=1), encoding="utf-8")
    decididos = set(estado_atual(ler_registo(out / "registo_validacoes.jsonl")))
    for linha in relatorio(reg_ids["execucoes"][-1], decididos):
        print(linha)

    json.dump(els, open(out / "elementos.json", "w"), ensure_ascii=False, indent=1)
    n_det = sum(len(g["membros"]) for g in groups)
    print(f"{n_det}/{len(dets)} deteções usadas → {len(els)} elementos {dict(Counter(e['tipo'] for e in els))}")
    print(f"  metodo_posicao: {dict(Counter(e['metodo_posicao'] for e in els))}; "
          f"ajustados a edifícios: {sum(e['ajustado_edificio'] for e in els)}")
    print(f"  estados {dict(Counter(e['estado'] for e in els))}; "
          f"vistas: {dict(sorted(Counter(min(e['n_vistas'], 5) for e in els).items()))} (5 = 5+)")


if __name__ == "__main__":
    main()
