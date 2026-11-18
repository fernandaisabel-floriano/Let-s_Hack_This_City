#!/usr/bin/env python3
"""Contentores — precisão das deteções da M3 contra os rótulos manuais.

Lê as deteções de contentor (deteccoes.json) e os rótulos por caixa
(<relatorios_yolo_world>/labels.json, preenchido pela página de rotulagem via
`m4_rotular.py importar-contentores`; mesma imagem e IoU ≥ 0,5).

Relatório (por deteção, não por elemento fundido):
  * verdadeiros / falsos, por fonte e por prompt;
  * precisão por faixa de confiança e precisão/recall acumulados (conf ≥ t);
  * limiares SUGERIDOS (não altera a config):
      entra direto ≥ t_auto : menor t com precisão ≥ alvo_precisao (e ≥ min_n deteções)
      vai para a fila ≥ t_fila: maior t que ainda guarda ≥ alvo_recall dos verdadeiros
      (abaixo de t_fila: descartar)
  * tipos de falso mais frequentes (falso_tipo) e de verdadeiro (tipo), com
    exemplos copiados para exemplos/<tipo>/.

Saída: <contentores_relatorios> (por omissão reports/contentores/): medicao.json, medicao.md, exemplos/

Uso:
    python pipeline/contentores_medir.py [--alvo-precisao 0.95] [--alvo-recall 0.95]
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402

TIPOS_FALSO = ["papeleira", "armario", "banco_floreira", "veiculo", "outro", "(sem tipo)"]
TIPOS_VERDADEIRO = ["subterraneo", "ilha_reciclagem", "indiferenciado", "(sem tipo)"]
FAIXAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.01]
LIMIARES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def _arg(nome: str, default: float) -> float:
    return float(sys.argv[sys.argv.index(nome) + 1]) if nome in sys.argv else default


def _ler_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def fmt(x) -> str:
    return "—" if x is None else f"{x:.2f}".replace(".", ",")


def rotulados(cfg: dict) -> tuple[list[dict], list[dict], int]:
    """(deteções de contentor, linhas rotuladas, n.º sem rótulo). Linha = deteção + real/tipo/falso_tipo."""
    from test_yolo_world_prompts import iou
    zdir = zone_dir(cfg)
    base = ROOT / (cfg.get("relatorios_yolo_world") or "reports/yolo_world_test")
    labels = [c for c in json.loads((base / "labels.json").read_text(encoding="utf-8"))["caixas"]
              if c["grupo"] == "contentor"]
    por_img = defaultdict(list)
    for c in labels:
        por_img[c["image"]].append(c)
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json", encoding="utf-8")) if d["classe"] == "contentor"]
    linhas, sem = [], 0
    for d in dets:
        cands = [(iou(c["bbox"], d["bbox"]), c) for c in por_img.get(d["extra"]["imagem_id"], [])]
        cands = [x for x in cands if x[0] >= 0.5]
        if not cands:
            sem += 1
            continue
        c = max(cands, key=lambda x: x[0])[1]
        linhas.append({"id": d["id"], "conf": d["confianca"], "real": bool(c["real"]), "fonte": d["extra"].get("fonte"),
                       "prompt": d["extra"].get("prompt"), "tipo": c.get("tipo"), "falso_tipo": c.get("falso_tipo"),
                       "recorte": d["recorte"], "_det": d})
    return dets, linhas, sem


def main() -> None:
    cfg = load_config()
    alvo_p, alvo_r = _arg("--alvo-precisao", 0.95), _arg("--alvo-recall", 0.95)
    min_n = 5
    out = ROOT / (cfg.get("contentores_relatorios") or "reports/contentores")
    zdir = zone_dir(cfg)
    dets, linhas, sem = rotulados(cfg)
    if not linhas:
        sys.exit("nenhuma deteção de contentor tem rótulo (correr m4_rotular.py importar-contentores)")
    n_r = sum(x["real"] for x in linhas)

    faixas = []
    for a, b in zip(FAIXAS, FAIXAS[1:]):
        xs = [x for x in linhas if a <= x["conf"] < b]
        r = sum(x["real"] for x in xs)
        faixas.append({"faixa": f"[{a:.2f}, {min(b, 1):.2f}{']' if b > 1 else ')'}", "n": len(xs), "verdadeiros": r,
                       "precisao": round(r / len(xs), 3) if xs else None})
    acum = []
    for t in LIMIARES:
        xs = [x for x in linhas if x["conf"] >= t]
        r = sum(x["real"] for x in xs)
        acum.append({"limiar": t, "n": len(xs), "verdadeiros": r, "precisao": round(r / len(xs), 3) if xs else None,
                     "recall": round(r / n_r, 3) if n_r else None})
    t_auto = next((a["limiar"] for a in acum if a["n"] >= min_n and a["precisao"] is not None and a["precisao"] >= alvo_p), None)
    t_fila = max((a["limiar"] for a in acum if a["recall"] is not None and a["recall"] >= alvo_r), default=None)

    def conta(chave, real, ordem):
        c = Counter(x[chave] or "(sem tipo)" for x in linhas if x["real"] == real)
        return {k: c.get(k, 0) for k in ordem} | {k: v for k, v in c.items() if k not in ordem}

    # incertos da página (ficam fora da medição: não foram importados)
    rc = _ler_json(ROOT / ((cfg.get("m4") or {}).get("rotulos_contentores") or "reports/m4/rotulos_contentores.json"))
    inc = [r for r in (rc or {}).get("rotulos", {}).values() if r.get("real") is None]
    incertos = {"n": len(inc), "pequenos_lt30px": sum((r.get("lado_px") or 0) < 30 for r in inc),
                "conf_lt_0_1": sum((r.get("conf") or 0) < 0.1 for r in inc),
                "outros": sum(not ((r.get("lado_px") or 0) < 30 or (r.get("conf") or 0) < 0.1) for r in inc)}

    out.mkdir(parents=True, exist_ok=True)
    ex = out / "exemplos"
    if ex.exists():
        shutil.rmtree(ex)
    exemplos = {}
    for real, chave, pref in ((False, "falso_tipo", "falso"), (True, "tipo", "verdadeiro")):
        grupos = defaultdict(list)
        for x in sorted(linhas, key=lambda x: -x["conf"]):
            if x["real"] == real:
                grupos[x[chave] or "sem_tipo"].append(x)
        for tipo, xs in grupos.items():
            pasta = ex / f"{pref}_{tipo}"
            pasta.mkdir(parents=True, exist_ok=True)
            for x in xs[:3]:
                shutil.copyfile(zdir / x["recorte"], pasta / f"{x['id']}_conf{x['conf']:.2f}.jpg")
            exemplos[f"{pref}_{tipo}"] = str(pasta.relative_to(ROOT))

    res = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "deteccoes": len(dets), "rotuladas": len(linhas), "sem_rotulo": sem,
           "verdadeiros": n_r, "falsos": len(linhas) - n_r,
           "por_fonte": {f: {"n": sum(x["fonte"] == f for x in linhas), "verdadeiros": sum(x["real"] for x in linhas if x["fonte"] == f)}
                         for f in sorted({x["fonte"] for x in linhas})},
           "por_prompt": {p: {"n": sum(x["prompt"] == p for x in linhas), "verdadeiros": sum(x["real"] for x in linhas if x["prompt"] == p)}
                          for p in sorted({x["prompt"] for x in linhas})},
           "faixas": faixas, "acumulado": acum,
           "sugestao": {"entra_direto_conf_min": t_auto, "fila_conf_min": t_fila,
                        "alvo_precisao": alvo_p, "alvo_recall": alvo_r, "min_n": min_n},
           "tipos_falso": conta("falso_tipo", False, TIPOS_FALSO), "tipos_verdadeiro": conta("tipo", True, TIPOS_VERDADEIRO),
           "incertos_fora_da_medicao": incertos, "exemplos": exemplos}
    (out / "medicao.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    md = [f"# Contentores — deteções da M3 contra os rótulos\n\n{res['gerado_em']} · {len(linhas)} de {len(dets)} deteções "
          f"rotuladas ({sem} sem rótulo) · **{n_r} verdadeiros, {len(linhas) - n_r} falsos**\n",
          f"Incertos fora da medição: **{incertos['n']}** ({incertos['pequenos_lt30px']} com < 30 px, "
          f"{incertos['conf_lt_0_1']} com confiança < 0,1, {incertos['outros']} sem nenhum dos dois motivos).\n",
          f"**Precisão atual** (todas as deteções da M3, sem limiar extra): **{fmt(n_r / len(linhas))}** "
          f"({n_r} de {len(linhas)}).\n",
          "| Fonte | n | verdadeiros | precisão |\n|---|---:|---:|---:|"]
    md += [f"| {f} | {v['n']} | {v['verdadeiros']} | {fmt(v['verdadeiros'] / v['n'] if v['n'] else None)} |" for f, v in res["por_fonte"].items()]
    md += ["", "| Prompt | n | verdadeiros |\n|---|---:|---:|"]
    md += [f"| {p} | {v['n']} | {v['verdadeiros']} |" for p, v in res["por_prompt"].items()]
    md += ["", "## Precisão por faixa de confiança\n", "| Faixa | n | verdadeiros | precisão |\n|---|---:|---:|---:|"]
    md += [f"| {f['faixa']} | {f['n']} | {f['verdadeiros']} | {fmt(f['precisao'])} |" for f in faixas]
    md += ["", "## Acumulado (conf ≥ t)\n", "| t | n | verdadeiros | precisão | recall |\n|---:|---:|---:|---:|---:|"]
    md += [f"| {a['limiar']} | {a['n']} | {a['verdadeiros']} | {fmt(a['precisao'])} | {fmt(a['recall'])} |" for a in acum]
    md += ["", "## Limiares sugeridos (por confirmar; a config não foi alterada)\n",
           f"- entra direto: conf ≥ **{t_auto if t_auto is not None else 'nenhum'}** (menor t com precisão ≥ {alvo_p:.0%} e ≥ {min_n} deteções)",
           f"- vai para a fila: conf ≥ **{t_fila if t_fila is not None else '—'}** (maior t que guarda ≥ {alvo_r:.0%} dos verdadeiros); abaixo: descartar",
           "", "## Falsos por tipo\n", "| Tipo | n |\n|---|---:|", *[f"| {k} | {v} |" for k, v in res["tipos_falso"].items()],
           "", "## Verdadeiros por tipo\n", "| Tipo | n |\n|---|---:|", *[f"| {k} | {v} |" for k, v in res["tipos_verdadeiro"].items()], "",
           "Exemplos (3 por tipo, maior confiança primeiro):", ""]
    md += [f"- {k}: `{v}`" for k, v in exemplos.items()]
    (out / "medicao.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
