#!/usr/bin/env python3
"""M4 — Precisão e recall da classificação de sinais contra os rótulos manuais.

Compara as variantes de classify_signs.py (atual / p1 / p3 / p4 / p5) sobre os
recortes rotulados em reports/m4/rotulos.json (página m4_rotular.py). Não
altera deteccoes.json.

Os rótulos casam com as deteções pelo id e, se o id mudou (nova execução da
M3), pela mesma imagem com IoU ≥ 0,5.

Por classe: precisão = certos / previstos dessa classe; recall = certos /
rotulados dessa classe. "limite (família)" conta qualquer limite, com ou sem
valor; "limite_30/40/50" exige o valor. As abstenções (outro_sinal incerto,
limite_desconhecido) não são erros de precisão: vão para a fila (coluna
"fila"). "Erros" = previsões específicas (stop, cedência, limite com valor)
erradas — o número a manter perto de 0.

Para o passo final (a última variante pedida): matriz de confusão (rótulo ×
previsão; "(fila)" = abstenção) e, para os m4.erros_frequentes erros mais
frequentes, m4.exemplos_por_erro exemplos em exemplos/<n>_<rótulo>__<previsão>/
(<id>_largo.jpg = o que o técnico vê; <id>_justo.jpg = o que o classificador vê).

Saída (em m4.relatorios, por omissão reports/m4/): medicao.json, medicao.md,
predicoes.json, exemplos/

Uso:
    python pipeline/m4_medir.py [--variantes atual,p1,p3,p4,p5] [--varrer]
      --varrer  também varre um limiar de família comum (0,3–0,9) no passo final
                e compara as opções para a família "de costas" (opcoes_costas)
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify_signs import DECIDE, VARIANTES, ClipSignClassifier, contextos, m4_cfg  # noqa: E402
from common import ROOT, load_config, zone_dir  # noqa: E402

# rótulo manual → (classe, valor)
VERDADE = {
    "stop": ("stop", None), "cedencia": ("cedencia", None),
    "limite_30": ("limite", 30), "limite_40": ("limite", 40), "limite_50": ("limite", 50),
    "limite_outro": ("limite", "outro"), "outro_frente": ("outro", None),
    "costas": ("costas", None), "nao_sinal": ("nao_sinal", None),
}
VALORES_ROTULADOS = {30, 40, 50}   # "limite_outro" = qualquer valor fora destes
LINHAS = ["stop", "cedencia", "limite (família)", "limite_30", "limite_40", "limite_50", "costas", "outro (de frente)"]


def previsto(r: dict) -> tuple[str, object, bool]:
    """(classe, valor, abstenção)."""
    s = r["subclasse"]
    if s == "stop":
        return "stop", None, False
    if s == "cedencia_passagem":
        return "cedencia", None, False
    if s == "limite_desconhecido":
        return "limite", None, True
    if s.startswith("limite_"):
        return "limite", int(s.split("_")[1]), False
    if s == "costas":
        return "costas", None, False
    return "outro", None, bool(r.get("incerto"))


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9)


def casar(rotulos: dict, dets: list[dict]) -> tuple[list[tuple[dict, str]], int]:
    por_id = {d["id"]: d for d in dets}
    por_img = defaultdict(list)
    for d in dets:
        por_img[d["extra"]["imagem_id"]].append(d)
    pares, falhas = [], 0
    for did, r in rotulos.items():
        d = por_id.get(did)
        if d is None or d["extra"]["imagem_id"] != r["imagem_id"] or iou(d["bbox"], r["bbox"]) < 0.5:
            cands = [(iou(x["bbox"], r["bbox"]), x) for x in por_img.get(r["imagem_id"], [])]
            cands = [c for c in cands if c[0] >= 0.5]
            d = max(cands, key=lambda c: c[0])[1] if cands else None
        if d is None:
            falhas += 1
        else:
            pares.append((d, r["rotulo"]))
    return pares, falhas


def acerta(linha: str, cls, val) -> bool:
    if linha == "limite (família)":
        return cls == "limite"
    if linha.startswith("limite_"):
        return cls == "limite" and val == int(linha.split("_")[1])
    if linha == "outro (de frente)":
        return cls == "outro"
    return cls == linha


def certo(v: tuple, p: tuple) -> bool:
    """Previsão específica certa? Com rótulo "limite (outro valor)" o valor não
    se pode verificar: conta como certo qualquer valor fora de 30/40/50."""
    if v[0] != p[0]:
        return False
    if p[0] != "limite":
        return True
    return v[1] == p[1] or (v[1] == "outro" and p[1] not in VALORES_ROTULADOS)


def metricas(verdades: list[tuple], preds: list[tuple]) -> dict:
    res = {}
    for ln in LINHAS:
        tp = sum(acerta(ln, *v) and acerta(ln, p[0], p[1]) for v, p in zip(verdades, preds))
        n_v = sum(acerta(ln, *v) for v in verdades)
        n_p = sum(acerta(ln, p[0], p[1]) for p in preds)
        res[ln] = {"precisao": None if n_p == 0 else round(tp / n_p, 3),
                   "recall": None if n_v == 0 else round(tp / n_v, 3), "certos": tp, "previstos": n_p, "rotulados": n_v}
    especificas = [(v, p) for v, p in zip(verdades, preds)
                   if p[0] in ("stop", "cedencia") or (p[0] == "limite" and p[1] is not None)]
    erros = [(v, p) for v, p in especificas if not certo(v, p)]
    res["_resumo"] = {"n": len(preds), "fila": sum(p[2] for p in preds),
                      "especificas": len(especificas), "erros_especificos": len(erros),
                      "precisao_especificas": None if not especificas else round(1 - len(erros) / len(especificas), 3),
                      "confusao_erros": dict(Counter(f"{v[0]}{'' if v[1] is None else '_' + str(v[1])} → "
                                                     f"{p[0]}{'' if p[1] is None else '_' + str(p[1])}"
                                                     for v, p in erros))}
    return res


# rótulo manual → previsões que contam como certas (no passo final)
CERTO = {
    "stop": {"stop"}, "cedencia": {"cedencia_passagem"},
    "limite_30": {"limite_30"}, "limite_40": {"limite_40"}, "limite_50": {"limite_50"},
    "limite_outro": {"limite_desconhecido (fila)"}, "outro_frente": {"outro_sinal"},
    "costas": {"costas"},
    # deteção falsa da M3: a M4 não rejeita deteções, o melhor que pode fazer é "outro"
    "nao_sinal": {"outro_sinal", "outro_sinal (fila)"},
}


def chave_prev(r: dict) -> str:
    return r["subclasse"] + (" (fila)" if r.get("incerto") else "")


def confusao(rotulos: list[str], rs: list[dict]) -> dict:
    m: dict = defaultdict(Counter)
    for rot, r in zip(rotulos, rs):
        m[rot][chave_prev(r)] += 1
    return {k: dict(v) for k, v in m.items()}


def certo_chave(rot: str, r: dict) -> bool:
    k = chave_prev(r)
    if rot == "limite_outro" and k.startswith("limite_") and k[7:].isdigit():
        return int(k[7:]) not in VALORES_ROTULADOS
    return k in CERTO[rot]


def erros_frequentes(rotulos: list[str], rs: list[dict], n: int) -> list[tuple[str, str, list[int]]]:
    """[(rótulo, previsão, índices)] dos n pares errados mais frequentes."""
    cel = defaultdict(list)
    for i, (rot, r) in enumerate(zip(rotulos, rs)):
        if not certo_chave(rot, r):
            cel[(rot, chave_prev(r))].append(i)
    return [(a, b, ix) for (a, b), ix in sorted(cel.items(), key=lambda kv: -len(kv[1]))[:n]]


def tabela_confusao(m: dict, variante: str) -> str:
    rot = [r for r in VERDADE if r in m]
    cols = sorted({c for v in m.values() for c in v})
    out = [f"## Matriz de confusão — {variante}\n", "Linhas = rótulo manual; colunas = previsão; \"(fila)\" = abstenção.\n",
           "| rótulo \\ previsão | " + " | ".join(cols) + " |", "|---|" + "---:|" * len(cols)]
    for r in rot:
        out.append(f"| {r} | " + " | ".join(str(m[r].get(c, "")) for c in cols) + " |")
    return "\n".join(out)


def guardar_exemplos(out: Path, erros, ds, ctx, zdir: Path, k: int) -> list[dict]:
    import cv2
    base = out / "exemplos"
    if base.exists():
        shutil.rmtree(base)
    feitos = []
    for n, (rot, prev, ix) in enumerate(erros, 1):
        pasta = base / f"{n:02d}_{rot}__{prev.replace(' (fila)', '_fila')}"
        pasta.mkdir(parents=True, exist_ok=True)
        for i in ix[:k]:
            d = ds[i]
            shutil.copyfile(zdir / d["recorte"], pasta / f"{d['id']}_largo.jpg")
            if ctx[i].get("justo") is not None:
                cv2.imwrite(str(pasta / f"{d['id']}_justo.jpg"), ctx[i]["justo"])
        feitos.append({"rotulo": rot, "previsao": prev, "n": len(ix), "pasta": str(pasta.relative_to(ROOT)),
                       "exemplos": [ds[i]["id"] for i in ix[:k]]})
    return feitos


def opcoes_costas(verdades, ctx, m4: dict, final: str) -> dict:
    """Precisão/recall de "costas", precisão das específicas e fila: configuração atual vs costas a 0,8.

    (A opção "sem as 2 frases de costas" foi medida a 18/11 e aplicada; já não existe.)
    """
    opcoes = {
        f"atual (costas {m4['limiar_familia']['costas']})": (m4, ctx),
        "limiar costas 0,8": ({**m4, "limiar_familia": {**m4["limiar_familia"], "costas": 0.8}}, ctx),
    }
    out = {}
    for nome, (mt, cs_) in opcoes.items():
        r = metricas(verdades, [previsto(DECIDE[final](c, mt)) for c in cs_])
        out[nome] = {"costas": r["costas"], "outro (de frente)": r["outro (de frente)"], "_resumo": r["_resumo"]}
    return out


def fmt(x) -> str:
    return "—" if x is None else f"{x:.2f}".replace(".", ",")


def tabela_md(res: dict, variantes) -> str:
    cab = "| Classe | n | " + " | ".join(f"{v} P | {v} R" for v in variantes) + " |"
    sep = "|---|---:|" + "---:|---:|" * len(variantes)
    linhas = [cab, sep]
    for ln in LINHAS:
        n = res[variantes[0]][ln]["rotulados"]
        cel = " | ".join(f"{fmt(res[v][ln]['precisao'])} | {fmt(res[v][ln]['recall'])}" for v in variantes)
        linhas.append(f"| {ln} | {n} | {cel} |")
    linhas.append("")
    linhas.append("| Variante | Previsões específicas | Erros | Precisão das específicas | Para a fila |")
    linhas.append("|---|---:|---:|---:|---:|")
    for v in variantes:
        r = res[v]["_resumo"]
        linhas.append(f"| {v} | {r['especificas']} | {r['erros_especificos']} | {fmt(r['precisao_especificas'])} | "
                      f"{r['fila']} de {r['n']} |")
    return "\n".join(linhas)


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m4 = m4_cfg(cfg)
    variantes = (sys.argv[sys.argv.index("--variantes") + 1].split(",") if "--variantes" in sys.argv
                 else list(VARIANTES))
    OUT = ROOT / m4.get("relatorios", "reports/m4")
    rot_p = ROOT / m4.get("rotulos", "reports/m4/rotulos.json")
    if not rot_p.exists():
        sys.exit(f"sem rótulos em {rot_p.relative_to(ROOT)} (página: python pipeline/m4_rotular.py)")
    rotulos = json.loads(rot_p.read_text(encoding="utf-8"))["rotulos"]
    zdir = zone_dir(cfg)
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json", encoding="utf-8")) if d["classe"] == "sinal"]
    pares, falhas = casar(rotulos, dets)
    if not pares:
        sys.exit("nenhum rótulo casa com as deteções atuais")
    pares.sort(key=lambda p: (p[0]["extra"]["imagem"], p[0]["id"]))
    ds = [p[0] for p in pares]
    verdades = [VERDADE[p[1]] for p in pares]
    print(f"{len(pares)} rótulos casados ({falhas} sem deteção correspondente): {dict(Counter(p[1] for p in pares))}")

    ctx = contextos(ds, zdir, m4, ClipSignClassifier(), variantes=variantes)
    res, pred_out, por_var = {}, [], {}
    for v in variantes:
        rs = [DECIDE[v](c, m4) for c in ctx]
        por_var[v] = rs
        res[v] = metricas(verdades, [previsto(r) for r in rs])
        for d, rot, r in zip(ds, (p[1] for p in pares), rs):
            pred_out.append({"variante": v, "id": d["id"], "rotulo": rot, **r})

    final = variantes[-1]
    rot_list = [p[1] for p in pares]
    conf_final = confusao(rot_list, por_var[final])
    varrimento = {}
    if "--varrer" in sys.argv:
        for t in (0.3, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9):
            mt = {**m4, "limiar_familia": dict.fromkeys(m4["limiar_familia"], t)}
            varrimento[str(t)] = metricas(verdades, [previsto(DECIDE[final](c, mt)) for c in ctx])
        opc = opcoes_costas(verdades, ctx, m4, final)
    else:
        opc = {}

    OUT.mkdir(parents=True, exist_ok=True)
    erros = erros_frequentes(rot_list, por_var[final], int(m4.get("erros_frequentes", 5)))
    exemplos = guardar_exemplos(OUT, erros, ds, ctx, zdir, int(m4.get("exemplos_por_erro", 3)))
    meta = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rotulos": len(pares),
            "rotulos_sem_deteccao": falhas, "config_m4": {k: m4[k] for k in m4 if k != "rotulos"}}
    (OUT / "medicao.json").write_text(json.dumps({**meta, "variantes": res, "passo_final": final,
                                                  "confusao_final": conf_final, "erros_frequentes": exemplos,
                                                  "varrimento_final": varrimento,
                                                  "opcoes_costas": opc},
                                                 ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "predicoes.json").write_text(json.dumps(pred_out, ensure_ascii=False, indent=0), encoding="utf-8")
    md = (f"# M4 — medição contra os rótulos manuais\n\n{meta['gerado_em']} · {len(pares)} recortes rotulados "
          f"(lado ≥ {m4.get('rotular_lado_min_px', 30)} px)\n\nP = precisão, R = recall. "
          f"Abstenções (fila) não contam como erro de precisão.\n\n{tabela_md(res, variantes)}\n")
    for v in variantes:
        ce = res[v]["_resumo"]["confusao_erros"]
        if ce:
            md += f"\nErros de {v}: " + "; ".join(f"{k} ×{n}" for k, n in ce.items()) + "\n"
    if "atual" in variantes and final != "atual":
        a, f = res["atual"], res[final]
        md += (f"\n## Antes (atual) → depois ({final})\n\n| | antes | depois |\n|---|---:|---:|\n"
               f"| previsões específicas (stop, cedência, limite com valor) | {a['_resumo']['especificas']} | {f['_resumo']['especificas']} |\n"
               f"| erradas | {a['_resumo']['erros_especificos']} | {f['_resumo']['erros_especificos']} |\n"
               f"| precisão das específicas | {fmt(a['_resumo']['precisao_especificas'])} | {fmt(f['_resumo']['precisao_especificas'])} |\n"
               f"| para a fila do técnico | {a['_resumo']['fila']} | {f['_resumo']['fila']} |\n")
        for ln in ("stop", "cedencia", "limite (família)", "costas"):
            md += f"| {ln}: precisão / recall | {fmt(a[ln]['precisao'])} / {fmt(a[ln]['recall'])} | {fmt(f[ln]['precisao'])} / {fmt(f[ln]['recall'])} |\n"
    md += "\n" + tabela_confusao(conf_final, final) + "\n"
    if exemplos:
        md += f"\n## Erros mais frequentes — {final}\n\n| Rótulo | Previsão | n | Exemplos |\n|---|---|---:|---|\n"
        for e in exemplos:
            md += f"| {e['rotulo']} | {e['previsao']} | {e['n']} | `{e['pasta']}` |\n"
    if varrimento:
        md += f"\n## Varrimento do limiar de família ({final})\n\n| Limiar | Específicas | Erros | Fila |\n|---:|---:|---:|---:|\n"
        for t, r in varrimento.items():
            s = r["_resumo"]
            md += f"| {t} | {s['especificas']} | {s['erros_especificos']} | {s['fila']} |\n"
    if opc:
        md += (f"\n## Opções para \"de costas\" ({final})\n\n| Opção | costas P | costas R | costas previstos | "
               "específicas erradas | fila |\n|---|---:|---:|---:|---:|---:|\n")
        for nome, r in opc.items():
            md += (f"| {nome} | {fmt(r['costas']['precisao'])} | {fmt(r['costas']['recall'])} | {r['costas']['previstos']} | "
                   f"{r['_resumo']['erros_especificos']} | {r['_resumo']['fila']} de {r['_resumo']['n']} |\n")
    (OUT / "medicao.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
