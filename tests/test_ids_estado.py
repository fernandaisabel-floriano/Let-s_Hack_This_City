#!/usr/bin/env python3
"""Testes dos ids estáveis (pipeline/ids.py, D1) e do estado efetivo (pipeline/estado.py).

    python tests/test_ids_estado.py      (ou: pytest tests/)

Não precisam de data/ nem de modelos.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path[:0] = [str(AQUI.parent / "pipeline")]

from estado import aplicar, estado_auto, estado_efetivo, limiares_zona, padrao  # noqa: E402
from ids import herdar_ids, relatorio  # noqa: E402

LAT0, LON0 = 40.6388, -8.6573
RAIO = {"sinal": 8.0, "candeeiro": 8.0, "contentor": 8.0}


def el(id_, tipo, dx_m=0.0, dy_m=0.0, subtipo=None, **kw):
    """Elemento a dx/dy metros de um ponto fixo."""
    kx = 111320.0 * math.cos(math.radians(LAT0))
    return {"id": id_, "tipo": tipo, "subtipo": subtipo, "lon": LON0 + dx_m / kx, "lat": LAT0 + dy_m / 111320.0, **kw}


# ------------------------------------------------------------------ ids

def test_mesma_execucao_mantem_ids():
    antigos = [el("can_0001", "candeeiro", 0), el("can_0002", "candeeiro", 30), el("sin_0001", "sinal", 10)]
    novos = [el("x", e["tipo"], 0) for e in antigos]
    for n, a in zip(novos, antigos):
        n.update(lon=a["lon"], lat=a["lat"])
    out, reg = herdar_ids(novos, antigos, RAIO)
    assert [e["id"] for e in out] == ["can_0001", "can_0002", "sin_0001"]
    assert reg["execucoes"][-1]["herdados"] == 3 and not reg["execucoes"][-1]["novos"]


def test_ordem_e_numeracao_diferentes():
    """O pipeline numera por ordem de cálculo: a mesma rua pode sair com a numeração trocada."""
    antigos = [el("can_0001", "candeeiro", 0), el("can_0002", "candeeiro", 30), el("can_0003", "candeeiro", 60)]
    novos = [el("can_0001", "candeeiro", 61), el("can_0002", "candeeiro", 1), el("can_0003", "candeeiro", 29)]
    out, _ = herdar_ids(novos, antigos, RAIO)
    assert [e["id"] for e in out] == ["can_0003", "can_0001", "can_0002"]


def test_deslocado_dentro_do_raio_herda_fora_nao():
    antigos = [el("con_0007", "contentor", 0)]
    out, _ = herdar_ids([el("?", "contentor", 6.5)], antigos, RAIO)
    assert out[0]["id"] == "con_0007"
    out, reg = herdar_ids([el("?", "contentor", 9.0)], antigos, RAIO)
    assert out[0]["id"] == "con_0008" and reg["execucoes"][-1]["desaparecidos"] == ["con_0007"]


def test_classe_diferente_nao_herda():
    out, _ = herdar_ids([el("?", "sinal", 0)], [el("can_0001", "candeeiro", 0)], RAIO)
    assert out[0]["id"] == "sin_0001"


def test_id_desaparecido_nunca_e_reutilizado():
    """Um elemento removido não pode passar o id (e as decisões) a um objeto novo."""
    reg = None
    run1 = [el("can_0001", "candeeiro", 0), el("can_0002", "candeeiro", 30)]
    # execução 2: o can_0002 desaparece
    out2, reg = herdar_ids([el("?", "candeeiro", 0)], run1, RAIO, reg)
    assert [e["id"] for e in out2] == ["can_0001"]
    # execução 3: aparece um candeeiro noutro sítio — recebe um número novo, não o 0002
    out3, reg = herdar_ids([el("?", "candeeiro", 0), el("?", "candeeiro", 100)], out2, RAIO, reg)
    assert [e["id"] for e in out3] == ["can_0001", "can_0003"]
    assert reg["ultimo"]["can"] == 3


def test_um_a_um_o_mais_proximo_ganha():
    """Dois novos perto de um antigo: só o mais próximo herda."""
    antigos = [el("can_0001", "candeeiro", 0)]
    out, _ = herdar_ids([el("?", "candeeiro", 3), el("?", "candeeiro", 1)], antigos, RAIO)
    assert [e["id"] for e in out] == ["can_0002", "can_0001"]


def test_sinais_no_mesmo_poste_nao_se_trocam():
    """STOP e limite no mesmo poste (a 0,3 m): cada um fica com o seu id, mesmo com a posição a variar."""
    antigos = [el("sin_0001", "sinal", 0, subtipo="stop"), el("sin_0002", "sinal", 0.3, subtipo="limite_40")]
    novos = [el("?", "sinal", 0.4, subtipo="limite_40"), el("?", "sinal", 0.1, subtipo="stop")]
    out, _ = herdar_ids(novos, antigos, RAIO)
    assert [e["id"] for e in out] == ["sin_0002", "sin_0001"]


def test_subtipo_mudou_mas_e_o_unico_candidato():
    """A M4 nova reclassificou o sinal: continua a ser o mesmo objeto."""
    out, _ = herdar_ids([el("?", "sinal", 0.5, subtipo="stop")], [el("sin_0004", "sinal", 0, subtipo="outro_sinal")], RAIO)
    assert out[0]["id"] == "sin_0004"


def test_deteccoes_em_comum_ganham_a_posicao():
    """O mesmo objeto (mesmas deteções) com a posição recalculada a 12 m continua a ser ele."""
    antigos = [el("can_0001", "candeeiro", 0, deteccoes=["d1", "d2", "d3"]), el("can_0002", "candeeiro", 11, deteccoes=["d9"])]
    novos = [el("?", "candeeiro", 12, deteccoes=["d1", "d2"]), el("?", "candeeiro", 0.5, deteccoes=["d7"])]
    out, reg = herdar_ids(novos, antigos, RAIO, dets_atuais={"d1", "d2", "d3", "d7", "d9"})
    assert out[0]["id"] == "can_0001"
    # can_0002: as deteções (d9) ainda existem mas nenhum elemento as usa → desaparece; o novo d7 não o herda
    assert out[1]["id"] == "can_0003"
    assert reg["execucoes"][-1]["desaparecidos"] == ["can_0002"]


def test_rejeitado_pelo_filtro_nao_passa_a_vizinho():
    """Caso real de 19/11: um contentor falso (rejeitado pelo técnico) desaparece com o filtro CLIP;
    o contentor real a 6 m não pode herdar o id — senão ficava escondido como rejeitado."""
    antigos = [el("con_0156", "contentor", 0, deteccoes=["f1", "f2"]), el("con_0157", "contentor", 6, deteccoes=["r1"])]
    novos = [el("?", "contentor", 6.2, deteccoes=["r1", "r2"])]
    out, reg = herdar_ids(novos, antigos, RAIO, dets_atuais={"f1", "f2", "r1", "r2"})
    assert out[0]["id"] == "con_0157"
    assert reg["execucoes"][-1]["desaparecidos"] == ["con_0156"]


def test_deteccoes_recalculadas_usa_a_posicao():
    """detect.py voltou a correr: os ids das deteções mudaram todos → herda pela posição."""
    antigos = [el("sin_0003", "sinal", 0, subtipo="stop", deteccoes=["velha1"])]
    novos = [el("?", "sinal", 1.0, subtipo="stop", deteccoes=["nova1"])]
    out, reg = herdar_ids(novos, antigos, RAIO, dets_atuais={"nova1"})
    assert out[0]["id"] == "sin_0003" and reg["execucoes"][-1]["por_regra"] == {"deteccoes": 0, "posicao": 1}


def test_relatorio_avisa_decisoes_perdidas():
    _, reg = herdar_ids([], [el("can_0001", "candeeiro", 0), el("can_0002", "candeeiro", 9)], RAIO)
    linhas = relatorio(reg["execucoes"][-1], {"can_0002"})
    assert any("AVISO" in l and "can_0002" in l for l in linhas)


# ------------------------------------------------------------------ estado

LIM = limiares_zona({"padrao": padrao({"m8": {"limiar_auto": 0.9, "min_vistas": 2}}), "zonas": {
    "z2": {"candeeiro": {"limiar": 0.7}, "contentor": {"ativo": True}}}}, "z1")
LIM_Z2 = limiares_zona({"padrao": padrao({"m8": {"limiar_auto": 0.9, "min_vistas": 2}}), "zonas": {
    "z2": {"candeeiro": {"limiar": 0.7}, "contentor": {"ativo": True}}}}, "z2")


def test_padrao_e_zona():
    assert LIM["candeeiro"]["limiar"] == 0.9 and LIM_Z2["candeeiro"]["limiar"] == 0.7
    assert LIM_Z2["candeeiro"]["min_vistas"] == 2  # o resto vem do padrão
    assert not LIM["contentor"]["ativo"] and LIM_Z2["contentor"]["ativo"]


def test_estado_auto():
    c = el("can_0001", "candeeiro", confianca=0.95, n_vistas=3)
    assert estado_auto(c, LIM["candeeiro"]) == "auto"
    assert estado_auto({**c, "confianca": 0.8}, LIM["candeeiro"]) == "pendente"
    assert estado_auto({**c, "confianca": 0.8}, LIM_Z2["candeeiro"]) == "auto"
    assert estado_auto({**c, "n_vistas": 1}, LIM["candeeiro"]) == "pendente"
    assert estado_auto({**c, "confianca": None}, LIM["candeeiro"]) == "pendente"  # sem calibração
    s = el("sin_0001", "sinal", confianca=0.99, n_vistas=5, subtipo_incerto=True)
    assert estado_auto(s, LIM["sinal"]) == "pendente"  # subtipo incerto → fila, como antes no fuse.py


def test_so_vistas_fracas_rejeitado_salvo_decisao():
    c = el("con_0009", "contentor", confianca=None, confianca_clip=0.99, n_vistas=4, n_vistas_boas=0, so_vistas_fracas=True)
    assert estado_auto(c, LIM_Z2["contentor"]) == "rejeitado"     # mesmo com o tipo ligado e pontuação alta
    val = {"estado": "validado", "validado_em": "2026-11-19T10:00:00Z"}
    assert estado_efetivo(c, val, None, LIM["contentor"]) == "validado"   # o técnico reviu: fica a decisão dele


def test_contentores_desligados_por_omissao():
    c = el("con_0001", "contentor", confianca=None, confianca_clip=0.97, n_vistas=4)
    assert estado_auto(c, LIM["contentor"]) == "pendente"
    assert estado_auto(c, LIM_Z2["contentor"]) == "auto"  # base clip, limiar 0,8
    assert estado_auto({**c, "confianca_clip": 0.6}, LIM_Z2["contentor"]) == "pendente"


def test_decisao_humana_ganha_ao_limiar_e_ticket_reabre():
    c = el("can_0001", "candeeiro", confianca=0.99, n_vistas=5)
    rej = {"estado": "rejeitado", "validado_em": "2026-11-19T10:00:00Z"}
    assert estado_efetivo(c, rej, None, LIM["candeeiro"]) == "rejeitado"
    val = {"estado": "validado", "validado_em": "2026-11-19T10:00:00Z"}
    assert estado_efetivo({**c, "confianca": 0.1}, val, None, LIM["candeeiro"]) == "validado"
    # ticket depois da decisão → volta à fila; ticket antes da decisão já foi tratado
    assert estado_efetivo(c, val, {"quando": "2026-11-19T11:00:00Z"}, LIM["candeeiro"]) == "pendente"
    assert estado_efetivo(c, val, {"quando": "2026-11-19T09:00:00Z"}, LIM["candeeiro"]) == "validado"
    assert estado_efetivo(c, None, {"quando": "2026-11-19T09:00:00Z"}, LIM["candeeiro"]) == "pendente"


def test_aplicar_registo():
    els = [el("can_0001", "candeeiro", confianca=0.95, n_vistas=3), el("sin_0001", "sinal", confianca=0.5, n_vistas=1),
           el("can_0002", "candeeiro", 2, confianca=0.95, n_vistas=3)]
    t = {"utilizador": "a", "nome": "A"}
    reg = [
        {"seq": 1, "quando": "2026-11-19T10:00:00Z", "tecnico": t, "acao": "decisao", "id": "sin_0001",
         "validacao": {"id": "sin_0001", "classe": "sinal", "confiancas_vistas": [], "estado": "corrigido",
                       "subtipo_corrigido": "stop", "lat": 40.0, "lon": -8.0}},
        {"seq": 2, "quando": "2026-11-19T10:01:00Z", "tecnico": t, "acao": "decisao", "id": "can_0002",
         "validacao": {"id": "can_0002", "classe": "candeeiro", "confiancas_vistas": [], "estado": "rejeitado",
                       "duplicado_de": "can_0001"}},
        {"seq": 3, "quando": "2026-11-19T10:02:00Z", "tecnico": t, "acao": "ticket", "id": "can_0001", "motivo": "nao_existe"},
    ]
    out = {e["id"]: e for e in aplicar(els, reg, LIM)}
    assert out["sin_0001"]["estado"] == "corrigido" and out["sin_0001"]["subtipo"] == "stop" and out["sin_0001"]["lat"] == 40.0
    assert out["can_0002"]["estado"] == "rejeitado" and out["can_0002"]["duplicado_de"] == "can_0001"
    assert out["can_0001"]["estado"] == "pendente"  # ticket aberto, mesmo sendo automático


if __name__ == "__main__":
    testes = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in testes:
        f()
        print(f"ok  {n}")
    print(f"{len(testes)} testes ok")
