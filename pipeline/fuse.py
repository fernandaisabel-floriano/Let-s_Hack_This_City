#!/usr/bin/env python3
"""M6 — Fusão entre vistas e fontes → elementos; M8 — confiança e estado inicial.

Agrupamento guloso por classe: as deteções (com posição válida, M5) são
percorridas por confiança decrescente; cada uma junta-se ao elemento mais
próximo da mesma classe a ≤ raio_fusao_m, desde que esse elemento ainda não
tenha uma deteção da mesma imagem (duas caixas na mesma imagem são dois
objetos). Posição do elemento = média ponderada por confiança / distância
(vistas mais próximas pesam mais), recalculada a cada junção.

Fontes misturam-se naturalmente: Mapillary e vídeo próprio do mesmo objeto
caem no mesmo elemento (fonte = "mapillary+video_proprio").

Confiança (M8, pipeline/confianca.py): P(real) calibrada sobre as confianças
das vistas; estado inicial "auto" (entra direto) ou "pendente" (fila).

Subtipo dos sinais (M4): voto das vistas pesado pelo tamanho do recorte; as
vistas de costas e as incertas abstêm-se (votar_subtipo). Subtipo incerto →
sempre "pendente", mesmo com confiança de deteção alta.

Saída: <zona>/catalogo/elementos.json

Uso:
    python pipeline/fuse.py
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, lado_px, load_config, zone_dir  # noqa: E402
from confianca import confianca_elemento, estado_inicial, load_calibration, m8_cfg  # noqa: E402

KY = 111320.0


def dist_m(lon1, lat1, lon2, lat2) -> float:
    kx = KY * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * KY)


def weight(d: dict) -> float:
    return d["confianca"] / max(d["extra"]["dist_m"], 5.0)


def cluster(dets: list[dict], raio: float) -> list[list[dict]]:
    clusters: list[dict] = []
    for d in sorted(dets, key=lambda d: -d["confianca"]):
        e = d["extra"]
        best, bd = None, raio
        for c in clusters:
            if c["classe"] != d["classe"] or e["imagem_id"] in c["imagens"]:
                continue
            dd = dist_m(e["lon_obj"], e["lat_obj"], c["lon"], c["lat"])
            if dd <= bd:
                best, bd = c, dd
        if best is None:
            best = {"classe": d["classe"], "membros": [], "imagens": set(), "lon": e["lon_obj"], "lat": e["lat_obj"]}
            clusters.append(best)
        best["membros"].append(d)
        best["imagens"].add(e["imagem_id"])
        w = [weight(m) for m in best["membros"]]
        best["lon"] = sum(m["extra"]["lon_obj"] * wi for m, wi in zip(best["membros"], w)) / sum(w)
        best["lat"] = sum(m["extra"]["lat_obj"] * wi for m, wi in zip(best["membros"], w)) / sum(w)
    return [c["membros"] for c in clusters]


def votar_subtipo(membros: list[dict], m4: dict) -> tuple[str, float | None, bool, str | None]:
    """Subtipo do sinal fundido → (subtipo, fração do voto, incerto, motivo).

    Abstêm-se: vistas de costas e vistas incertas da M4 (outro_sinal incerto).
    "limite_desconhecido" vota na família limite mas não no número.
    Peso de cada voto = confiança da classificação × min(lado, voto_lado_max_px)
    / voto_lado_max_px (recortes maiores leem-se melhor).
    1.º a família, depois o número; abaixo de voto_min_fracao fica incerto
    (→ fila, como outro_sinal ou limite_desconhecido).
    """
    cap = float(m4.get("voto_lado_max_px", 100))
    fmin = float(m4.get("voto_min_fracao", 0.6))
    fam_v: dict[str, float] = defaultdict(float)
    num_v: dict[str, float] = defaultdict(float)
    costas = 0
    for m in membros:
        sub, e = m.get("subclasse") or "outro_sinal", m["extra"]
        if sub == "costas":
            costas += 1
            continue
        if e.get("m4_incerto") and sub != "limite_desconhecido":
            continue
        w = max(e.get("confianca_classificacao") or 0.0, 1e-3) * min(lado_px(m["bbox"]), cap) / cap
        fam = "limite" if sub.startswith("limite_") else sub
        fam_v[fam] += w
        if fam == "limite" and sub != "limite_desconhecido":
            num_v[sub] += w
    if not fam_v:
        return "outro_sinal", None, True, "só visto de costas" if costas == len(membros) else "sem votos certos"
    fam = max(fam_v, key=fam_v.get)
    frac = fam_v[fam] / sum(fam_v.values())
    if frac < fmin:
        return "outro_sinal", round(frac, 3), True, f"vistas discordam ({dict(fam_v)})"
    if fam != "limite":
        return fam, round(frac, 3), False, None
    if not num_v:
        return "limite_desconhecido", round(frac, 3), True, "valor do limite não lido"
    v = max(num_v, key=num_v.get)
    fv = num_v[v] / sum(num_v.values())
    if fv < fmin:
        return "limite_desconhecido", round(frac, 3), True, f"valores discordam ({dict(num_v)})"
    return v, round(frac * fv, 3), False, None


def element(i: int, membros: list[dict], calib: dict, m8: dict, m4: dict) -> dict:
    classe = membros[0]["classe"]
    w = [weight(m) for m in membros]
    lon = sum(m["extra"]["lon_obj"] * wi for m, wi in zip(membros, w)) / sum(w)
    lat = sum(m["extra"]["lat_obj"] * wi for m, wi in zip(membros, w)) / sum(w)
    # uma confiança por imagem (a melhor), para a calibração
    por_imagem: dict[str, float] = defaultdict(float)
    for m in membros:
        por_imagem[m["extra"]["imagem_id"]] = max(por_imagem[m["extra"]["imagem_id"]], m["confianca"])
    confs = sorted(por_imagem.values(), reverse=True)
    n_vistas = len(confs)
    conf = confianca_elemento(confs, classe, calib, m8)
    subclasse, conf_cls, incerto, motivo_sub = None, None, False, None
    if classe == "sinal":
        subclasse, conf_cls, incerto, motivo_sub = votar_subtipo(membros, m4)
    elif classe == "contentor" and any(m.get("subclasse") for m in membros):
        # tipo do contentor (contentores_clip.py): voto pesado pela confiança de deteção
        votos: dict[str, float] = defaultdict(float)
        for m in membros:
            if m.get("subclasse"):
                votos[m["subclasse"]] += m["confianca"]
        subclasse = max(votos, key=votos.get)
        conf_cls = round(votos[subclasse] / sum(votos.values()), 3)
    melhor = max(membros, key=lambda m: m["confianca"] / max(m["extra"]["dist_m"], 5.0))
    datas = sorted(m["extra"]["captured_at"] for m in membros)
    fontes = sorted({m["extra"]["fonte"] for m in membros})
    atrib = sorted({m["extra"]["atribuicao"] for m in membros if m["extra"].get("atribuicao")})
    espalho = max(dist_m(lon, lat, m["extra"]["lon_obj"], m["extra"]["lat_obj"]) for m in membros)
    return {
        "id": f"{classe[:3]}_{i:04d}", "tipo": classe, "subtipo": subclasse,
        "lon": round(lon, 7), "lat": round(lat, 7),
        "confianca": None if conf is None else round(conf, 3),
        "confianca_max_vista": round(confs[0], 3), "confianca_subtipo": conf_cls,
        "subtipo_incerto": incerto, "subtipo_motivo": motivo_sub,
        "n_vistas": n_vistas,
        "estado": "auto" if estado_inicial(conf, n_vistas, m8) == "auto" and not incerto else "pendente",
        "primeira_vista": datas[0], "ultima_vista": datas[-1],
        "imagem": melhor["extra"]["imagem"], "recorte": melhor["recorte"],
        "fonte": "+".join(fontes), "atribuicao": "; ".join(atrib),
        "espalhamento_m": round(espalho, 1),
        "deteccoes": [m["id"] for m in membros],
    }


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    raio = float(cfg["m6"]["raio_fusao_m"])
    m8 = m8_cfg(cfg)
    calib = load_calibration(m8)
    zdir = zone_dir(cfg)
    # clip_rejeitado: filtro CLIP dos contentores (contentores_clip.py, opcional) deitou a deteção fora
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json"))
            if d["extra"].get("posicao_valida") and not d["extra"].get("clip_rejeitado")]
    m4 = cfg.get("m4") or {}
    els = [element(i, ms, calib, m8, m4) for i, ms in enumerate(cluster(dets, raio), 1)]
    out = zdir / "catalogo"
    out.mkdir(exist_ok=True)
    json.dump(els, open(out / "elementos.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(dets)} deteções → {len(els)} elementos "
          f"{dict(Counter(e['tipo'] for e in els))}; estados {dict(Counter(e['estado'] for e in els))}")
    nv = Counter(min(e["n_vistas"], 5) for e in els)
    print(f"  vistas por elemento: {dict(sorted(nv.items()))} (5 = 5 ou mais)")


if __name__ == "__main__":
    main()
