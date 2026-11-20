#!/usr/bin/env python3
"""Testes da M4 sem dados reais: sinais sintéticos e CLIP fabricado.

    python tests/test_m4_sintetico.py      (ou: pytest tests/)

Não precisam de torch, CLIP, ultralytics nem de data/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
sys.path[:0] = [str(AQUI), str(AQUI.parent / "pipeline")]

import classify_signs as cs  # noqa: E402
import m4_voto  # noqa: E402
import m4_medir as mm  # noqa: E402
from m4_algarismos import ler_valor  # noqa: E402
from m4_forma import analisar, para_analise  # noqa: E402
from sinais_sinteticos import CASOS, degradar  # noqa: E402

LADOS = (24, 32, 40, 48, 64, 80)
BLURS = (0, 0.8, 1.2)
FORMA_ESPERADA = {"stop": "stop", "cedencia": "cedencia", **{k: "anel_vermelho" for k in CASOS if k.startswith("limite_")},
                  "proibido_pesados": "anel_vermelho"}
M4 = cs.m4_cfg({})


def _variantes(nome):
    im = CASOS[nome]()
    for lado in LADOS:
        for b in BLURS:
            yield lado, b, degradar(im, lado, b, lado)


# ------------------------------------------------------------------ filtro A

def test_filtro_a_sem_confusoes():
    """Nenhuma forma errada: cada sinal dá a sua forma ou "nenhuma" (abstenção)."""
    for nome in CASOS:
        for lado, b, im in _variantes(nome):
            f = analisar(im)["forma"]
            assert f in (FORMA_ESPERADA.get(nome, "nenhuma"), "nenhuma"), (nome, lado, b, f)


def test_filtro_a_recall():
    for nome, minimo in (("stop", 1.0), ("cedencia", 0.8), ("limite_40", 1.0)):
        r = [analisar(im)["forma"] == FORMA_ESPERADA[nome] for lado, b, im in _variantes(nome) if lado >= 32]
        assert np.mean(r) >= minimo, (nome, np.mean(r))


# --------------------------------------------------------------- algarismos

def test_algarismos_sem_valores_errados():
    for nome in [k for k in CASOS if k.startswith("limite_")] + ["proibido_pesados"]:
        for lado, b, im in _variantes(nome):
            f = analisar(im)
            if not f.get("circulo"):
                continue
            v = ler_valor(para_analise(im), f["circulo"])["valor"]
            certo = int(nome.split("_")[1]) if nome.split("_")[-1].isdigit() else None
            assert v is None or v == certo, (nome, lado, b, v)


def test_algarismos_recall_30_40_50():
    ok = []
    for nome in ("limite_30", "limite_40", "limite_50"):
        for lado, b, im in _variantes(nome):
            if lado < 32:
                continue
            f = analisar(im)
            ok.append(bool(f.get("circulo")) and ler_valor(para_analise(im), f["circulo"])["valor"] == int(nome[-2:]))
    assert np.mean(ok) >= 0.8, np.mean(ok)


# ------------------------------------------------------------------- cascata

def p_fam(**massas) -> np.ndarray:
    """Probabilidades das frases de LABELS_FAM: massa por subclasse/família, resto uniforme."""
    p = np.full(len(cs.LABELS_FAM), 1e-3)
    for chave, m in massas.items():
        idx = [i for i, lb in enumerate(cs.LABELS_FAM) if chave in (lb[1], lb[2])]
        p[idx] += m / len(idx)
    return p / p.sum()


def ctx(forma="nenhuma", prompt="traffic sign", lado=50, num=None, **massas):
    return {"lado": lado, "prompt": prompt, "p_fam": p_fam(**massas), "forma": {"forma": forma}, "num": num or {}}


def test_p1_familia_primeiro_e_limiares():
    assert cs.decide_p1(ctx(stop=0.9), M4)["subclasse"] == "stop"
    r = cs.decide_p1(ctx(stop=0.3, cedencia_passagem=0.3, outro_sinal=0.3), M4)   # indeciso: ~0,32 cada
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", True)
    r = cs.decide_p1(ctx(limite_40=0.4, limite_70=0.4), M4)        # família certa, valor não
    assert (r["subclasse"], r["incerto"]) == ("limite_desconhecido", True)
    assert cs.decide_p1(ctx(limite_40=0.9), M4)["subclasse"] == "limite_40"
    for v in (20, 60, 80, 100, 120):                                  # fora dos aceites → desconhecido
        for dec in (cs.decide_p1, cs.decide_p3):
            forma = "anel_vermelho" if dec is cs.decide_p3 else "nenhuma"
            r = dec(ctx(forma, **{f"limite_{v}": 0.95}), M4)
            assert (r["subclasse"], r["incerto"]) == ("limite_desconhecido", True), (v, r)


def test_valores_possiveis():
    """p1–p5 só podem dar os valores aceites; a variante atual fica como linha de base."""
    rng = np.random.default_rng(0)
    vistos = set()
    for _ in range(300):
        c = ctx(rng.choice(["nenhuma", "anel_vermelho", "stop", "cedencia"]), lado=int(rng.integers(20, 90)),
                num={"valor": int(rng.choice([30, 40, 50])), "score": 0.9} if rng.random() < 0.5 else {},
                **{f"limite_{int(rng.choice(cs.VALORES_LIMITE))}": float(rng.uniform(0.3, 1.0))})
        for v in ("p1", "p3", "p4", "p5"):
            s = cs.DECIDE[v](c, M4)["subclasse"]
            if s.startswith("limite_") and s != "limite_desconhecido":
                vistos.add(int(s.split("_")[1]))
    assert vistos <= {30, 40, 50}, vistos


def test_p3_porta_e_veto():
    assert cs.decide_p3(ctx("stop", outro_sinal=0.9), M4)["subclasse"] == "stop"
    assert cs.decide_p3(ctx("cedencia", stop=0.9), M4)["subclasse"] == "cedencia_passagem"
    r = cs.decide_p3(ctx("nenhuma", stop=0.9), M4)
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", True)
    r = cs.decide_p3(ctx("nenhuma", limite_50=0.9), M4)              # sem anel nunca é limite
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", True)


def test_p4_algarismos_resgate_e_tamanho():
    n40 = {"valor": 40, "score": 0.8}
    assert cs.decide_p4(ctx("anel_vermelho", num=n40, limite_70=0.9), M4)["subclasse"] == "limite_40"
    assert cs.decide_p4(ctx("anel_vermelho", num=n40, lado=25, limite=0.9), M4)["subclasse"] == "limite_desconhecido"
    # CLIP indeciso + anel + algarismos certos → resgate
    assert cs.decide_p4(ctx("anel_vermelho", num=n40, stop=0.3, outro_sinal=0.3, costas=0.3), M4)["subclasse"] == "limite_40"
    # CLIP confiante noutra família → o anel não a contraria
    assert cs.decide_p4(ctx("anel_vermelho", num=n40, outro_sinal=0.9), M4)["subclasse"] == "outro_sinal"


def test_p5_prompt_stop_sign():
    assert cs.decide_p5(ctx("stop", prompt="stop sign", outro_sinal=0.9), M4)["subclasse"] == "stop"
    r = cs.decide_p5(ctx("nenhuma", prompt="stop sign", outro_sinal=0.9), M4)   # veto vence → fila
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", True)
    r = cs.decide_p5(ctx("anel_vermelho", prompt="stop sign", num={"valor": 40, "score": 0.9}, limite=0.9), M4)
    assert r["incerto"]
    assert cs.decide_p5(ctx("cedencia", prompt="stop sign"), M4)["subclasse"] == "cedencia_passagem"
    # sem o prompt, p5 = p4
    c = ctx("nenhuma", outro_sinal=0.9)
    assert cs.decide_p5(c, M4) == cs.decide_p4(c, M4)
    # cedência em 2.º lugar no CLIP → fila; em 2.º mas fraca → fica outro_sinal
    r = cs.decide_p5(ctx("nenhuma", outro_sinal=0.55, cedencia_passagem=0.35), M4)
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", True), r
    r = cs.decide_p5(ctx("nenhuma", outro_sinal=0.8, cedencia_passagem=0.15), M4)
    assert (r["subclasse"], r["incerto"]) == ("outro_sinal", False), r


# -------------------------------------------------------------------- fusão

def _m(sub, lado, incerto=False, conf=0.8):
    return {"subclasse": sub, "bbox": [0, 0, lado, lado], "extra": {"confianca_classificacao": conf, "m4_incerto": incerto}}


def test_fusao_votos():
    m4 = {"voto_lado_max_px": 100, "voto_min_fracao": 0.6}
    assert m4_voto.votar_subtipo([_m("stop", 60), _m("costas", 80), _m("outro_sinal", 90, True)], m4)[:3] == ("stop", 1.0, False)
    assert m4_voto.votar_subtipo([_m("limite_40", 30), _m("limite_50", 90)], m4)[0] == "limite_50"       # pesa o tamanho
    assert m4_voto.votar_subtipo([_m("limite_40", 100), _m("limite_50", 400)], m4)[0] == "limite_desconhecido"  # teto 100 px
    s, _, inc, mot = m4_voto.votar_subtipo([_m("costas", 30), _m("costas", 50)], m4)
    assert (s, inc, mot) == ("outro_sinal", True, "só visto de costas")
    r = m4_voto.votar_subtipo([_m("stop", 50), _m("cedencia_passagem", 50)], m4)       # vistas discordam
    assert (r[0], r[2]) == ("outro_sinal", True), r


# ------------------------------------------------------------------ medição

def test_medicao_regras():
    assert mm.certo(("limite", "outro"), ("limite", 80))
    assert not mm.certo(("limite", "outro"), ("limite", 40))
    assert not mm.certo(("limite", 30), ("limite", 50))
    assert mm.certo_chave("limite_outro", {"subclasse": "limite_desconhecido", "incerto": True})
    assert not mm.certo_chave("stop", {"subclasse": "outro_sinal", "incerto": True})
    m = mm.metricas([("stop", None), ("limite", 30), ("nao_sinal", None)],
                    [("stop", None, False), ("limite", 50, False), ("outro", None, True)])
    assert m["_resumo"]["erros_especificos"] == 1 and m["stop"]["precisao"] == 1.0


# ------------------------------------------------------ filtro dos contentores

def test_contentores_cores_e_tipo():
    import contentores_clip as cc
    from sinais_sinteticos import contentor_ilha, papeleira
    f = cc.DEFAULTS
    ilha = cc.cores(contentor_ilha(), f)
    assert sum(v >= f["cor_frac_min"] for v in ilha.values()) >= 2, ilha
    assert cc.tipo(contentor_ilha(), {"subterraneo": 0.6, "ilha_reciclagem": 0.2, "indiferenciado": 0.2}, f)[0] == "ilha_reciclagem"
    # sem cores: decide o CLIP
    assert cc.tipo(papeleira(), {"subterraneo": 0.1, "ilha_reciclagem": 0.2, "indiferenciado": 0.7}, f)[0] == "indiferenciado"


def test_contentores_classificar_e_limiares():
    import contentores_clip as cc

    class ClipFalso:
        def probs(self, crops, nome):
            if nome == "tipos":
                return [{"subterraneo": 0.2, "ilha_reciclagem": 0.2, "indiferenciado": 0.6}] * len(crops)
            return [{**dict.fromkeys(cc.CLASSES, 0.05), "contentor": 0.65},
                    {**dict.fromkeys(cc.CLASSES, 0.05), "papeleira": 0.65}][:len(crops)]

    crops = [np.zeros((40, 40, 3), np.uint8)] * 2
    cl = cc.classificar(crops, ClipFalso(), cc.DEFAULTS)
    assert [c["classe"] for c in cl] == ["contentor", "papeleira"]
    assert cl[1]["classe_negativa"] == "papeleira" and cl[0]["p_contentor"] == 0.65
    linhas = [{"real": r} for r in (True, True, True, False, False, False)]
    ps = [0.9, 0.8, 0.2, 0.5, 0.1, 0.05]
    grelha = [0.0, 0.1, 0.2, 0.3, 0.5, 0.7]
    assert cc.escolher(linhas, ps, 1.0, grelha) == 0.2          # maior limiar que guarda todos os verdadeiros
    assert cc.escolher_auto(linhas, ps, 1.0, grelha, min_n=2) == 0.7
    assert cc.escolher_auto(linhas, ps, 1.0, grelha, min_n=3) is None
    m = cc._met(linhas, [p >= 0.2 for p in ps])
    assert (m["fila"], m["verdadeiros"], m["falsos_tirados"], m["verdadeiros_deitados_fora"]) == (4, 3, 2, 0)


def test_subtipo_contentor_e_filtro():
    def mc(sub, conf, rejeitado=False):
        return {"subclasse": sub, "confianca": conf, "bbox": [0, 0, 50, 50], "extra": {"clip_rejeitado": rejeitado}}
    assert m4_voto.subtipo("contentor", [mc("ilha_reciclagem", 0.6), mc("indiferenciado", 0.2), mc(None, 0.9)], {}) == \
        ("ilha_reciclagem", 0.75, False, None)
    assert m4_voto.subtipo("contentor", [mc(None, 0.9)], {}) == (None, None, False, None)   # escrever_tipo: false
    assert m4_voto.subtipo("candeeiro", [mc(None, 0.9)], {}) == (None, None, False, None)
    assert not m4_voto.usar_deteccao(mc(None, 0.5, True)) and m4_voto.usar_deteccao(mc(None, 0.5))


def test_fuse_main_usa_m4_voto():
    """O fuse.py (fusão da main) chama o m4_voto para o subtipo e para o filtro dos contentores."""
    import inspect
    import fuse
    src = inspect.getsource(fuse)
    assert "subtipo(classe, membros, m4)" in src and "usar_deteccao(d)" in src
    assert "subtipo_incerto" in src and "estado_auto(" in src
    # subtipo incerto → fila: a regra passou do fuse.py para estado.estado_auto (decisão 3, opção B)
    from estado import estado_auto
    p = {"ativo": True, "base": "calibrada", "limiar": 0.5, "min_vistas": 1}
    assert estado_auto({"confianca": 0.99, "n_vistas": 5, "subtipo_incerto": True}, p) == "pendente"
    assert estado_auto({"confianca": 0.99, "n_vistas": 5, "subtipo_incerto": False}, p) == "auto"


if __name__ == "__main__":
    falhas = 0
    for nome, f in list(globals().items()):
        if nome.startswith("test_") and callable(f):
            try:
                f()
                print(f"ok    {nome}")
            except AssertionError as e:
                falhas += 1
                print(f"FALHA {nome}: {e}")
    sys.exit(1 if falhas else 0)
