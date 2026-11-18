#!/usr/bin/env python3
"""Gera tests/dados_falsos/: uma zona falsa com a mesma estrutura de data/.

    python tests/gerar_dados_falsos.py

Cena sintética na Rua dos Santos Mártires (geometria real do OSM): 3 câmaras a
avançar pela rua, sinais e contentores desenhados à mão projetados com o mesmo
modelo de câmara da M5 (por isso a fusão junta as vistas do mesmo objeto).
Inclui o que a M3 teria produzido (deteccoes.json + recortes largos) e um
teste de prompts do YOLO-World (raw_detections.json + labels.json) para o modo
contentores da página. Nada aqui é uma imagem real.

Também escreve:
  config.yaml       config da zona falsa (CTRLF_CONFIG), com saídas em tests/dados_falsos/
  clip_oraculo.json o que o CLIP falso (tests/fakes/clip.py) responde a cada recorte
  verdade.json      rótulos certos (para simular a rotulagem)
"""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml
from PIL import Image

AQUI = Path(__file__).resolve().parent
ROOT = AQUI.parent
sys.path[:0] = [str(AQUI), str(AQUI / "fakes"), str(ROOT / "pipeline")]

from clip import impressao_digital, reduzir  # noqa: E402  (CLIP falso)
from classify_signs import recorte_justo  # noqa: E402
import contentores_clip as cc  # noqa: E402
from common import recorte_largo_janela, write_catalog  # noqa: E402
import sinais_sinteticos as ss  # noqa: E402

BASE = AQUI / "dados_falsos"
REL = BASE.relative_to(ROOT)
W, H, FOV = 1600, 1200, 70.0
F = (W / 2) / math.tan(math.radians(FOV / 2))
H_CAM = 1.4            # m5.camera_altura_m.mapillary
PLACA = 0.7            # m5.sinal_tamanho_m

# (id, desenho, rótulo manual, s ao longo da rua [m], lateral [m, + = direita], prompt, oráculo CLIP)
SINAIS = [
    ("A", ss.limite(40), "limite_40", 30, 2.5, "traffic sign", {"number 40": 0.45, "number 70": 0.3}),
    ("B", ss.stop(), "stop", 34, -2.0, "stop sign", {"STOP": 0.75}),
    ("C", ss.cedencia(), "cedencia", 27, -4.5, "traffic sign", {"yield": 0.35, "warning": 0.35}),
    ("D", ss.costas(), "costas", 31, 6.0, "road sign", {"grey metal back": 0.35, "back side of a round": 0.35}),
    ("E", ss.perigo(), "outro_frente", 38, 12.0, "traffic sign", {"warning": 0.7}),
    ("F", ss.limite(80), "limite_outro", 36, -7.5, "traffic sign", {"number 80": 0.65}),
    ("G", ss.informacao(), "outro_frente", 33, 9.0, "stop sign", {"information": 0.7}),
]
# (id, desenho, verdadeiro?, s, lateral, tecla na página, largura, altura [m], oráculo CLIP do filtro)
CONTENTORES = [
    ("H", ss.contentor_ilha(), True, 29, 5.5, "2", 2.4, 1.6, {"container": 0.8}),
    ("I", ss.papeleira(), False, 26, 3.0, "p", 0.5, 1.0, {"litter bin attached": 0.6}),
]
CAMARAS_S = [8, 11, 14]
# altura do centro da placa [m] — diferente por sinal para não se taparem na imagem
ALTURA = {"A": 2.0, "B": 2.3, "C": 3.1, "D": 3.0, "E": 2.5, "F": 1.8, "G": 3.6}


# ---------------------------------------------------------------- geometria

def rua() -> list[tuple[float, float]]:
    d = json.load(open(ROOT / "config/ruas/santos-martires-v3.geojson"))
    return next(f["geometry"]["coordinates"] for f in d["features"] if f["properties"].get("osm_id") == 172547669)


LINHA = rua()
LAT0 = LINHA[0][1]
KX, KY = 111320 * math.cos(math.radians(LAT0)), 111320.0


def xy(lon, lat):
    return (lon - LINHA[0][0]) * KX, (lat - LINHA[0][1]) * KY


def lonlat(x, y):
    return LINHA[0][0] + x / KX, LINHA[0][1] + y / KY


PTS = [xy(*c) for c in LINHA]


def ponto(s: float, lateral: float = 0.0) -> tuple[float, float, float]:
    """(x, y, rumo) a s metros do início da rua, deslocado `lateral` m para a direita."""
    for (ax, ay), (bx, by) in zip(PTS, PTS[1:]):
        L = math.hypot(bx - ax, by - ay)
        if s <= L:
            tx, ty = (bx - ax) / L, (by - ay) / L
            rumo = math.degrees(math.atan2(tx, ty)) % 360
            return ax + tx * s + ty * lateral, ay + ty * s - tx * lateral, rumo
        s -= L
    raise ValueError("s fora da rua")


def projetar(cam, obj):
    """(cx_px, distância·cos, desvio) do objeto na imagem da câmara, ou None se fora do campo."""
    cx, cy, rumo = cam
    ox, oy = obj
    b = math.degrees(math.atan2(ox - cx, oy - cy)) % 360
    off = (b - rumo + 180) % 360 - 180
    if abs(off) > FOV / 2 - 3:
        return None
    d = math.hypot(ox - cx, oy - cy)
    return W / 2 + F * math.tan(math.radians(off)), d * math.cos(math.radians(off))


# ------------------------------------------------------------------- cena

def cena() -> np.ndarray:
    im = np.zeros((H, W, 3), np.uint8)
    im[: H // 2 - 120] = (225, 200, 170)       # céu
    im[H // 2 - 120: H // 2 + 40] = (150, 180, 200)  # fachadas
    im[H // 2 + 40:] = (95, 95, 95)            # estrada
    return im


def colar(im, desenho, x1, y1, lado_w, lado_h):
    x1, y1 = int(round(x1)), int(round(y1))
    w, h = max(2, int(round(lado_w))), max(2, int(round(lado_h)))
    patch = cv2.resize(desenho, (w, h), interpolation=cv2.INTER_AREA)
    # o fundo do desenho (cor FUNDO) fica transparente
    mask = np.any(np.abs(patch.astype(int) - ss.FUNDO) > 12, axis=2)
    X0, Y0, X1, Y1 = max(0, x1), max(0, y1), min(W, x1 + w), min(H, y1 + h)
    if X1 <= X0 or Y1 <= Y0:
        return None
    sub = patch[Y0 - y1:Y1 - y1, X0 - x1:X1 - x1]
    m = mask[Y0 - y1:Y1 - y1, X0 - x1:X1 - x1]
    im[Y0:Y1, X0:X1][m] = sub[m]
    return [float(X0), float(Y0), float(X1), float(Y1)]


def main() -> None:
    if BASE.exists():
        shutil.rmtree(BASE)
    cfg = yaml.safe_load(open(ROOT / "config/municipio.yaml", encoding="utf-8"))
    cfg["saida"] = str(REL / "data/clean")
    cfg["relatorios_yolo_world"] = str(REL / "reports/yolo_world_test")
    cfg["contentores_relatorios"] = str(REL / "reports/contentores")
    cfg["contentores_clip"] = {**cfg.get("contentores_clip", {}), "ativo": True, "limiar": 0.5, "escrever_tipo": True}
    cfg["m4"].update(rotulos=str(REL / "reports/m4/rotulos.json"),
                     rotulos_contentores=str(REL / "reports/m4/rotulos_contentores.json"),
                     relatorios=str(REL / "reports/m4"))
    cfg["m10"]["referencia"] = str(REL / "data/clean/aveiro/santos-martires/referencia.csv")
    zdir = BASE / "data/clean" / cfg["municipio"] / cfg["zona"]
    mdir = zdir / "mapillary"
    (mdir / "images").mkdir(parents=True)
    (zdir / "deteccoes/recortes").mkdir(parents=True)
    yw = BASE / "reports/yolo_world_test/v_teste"
    yw.mkdir(parents=True)
    BASE.joinpath("config.yaml").write_text(
        "# GERADO por tests/gerar_dados_falsos.py — config da zona FALSA\n" + yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False),
        encoding="utf-8")
    margem = float(cfg["m4"]["recorte_margem"])

    recs, dets, oraculo, verdade = [], [], {}, {"sinais": {}, "contentores": {}}
    raw = {"segundos_por_imagem": 0.5, "imgsz": 1280, "conf_min": 0.05, "imagens": [], "deteccoes": [], "objetos": []}
    labels = {"criterios": "dados falsos", "rotulado_por": {"gerador": "tests/gerar_dados_falsos.py"}, "caixas": []}
    rng = np.random.default_rng(7)

    for k, s_cam in enumerate(CAMARAS_S):
        cam = ponto(s_cam)
        iid = f"falsa_{k}"
        im = cena()
        objetos = []   # (tipo, id, bbox, extra)
        # mais longe primeiro (os mais perto tapam)
        todos = [("sinal",) + t for t in SINAIS] + [("contentor",) + t for t in CONTENTORES]
        todos.sort(key=lambda t: -math.dist(cam[:2], ponto(t[4], t[5])[:2]))
        for t in todos:
            pr = projetar(cam, ponto(t[4], t[5])[:2])
            if pr is None:
                continue
            u, dc = pr
            chao = H / 2 + F * H_CAM / dc
            if t[0] == "sinal":
                lado = F * PLACA / dc
                topo = H / 2 - F * (ALTURA[t[1]] + PLACA / 2 - H_CAM) / dc
                cv2.line(im, (int(u), int(topo + lado)), (int(u), int(chao)), (50, 50, 50), max(2, int(lado / 12)))
                bb = colar(im, t[2], u - lado / 2, topo, lado, lado)
            else:
                lw, lh = F * t[7] / dc, F * t[8] / dc
                bb = colar(im, t[2], u - lw / 2, chao - lh, lw, lh)
            if bb is not None and bb[2] - bb[0] > 4:
                objetos.append((t, bb))
        # um falso positivo de sinal: janela numa fachada
        jx, jy = 200 + 300 * k, H // 2 - 100
        cv2.rectangle(im, (jx, jy), (jx + 44, jy + 52), (245, 245, 245), -1)
        cv2.rectangle(im, (jx + 5, jy + 5), (jx + 39, jy + 47), (60, 90, 120), -1)
        im = cv2.GaussianBlur(im, (0, 0), 0.6)
        cv2.imwrite(str(mdir / "images" / f"{iid}.jpg"), im, [cv2.IMWRITE_JPEG_QUALITY, 92])
        im = cv2.imread(str(mdir / "images" / f"{iid}.jpg"))   # o que o pipeline vai ler
        objetos.append((("sinal", "J", None, "nao_sinal", None, None, "traffic sign", {"direction": 0.3}),
                        [float(jx), float(jy), float(jx + 44), float(jy + 52)]))

        lon, lat = lonlat(cam[0], cam[1])
        recs.append({"id": iid, "image_id": iid, "view": "", "fonte": "mapillary", "lon": round(lon, 7), "lat": round(lat, 7),
                     "coord_fonte": "computed", "heading": round(cam[2], 2), "heading_fonte": "computed",
                     "captured_at": f"2026-11-1{k}T10:00:00Z", "is_pano": False, "fov_deg": FOV, "focal_norm": "",
                     "sequence": "seq_falsa", "camera_type": "perspective", "camera_parameters": "",
                     "width": W, "height": H, "ficheiro": f"images/{iid}.jpg", "autor": "teste", "autor_id": "0",
                     "licenca": "dados falsos", "atribuicao": "dados falsos (teste)", "url_origem": "",
                     "rostos": 0, "matriculas": 0, "cabecas": 0})
        raw["imagens"].append(iid)

        for t, bb in objetos:
            did = f"{iid}_{len(dets):05d}"
            wx0, wy0, wx1, wy1 = recorte_largo_janela(bb, W, H)
            rp = zdir / "deteccoes/recortes" / f"{did}.jpg"
            cv2.imwrite(str(rp), im[wy0:wy1, wx0:wx1], [cv2.IMWRITE_JPEG_QUALITY, 90])
            conf = round(float(rng.uniform(0.2, 0.6)), 4)
            prompt = t[6] if t[0] == "sinal" else "underground waste bin"
            dets.append({"id": did, "image_id": iid, "view": None, "bbox": [round(v, 1) for v in bb], "classe": t[0],
                         "subclasse": None, "confianca": conf, "recorte": f"deteccoes/recortes/{did}.jpg",
                         "heading_camara": round(cam[2], 2), "lat_camara": round(lat, 7), "lon_camara": round(lon, 7),
                         "extra": {"prompt": prompt, "fonte": "mapillary", "imagem": f"mapillary/images/{iid}.jpg",
                                   "imagem_id": iid, "width": W, "height": H, "focal_norm": None, "fov_deg": FOV,
                                   "captured_at": recs[-1]["captured_at"], "sequence": "seq_falsa",
                                   "coord_fonte": "computed", "atribuicao": "dados falsos (teste)"}})
            if t[0] == "contentor":
                # o que o CLIP falso responde ao filtro dos contentores (recorte justo e largo)
                fcl = cfg["contentores_clip"]
                for modo in ("justo", "largo"):
                    crop = cc.recorte(im, dets[-1]["bbox"], {**cc.DEFAULTS, **fcl, "recorte": modo})
                    oraculo[impressao_digital(reduzir(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))))] = t[9]
            if t[0] == "sinal":
                verdade["sinais"][did] = {"rotulo": t[3], "objeto": t[1]}
                # o que o CLIP falso responde: recorte largo (variante atual) e justo (p1–p5)
                largo = cv2.imread(str(rp))
                justo = recorte_justo(im, dets[-1]["bbox"], margem)
                for crop in (largo, justo):
                    oraculo[impressao_digital(reduzir(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))))] = t[7]
            # a papeleira da última câmara só existe no pipeline (não no teste de prompts):
            # a página tem de a mostrar pelo id da deteção
            if t[0] == "contentor" and t[1] == "I" and k == len(CAMARAS_S) - 1:
                verdade["contentores"][did] = {"tecla": t[6], "objeto": t[1], "real": t[3]}
                continue
            # teste de prompts do YOLO-World: contentores por rotular, sinais já rotulados
            obj = len(raw["objetos"])
            grupo = t[0]
            raw["objetos"].append({"obj": obj, "image": iid, "grupo": grupo, "bbox": dets[-1]["bbox"], "max_conf": conf})
            raw["deteccoes"].append({"image": iid, "grupo": grupo, "prompt": "traffic sign" if grupo == "sinal" else prompt,
                                     "bbox": dets[-1]["bbox"], "conf": conf, "obj": obj})
            if grupo == "sinal":
                labels["caixas"].append({"image": iid, "grupo": "sinal", "bbox": dets[-1]["bbox"], "real": t[3] != "nao_sinal"})
            else:
                # a primeira vista da ilha fica "incerta" para testar esse caminho
                tecla = "i" if (t[1] == "H" and k == 0) else t[6]
                verdade["contentores"][f"v_teste#{obj}"] = {"tecla": tecla, "objeto": t[1], "real": t[3]}

    # a cena tem de ser legível: caixas de sinais diferentes não se sobrepõem
    for iid in raw["imagens"]:
        bs = [d["bbox"] for d in dets if d["image_id"] == iid and d["classe"] == "sinal"]
        for i in range(len(bs)):
            for j in range(i + 1, len(bs)):
                a, b = bs[i], bs[j]
                inter = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
                assert inter < 0.05 * min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])), (iid, a, b)
    write_catalog(mdir, recs)
    json.dump(dets, open(zdir / "deteccoes/deteccoes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    json.dump(raw, open(yw / "raw_detections.json", "w"), indent=1)
    json.dump(labels, open(BASE / "reports/yolo_world_test/labels.json", "w"), indent=0)
    json.dump(oraculo, open(BASE / "clip_oraculo.json", "w"), indent=0)
    json.dump(verdade, open(BASE / "verdade.json", "w"), indent=1)
    n_s = sum(d["classe"] == "sinal" for d in dets)
    print(f"dados falsos em {REL}: {len(recs)} imagens, {n_s} deteções de sinal, "
          f"{len(dets) - n_s} de contentor, {len(verdade['contentores'])} contentores por rotular")


if __name__ == "__main__":
    main()
