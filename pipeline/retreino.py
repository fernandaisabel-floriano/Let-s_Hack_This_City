#!/usr/bin/env python3
"""P2.2 / P1.3 — Re-treino da classificação de sinais: sonda linear sobre o CLIP.

Em vez de afinar o YOLO ou o CLIP (sem GPU e com poucas centenas de rótulos não
compensa), treina uma regressão logística multinomial sobre o vetor CLIP
(ViT-B/32, normalizado) do recorte justo de cada sinal. Classes:
stop, cedencia_passagem, limite, outro_sinal, costas, nao_sinal.

Exemplos:
  rótulos     reports/m4/rotulos.json (página m4_rotular.py) — mandam sempre
  validações  catalogo/registo_validacoes.jsonl (a app; "melhora com o uso"):
                sinal rejeitado (não duplicado) ou mudado para outra classe → as
                  vistas do elemento são nao_sinal;
                sinal confirmado com subtipo → as vistas que a M4 não pôs
                  noutra família certa (placas empilhadas no mesmo poste)
  sintéticos  --sinteticos: STOP / cedência / limites desenhados à mão
              (tests/sinais_sinteticos.py), degradados; só no treino

Validação: 5 grupos × 10 repetições, separados POR ELEMENTO (as vistas do mesmo
objeto nunca ficam umas no treino e outras no teste). Com as probabilidades fora
do grupo de treino:
  - escolhe a regularização (perda logarítmica);
  - escolhe os limiares da p6 (classify_signs.py) com 0 erros específicos;
  - compara p5 × p6 recorte a recorte (como m4_medir.py) e por elemento (como
    m4_elementos.py, refazendo só o voto).
A sonda final (todos os exemplos) vai para config/m4/sonda.npz e o relatório para
reports/m4/retreino.json / retreino.md.

Uso:
    python pipeline/retreino.py [--sinteticos] [--so-contar]
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify_signs import (CLASSES_SONDA, DECIDE, ClipSignClassifier, Sonda, contextos,  # noqa: E402
                            m4_cfg)
from common import ROOT, load_config, zone_dir  # noqa: E402
from estado import estado_atual, ler_registo  # noqa: E402
from m4_elementos import medir as medir_elementos  # noqa: E402
from m4_medir import VERDADE, casar, metricas, previsto  # noqa: E402

ROTULO_CLASSE = {"stop": "stop", "cedencia": "cedencia_passagem", "limite_30": "limite", "limite_40": "limite",
                 "limite_50": "limite", "limite_outro": "limite", "outro_frente": "outro_sinal",
                 "costas": "costas", "nao_sinal": "nao_sinal"}
K = len(CLASSES_SONDA)
IDX = {c: i for i, c in enumerate(CLASSES_SONDA)}


# ------------------------------------------------------------------ exemplos

def familia_certa(d: dict) -> str | None:
    s, e = d.get("subclasse") or "", d["extra"]
    if not s or s == "costas" or e.get("m4_incerto"):
        return None
    return "limite" if s.startswith("limite_") else s


def exemplos_validacoes(zdir: Path, por_id: dict) -> dict[str, str]:
    """det id → classe, a partir das decisões dos técnicos na app."""
    reg = ler_registo(zdir / "catalogo/registo_validacoes.jsonl")
    if not reg:
        return {}
    els = {e["id"]: e for e in json.load(open(zdir / "catalogo/elementos.json", encoding="utf-8"))}
    out = {}
    for eid, v in estado_atual(reg).items():
        e = els.get(eid)
        if not e or v.get("classe") != "sinal":
            continue
        dets = [por_id[i] for i in e["deteccoes"] if i in por_id]
        if (v["estado"] == "rejeitado" and not v.get("duplicado_de")) or (v.get("classe_corrigida") not in (None, "sinal")):
            for d in dets:
                out[d["id"]] = "nao_sinal"
            continue
        if v["estado"] == "rejeitado":
            continue
        sub = v["subtipo_corrigido"] if "subtipo_corrigido" in v else e.get("subtipo")
        if not sub or (e.get("subtipo_incerto") and "subtipo_corrigido" not in v):
            continue
        fam = "limite" if sub.startswith("limite_") else sub
        if fam not in IDX:
            continue
        for d in dets:
            f = familia_certa(d)
            if d.get("subclasse") != "costas" and (f is None or f == fam):
                out[d["id"]] = fam
    return out


def sinteticos(n_por_classe: int = 24) -> tuple[list[np.ndarray], list[str]]:
    sys.path.insert(0, str(ROOT / "tests"))
    import sinais_sinteticos as ss
    gen = {"stop": [ss.stop], "cedencia_passagem": [ss.cedencia],
           "limite": [lambda v=v: ss.limite(v) for v in (30, 40, 50)]}
    imgs, ys = [], []
    rng = np.random.default_rng(0)
    for cls, fs in gen.items():
        for k in range(n_por_classe):
            im = fs[k % len(fs)]()
            imgs.append(ss.degradar(im, int(rng.integers(28, 90)), float(rng.uniform(0, 1.6)), int(rng.integers(1e6))))
            ys.append(cls)
    return imgs, ys


# ------------------------------------------------------------------ modelo

def treinar(X: np.ndarray, y: np.ndarray, lam: float) -> tuple[np.ndarray, np.ndarray]:
    """Softmax com L2 e pesos por classe equilibrados (L-BFGS)."""
    n, d = X.shape
    cnt = np.bincount(y, minlength=K).astype(float)
    w_cls = np.where(cnt > 0, n / (K * np.maximum(cnt, 1)), 0.0)
    sw = w_cls[y]
    Y = np.eye(K)[y]

    def f(theta):
        W, b = theta[:d * K].reshape(d, K), theta[d * K:]
        z = X @ W + b
        z -= z.max(1, keepdims=True)
        lse = np.log(np.exp(z).sum(1))
        P = np.exp(z - lse[:, None])
        loss = (sw * (lse - (z * Y).sum(1))).sum() / sw.sum() + lam * (W * W).sum()
        G = (P - Y) * sw[:, None] / sw.sum()
        return loss, np.concatenate([(X.T @ G + 2 * lam * W).ravel(), G.sum(0)])

    r = minimize(f, np.zeros(d * K + K), jac=True, method="L-BFGS-B", options={"maxiter": 500})
    return r.x[:d * K].reshape(d, K), r.x[d * K:]


def prob(X, W, b):
    z = X @ W + b
    z -= z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def fora_do_grupo(X, y, grupos, Xs, ys, lam, rep=10, folds=5) -> np.ndarray:
    """Probabilidades fora do treino (média das repetições), grupos separados por elemento."""
    P = np.zeros((len(y), K))
    ug = np.array(sorted(set(grupos)))
    g = np.array(grupos)
    for r in range(rep):
        rng = np.random.default_rng(r)
        perm = rng.permutation(len(ug))
        fold_de = {ug[i]: k % folds for k, i in enumerate(perm)}
        f = np.array([fold_de[x] for x in g])
        for k in range(folds):
            te = f == k
            Xtr, ytr = np.vstack([X[~te], Xs]), np.concatenate([y[~te], ys])
            W, b = treinar(Xtr, ytr, lam)
            P[te] += prob(X[te], W, b)
    return P / rep


# ------------------------------------------------------------------ main

def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m4 = m4_cfg(cfg)
    zdir = zone_dir(cfg)
    out_dir = ROOT / m4.get("relatorios", "reports/m4")
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json", encoding="utf-8")) if d["classe"] == "sinal"]
    por_id = {d["id"]: d for d in dets}

    # 1. exemplos
    rot = json.loads((ROOT / m4.get("rotulos", "reports/m4/rotulos.json")).read_text(encoding="utf-8"))["rotulos"]
    pares, _ = casar(rot, dets)
    rotulo_de = {d["id"]: lab for d, lab in pares}
    classe_de = {i: ROTULO_CLASSE[lab] for i, lab in rotulo_de.items()}
    fonte_de = dict.fromkeys(classe_de, "rótulos")
    for i, c in exemplos_validacoes(zdir, por_id).items():
        if i not in classe_de:
            classe_de[i], fonte_de[i] = c, "validações"
    usar_sint = "--sinteticos" in sys.argv
    tab = defaultdict(Counter)
    for i, c in classe_de.items():
        tab[c][fonte_de[i]] += 1
    sint_imgs, sint_y = sinteticos() if usar_sint else ([], [])
    for c in sint_y:
        tab[c]["sintéticos"] += 1
    print("Exemplos prontos para o re-treino:")
    for c in CLASSES_SONDA:
        print(f"  {c:18s} {sum(tab[c].values()):4d}  ({', '.join(f'{k} {v}' for k, v in tab[c].items()) or '—'})")
    total = len(classe_de) + len(sint_y)
    print(f"  {'total':18s} {total:4d}")
    contagem = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "exemplos_prontos": total, "por_classe": {c: dict(tab[c]) for c in CLASSES_SONDA}}
    if "--so-contar" in sys.argv:
        (out_dir / "retreino.json").write_text(json.dumps(contagem, ensure_ascii=False, indent=1), encoding="utf-8")
        return

    # 2. vetores CLIP + contexto da p5 (forma, algarismos)
    # todas as vistas de sinal (as sem exemplo entram na medição por elemento)
    todos_ids = sorted(por_id, key=lambda i: (por_id[i]["extra"]["imagem"], i))
    clip = ClipSignClassifier()
    ctx_todos = dict(zip(todos_ids, contextos([por_id[i] for i in todos_ids], zdir, m4, clip, variantes=("p5",))))
    ids = [i for i in todos_ids if i in classe_de]
    ctx = [ctx_todos[i] for i in ids]
    X = np.array([c["emb"] for c in ctx])
    y = np.array([IDX[classe_de[i]] for i in ids])
    Xs = clip.embed(sint_imgs) if sint_imgs else np.zeros((0, X.shape[1]))
    ys = np.array([IDX[c] for c in sint_y], dtype=int)
    el_de = {d: e["id"] for e in json.load(open(zdir / "catalogo/elementos.json", encoding="utf-8")) for d in e["deteccoes"]}
    grupos = [el_de.get(i, i) for i in ids]

    # 3. regularização por validação cruzada
    escolha = None
    for lam in (1e-6, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3):
        P = fora_do_grupo(X, y, grupos, Xs, ys, lam, rep=3)
        ll = float(-np.log(np.clip(P[np.arange(len(y)), y], 1e-9, 1)).mean())
        print(f"  λ={lam:g}: perda log {ll:.3f}, acerto {float((P.argmax(1) == y).mean()):.3f}")
        if escolha is None or ll < escolha[1]:
            escolha = (lam, ll)
    lam = escolha[0]
    P = fora_do_grupo(X, y, grupos, Xs, ys, lam)
    pred = P.argmax(1)
    por_classe = {}
    for k, c in enumerate(CLASSES_SONDA):
        tp, npred, nver = int(((pred == k) & (y == k)).sum()), int((pred == k).sum()), int((y == k).sum())
        por_classe[c] = {"precisao": round(tp / npred, 3) if npred else None, "recall": round(tp / nver, 3) if nver else None,
                         "rotulados": nver}

    # 4. p5 × p6 com as probabilidades fora do treino; limiares com 0 erros específicos
    verdades = [VERDADE[rotulo_de[i]] if i in rotulo_de else None for i in ids]
    so_rot = [k for k, v in enumerate(verdades) if v is not None]
    def com_sonda(Pm):
        for c, p in zip(ctx, Pm):
            c["p_sonda"] = dict(zip(CLASSES_SONDA, map(float, p)))
    com_sonda(P)
    base = metricas([verdades[k] for k in so_rot], [previsto(DECIDE["p5"](ctx[k], m4)) for k in so_rot])
    # não-sinal: o limiar mais baixo que marca por engano ≤ 5 % das vistas reais de frente
    # (marcar = a vista abstém-se do voto e o elemento vai para a fila)
    reais = [k for k in so_rot if rotulo_de[ids[k]] not in ("nao_sinal", "costas")]
    falsos = [k for k in so_rot if rotulo_de[ids[k]] == "nao_sinal"]
    tab_nao = []
    for nao in (0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01):
        tab_nao.append({"nao_sinal_min": nao, "nao_sinal_apanhados": int(sum(P[k, IDX["nao_sinal"]] >= nao for k in falsos)),
                        "reais_marcados": int(sum(P[k, IDX["nao_sinal"]] >= nao for k in reais))})
    nao = min((t for t in tab_nao if t["reais_marcados"] <= 0.05 * len(reais)), key=lambda t: t["nao_sinal_min"])["nao_sinal_min"]
    # 5. sonda final com todos os exemplos; as vistas sem exemplo usam-na (não estão no treino),
    #    as com exemplo usam as probabilidades fora do treino
    W, b = treinar(np.vstack([X, Xs]), np.concatenate([y, ys]), lam)
    sem = [i for i in todos_ids if i not in classe_de]
    if sem:
        for i, p in zip(sem, prob(np.array([ctx_todos[i]["emb"] for i in sem]), W, b)):
            ctx_todos[i]["p_sonda"] = dict(zip(CLASSES_SONDA, map(float, p)))

    # 6. por elemento (refaz só o voto): todas as vistas de sinal com a variante medida
    els = json.load(open(zdir / "catalogo/elementos.json", encoding="utf-8"))
    def elementos(variante, m4v):
        dd = {}
        for i, d in por_id.items():
            r = DECIDE[variante](ctx_todos[i], m4v)
            dd[i] = {**d, "subclasse": r["subclasse"], "extra": {**d["extra"], "m4_incerto": r["incerto"],
                                                                 "confianca_classificacao": r["conf"]}}
        return medir_elementos(els, dd, rotulo_de, cfg["m4"])["resumo"]
    el_p5 = elementos("p5", m4)

    # limiares da p6: por recorte e por elemento; escolhe 0 falsos específicos SEM fila por elemento
    # (um recorte errado sozinho vai para a fila: voto_min_vistas_especificas), mais certos, depois o mais alto
    grelha = []
    for esp in (0.5, 0.6, 0.7, 0.8, 0.9):
        m4t = {**m4, "sonda": {**m4["sonda"], "especifica_min": esp, "nao_sinal_min": nao, "sugere_min": min(0.5, esp)}}
        r = metricas([verdades[k] for k in so_rot], [previsto(DECIDE["p6"](ctx[k], m4t)) for k in so_rot])
        el = elementos("p6", m4t)
        grelha.append({"especifica_min": esp, "nao_sinal_min": nao, **r["_resumo"],
                       "stop_R": r["stop"]["recall"], "cedencia_R": r["cedencia"]["recall"], "limite_R": r["limite (família)"]["recall"],
                       "elementos": el})
    certos = lambda e: e.get("certo_auto", 0) + e.get("certo_fila", 0)
    validos = [g for g in grelha if g["elementos"].get("falso_especifico", 0) == 0 and g["elementos"].get("errado", 0) == 0]
    melhor = max(validos, key=lambda g: (certos(g["elementos"]), g["elementos"].get("certo_auto", 0), g["especifica_min"])) if validos else None
    m4_melhor = {**m4, "sonda": {**m4["sonda"], "especifica_min": melhor["especifica_min"],
                                 "nao_sinal_min": nao, "sugere_min": min(0.5, melhor["especifica_min"])}} if melhor else m4
    el_p6 = melhor["elementos"] if melhor else None
    ganha = bool(melhor) and certos(el_p6) > certos(el_p5) and el_p6.get("perdido", 0) <= el_p5.get("perdido", 0)
    meta = {"gerado_em": contagem["gerado_em"], "lambda": lam, "exemplos": contagem["por_classe"],
            "limiares": {k: m4_melhor["sonda"][k] for k in ("especifica_min", "nao_sinal_min", "sugere_min")},
            "sinteticos": usar_sint, "ganha_a_p5": ganha}
    sp = ROOT / m4["sonda"]["ficheiro"]
    Sonda(W, b, CLASSES_SONDA, meta).guardar(sp)

    rel = {**contagem, "lambda": lam, "sinteticos": usar_sint, "sonda_fora_do_treino": por_classe,
           "p5": base["_resumo"], "p6_melhor": melhor, "grelha_p6": grelha, "nao_sinal": tab_nao,
           "elementos": {"p5": el_p5, "p6": el_p6}, "p6_ganha": ganha, "sonda": str(sp.relative_to(ROOT)),
           "fora_do_treino": {i: {"rotulo": rotulo_de.get(i) or classe_de[i], **{c: round(float(v), 3) for c, v in zip(CLASSES_SONDA, P[k])}}
                              for k, i in enumerate(ids)}}
    (out_dir / "retreino.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding="utf-8")
    fmt = lambda x: "—" if x is None else f"{x:.2f}".replace(".", ",")
    md = (f"# M4 — re-treino (sonda linear sobre o CLIP)\n\n{contagem['gerado_em']} · **{total} exemplos prontos** · "
          f"λ = {lam:g}{' · com sintéticos' if usar_sint else ''}\n\n| Classe | Exemplos | P (fora do treino) | R (fora do treino) |\n|---|---|---:|---:|\n")
    for c in CLASSES_SONDA:
        md += f"| {c} | {sum(tab[c].values())} ({', '.join(f'{k} {v}' for k, v in tab[c].items())}) | {fmt(por_classe[c]['precisao'])} | {fmt(por_classe[c]['recall'])} |\n"
    md += ("\n## p5 × p6 (sonda fora do treino)\n\nPor recorte (rótulos) e por elemento (voto refeito). "
           "Escolha: 0 falsos específicos sem fila por elemento, mais elementos certos.\n\n"
           "| | recortes: específicos certos | errados | STOP R | cedência R | limite R | elementos: certo (auto) | certo (fila) | "
           "fila sem tipo | perdido | falsos sem fila |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n")
    linha_el = lambda e: " | ".join(str(e.get(c, 0)) for c in ("certo_auto", "certo_fila", "fila", "perdido", "falso_especifico"))
    md += (f"| p5 | {base['_resumo']['especificas'] - base['_resumo']['erros_especificos']} | {base['_resumo']['erros_especificos']} | "
           f"{fmt(base['stop']['recall'])} | {fmt(base['cedencia']['recall'])} | {fmt(base['limite (família)']['recall'])} | {linha_el(el_p5)} |\n")
    for g in grelha:
        md += (f"| p6 específica ≥ {g['especifica_min']}{' ← escolhido' if g is melhor else ''} | {g['especificas'] - g['erros_especificos']} | "
               f"{g['erros_especificos']} | {fmt(g['stop_R'])} | {fmt(g['cedencia_R'])} | {fmt(g['limite_R'])} | {linha_el(g['elementos'])} |\n")
    md += (f"\n## \"Não é sinal\" (vistas rotuladas, fora do treino)\n\n{len(falsos)} recortes que não são sinais; {len(reais)} sinais reais de frente.\n\n"
           "| P(não é sinal) ≥ | não-sinais apanhados | sinais reais marcados por engano |\n|---:|---:|---:|\n")
    for t in tab_nao:
        md += f"| {t['nao_sinal_min']} | {t['nao_sinal_apanhados']} | {t['reais_marcados']}{' ← escolhido' if t['nao_sinal_min'] == nao else ''} |\n"
    md += f"\n**p6 ganha à p5: {'sim' if ganha else 'não'}.** Sonda gravada em `{sp.relative_to(ROOT)}`.\n"
    (out_dir / "retreino.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
