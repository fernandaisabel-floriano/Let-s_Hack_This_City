#!/usr/bin/env python3
"""Etapa 1 — qualidade de cada vista (recorte da deteção na imagem).

Para cada deteção de deteccoes.json, no recorte justo da caixa na imagem (já desfocada):

    lado_px      lado maior da caixa
    nitidez      variância do Laplaciano (tremido/desfocado → baixa)
    nitidez_rel  nitidez ÷ variância da intensidade (não depende tanto do contraste do objeto)
    brilho       intensidade média (0–255): noite / contraluz → baixo; queimado → alto
    contraste    desvio-padrão da intensidade

Uma vista é FRACA se falhar um dos limiares de config `qualidade` (decisão 19/11: as
fracas ficam de lado, não se apagam). No fuse.py, as vistas fracas não entram no
agrupamento nem na escolha da imagem; um objeto visto só em vistas fracas continua
no catálogo, mas vai sempre para a fila (so_vistas_fracas).

Grava em deteccoes.json: extra.qualidade = {...}, extra.fraca, extra.fraca_motivo.

Uso:
    python pipeline/qualidade.py           passo do pipeline (antes do geolocate/fuse)
    python pipeline/qualidade.py medir     limiares contra os recortes rotulados (M4 e contentores)
                                           → reports/qualidade/medicao.{md,json}
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402

DEFAULTS = {"ativo": True, "lado_min_px": 0, "nitidez_min": 0.0, "brilho_min": 0.0, "brilho_max": 255.0,
            "contraste_min": 0.0}
METRICAS = ("lado_px", "nitidez", "nitidez_rel", "brilho", "contraste")


def cfg_qualidade(cfg: dict) -> dict:
    return {**DEFAULTS, **(cfg.get("qualidade") or {})}


def medir_recorte(img: np.ndarray, bbox) -> dict:
    H, W = img.shape[:2]
    x0, y0 = max(0, int(bbox[0])), max(0, int(bbox[1]))
    x1, y1 = min(W, int(round(bbox[2]))), min(H, int(round(bbox[3])))
    lado = float(max(bbox[2] - bbox[0], bbox[3] - bbox[1]))
    if x1 - x0 < 3 or y1 - y0 < 3:
        return {"lado_px": round(lado, 1), "nitidez": 0.0, "nitidez_rel": 0.0, "brilho": 0.0, "contraste": 0.0}
    g = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float64)
    lap = float(cv2.Laplacian(g, cv2.CV_64F).var())
    var = float(g.var())
    return {"lado_px": round(lado, 1), "nitidez": round(lap, 1), "nitidez_rel": round(lap / (var + 1.0), 3),
            "brilho": round(float(g.mean()), 1), "contraste": round(float(g.std()), 1)}


def _lado_min(f: dict, classe: str | None) -> float:
    v = f["lado_min_px"]
    return float(v.get(classe, v.get("default", 0)) if isinstance(v, dict) else v)


def fraca(q: dict, f: dict, classe: str | None = None) -> str | None:
    """Motivo, ou None se a vista é boa. lado_min_px pode ser um número ou um valor por classe."""
    if q["lado_px"] < _lado_min(f, classe):
        return "pequena"
    if q["nitidez"] < f["nitidez_min"]:
        return "desfocada"
    if q["brilho"] < f["brilho_min"]:
        return "escura"
    if q["brilho"] > f["brilho_max"]:
        return "queimada"
    if q["contraste"] < f["contraste_min"]:
        return "sem_contraste"
    return None


def medir_todas(dets: list[dict], zdir: Path) -> dict[str, dict]:
    out, cache = {}, {}
    for d in sorted(dets, key=lambda d: d["extra"]["imagem"]):
        p = zdir / d["extra"]["imagem"]
        if p not in cache:
            cache = {p: cv2.imread(str(p))}
        img = cache[p]
        if img is not None:
            out[d["id"]] = medir_recorte(img, d["bbox"])
    return out


def main() -> None:
    cfg = load_config()
    f = cfg_qualidade(cfg)
    if not f["ativo"]:
        print("qualidade: desligado (qualidade.ativo: false) — nada a fazer")
        return
    zdir = zone_dir(cfg)
    p = zdir / "deteccoes/deteccoes.json"
    dets = json.load(open(p, encoding="utf-8"))
    qs = medir_todas(dets, zdir)
    for d in dets:
        q = qs.get(d["id"])
        if q is None:
            continue
        m = fraca(q, f, d["classe"])
        d["extra"].update(qualidade=q, fraca=m is not None, fraca_motivo=m)
    json.dump(dets, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    mot = Counter(d["extra"].get("fraca_motivo") for d in dets if d["extra"].get("fraca"))
    print(f"qualidade: {sum(mot.values())} de {len(dets)} vistas fracas {dict(mot)} "
          f"(por classe: {dict(Counter(d['classe'] for d in dets if d['extra'].get('fraca')))})")


# ------------------------------------------------------------------ medição

def _rotulos() -> dict[str, bool]:
    """det_id → é um objeto real (sinal legível ou não; contentor verdadeiro)."""
    out = {}
    s = ROOT / "reports/m4/rotulos.json"
    if s.exists():
        for k, v in json.load(open(s))["rotulos"].items():
            out[k] = v["rotulo"] != "nao_sinal"
    c = ROOT / "reports/m4/rotulos_contentores.json"
    if c.exists():
        for k, v in json.load(open(c))["rotulos"].items():
            out[v.get("det_id", k)] = v["rotulo"] in ("verdadeiro", "ilha", "indiferenciado")
    return out


def medir() -> None:
    cfg = load_config()
    zdir = zone_dir(cfg)
    dets = {d["id"]: d for d in json.load(open(zdir / "deteccoes/deteccoes.json"))}
    rot = {k: v for k, v in _rotulos().items() if k in dets}
    qs = medir_todas([dets[k] for k in rot], zdir)
    reais = [qs[k] for k, v in rot.items() if v and k in qs]
    falsos = [qs[k] for k, v in rot.items() if not v and k in qs]

    # por métrica: o maior limiar que perde no máximo PERDA_MAX dos reais, e quantos falsos tira
    PERDA_MAX = 0.05
    res = {"rotulos": {"reais": len(reais), "falsos": len(falsos)}, "por_metrica": {}, "proposta": {}}
    for m, chave, lado in (("lado_px", "lado_min_px", "min"), ("nitidez", "nitidez_min", "min"),
                           ("brilho", "brilho_min", "min"), ("brilho", "brilho_max", "max"),
                           ("contraste", "contraste_min", "min")):
        r = np.array([q[m] for q in reais])
        fz = np.array([q[m] for q in falsos])
        lim = float(np.percentile(r, 100 * PERDA_MAX)) if lado == "min" else float(np.percentile(r, 100 * (1 - PERDA_MAX)))
        tira = (fz < lim).mean() if lado == "min" else (fz > lim).mean()
        perde = (r < lim).mean() if lado == "min" else (r > lim).mean()
        res["por_metrica"][chave] = {"limiar": round(lim, 1), "perde_reais": round(float(perde), 3),
                                     "tira_falsos": round(float(tira), 3),
                                     "reais_mediana": round(float(np.median(r)), 1), "falsos_mediana": round(float(np.median(fz)), 1)}
    # proposta: só os critérios que tiram pelo menos o dobro (em fração) do que perdem
    prop = {k: v["limiar"] for k, v in res["por_metrica"].items() if v["tira_falsos"] >= 2 * max(v["perde_reais"], 0.01)}
    f = {**DEFAULTS, **prop}
    perde = sum(fraca(q, f) is not None for q in reais) / max(1, len(reais))
    tira = sum(fraca(q, f) is not None for q in falsos) / max(1, len(falsos))
    res["proposta"] = {"limiares": prop, "perde_reais": round(perde, 3), "tira_falsos": round(tira, 3)}

    # o resto (candeeiros, sem rótulos): quanto ficaria de lado com a proposta
    todas = medir_todas(list(dets.values()), zdir)
    fcfg = cfg_qualidade(cfg)
    por_classe = Counter(dets[k]["classe"] for k, q in todas.items() if fraca(q, fcfg, dets[k]["classe"]))
    res["config_atual"] = {"limiares": {k: fcfg[k] for k in DEFAULTS if k != "ativo"},
                           "perde_reais": round(sum(fraca(qs[k], fcfg, dets[k]["classe"]) is not None for k, v in rot.items() if v and k in qs) / max(1, len(reais)), 3),
                           "tira_falsos": round(sum(fraca(qs[k], fcfg, dets[k]["classe"]) is not None for k, v in rot.items() if not v and k in qs) / max(1, len(falsos)), 3)}
    res["config_atual"]["fracas_por_classe"] = {c: f"{por_classe.get(c, 0)} de {n}" for c, n in Counter(d["classe"] for d in dets.values()).items()}

    out = ROOT / "reports/qualidade"
    out.mkdir(parents=True, exist_ok=True)
    (out / "medicao.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    md = ["# Qualidade das vistas — medição contra os recortes rotulados\n",
          f"{len(reais)} reais e {len(falsos)} falsos (sinais da M4 e contentores). "
          f"Por métrica, o limiar que perde no máximo {PERDA_MAX:.0%} dos reais:\n",
          "| critério | limiar | perde reais | tira falsos | mediana reais | mediana falsos |", "|---|---:|---:|---:|---:|---:|"]
    for k, v in res["por_metrica"].items():
        md.append(f"| {k} | {v['limiar']} | {v['perde_reais']:.0%} | {v['tira_falsos']:.0%} | {v['reais_mediana']} | {v['falsos_mediana']} |")
    p = res["proposta"]
    md += ["", f"**Proposta** (critérios que tiram pelo menos o dobro do que perdem): `{p['limiares']}` → "
           f"perde {p['perde_reais']:.0%} dos reais, põe de lado {p['tira_falsos']:.0%} dos falsos.",
           "", "**Atenção:** os rótulos de sinais só incluem recortes com lado ≥ 30 px (m4.rotular_lado_min_px), por isso "
           "o critério do tamanho só se mede bem nos contentores.",
           "", f"**Config atual** `{res['config_atual']['limiares']}` → perde {res['config_atual']['perde_reais']:.0%} dos reais, "
           f"põe de lado {res['config_atual']['tira_falsos']:.0%} dos falsos. Vistas fracas por classe: {res['config_atual']['fracas_por_classe']}"]
    (out / "medicao.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    medir() if sys.argv[1:2] == ["medir"] else main()
