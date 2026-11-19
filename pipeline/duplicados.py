#!/usr/bin/env python3
"""Duplicados entre elementos: pares candidatos, características e medição (etapa 0).

Pares candidatos: mesma classe, a ≤ DIST_CANDIDATO_M. Para cada par:

    dist_m            distância entre os pontos
    partilham_foto    aparecem na mesma imagem
    iou_max           maior sobreposição das caixas numa imagem partilhada
    caixas_distintas  partilham uma foto em caixas separadas (IoU < IOU_MIN): prova de que são diferentes
    subtipo_compat    subtipos compatíveis (sinais lidos com certeza e diferentes → incompatíveis)
    mesmo_subtipo     subtipo igual
    fontes_diferentes um só do Mapillary e o outro só do vídeo (ou fotos)
    raio_m            coerência dos raios: mediana da distância perpendicular das direções das
                      deteções de um ao ponto do outro (o menor dos dois sentidos). Pequena = as
                      fotos de B também apontam para A (o mesmo objeto deslocado).
    anos              diferença entre as últimas vistas (anos)

regra_atual() reproduz a regra da app (frontend/server/duplicados.ts, D7) para a medir.

Rótulos, do registo dos técnicos (catalogo/registo_validacoes.jsonl):
    mesmo      "duplicado de" (rejeitado com duplicado_de) e pares "é o mesmo"
    diferente  pares "são diferentes"
    implicito  dois elementos reais (confirmados) da mesma classe a ≤ 8 m, sem ligação:
               o técnico viu os dois e ficou com os dois (rótulo mais fraco, à parte)

Só estatística: não muda o catálogo.

Etapa 2: um modelo (regressão logística) com dist_m, raio_m, caixas_distintas, iou_max, semelhança
CLIP dos recortes e mesmo_subtipo, treinado com as decisões dos técnicos (config/duplicados_modelo.json).
Medido a 19/11 (validação cruzada, 29 pares "mesmo"): AUC 0,59 só com a distância, 0,81 com tudo.

Uso:
    python pipeline/duplicados.py           EXPERIMENTAL, fora do run_all: pares com a probabilidade do modelo
                                            → catalogo/duplicados.json (19/11: o modelo não bateu a regra D7 —
                                            para apanhar os mesmos 59 % sugeria 127 pares em vez de 36)
    python pipeline/duplicados.py treinar   ajusta o modelo às decisões dos técnicos e escolhe os limiares
    python pipeline/duplicados.py medir     → reports/duplicados/medicao.{md,json}
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from estado import depois_do_ultimo_limpar, estado_atual, ler_registo  # noqa: E402

DIST_CANDIDATO_M = 15.0
IOU_MIN = 0.3            # igual a server/duplicados.ts
DIST_POSSIVEL_M = 5.0
DIST_CERTO_M = 1.5
CONF_CERTO = 0.9
DIST_IMPLICITO_M = 8.0
SUBTIPO_VAGO = {None, "", "outro_sinal", "limite_desconhecido", "costas"}
R = 6371000.0


def dist_m(a: dict, b: dict) -> float:
    kx = 111320.0 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return math.hypot((a["lon"] - b["lon"]) * kx, (a["lat"] - b["lat"]) * 111320.0)


def _xy(lon, lat, lat0):
    return np.array([lon * 111320.0 * math.cos(math.radians(lat0)), lat * 111320.0])


def iou(p, q) -> float:
    w = max(0.0, min(p[2], q[2]) - max(p[0], q[0]))
    h = max(0.0, min(p[3], q[3]) - max(p[1], q[1]))
    i = w * h
    u = (p[2] - p[0]) * (p[3] - p[1]) + (q[2] - q[0]) * (q[3] - q[1]) - i
    return i / u if u > 0 else 0.0


def subtipos_compativeis(a: dict, b: dict) -> bool:
    if a["tipo"] != "sinal":
        return True
    return a.get("subtipo") in SUBTIPO_VAGO or b.get("subtipo") in SUBTIPO_VAGO or a.get("subtipo") == b.get("subtipo")


def _fontes(e: dict) -> set[str]:
    return set((e.get("fonte") or "").split("+")) - {""}


def coerencia_raios(de: list[dict], alvo: dict) -> float | None:
    """Mediana da distância perpendicular (m) das direções das deteções `de` ao ponto `alvo`.
    Um raio que aponta para trás do ponto conta pela distância da câmara ao ponto."""
    lat0 = alvo["lat"]
    p = _xy(alvo["lon"], alvo["lat"], lat0)
    ds = []
    for d in de:
        b = (d.get("extra") or {}).get("bearing")
        if b is None or d.get("lon_camara") is None:
            continue
        c = _xy(d["lon_camara"], d["lat_camara"], lat0)
        u = np.array([math.sin(math.radians(b)), math.cos(math.radians(b))])
        v = p - c
        t = float(v @ u)
        ds.append(abs(float(v[0] * u[1] - v[1] * u[0])) if t > 0 else float(np.linalg.norm(v)))
    return float(np.median(ds)) if ds else None


def fotos_de(e: dict, dets: dict) -> dict[str, list]:
    m: dict[str, list] = defaultdict(list)
    for did in e.get("deteccoes") or []:
        d = dets.get(did)
        if d:
            m[f"{(d.get('extra') or {}).get('imagem_id', d.get('image_id'))}|{d.get('view') or ''}"].append(d["bbox"])
    return m


def caracteristicas(a: dict, b: dict, dets: dict) -> dict:
    fa, fb = fotos_de(a, dets), fotos_de(b, dets)
    comum = set(fa) & set(fb)
    iou_max = max((iou(p, q) for k in comum for p in fa[k] for q in fb[k]), default=0.0)
    da = [dets[i] for i in a.get("deteccoes") or [] if i in dets]
    db = [dets[i] for i in b.get("deteccoes") or [] if i in dets]
    r1, r2 = coerencia_raios(db, a), coerencia_raios(da, b)
    rs = [r for r in (r1, r2) if r is not None]
    try:
        anos = abs((datetime.fromisoformat(a["ultima_vista"]) - datetime.fromisoformat(b["ultima_vista"])).days) / 365.25
    except (KeyError, ValueError):
        anos = None
    sa, sb = _fontes(a), _fontes(b)
    return {
        "dist_m": round(dist_m(a, b), 2),
        "partilham_foto": bool(comum),
        "iou_max": round(iou_max, 3),
        "caixas_distintas": bool(comum) and iou_max < IOU_MIN,
        "subtipo_compat": subtipos_compativeis(a, b),
        "mesmo_subtipo": (a.get("subtipo") or None) == (b.get("subtipo") or None),
        "fontes_diferentes": bool(sa) and bool(sb) and not (sa & sb),
        "raio_m": round(min(rs), 2) if rs else None,
        "anos": round(anos, 2) if anos is not None else None,
        "tem_fotos": bool(fa) and bool(fb),
    }


def conf_alta(e: dict) -> bool:
    c = e.get("confianca")
    return (c if c is not None else e.get("confianca_max_vista") or 0) >= CONF_CERTO


def regra_atual(a: dict, b: dict, f: dict) -> str:
    """'certo' | 'possivel' | 'nada' — como a app decide hoje (server/duplicados.ts, D7)."""
    if f["caixas_distintas"]:
        return "nada"
    obvio = (f["dist_m"] <= DIST_CERTO_M and conf_alta(a) and conf_alta(b) and f["mesmo_subtipo"]
             and (a["tipo"] != "sinal" or a.get("subtipo") not in SUBTIPO_VAGO))
    if obvio:
        return "certo"
    if f["partilham_foto"] and f["dist_m"] <= 8.0:
        return "possivel"
    if f["tem_fotos"] and f["dist_m"] <= DIST_POSSIVEL_M and f["subtipo_compat"]:
        return "possivel"
    return "nada"


def pares_candidatos(els: list[dict], dets: dict, dmax: float = DIST_CANDIDATO_M) -> list[dict]:
    out = []
    for i, a in enumerate(els):
        for b in els[i + 1:]:
            if a["tipo"] != b["tipo"] or dist_m(a, b) > dmax:
                continue
            out.append({"a": a["id"], "b": b["id"], "tipo": a["tipo"], **caracteristicas(a, b, dets)})
    return out


# ------------------------------------------------------------------ semelhança de imagem (CLIP)

def embeddings(zdir: Path, dets: dict) -> dict[str, np.ndarray]:
    """Vetor CLIP (ViT-B/32, normalizado) do recorte de cada deteção; cache em deteccoes/embeddings_clip.npz."""
    cache = zdir / "deteccoes/embeddings_clip.npz"
    out: dict[str, np.ndarray] = {}
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        out = dict(zip(z["ids"].tolist(), z["v"]))
    falta = [i for i, d in dets.items() if i not in out and d.get("recorte") and (zdir / d["recorte"]).exists()]
    if falta:
        import clip
        import torch
        from PIL import Image
        model, pre = clip.load("ViT-B/32", device="cpu", download_root=str(ROOT / "weights/clip"))
        for k in range(0, len(falta), 64):
            lote = falta[k:k + 64]
            x = torch.stack([pre(Image.open(zdir / dets[i]["recorte"]).convert("RGB")) for i in lote])
            with torch.no_grad():
                v = model.encode_image(x).float()
            v = (v / v.norm(dim=-1, keepdim=True)).numpy().astype(np.float32)
            out.update(zip(lote, v))
        ids = sorted(out)
        np.savez_compressed(cache, ids=np.array(ids), v=np.stack([out[i] for i in ids]))
    return out


def sim_clip(a: dict, b: dict, emb: dict, dets: dict) -> float | None:
    """Semelhança entre os recortes de dois elementos: média dos 3 melhores pares de vistas boas
    (as fracas só se não houver boas)."""
    def vistas(e):
        ids = [i for i in e.get("deteccoes") or [] if i in emb]
        boas = [i for i in ids if not (dets.get(i, {}).get("extra") or {}).get("fraca")]
        return np.stack([emb[i] for i in (boas or ids)]) if (boas or ids) else None
    va, vb = vistas(a), vistas(b)
    if va is None or vb is None:
        return None
    s = np.sort((va @ vb.T).ravel())[::-1]
    return round(float(s[:3].mean()), 4)


# ------------------------------------------------------------------ rótulos

def rotulos(reg: list[dict], els: dict[str, dict]) -> dict[tuple[str, str], str]:
    reg = depois_do_ultimo_limpar(reg)
    atual = estado_atual(reg)
    lab: dict[tuple[str, str], str] = {}
    for e in reg:
        if e["acao"] == "par" and e.get("a") and e.get("b"):
            lab[tuple(sorted((e["a"], e["b"])))] = "mesmo" if e.get("mesmo") else "diferente"
    for i, v in atual.items():
        if v["estado"] == "rejeitado" and v.get("duplicado_de"):
            lab[tuple(sorted((i, v["duplicado_de"])))] = "mesmo"
    # implícitos: os dois confirmados como reais, mesma classe final, perto, sem ligação
    reais = []
    for i, v in atual.items():
        if i in els and v["estado"] in ("validado", "corrigido"):
            e = els[i]
            reais.append({**e, "tipo": v.get("classe_corrigida") or e["tipo"],
                          "lat": v.get("lat", e["lat"]), "lon": v.get("lon", e["lon"])})
    for k, a in enumerate(reais):
        for b in reais[k + 1:]:
            par = tuple(sorted((a["id"], b["id"])))
            if a["tipo"] == b["tipo"] and par not in lab and dist_m(a, b) <= DIST_IMPLICITO_M:
                lab[par] = "implicito"
    return lab


# ------------------------------------------------------------------ medição

def _quantis(xs: list[float]) -> dict | None:
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    a = np.array(xs)
    return {"n": len(a), "p10": round(float(np.percentile(a, 10)), 2), "mediana": round(float(np.median(a)), 2),
            "p90": round(float(np.percentile(a, 90)), 2)}


def medir() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    zdir = zone_dir(cfg)
    els_l = json.load(open(zdir / "catalogo/elementos.json"))
    els = {e["id"]: e for e in els_l}
    dets = {d["id"]: d for d in json.load(open(zdir / "deteccoes/deteccoes.json"))}
    reg = ler_registo(zdir / "catalogo/registo_validacoes.jsonl")
    lab = rotulos(reg, els)

    pares = {tuple(sorted((p["a"], p["b"]))): p for p in pares_candidatos(els_l, dets)}
    # rótulos fora do raio de candidatos (ex.: "duplicado de" a 20 m) também contam
    for par in lab:
        if par not in pares and par[0] in els and par[1] in els:
            a, b = els[par[0]], els[par[1]]
            pares[par] = {"a": par[0], "b": par[1], "tipo": a["tipo"], **caracteristicas(a, b, dets)}

    linhas = []
    for par, p in pares.items():
        a, b = els[par[0]], els[par[1]]
        linhas.append({**p, "regra": regra_atual(a, b, p), "rotulo": lab.get(par)})

    rot = [l for l in linhas if l["rotulo"] in ("mesmo", "diferente")]
    imp = [l for l in linhas if l["rotulo"] == "implicito"]
    n_mesmo = sum(l["rotulo"] == "mesmo" for l in rot)
    n_dif = sum(l["rotulo"] == "diferente" for l in rot)

    def avaliar(sugere) -> dict:
        tp = sum(1 for l in rot if sugere(l) and l["rotulo"] == "mesmo")
        fp = sum(1 for l in rot if sugere(l) and l["rotulo"] == "diferente")
        fn = sum(1 for l in rot if not sugere(l) and l["rotulo"] == "mesmo")
        fp_imp = sum(1 for l in imp if sugere(l))
        return {"apanha_mesmo": tp, "sugere_diferente": fp, "falha_mesmo": fn,
                "precisao": round(tp / (tp + fp), 3) if tp + fp else None,
                "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                "sugere_implicitos_diferentes": fp_imp}

    res = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "zona": cfg["zona"],
        "rotulos": {"mesmo": n_mesmo, "diferente": n_dif, "implicito": len(imp)},
        "pares_candidatos": len(linhas),
        "regra_atual": {
            "junta_sozinho (certo)": avaliar(lambda l: l["regra"] == "certo"),
            "sugere (certo ou possivel)": avaliar(lambda l: l["regra"] in ("certo", "possivel")),
            "por_regra_em_todos_os_pares": dict(Counter(l["regra"] for l in linhas)),
        },
        "caracteristicas": {
            k: {r: _quantis([l[k] for l in linhas if l["rotulo"] == r]) for r in ("mesmo", "diferente", "implicito")}
            for k in ("dist_m", "raio_m", "anos")
        },
        "proporcoes": {
            k: {r: (round(sum(bool(l[k]) for l in linhas if l["rotulo"] == r) / max(1, sum(l["rotulo"] == r for l in linhas)), 2))
                for r in ("mesmo", "diferente", "implicito")}
            for k in ("partilham_foto", "caixas_distintas", "fontes_diferentes", "mesmo_subtipo")
        },
        "por_classe": {
            t: dict(Counter(l["rotulo"] for l in linhas if l["tipo"] == t and l["rotulo"])) for t in ("sinal", "candeeiro", "contentor")
        },
        "pares": [l for l in linhas if l["rotulo"]],
    }
    out = ROOT / "reports/duplicados"
    out.mkdir(parents=True, exist_ok=True)
    (out / "medicao.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    md = [f"# Duplicados — medição contra as decisões dos técnicos\n",
          f"{res['gerado_em']} · zona {res['zona']} · rótulos: **{n_mesmo} mesmo**, **{n_dif} diferente**, "
          f"{len(imp)} implícitos (dois reais a ≤ {DIST_IMPLICITO_M:g} m que o técnico manteve) · "
          f"{len(linhas)} pares candidatos (mesma classe, ≤ {DIST_CANDIDATO_M:g} m)\n",
          "## Regra atual (D7)\n",
          "| | apanha mesmo | sugere diferente | falha mesmo | precisão | recall | sugere implícitos |",
          "|---|---:|---:|---:|---:|---:|---:|"]
    for k in ("junta_sozinho (certo)", "sugere (certo ou possivel)"):
        r = res["regra_atual"][k]
        md.append(f"| {k} | {r['apanha_mesmo']} | {r['sugere_diferente']} | {r['falha_mesmo']} | {r['precisao']} | "
                  f"{r['recall']} | {r['sugere_implicitos_diferentes']} |")
    md += ["", "## Características (mediana e p10–p90)\n", "| | mesmo | diferente | implícito |", "|---|---|---|---|"]
    for k, v in res["caracteristicas"].items():
        md.append(f"| {k} | " + " | ".join(
            f"{q['mediana']} ({q['p10']}–{q['p90']}), n={q['n']}" if q else "—" for q in (v["mesmo"], v["diferente"], v["implicito"])) + " |")
    for k, v in res["proporcoes"].items():
        md.append(f"| {k} | {v['mesmo']} | {v['diferente']} | {v['implicito']} |")
    md += ["", "## Por classe\n"] + [f"- {t}: {dict(c)}" for t, c in res["por_classe"].items()]
    (out / "medicao.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    print(f"→ {(out / 'medicao.md').relative_to(ROOT)}")


# ------------------------------------------------------------------ modelo (etapa 2)

MODELO_PATH = ROOT / "config/duplicados_modelo.json"
COLUNAS = ("dist_m", "raio_m", "caixas_distintas", "iou_max", "clip", "mesmo_subtipo")
RECALL_SUGERIR = 0.9      # sugerir ao técnico: apanhar pelo menos 90 % dos duplicados (validação cruzada)
PRECISAO_AUTO = 0.95      # juntar sozinho só acima de um limiar com esta precisão (senão: só os óbvios, D7)
MIN_ROTULOS = 15          # mínimo de pares "mesmo" para treinar; abaixo fica o modelo anterior


def vetor(p: dict) -> list[float]:
    """Características de um par para o modelo (ausentes → valor neutro)."""
    return [float(p["dist_m"]), float(p["raio_m"] if p.get("raio_m") is not None else 5.0),
            float(bool(p["caixas_distintas"])), float(p["iou_max"]),
            float(p["clip"] if p.get("clip") is not None else 0.85), float(bool(p["mesmo_subtipo"]))]


def _ajustar(X: np.ndarray, y: np.ndarray, l2: float = 1.0, it: int = 4000, lr: float = 0.1) -> dict:
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    for _ in range(it):
        g = 1 / (1 + np.exp(-(Z @ w + b))) - y
        w -= lr * (Z.T @ g / len(y) + l2 * w / len(y))
        b -= lr * g.mean()
    return {"mu": mu.tolist(), "sd": sd.tolist(), "w": w.tolist(), "b": float(b)}


def prob(m: dict, X: np.ndarray) -> np.ndarray:
    Z = (X - np.array(m["mu"])) / np.array(m["sd"])
    return 1 / (1 + np.exp(-(Z @ np.array(m["w"]) + m["b"])))


def ler_modelo() -> dict | None:
    return json.loads(MODELO_PATH.read_text(encoding="utf-8")) if MODELO_PATH.exists() else None


def _pares_rotulados(zdir: Path, com_clip: bool = True) -> tuple[list[dict], dict, dict]:
    els = {e["id"]: e for e in json.load(open(zdir / "catalogo/elementos.json"))}
    dets = {d["id"]: d for d in json.load(open(zdir / "deteccoes/deteccoes.json"))}
    lab = rotulos(ler_registo(zdir / "catalogo/registo_validacoes.jsonl"), els)
    emb = embeddings(zdir, dets) if com_clip else {}
    P = []
    for (a, b), l in lab.items():
        if a in els and b in els and els[a]["tipo"] == els[b]["tipo"]:
            p = {"a": a, "b": b, "tipo": els[a]["tipo"], "rotulo": l, **caracteristicas(els[a], els[b], dets)}
            p["clip"] = sim_clip(els[a], els[b], emb, dets) if emb else None
            P.append(p)
    return P, els, dets


def treinar() -> dict:
    """Ajusta o modelo às decisões dos técnicos, mede-o com validação cruzada e escolhe os limiares."""
    cfg = load_config(ROOT / "config/municipio.yaml")
    zdir = zone_dir(cfg)
    P, _, _ = _pares_rotulados(zdir)
    y = np.array([p["rotulo"] == "mesmo" for p in P], float)
    if y.sum() < MIN_ROTULOS:
        print(f"só {int(y.sum())} pares 'mesmo' (mínimo {MIN_ROTULOS}): fica o modelo anterior")
        return ler_modelo() or {}
    X = np.array([vetor(p) for p in P], float)
    rng = np.random.default_rng(0)
    grelha = np.round(np.arange(0.05, 0.96, 0.01), 2)
    rec, prec, sug_neg, aucs = [], [], [], []
    for _ in range(200):
        idx = rng.permutation(len(y))
        tr, te = idx[: len(y) // 2], idx[len(y) // 2:]
        if y[tr].sum() < 3 or y[te].sum() < 3 or (1 - y[te]).sum() < 3:
            continue
        s = prob(_ajustar(X[tr], y[tr]), X[te])
        pos, neg = s[y[te] == 1], s[y[te] == 0]
        aucs.append(float(np.mean([(a > b) + 0.5 * (a == b) for a in pos for b in neg])))
        rec.append([(pos >= t).mean() for t in grelha])
        sug_neg.append([(neg >= t).mean() for t in grelha])
        prec.append([((pos >= t).sum() / max(1, (pos >= t).sum() + (neg >= t).sum())) if (s >= t).any() else np.nan for t in grelha])
    rec, prec, sug_neg = np.array(rec).mean(0), np.nanmean(np.array(prec, float), 0), np.array(sug_neg).mean(0)
    ok_rec = [t for t, r in zip(grelha, rec) if r >= RECALL_SUGERIR]
    p_sugerir = float(max(ok_rec)) if ok_rec else float(grelha[0])
    ok_auto = [t for t, pr, r in zip(grelha, prec, rec) if pr >= PRECISAO_AUTO and r > 0]
    p_auto = float(min(ok_auto)) if ok_auto else None
    k = list(grelha).index(p_sugerir)
    m = {**_ajustar(X, y), "colunas": list(COLUNAS),
         "p_sugerir": p_sugerir, "p_auto": p_auto,
         "metricas_validacao_cruzada": {
             "auc": round(float(np.mean(aucs)), 3), "recall_ao_sugerir": round(float(rec[k]), 3),
             "precisao_ao_sugerir": round(float(prec[k]), 3), "negativos_sugeridos": round(float(sug_neg[k]), 3),
             "repeticoes": len(aucs)},
         "rotulos": {"mesmo": int(y.sum()), "nao_mesmo": int((1 - y).sum()),
                     "nota": "não-mesmo = pares 'são diferentes' + implícitos (dois reais perto que o técnico manteve)"},
         "treinado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "zona": cfg["zona"]}
    MODELO_PATH.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    mc = m["metricas_validacao_cruzada"]
    print(f"modelo de duplicados: {m['rotulos']['mesmo']} 'mesmo' / {m['rotulos']['nao_mesmo']} não · AUC {mc['auc']} · "
          f"sugerir com p ≥ {p_sugerir}: apanha {mc['recall_ao_sugerir']:.0%} dos duplicados, sugere "
          f"{mc['negativos_sugeridos']:.0%} dos não-duplicados · juntar sozinho: "
          f"{'p ≥ ' + str(p_auto) if p_auto is not None else 'nenhum limiar chega a ' + format(PRECISAO_AUTO, '.0%') + ' de precisão (só os óbvios, D7)'}")
    print(f"→ {MODELO_PATH.relative_to(ROOT)}")
    return m


def main() -> None:
    """Passo do pipeline (depois do fuse): pares de duplicados com a probabilidade do modelo
    → catalogo/duplicados.json, que a app usa em vez de os calcular ela própria."""
    cfg = load_config(ROOT / "config/municipio.yaml")
    zdir = zone_dir(cfg)
    els = json.load(open(zdir / "catalogo/elementos.json"))
    porid = {e["id"]: e for e in els}
    dets = {d["id"]: d for d in json.load(open(zdir / "deteccoes/deteccoes.json"))}
    m = ler_modelo()
    emb = embeddings(zdir, dets)
    pares = pares_candidatos(els, dets)
    out = []
    for p in pares:
        a, b = porid[p["a"]], porid[p["b"]]
        p["clip"] = sim_clip(a, b, emb, dets)
        regra = regra_atual(a, b, p)
        pr = float(prob(m, np.array([vetor(p)]))[0]) if m else None
        if regra == "certo" or (m and m.get("p_auto") is not None and pr >= m["p_auto"]):
            motivo = "certo"
        elif (m and pr >= m["p_sugerir"]) or (not m and regra == "possivel"):
            motivo = "possivel"
        else:
            continue
        out.append({"a": p["a"], "b": p["b"], "tipo": p["tipo"], "dist_m": round(p["dist_m"], 1), "motivo": motivo,
                    **({"iou": round(p["iou_max"], 2)} if p["partilham_foto"] else {}),
                    **({"p": round(pr, 3)} if pr is not None else {}), "clip": p["clip"]})
    (zdir / "catalogo/duplicados.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    c = Counter(x["motivo"] for x in out)
    print(f"duplicados: {len(pares)} pares candidatos → {c.get('certo', 0)} juntados sozinhos, {c.get('possivel', 0)} "
          f"sugeridos ao técnico ({'modelo ' + m['treinado_em'][:10] if m else 'sem modelo: regra D7'})")


def simular(novos_path: Path, rotulo: str) -> dict:
    """Compara um catálogo recalculado com as decisões dos técnicos, pelas deteções."""
    cfg = load_config(ROOT / "config/municipio.yaml")
    zdir = zone_dir(cfg)
    antes = {e["id"]: e for e in json.load(open(zdir / "catalogo/elementos.json"))}
    lab = rotulos(ler_registo(zdir / "catalogo/registo_validacoes.jsonl"), antes)
    novos = json.load(open(novos_path))
    det_el = {d: e["id"] for e in novos for d in e.get("deteccoes") or []}

    def onde(i: str) -> set[str]:
        return {det_el[d] for d in antes[i].get("deteccoes") or [] if d in det_el}

    r = Counter()
    for (a, b), l in lab.items():
        if a not in antes or b not in antes:
            continue
        na, nb = onde(a), onde(b)
        if not na or not nb:
            r[f"{l}: um deles desapareceu"] += 1
        elif na & nb:
            r[f"{l}: juntos"] += 1
        else:
            r[f"{l}: separados"] += 1
    mesmo = r["mesmo: juntos"] + r["mesmo: separados"]
    outros = sum(v for k, v in r.items() if not k.startswith("mesmo") and "desapareceu" not in k)
    errados = sum(v for k, v in r.items() if not k.startswith("mesmo") and k.endswith("juntos"))
    res = {"rotulo": rotulo, "quando": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "elementos": len(novos), "por_tipo": dict(Counter(e["tipo"] for e in novos)),
           "pendentes": sum(e.get("estado") == "pendente" for e in novos),
           "duplicados_resolvidos": f"{r['mesmo: juntos']} de {mesmo}",
           "diferentes_juntados_mal": f"{errados} de {outros}",
           "detalhe": dict(sorted(r.items()))}
    out = ROOT / "reports/duplicados/simulacoes.json"
    hist = json.loads(out.read_text()) if out.exists() else []
    hist = [h for h in hist if h["rotulo"] != rotulo] + [res]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "quando"}, ensure_ascii=False))
    return res


if __name__ == "__main__":
    if sys.argv[1:2] == ["medir"]:
        medir()
    elif sys.argv[1:2] == ["treinar"]:
        treinar()
    elif not sys.argv[1:]:
        main()
    elif sys.argv[1:2] == ["simular"]:
        rot = sys.argv[sys.argv.index("--rotulo") + 1] if "--rotulo" in sys.argv else Path(sys.argv[2]).stem
        simular(Path(sys.argv[2]), rot)
    else:
        print(__doc__)
