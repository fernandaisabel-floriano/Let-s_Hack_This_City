#!/usr/bin/env python3
"""M4 ao nível do ELEMENTO (o que entra no catálogo e na M10), contra os rótulos manuais.

m4_medir.py mede cada recorte; aqui mede-se o subtipo final de cada elemento
fundido, depois do voto das vistas (m4_voto.py). Refaz o voto a partir de
catalogo/elementos.json + deteccoes/deteccoes.json, sem correr o CLIP nem a
fusão — compara as regras de voto em segundos.

Verdade de um elemento = rótulos manuais dos recortes que o compõem
(reports/m4/rotulos.json, casados por id ou IoU como em m4_medir.py):
  - elemento "específico": o rótulo mais frequente dos seus recortes de frente é
    stop / cedência / limite_NN (empate com "outro" → específico; ver verdade()).
    Certo se o subtipo final é essa família (limite: com o valor).
    Também conta como específico (e certo) se o subtipo final é específico e há
    recortes rotulados desse tipo no elemento, mesmo em minoria (STOP + vistas
    incertas da placa de baixo).
  - elemento "não específico": nenhum dos casos acima. Erro se o subtipo final
    for específico (stop, cedência ou limite com valor).

Uso:
    python pipeline/m4_elementos.py [--votos maioria,especifico] [--elementos outro/elementos.json]
Saída: reports/m4/elementos.json e elementos.md
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from m4_medir import casar  # noqa: E402
from m4_voto import votar_subtipo  # noqa: E402

ESPEC = {"stop": "stop", "cedencia": "cedencia_passagem", "limite_30": "limite_30",
         "limite_40": "limite_40", "limite_50": "limite_50", "limite_outro": "limite_outro"}


def verdade(rots: list[str]) -> set[str]:
    """Subtipo real do elemento = rótulo mais frequente entre os de frente (stop, cedência,
    limite, outro); empate → o específico. De costas e "não é sinal" não contam.
    (Placas empilhadas no mesmo poste: um recorte do STOP preso ao elemento da placa
    de baixo não faz desse elemento um STOP.)"""
    c = Counter(x for x in rots if x in ESPEC or x == "outro_frente")
    if not c:
        return set()
    top = max(c.values())
    return {ESPEC[x] for x, n in c.items() if n == top and x in ESPEC}


def certo(sub: str, alvos: set[str]) -> bool:
    if sub in alvos:
        return True
    return "limite_outro" in alvos and sub.startswith("limite_") and sub not in (
        "limite_desconhecido", "limite_30", "limite_40", "limite_50")


def especifico(sub: str) -> bool:
    return sub in ("stop", "cedencia_passagem") or (sub.startswith("limite_") and sub != "limite_desconhecido")


def medir(els: list[dict], por_id: dict, rot_por_det: dict, m4: dict) -> dict:
    linhas, r = [], Counter()
    for e in els:
        if e["tipo"] != "sinal":
            continue
        membros = [por_id[i] for i in e["deteccoes"] if i in por_id]
        rots = [rot_por_det[i] for i in e["deteccoes"] if i in rot_por_det]
        if not rots:
            continue
        sub, frac, incerto, motivo = votar_subtipo(membros, m4)
        alvos = verdade(rots)
        presentes = {ESPEC[x] for x in rots if x in ESPEC}
        # específico previsto e há recortes rotulados desse tipo no elemento: o sinal está lá (placa
        # empilhada no mesmo poste que outras placas incertas) — conta como certo, não como falso
        if not alvos and especifico(sub) and certo(sub, presentes):
            alvos = presentes
        if alvos:
            r["especificos"] += 1
            ok = certo(sub, alvos)
            res = ("certo_auto" if not incerto else "certo_fila") if ok else (
                "fila" if incerto else ("errado" if especifico(sub) else "perdido"))
        else:
            r["nao_especificos"] += 1
            res = ("falso_fila" if incerto else "falso_especifico") if especifico(sub) else "ok"
        r[res] += 1
        linhas.append({"id": e["id"], "rotulos": dict(Counter(rots)), "vistas": dict(Counter(
            m.get("subclasse") for m in membros)), "subtipo": sub, "incerto": incerto,
            "fracao": frac, "motivo": motivo, "resultado": res})
    return {"resumo": dict(r), "elementos": linhas}


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m4 = cfg.get("m4") or {}
    votos = sys.argv[sys.argv.index("--votos") + 1].split(",") if "--votos" in sys.argv else ["maioria", "especifico"]
    zdir = zone_dir(cfg)
    dets = [d for d in json.load(open(zdir / "deteccoes/deteccoes.json", encoding="utf-8")) if d["classe"] == "sinal"]
    por_id = {d["id"]: d for d in dets}
    rot = json.loads((ROOT / m4.get("rotulos", "reports/m4/rotulos.json")).read_text(encoding="utf-8"))["rotulos"]
    pares, falhas = casar(rot, dets)
    rot_por_det = {d["id"]: lab for d, lab in pares}
    ep = Path(sys.argv[sys.argv.index("--elementos") + 1]) if "--elementos" in sys.argv else zdir / "catalogo/elementos.json"
    els = json.load(open(ep, encoding="utf-8"))

    res = {v: medir(els, por_id, rot_por_det, {**m4, "voto": v}) for v in votos}
    out = ROOT / m4.get("relatorios", "reports/m4")
    meta = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "rotulos_casados": len(pares), "rotulos_sem_deteccao": falhas}
    (out / "elementos.json").write_text(json.dumps({**meta, "votos": res}, ensure_ascii=False, indent=1), encoding="utf-8")

    k = ["certo_auto", "certo_fila", "fila", "perdido", "errado"]
    md = (f"# M4 por elemento — subtipo final contra os rótulos\n\n{meta['gerado_em']} · {len(pares)} recortes rotulados "
          f"casados. Elemento \"específico\" = o rótulo mais frequente dos seus recortes de frente é STOP / cedência / limite.\n\n"
          "| Voto | específicos | certo (auto) | certo (fila) | fila sem tipo | perdido (outro, sem fila) | errado | "
          "falsos específicos sem fila |\n|---|---:|---:|---:|---:|---:|---:|---:|\n")
    for v, x in res.items():
        s = x["resumo"]
        md += f"| {v} | {s.get('especificos', 0)} | " + " | ".join(str(s.get(c, 0)) for c in k) + \
              f" | {s.get('falso_especifico', 0)} (+{s.get('falso_fila', 0)} na fila) de {s.get('nao_especificos', 0)} |\n"
    for v, x in res.items():
        md += f"\n## {v}\n\n| Elemento | Rótulos | Vistas (M4) | Subtipo | Resultado | Motivo |\n|---|---|---|---|---|---|\n"
        for ln in x["elementos"]:
            if ln["resultado"] == "ok":
                continue
            md += (f"| {ln['id']} | {ln['rotulos']} | {ln['vistas']} | {ln['subtipo']}{' (fila)' if ln['incerto'] else ''} "
                   f"| {ln['resultado']} | {ln['motivo'] or ''} |\n")
    (out / "elementos.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
