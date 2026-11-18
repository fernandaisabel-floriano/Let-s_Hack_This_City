#!/usr/bin/env python3
"""M4 — smoke test sobre TODOS os recortes de sinais, sem rótulos.

Corre as variantes (atual / p1 / p3 / p4 / p5) sobre os sinais de deteccoes.json
sem o alterar, e escreve em m4.relatorios (reports/m4/):

  smoke.json, smoke.md      por variante: contagem por subclasse, fila,
                            outro_sinal, limite_desconhecido, tempo, erros;
                            mais o que está hoje gravado em deteccoes.json ("no ficheiro")
  folha_contactos.html      até 10 recortes por subclasse prevista na variante
                            final, com a confiança e o motivo (abrir no browser)

Uso:
    python pipeline/m4_verificar.py [--variantes atual,p1,p3,p4,p5]
"""
from __future__ import annotations

import html
import json
import os
import sys
import time
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify_signs import DECIDE, VARIANTES, ClipSignClassifier, contextos, m4_cfg  # noqa: E402
from common import ROOT, lado_px, load_config, recorte_largo_janela, zone_dir  # noqa: E402


def contar(rs: list[dict]) -> dict:
    sub = Counter(r["subclasse"] for r in rs)
    return {"por_subclasse": dict(sub.most_common()), "fila": sum(bool(r["incerto"]) for r in rs),
            "outro_sinal": sub.get("outro_sinal", 0), "limite_desconhecido": sub.get("limite_desconhecido", 0),
            "stop": sub.get("stop", 0), "limite_120": sub.get("limite_120", 0)}


def main() -> None:
    cfg = load_config()
    m4 = m4_cfg(cfg)
    variantes = (sys.argv[sys.argv.index("--variantes") + 1].split(",") if "--variantes" in sys.argv else list(VARIANTES))
    out = ROOT / m4.get("relatorios", "reports/m4")
    out.mkdir(parents=True, exist_ok=True)
    zdir = zone_dir(cfg)
    sinais = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json", encoding="utf-8")) if d["classe"] == "sinal"]
    sinais.sort(key=lambda d: (d["extra"]["imagem"], d["id"]))
    print(f"{len(sinais)} recortes de sinais")
    no_ficheiro = Counter(d.get("subclasse") or "(nenhuma)" for d in sinais)

    erros = []
    t0 = time.time()
    clip = ClipSignClassifier()
    t_clip_load = time.time() - t0
    t0 = time.time()
    try:
        ctx = contextos(sinais, zdir, m4, clip, variantes=variantes)
    except Exception:  # noqa: BLE001 — encontrar o recorte culpado
        erros.append({"fase": "contextos (lote)", "erro": traceback.format_exc(limit=3)})
        ctx = []
        for d in sinais:
            try:
                ctx.append(contextos([d], zdir, m4, clip, variantes=variantes)[0])
            except Exception as e:  # noqa: BLE001
                erros.append({"fase": "contextos", "id": d["id"], "erro": repr(e)})
                ctx.append(None)
    t_ctx = time.time() - t0

    res, preds = {}, {}
    for v in variantes:
        t = time.time()
        rs = []
        for d, c in zip(sinais, ctx):
            if c is None:
                rs.append({"subclasse": "ERRO", "incerto": True, "conf": 0, "motivo": "contexto falhou", "desc": ""})
                continue
            try:
                rs.append(DECIDE[v](c, m4))
            except Exception as e:  # noqa: BLE001
                erros.append({"fase": v, "id": d["id"], "erro": repr(e)})
                rs.append({"subclasse": "ERRO", "incerto": True, "conf": 0, "motivo": repr(e), "desc": ""})
        preds[v] = rs
        res[v] = {**contar(rs), "segundos_decisao": round(time.time() - t, 3)}

    final = variantes[-1]
    resumo = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "recortes": len(sinais),
              "segundos_carregar_clip": round(t_clip_load, 1),
              "segundos_contexto": round(t_ctx, 1), "segundos_por_recorte": round(t_ctx / max(1, len(sinais)), 3),
              "no_ficheiro": {"por_subclasse": dict(no_ficheiro.most_common()), "stop": no_ficheiro.get("stop", 0),
                              "limite_120": no_ficheiro.get("limite_120", 0),
                              "classificador": dict(Counter(d["extra"].get("classificador") for d in sinais))},
              "variantes": res, "erros": erros,
              "valores_de_limite_previstos": {v: sorted({r["subclasse"] for r in preds[v] if r["subclasse"].startswith("limite_")})
                                              for v in variantes}}
    (out / "smoke.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")

    subs = sorted({s for v in variantes for s in res[v]["por_subclasse"]} | set(no_ficheiro))
    md = [f"# M4 — smoke test (sem rótulos)\n\n{resumo['gerado_em']} · {len(sinais)} recortes · contexto (recortes + CLIP + "
          f"forma + algarismos) {t_ctx:.0f} s ({resumo['segundos_por_recorte']} s/recorte) · {len(erros)} erros\n",
          "| subclasse | no ficheiro | " + " | ".join(variantes) + " |", "|---|---:|" + "---:|" * len(variantes)]
    md += [f"| {s} | {no_ficheiro.get(s, '')} | " + " | ".join(str(res[v]['por_subclasse'].get(s, '')) for v in variantes) + " |"
           for s in subs]
    md += [f"| **para a fila** | | " + " | ".join(str(res[v]["fila"]) for v in variantes) + " |"]
    (out / "smoke.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    if erros:
        print("\nERROS:", json.dumps(erros[:5], ensure_ascii=False, indent=1))

    # folha de contactos da variante final
    grupos = defaultdict(list)
    for d, c, r in zip(sinais, ctx, preds[final]):
        grupos[r["subclasse"] + (" (fila)" if r["incerto"] else "")].append((d, c, r))
    blocos = []
    for g in sorted(grupos, key=lambda g: -len(grupos[g])):
        itens = sorted(grupos[g], key=lambda t: -t[2]["conf"])[:10]
        cart = []
        for d, c, r in itens:
            e = d["extra"]
            wx0, wy0, wx1, wy1 = recorte_largo_janela(d["bbox"], e["width"], e["height"])
            x1, y1, x2, y2 = d["bbox"]
            cw, ch = wx1 - wx0, wy1 - wy0
            box = (f"left:{100 * (x1 - wx0) / cw:.1f}%;top:{100 * (y1 - wy0) / ch:.1f}%;"
                   f"width:{100 * (x2 - x1) / cw:.1f}%;height:{100 * (y2 - y1) / ch:.1f}%")
            src = html.escape(os.path.relpath(zdir / d["recorte"], out))
            forma = (c or {}).get("forma", {}).get("forma", "")
            cart.append(f'<figure><div class="m"><img src="{src}" loading="lazy" alt=""><div class="b" style="{box}"></div></div>'
                        f'<figcaption><b>{r["conf"]:.2f}</b> · {lado_px(d["bbox"]):.0f} px · {html.escape(e.get("prompt") or "")}'
                        f'<br>forma: {html.escape(forma)}<br>{html.escape(r.get("motivo") or r.get("desc") or "")}'
                        f'<br><span class="id">{html.escape(d["id"])}</span></figcaption></figure>')
        blocos.append(f'<section><h2>{html.escape(g)} <span class="n">{len(grupos[g])}</span></h2><div class="g">{"".join(cart)}</div></section>')
    pagina = f"""<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Folha de contactos M4</title><style>
:root{{--bg:#f6f6f4;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#d9d9d4;--acc:#c62828}}
@media (prefers-color-scheme: dark){{:root{{--bg:#1b1b1a;--fg:#ecece8;--muted:#a3a39c;--card:#262624;--line:#3a3a37;--acc:#ef5350}}}}
body{{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg)}}
h1{{font-size:18px}} h2{{font-size:16px;margin:24px 0 8px}} .n{{color:var(--muted);font-weight:400}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px}}
.m{{position:relative;line-height:0}} .m img{{width:100%;height:auto;image-rendering:pixelated}}
.b{{position:absolute;border:2px solid var(--acc)}} figcaption{{font-size:12px;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}}
figcaption b{{color:var(--fg)}} .id{{font-size:11px}}
</style></head><body><h1>Folha de contactos — M4, variante {final}</h1>
<p class="n">{len(sinais)} recortes · até 10 por subclasse prevista, maior confiança primeiro · "(fila)" = incerto, vai para o técnico.</p>
{"".join(blocos)}</body></html>"""
    (out / "folha_contactos.html").write_text(pagina, encoding="utf-8")
    print(f"\n→ {(out / 'smoke.md').relative_to(ROOT)}, {(out / 'folha_contactos.html').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
