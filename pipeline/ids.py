#!/usr/bin/env python3
"""D1 — ids estáveis entre execuções do pipeline.

Quando o fuse.py volta a correr (importação nova, modelo novo, parâmetros novos), os
elementos são recalculados de raiz e numerados outra vez. Sem isto, as decisões dos
técnicos (registo_validacoes.jsonl, por id) ficavam a apontar para outros elementos
ou para nenhum.

Regra (um a um, mesma classe), por esta ordem:

  1. Deteções em comum: o elemento novo que partilha mais deteções com o antigo
     (Jaccard) é o mesmo objeto e herda o id, esteja onde estiver.
  2. As deteções do antigo ainda existem em deteccoes.json mas nenhum elemento novo
     as usa (ex.: o filtro CLIP rejeitou-as): o objeto deixou de ter provas e o id
     desaparece — NÃO passa a um vizinho. Medido a 19/11 com as 69 decisões reais:
     só pela posição, 8 decisões colavam-se a outro objeto (ex.: um "rejeitado"
     herdado por um contentor real ao lado).
  3. Só quando as deteções do antigo já não existem (detect.py voltou a correr e os
     ids das deteções mudaram): o elemento novo mais próximo até ao raio de fusão
     da classe (m6.raio_fusao_m). Com subtipos diferentes (dois sinais no mesmo
     poste) o par custa mais PENALIZACAO_SUBTIPO_M metros, para não os trocar.

Os elementos sem par recebem um número NOVO, nunca usado antes nesta zona: um id
que desapareceu não volta a ser dado a outro objeto (senão herdaria decisões que
não são dele). O registo fica em <zona>/catalogo/ids.json:

    {"ultimo": {"sin": 52, "can": 61, "con": 140},
     "execucoes": [{quando, herdados, novos, desaparecidos: [...]}]}
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

PENALIZACAO_SUBTIPO_M = 2.0
MAX_EXECUCOES = 50


def _dist(a: dict, b: dict) -> float:
    kx = 111320.0 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return math.hypot((a["lon"] - b["lon"]) * kx, (a["lat"] - b["lat"]) * 111320.0)


def _num(id_: str) -> tuple[str, int] | None:
    pre, _, n = id_.rpartition("_")
    return (pre, int(n)) if pre and n.isdigit() else None


def herdar_ids(novos: list[dict], antigos: list[dict], raio: dict[str, float],
               registo: dict | None = None, dets_atuais: set[str] | None = None) -> tuple[list[dict], dict]:
    """Devolve (novos com ids atribuídos, registo atualizado). Não altera as listas de entrada.

    dets_atuais: ids de TODAS as deteções do deteccoes.json atual (usadas ou não);
    None = desconhecido, e então só a regra 1 e a 3 se aplicam."""
    registo = {"ultimo": {}, "execucoes": [], **(registo or {})}
    ultimo = dict(registo["ultimo"])
    for e in antigos:
        k = _num(e["id"])
        if k:
            ultimo[k[0]] = max(ultimo.get(k[0], 0), k[1])

    ids: dict[int, str] = {}
    usados_a: set[int] = set()
    herdados = []

    def atribuir(pares, regra):
        for *_, d, i, j in sorted(pares):
            if i in ids or j in usados_a:
                continue
            ids[i] = antigos[j]["id"]
            usados_a.add(j)
            herdados.append({"id": antigos[j]["id"], "dist_m": round(d, 2), "regra": regra})

    # 1. deteções em comum
    dn = [set(n.get("deteccoes") or ()) for n in novos]
    da = [set(a.get("deteccoes") or ()) for a in antigos]
    pares = []
    for i, n in enumerate(novos):
        for j, a in enumerate(antigos):
            if a["tipo"] == n["tipo"] and dn[i] & da[j]:
                jac = len(dn[i] & da[j]) / len(dn[i] | da[j])
                pares.append((-jac, _dist(n, a), i, j))
    atribuir(pares, "deteccoes")

    # 2. antigos cujas deteções ainda existem mas ficaram sem elemento: desaparecem
    sem_provas = {j for j in range(len(antigos)) if j not in usados_a and dets_atuais is not None
                  and da[j] and da[j] & dets_atuais}

    # 3. pela posição, só para os antigos cujas deteções já não existem
    pares = []
    for i, n in enumerate(novos):
        if i in ids:
            continue
        r = float(raio.get(n["tipo"], 8.0))
        for j, a in enumerate(antigos):
            if j in usados_a or j in sem_provas or a["tipo"] != n["tipo"]:
                continue
            d = _dist(n, a)
            if d > r:
                continue
            custo = d + (PENALIZACAO_SUBTIPO_M if (n.get("subtipo") or None) != (a.get("subtipo") or None) else 0.0)
            pares.append((custo, d, i, j))
    atribuir(pares, "posicao")

    out, criados = [], []
    novo_id: dict[int, str] = {}
    for i, n in enumerate(novos):
        x = dict(n)
        if i in ids:
            x["id"] = ids[i]
        else:
            pre = n["tipo"][:3]
            ultimo[pre] = ultimo.get(pre, 0) + 1
            x["id"] = f"{pre}_{ultimo[pre]:04d}"
            criados.append(x["id"])
        novo_id[i] = x["id"]
        out.append(x)

    desaparecidos = sorted(a["id"] for j, a in enumerate(antigos) if j not in usados_a)
    # desaparecidos cujas deteções foram para outro elemento: juntados a ele (o objeto continua no catálogo)
    fundidos = {}
    for j, a in enumerate(antigos):
        if j in usados_a or not da[j]:
            continue
        alvo = max(((len(da[j] & dn[i]), novo_id[i]) for i in range(len(novos)) if da[j] & dn[i]), default=None)
        if alvo:
            fundidos[a["id"]] = alvo[1]
    execucao = {
        "quando": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "antes": len(antigos), "depois": len(novos),
        "herdados": len(herdados), "por_regra": {r: sum(h["regra"] == r for h in herdados) for r in ("deteccoes", "posicao")},
        "novos": criados, "desaparecidos": desaparecidos, "fundidos_em": fundidos,
        "deslocamento_mediano_m": (sorted(h["dist_m"] for h in herdados)[len(herdados) // 2] if herdados else None),
    }
    registo["ultimo"] = ultimo
    registo["execucoes"] = (registo["execucoes"] + [execucao])[-MAX_EXECUCOES:]
    return out, registo


def ler_registo_ids(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def relatorio(execucao: dict, decididos: set[str]) -> list[str]:
    """Linhas para o terminal; avisa quando desaparece um elemento com decisão de um técnico."""
    pr = execucao.get("por_regra") or {}
    linhas = [f"ids: {execucao['herdados']} herdados ({pr.get('deteccoes', 0)} por deteções em comum, "
              f"{pr.get('posicao', 0)} pela posição), {len(execucao['novos'])} novos, "
              f"{len(execucao['desaparecidos'])} desaparecidos"
              + (f" (deslocamento mediano {execucao['deslocamento_mediano_m']} m)"
                 if execucao["deslocamento_mediano_m"] is not None else "")]
    fund = execucao.get("fundidos_em") or {}
    juntos = [f"{i}→{fund[i]}" for i in execucao["desaparecidos"] if i in decididos and i in fund]
    perdidos = [i for i in execucao["desaparecidos"] if i in decididos and i not in fund]
    if juntos:
        linhas.append(f"  {len(juntos)} elementos com decisão de um técnico foram juntados a outro (o objeto continua): "
                      f"{juntos[:10]}{' …' if len(juntos) > 10 else ''}")
    if perdidos:
        linhas.append(f"  AVISO: {len(perdidos)} elementos com decisão de um técnico deixaram de ser detetados: "
                      f"{perdidos[:10]}{' …' if len(perdidos) > 10 else ''} (as decisões ficam no registo)")
    return linhas
