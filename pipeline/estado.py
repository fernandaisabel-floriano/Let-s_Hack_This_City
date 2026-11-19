#!/usr/bin/env python3
"""Estado de cada elemento (decisão 3, opção B) e limiares de entrada automática.

O pipeline grava só a confiança. O estado calcula-se na leitura, igual na app
(frontend/src/lib/estado.ts) e aqui (export.py, evaluate.py):

    1. decisão de um técnico (validado / corrigido / rejeitado)   — nunca muda com o limiar
    2. ticket aberto depois da última decisão                     → pendente (em revisão)
    3. tipo ativo, subtipo certo, pontuação ≥ limiar e vistas ≥ mínimo → auto
    4. senão                                                       → pendente

Limiares: config/limiares.json, um só ficheiro para todas as zonas e tipos.

    {"padrao": {<tipo>: {ativo, base, limiar, min_vistas}},   valores por omissão
     "zonas":  {<zona>: {<tipo>: {...só o que muda...}}},
     "historico": [{quando, tecnico, zona, tipo, antes, depois}]}

base = qual pontuação se compara com o limiar:
    calibrada  confianca (P(real) calibrada, confianca.py) — candeeiros e sinais
    clip       confianca_clip (2.ª opinião do CLIP, contentores_clip.py) — contentores
    detetor    confianca_max_vista (confiança bruta do detetor na melhor imagem)

Os valores por omissão saem de m8 (limiar_auto, min_vistas) para os tipos calibrados;
os contentores ficam desligados (decidido a 18/11: nenhum contentor entra direto).

Uso:
    python pipeline/estado.py            mostra os limiares efetivos da zona do config
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config  # noqa: E402

TIPOS = ("sinal", "candeeiro", "contentor")
BASES = ("calibrada", "clip", "detetor")
LIMIARES_PATH = ROOT / "config/limiares.json"


# ------------------------------------------------------------------ limiares

def padrao(cfg: dict | None = None) -> dict:
    m8 = (cfg or load_config(ROOT / "config/municipio.yaml")).get("m8") or {}
    lim, vis = float(m8.get("limiar_auto", 0.9)), int(m8.get("min_vistas", 2))
    return {
        "sinal": {"ativo": True, "base": "calibrada", "limiar": lim, "min_vistas": vis},
        "candeeiro": {"ativo": True, "base": "calibrada", "limiar": lim, "min_vistas": vis},
        # 18/11: CLIP ≥ 0,8 dá precisão 0,93 (validação cruzada, por deteção) — desligado por omissão
        "contentor": {"ativo": False, "base": "clip", "limiar": 0.8, "min_vistas": vis},
    }


def ler_limiares(path: Path = LIMIARES_PATH, cfg: dict | None = None) -> dict:
    """O ficheiro, ou um vazio com os valores por omissão (não o cria)."""
    if path.exists():
        d = json.loads(path.read_text(encoding="utf-8"))
        d.setdefault("padrao", padrao(cfg))
        d.setdefault("zonas", {})
        d.setdefault("historico", [])
        return d
    return {"padrao": padrao(cfg), "zonas": {}, "historico": []}


def limiares_zona(lim: dict, zona: str) -> dict[str, dict]:
    """padrão + o que a zona muda, por tipo."""
    z = lim.get("zonas", {}).get(zona, {})
    return {t: {**lim["padrao"].get(t, {}), **z.get(t, {})} for t in TIPOS}


# ------------------------------------------------------------------ estado

def pontuacao(e: dict, p: dict) -> float | None:
    base = p.get("base", "calibrada")
    if base == "clip":
        return e.get("confianca_clip")
    if base == "detetor":
        return e.get("confianca_max_vista")
    return e.get("confianca")


def estado_auto(e: dict, p: dict) -> str:
    """'auto' ou 'pendente', só pelos limiares (sem decisões)."""
    if not p.get("ativo"):
        return "pendente"
    if e.get("subtipo_incerto"):
        return "pendente"
    s = pontuacao(e, p)
    if s is None or s < float(p["limiar"]) or e.get("n_vistas", 0) < int(p.get("min_vistas", 1)):
        return "pendente"
    return "auto"


def estado_efetivo(e: dict, validacao: dict | None, ticket: dict | None, p: dict) -> str:
    if ticket and (not validacao or ticket["quando"] > validacao.get("validado_em", "")):
        return "pendente"
    if validacao:
        return validacao["estado"]
    return estado_auto(e, p)


# ------------------------------------------------------------------ registo (igual a server/api.ts)

def ler_registo(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def depois_do_ultimo_limpar(reg: list[dict]) -> list[dict]:
    idx = max((i for i, e in enumerate(reg) if e.get("acao") == "limpar"), default=-1)
    return reg[idx + 1:]


def estado_atual(reg: list[dict]) -> dict[str, dict]:
    """Última decisão por elemento."""
    atual: dict[str, dict] = {}
    for e in reg:
        if e["acao"] == "limpar":
            atual.clear()
        elif e["acao"] == "desfazer" and e.get("id"):
            atual.pop(e["id"], None)
        elif e["acao"] == "decisao" and e.get("validacao"):
            atual[e["validacao"]["id"]] = {**e["validacao"], "validado_em": e["quando"], "validado_por": e["tecnico"]}
    return atual


def tickets_abertos(reg: list[dict]) -> dict[str, dict]:
    """Ticket aberto mais recente por elemento (acao ticket / ticket_resolvido)."""
    abertos: dict[str, dict] = {}
    for e in reg:
        if e["acao"] == "limpar":
            abertos.clear()
        elif e["acao"] == "ticket" and e.get("id"):
            abertos[e["id"]] = e
        elif e["acao"] == "ticket_resolvido" and e.get("id"):
            abertos.pop(e["id"], None)
    return abertos


def pares_mesmo(reg: list[dict]) -> list[tuple[str, str]]:
    m: dict[tuple[str, str], bool] = {}
    for e in reg:
        if e["acao"] == "limpar":
            m.clear()
        elif e["acao"] == "par" and e.get("a") and e.get("b"):
            m[tuple(sorted((e["a"], e["b"])))] = bool(e.get("mesmo"))
    return [k for k, v in m.items() if v]


def aplicar(els: list[dict], reg: list[dict], lim_zona: dict[str, dict]) -> list[dict]:
    """Elementos com as decisões e os limiares aplicados: estado efetivo e correções do técnico."""
    atual, tickets = estado_atual(reg), tickets_abertos(reg)
    out = []
    for e in els:
        v = atual.get(e["id"])
        x = dict(e)
        if v:
            x["tipo"] = v.get("classe_corrigida") or e["tipo"]
            if "subtipo_corrigido" in v:
                x["subtipo"] = v["subtipo_corrigido"]
            if "lat" in v and "lon" in v:
                x["lat"], x["lon"] = v["lat"], v["lon"]
            if v.get("duplicado_de"):
                x["duplicado_de"] = v["duplicado_de"]
        x["estado"] = estado_efetivo(e, v, tickets.get(e["id"]), lim_zona[e["tipo"]])
        out.append(x)
    return out


def main() -> None:
    cfg = load_config(ROOT / "config/municipio.yaml")
    lim = ler_limiares(cfg=cfg)
    print(f"{LIMIARES_PATH.relative_to(ROOT)}{'' if LIMIARES_PATH.exists() else ' (não existe: valores por omissão)'}")
    print(json.dumps(limiares_zona(lim, cfg["zona"]), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
