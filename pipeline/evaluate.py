#!/usr/bin/env python3
"""M10 — Precisão, recall e tempo de validação, a partir da validação na app e da contagem manual.

Entradas (pasta da zona):
  catalogo/elementos.json            o que o sistema propôs (só os de dentro do polígono de avaliação)
  catalogo/registo_validacoes.jsonl  decisões dos técnicos na app (M8): o estado atual de cada
                                     elemento é a última decisão depois do último "limpar"
  contagem.json                      contagem manual, por tipo, dos elementos reais únicos da zona
  referencia.csv                     (opcional) pontos marcados à mão: só para o erro de posição

Rótulos (uma decisão por elemento proposto):
  real        estado validado, ou corrigido sem mudar de classe (subtipo/posição corrigidos)
  falso       estado rejeitado sem duplicado_de
  duplicado   estado rejeitado com duplicado_de = <id> (é um objeto real que já está noutro elemento)
  tipo_errado estado corrigido com outra classe: falso para a classe proposta, real para a nova

Métricas:
  precisão (por classe proposta, antes da validação) = reais / decididos
  precisão_objeto = (reais + duplicados) / decididos   — a deteção é um objeto real, mesmo repetido
  recall (por classe final) = elementos reais ÚNICOS / contagem
      únicos: elementos reais ligados por duplicado_de ou por "é o mesmo" (pares) contam uma vez
  subtipo dos sinais (M4): stop / cedencia / limite / outro — recall por subtipo e % de subtipos
      que o técnico não teve de corrigir
  tempo: soma do tempo_s de todas as decisões (tempo ativo) e duração de relógio (1.ª → última
      decisão), total e por técnico

Uso:
    python pipeline/evaluate.py
    python pipeline/evaluate.py --contagem X.json --registo Y.jsonl --elementos Z.json --saida W.json
    python pipeline/evaluate.py --referencia R.csv --so-posicao --saida catalogo/metrica_osm.json
        (modo antigo: só correspondência por pontos, ex.: contra o OSM)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, zone_dir  # noqa: E402
from estado import depois_do_ultimo_limpar, estado_atual, ler_registo, ma_qualidade, pares_mesmo  # noqa: E402
from zona import zone_contains  # noqa: E402

CLASSES = ("sinal", "candeeiro", "contentor")
SUBTIPOS_SINAL = ("stop", "cedencia", "limite", "outro")
# pares reais da mesma classe mais próximos do que isto → aviso "confirmar que não são o mesmo"
# (não se aplica a sinais: vários sinais no mesmo poste estão a < 1 m e são objetos diferentes)
DIST_AVISO_DUPLICADO_M = 3.0

CONTAGEM_MODELO = {
    "_como_contar": [
        "Contar à mão os elementos REAIS e ÚNICOS dentro da zona de avaliação "
        "(config/ruas/santos-martires-v3-zona.geojson), vendo o vídeo e as fotografias Mapillary "
        "do Cais e da rotunda (reports/referencia_apoio/).",
        "Um número inteiro por campo. null = ainda não contado (o recall dessa classe fica vazio).",
        "sinal: cada placa conta uma vez, mesmo que estejam várias no mesmo poste. As placas de "
        "nome de rua e os painéis publicitários não contam.",
        "  stop = STOP; cedencia = cedência de passagem (triângulo invertido); "
        "limite = limite de velocidade (qualquer valor); outro = todos os outros sinais de trânsito.",
        "candeeiro: cada poste de iluminação conta uma vez (um poste com dois braços = 1).",
        "contentor: cada contentor conta uma vez (uma ilha de 3 contentores = 3). Papeleiras "
        "(caixotes pequenos presos a postes) NÃO contam.",
        "Contar só o que se vê nas imagens. Se souberem de um elemento que nenhuma imagem mostra, "
        "ponham-no em nao_visiveis (não entra no recall, mas fica registado).",
    ],
    "contado_por": None,
    "contado_em": None,
    "candeeiro": None,
    "sinal": {"stop": None, "cedencia": None, "limite": None, "outro": None},
    "contentor": None,
    "nao_visiveis": {"candeeiro": 0, "sinal": 0, "contentor": 0},
}


def dist_m(lon1, lat1, lon2, lat2) -> float:
    kx = 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111320.0)


def ratio(a: int, b: int) -> float | None:
    return round(a / b, 3) if b else None


def grupo_sinal(subtipo: str | None) -> str:
    s = (subtipo or "").lower()
    if s == "stop":
        return "stop"
    if s.startswith("cedencia"):
        return "cedencia"
    if s.startswith("limite"):
        return "limite"
    return "outro"


# ----------------------------------------------------------------- rótulos

def rotular(e: dict, v: dict | None) -> dict:
    """Rótulo de um elemento proposto a partir da última decisão."""
    r = {"id": e["id"], "classe_proposta": e["tipo"], "subtipo_proposto": e.get("subtipo"),
         "lon": e["lon"], "lat": e["lat"], "n_vistas": e.get("n_vistas", 0),
         "metodo_posicao": e.get("metodo_posicao"), "rotulo": "por_validar",
         "classe_final": e["tipo"], "subtipo_final": e.get("subtipo"), "duplicado_de": None}
    if not v:
        return r
    if "subtipo_corrigido" in v:
        r["subtipo_final"] = v["subtipo_corrigido"]
    if v["estado"] == "rejeitado":
        r["rotulo"] = "duplicado" if v.get("duplicado_de") else "falso"
        r["duplicado_de"] = v.get("duplicado_de")
    elif v["estado"] == "corrigido" and v.get("classe_corrigida") and v["classe_corrigida"] != e["tipo"]:
        r["rotulo"] = "tipo_errado"
        r["classe_final"] = v["classe_corrigida"]
    else:
        r["rotulo"] = "real"
    return r


def grupos_reais(rot: dict[str, dict], pares: list[tuple[str, str]]) -> list[list[dict]]:
    """Objetos reais únicos: união por duplicado_de e por pares "é o mesmo"; um grupo conta
    se tiver pelo menos um elemento real (ou de tipo corrigido)."""
    pai = {i: i for i in rot}

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x

    def unir(a, b):
        if a in pai and b in pai:
            pai[raiz(a)] = raiz(b)

    for r in rot.values():
        if r["duplicado_de"]:
            unir(r["id"], r["duplicado_de"])
    for a, b in pares:
        unir(a, b)
    g: dict[str, list[dict]] = defaultdict(list)
    for r in rot.values():
        g[raiz(r["id"])].append(r)
    return [m for m in g.values() if any(x["rotulo"] in ("real", "tipo_errado") for x in m)]


# ----------------------------------------------------------------- tempo

def tempos(reg: list[dict], ids_zona: set[str]) -> dict:
    dec = [e for e in reg if e["acao"] == "decisao" and e.get("validacao")]
    if not dec:
        return {"decisoes": 0}

    def resumo(evs: list[dict]) -> dict:
        ts = [e["validacao"].get("tempo_s") or 0 for e in evs]
        elementos = {e["validacao"]["id"] for e in evs}
        quando = sorted(e["quando"] for e in evs)
        rel = (datetime.fromisoformat(quando[-1].replace("Z", "+00:00"))
               - datetime.fromisoformat(quando[0].replace("Z", "+00:00"))).total_seconds()
        ativo = round(sum(ts), 1)
        return {"decisoes": len(evs), "elementos": len(elementos),
                "elementos_na_zona": len(elementos & ids_zona),
                "tempo_ativo_s": ativo, "s_por_elemento": round(ativo / len(elementos), 1) if elementos else None,
                "relogio_s": round(rel), "inicio": quando[0], "fim": quando[-1],
                "decisoes_sem_tempo": sum(1 for t in ts if not t)}

    por_tec: dict[str, list[dict]] = defaultdict(list)
    for e in dec:
        por_tec[e["tecnico"].get("nome") or e["tecnico"].get("utilizador", "?")].append(e)
    return {**resumo(dec), "por_tecnico": {k: resumo(v) for k, v in sorted(por_tec.items())}}


# ----------------------------------------------------------------- erro de posição (opcional)

def load_reference(path: Path, inside) -> tuple[list[dict], Counter]:
    refs, ignored = [], Counter()
    if not path.exists():
        return refs, ignored
    for r in csv.DictReader(open(path, encoding="utf-8")):
        tipo = (r.get("tipo") or "").strip().lower()
        sub = (r.get("subtipo") or "").strip().lower()
        if not r.get("lat") or not r.get("lon"):
            ignored["sem_coordenadas"] += 1
            continue
        if tipo not in CLASSES:
            ignored[f"tipo_desconhecido:{tipo or '(vazio)'}"] += 1
            continue
        if sub == "papeleira":
            ignored["papeleira"] += 1
            continue
        lat, lon = float(r["lat"]), float(r["lon"])
        if not inside(lon, lat):
            ignored["fora_da_zona"] += 1
            continue
        refs.append({**r, "tipo": tipo, "lat": lat, "lon": lon})
    return refs, ignored


def match(els: list[dict], refs: list[dict], dmax: float) -> dict:
    """Correspondência um a um gulosa pelos pares mais próximos, por classe."""
    res = {"pares": [], "duplicados": [], "falsos": [], "em_falta": []}
    for c in CLASSES:
        E = [e for e in els if e["tipo"] == c]
        R = [r for r in refs if r["tipo"] == c]
        pairs = sorted((dist_m(e["lon"], e["lat"], r["lon"], r["lat"]), i, j)
                       for i, e in enumerate(E) for j, r in enumerate(R))
        used_e, used_r = set(), set()
        for d, i, j in pairs:
            if d > dmax:
                break
            if i in used_e or j in used_r:
                continue
            used_e.add(i)
            used_r.add(j)
            res["pares"].append({"elemento": E[i], "referencia": R[j], "erro_m": d})
        for i, e in enumerate(E):
            if i in used_e:
                continue
            near = any(dist_m(e["lon"], e["lat"], R[j]["lon"], R[j]["lat"]) <= dmax for j in used_r)
            res["duplicados" if near else "falsos"].append(e)
        res["em_falta"] += [r for j, r in enumerate(R) if j not in used_r]
    return res


def dist_stats(errs: list[float]) -> dict | None:
    if not errs:
        return None
    a = np.array(errs)
    return {"n": len(a), "mediana": round(float(np.median(a)), 2), "media": round(float(a.mean()), 2),
            "p90": round(float(np.percentile(a, 90)), 2), "max": round(float(a.max()), 2),
            "histograma_m": {f"{lo}-{hi}": int(((a >= lo) & (a < hi)).sum())
                             for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 5), (5, 8), (8, 99))}}


def erro_posicao(reais: list[dict], refs: list[dict], dmax: float) -> dict:
    """Erro (m) entre a posição PROPOSTA pelo sistema e o ponto de referência mais próximo,
    só para os elementos reais com um ponto de referência a ≤ dmax."""
    els = [{"id": r["id"], "tipo": r["classe_final"], "lon": r["lon"], "lat": r["lat"],
            "metodo_posicao": r["metodo_posicao"]} for r in reais]
    res = match(els, refs, dmax)
    out = {c: dist_stats([p["erro_m"] for p in res["pares"] if p["elemento"]["tipo"] == c]) for c in CLASSES}
    out["todas"] = dist_stats([p["erro_m"] for p in res["pares"]])
    por_m: dict[str, list[float]] = defaultdict(list)
    for p in res["pares"]:
        por_m[p["elemento"]["metodo_posicao"] or "?"].append(p["erro_m"])
    out["por_metodo_posicao"] = {m: dist_stats(v) for m, v in sorted(por_m.items())}
    out["pontos_referencia"] = len(refs)
    out["pontos_sem_par"] = len(res["em_falta"])
    out["dist_max_m"] = dmax
    return out


# ----------------------------------------------------------------- contagem

def ler_contagem(path: Path) -> dict | None:
    if not path.exists():
        path.write_text(json.dumps(CONTAGEM_MODELO, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"criado {path.relative_to(ROOT)} — preencham os números (null = por contar)")
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def contagem_de(cont: dict | None, classe: str, sub: str | None = None) -> int | None:
    if not cont:
        return None
    v = cont.get(classe)
    if sub:
        return v.get(sub) if isinstance(v, dict) else None
    if isinstance(v, dict):
        vs = [v.get(s) for s in SUBTIPOS_SINAL]
        return None if any(x is None for x in vs) else int(sum(vs))
    return v


# ----------------------------------------------------------------- principal

def avaliar(els: list[dict], reg_todo: list[dict], cont: dict | None, refs: list[dict], dmax: float) -> dict:
    reg = depois_do_ultimo_limpar(reg_todo)
    atual = estado_atual(reg)
    ids = {e["id"] for e in els}
    # rejeitados automaticamente por má qualidade (só vistas fracas) e que nenhum técnico reviu: o sistema
    # não os propôs para o catálogo, por isso não contam na precisão (contam-se à parte)
    fracos = {e["id"] for e in els if ma_qualidade(e) and e["id"] not in atual}
    rot = {e["id"]: rotular(e, atual.get(e["id"])) for e in els if e["id"] not in fracos}
    avisos: list[str] = []

    orfas = sorted(set(atual) - ids)
    if orfas:
        avisos.append(f"{len(orfas)} validações de elementos que não estão no catálogo atual (ou estão fora "
                      f"da zona): o pipeline foi corrido outra vez depois de validar? ex.: {orfas[:5]}")
    for r in rot.values():
        d = r["duplicado_de"]
        if d and d not in rot:
            avisos.append(f"{r['id']} é duplicado de {d}, que não está no catálogo da zona")

    grupos = grupos_reais(rot, pares_mesmo(reg))

    def classe_grupo(g: list[dict]) -> dict:
        reais = [x for x in g if x["rotulo"] in ("real", "tipo_errado")]
        return max(reais, key=lambda x: (x["rotulo"] == "real", x["n_vistas"]))

    reps = [classe_grupo(g) for g in grupos]

    out: dict = {}
    for c in ("todas",) + CLASSES:
        sel = [r for r in rot.values() if c == "todas" or r["classe_proposta"] == c]
        n = Counter(r["rotulo"] for r in sel)
        decididos = len(sel) - n["por_validar"]
        unicos = [r for r in reps if c == "todas" or r["classe_final"] == c]
        if c == "todas":
            por_classe = [contagem_de(cont, k) for k in CLASSES]
            cont_c = None if any(x is None for x in por_classe) else sum(por_classe)
        else:
            cont_c = contagem_de(cont, c)
        out[c] = {
            "propostos": len(sel), "decididos": decididos, "por_validar": n["por_validar"],
            "reais": n["real"], "falsos": n["falso"], "duplicados": n["duplicado"], "tipo_errado": n["tipo_errado"],
            "precisao": ratio(n["real"], decididos),
            "precisao_objeto": ratio(n["real"] + n["duplicado"], decididos),
            "reais_unicos": len(unicos), "contagem": cont_c,
            "recall": ratio(len(unicos), cont_c) if cont_c else None,
        }
        if cont_c is not None and len(unicos) > cont_c:
            avisos.append(f"{c}: {len(unicos)} reais únicos > contagem {cont_c} — falta marcar duplicados "
                          f"ou a contagem está curta")

    # sinais por subtipo (M4)
    sinais = [r for r in reps if r["classe_final"] == "sinal"]
    sub_out = {}
    for s in SUBTIPOS_SINAL:
        u = sum(1 for r in sinais if grupo_sinal(r["subtipo_final"]) == s)
        k = contagem_de(cont, "sinal", s)
        sub_out[s] = {"reais_unicos": u, "contagem": k, "recall": ratio(u, k) if k else None}
    sinais_reais = [r for r in rot.values() if r["rotulo"] == "real" and r["classe_proposta"] == "sinal"]
    certos = sum(1 for r in sinais_reais if grupo_sinal(r["subtipo_proposto"]) == grupo_sinal(r["subtipo_final"]))
    out["sinal_subtipo"] = {**sub_out, "subtipo_certo": certos, "sinais_reais": len(sinais_reais),
                            "precisao_subtipo": ratio(certos, len(sinais_reais))}

    # pares reais muito próximos: talvez duplicados por marcar
    proximos = []
    for i, a in enumerate(reps):
        for b in reps[i + 1:]:
            if a["classe_final"] == b["classe_final"] != "sinal":
                d = dist_m(a["lon"], a["lat"], b["lon"], b["lat"])
                if d < DIST_AVISO_DUPLICADO_M:
                    proximos.append({"a": a["id"], "b": b["id"], "classe": a["classe_final"], "dist_m": round(d, 2)})
    if proximos:
        avisos.append(f"{len(proximos)} pares de elementos reais a < {DIST_AVISO_DUPLICADO_M:g} m: confirmar "
                      f"que não são o mesmo objeto (ver detalhe.reais_proximos)")

    out["rejeitados_ma_qualidade"] = len(fracos)
    out["tempo"] = tempos(reg, ids)
    if refs:
        out["erro_posicao_m"] = erro_posicao([r for r in rot.values() if r["rotulo"] in ("real", "tipo_errado")],
                                             refs, dmax)
    if out["todas"]["por_validar"]:
        avisos.insert(0, f"faltam validar {out['todas']['por_validar']} de {out['todas']['propostos']} elementos: "
                         f"a precisão e o recall ainda são parciais")
    if cont is None or out["todas"]["contagem"] is None:
        avisos.append("contagem.json por preencher: sem recall")

    out["avisos"] = avisos
    out["detalhe"] = {
        "falsos": sorted(r["id"] for r in rot.values() if r["rotulo"] == "falso"),
        "duplicados": {r["id"]: r["duplicado_de"] for r in rot.values() if r["rotulo"] == "duplicado"},
        "tipo_errado": {r["id"]: f"{r['classe_proposta']}→{r['classe_final']}"
                        for r in rot.values() if r["rotulo"] == "tipo_errado"},
        "por_validar": sorted(r["id"] for r in rot.values() if r["rotulo"] == "por_validar"),
        "reais_proximos": proximos,
    }
    return out


def imprimir(s: dict) -> None:
    print(f"{'classe':10s} {'prop.':>5s} {'decid.':>6s} {'reais':>5s} {'falsos':>6s} {'dupl.':>5s} {'tipo≠':>5s} "
          f"{'precisão':>8s} {'únicos':>6s} {'contagem':>8s} {'recall':>6s}")
    for g in ("todas",) + CLASSES:
        r = s[g]
        print(f"{g:10s} {r['propostos']:5d} {r['decididos']:6d} {r['reais']:5d} {r['falsos']:6d} {r['duplicados']:5d} "
              f"{r['tipo_errado']:5d} {str(r['precisao']):>8s} {r['reais_unicos']:6d} {str(r['contagem']):>8s} "
              f"{str(r['recall']):>6s}")
    ss = s["sinal_subtipo"]
    print("\nsinais por subtipo: " + ", ".join(
        f"{k} {ss[k]['reais_unicos']}/{ss[k]['contagem']}" for k in SUBTIPOS_SINAL)
        + f" · subtipo certo {ss['subtipo_certo']}/{ss['sinais_reais']}")
    t = s["tempo"]
    if t.get("decisoes"):
        print(f"\ntempo: {t['elementos']} elementos em {t['tempo_ativo_s']:.0f} s ativos "
              f"({t['s_por_elemento']} s/elemento), {t['relogio_s'] / 60:.1f} min de relógio")
        for k, v in t["por_tecnico"].items():
            print(f"  {k}: {v['elementos']} elementos, {v['tempo_ativo_s']:.0f} s, {v['s_por_elemento']} s/elemento")
    ep = s.get("erro_posicao_m")
    if ep and ep.get("todas"):
        print(f"\nerro de posição: mediana {ep['todas']['mediana']} m, p90 {ep['todas']['p90']} m "
              f"(n={ep['todas']['n']} de {ep['pontos_referencia']} pontos)")
    for a in s["avisos"]:
        print(f"! {a}")


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    m10 = {"dist_max_m": 8.0, **(cfg.get("m10") or {})}
    zdir = zone_dir(cfg)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--elementos", type=Path, default=zdir / "catalogo/elementos.json")
    ap.add_argument("--registo", type=Path, default=zdir / "catalogo/registo_validacoes.jsonl")
    ap.add_argument("--contagem", type=Path, default=ROOT / m10.get("contagem", zdir / "contagem.json"))
    ap.add_argument("--referencia", type=Path, default=ROOT / m10.get("referencia", zdir / "referencia.csv"))
    ap.add_argument("--saida", type=Path, default=zdir / "catalogo/metrica.json")
    ap.add_argument("--so-posicao", action="store_true",
                    help="modo antigo: só correspondência por pontos contra --referencia")
    args = ap.parse_args()

    inside = zone_contains(cfg)
    dmax = float(m10["dist_max_m"])
    els = [e for e in json.load(open(args.elementos)) if inside(e["lon"], e["lat"])]
    refs, ign = load_reference(args.referencia, inside)

    if args.so_posicao:
        if not refs:
            sys.exit(f"referência sem linhas utilizáveis em {args.referencia} (ignoradas: {dict(ign)})")
        res = match([e for e in els if e.get("estado") != "rejeitado"], refs, dmax)
        s = {"tipo": "posicao", "pares": len(res["pares"]), "falsos": len(res["falsos"]),
             "em_falta": len(res["em_falta"]), "erro_posicao_m": dist_stats([p["erro_m"] for p in res["pares"]])}
    else:
        cont = ler_contagem(args.contagem)
        s = {"tipo": "validacao", **avaliar(els, ler_registo(args.registo), cont, refs, dmax)}
        if cont:
            s["contagem_info"] = {k: cont.get(k) for k in ("contado_por", "contado_em", "nao_visiveis")}
    s["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    s["regra"] = {"zona": cfg.get("zona_avaliacao_geojson"), "dist_max_m": dmax,
                  "referencias_ignoradas": dict(ign)}
    args.saida.parent.mkdir(parents=True, exist_ok=True)
    args.saida.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")

    if s["tipo"] == "validacao":
        imprimir(s)
    else:
        print(json.dumps({k: s[k] for k in ("pares", "falsos", "em_falta", "erro_posicao_m")}, ensure_ascii=False))
    print(f"→ {args.saida.relative_to(ROOT) if args.saida.resolve().is_relative_to(ROOT) else args.saida}")


if __name__ == "__main__":
    main()
