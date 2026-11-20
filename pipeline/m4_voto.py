"""Subtipo de um elemento fundido (M4 → M6) e filtro dos contentores.

Chamado por fuse.py (fusão M6, ramo main). Não depende da forma como a fusão
junta as deteções: recebe só a lista de deteções de cada elemento.

  subtipo(classe, membros, m4) → (subtipo, confianca_subtipo, incerto, motivo)
      sinal:     votar_subtipo — voto das vistas pesado pelo tamanho do recorte;
                 vistas de costas e incertas abstêm-se; família primeiro, número
                 depois; abaixo de m4.voto_min_fracao fica incerto (→ fila).
      contentor: tipo de contentores_clip.py (subclasse), voto pesado pela
                 confiança de deteção (só se o tipo estiver em subclasse:
                 contentores_clip.escrever_tipo).
      outros:    (None, None, False, None)
  usar_deteccao(d) → False para as deteções com extra.clip_rejeitado (filtro CLIP
                 dos contentores, contentores_clip.py).

Subtipo incerto → o elemento fica sempre "pendente" (fuse.py).
"""
from __future__ import annotations

from collections import Counter, defaultdict

from common import lado_px


def usar_deteccao(d: dict) -> bool:
    return not d["extra"].get("clip_rejeitado")


ESPECIFICAS = ("stop", "cedencia_passagem", "limite")


def familia(sub: str) -> str:
    return "limite" if sub.startswith("limite_") else sub


def votar_subtipo(membros: list[dict], m4: dict) -> tuple[str, float | None, bool, str | None]:
    """Subtipo do sinal fundido. m4.voto escolhe a regra:

      especifico (omissão)  uma vista específica CERTA (stop, cedência, limite com
                            valor — na p5 só saem com prova de forma/algarismos)
                            ganha ao "outro sinal", que é a classe residual: num
                            poste com várias placas, e com recortes que nem são
                            sinais, o "outro" ganhava sempre por maioria (20/11:
                            1 de 11 elementos com STOP/cedência/limite certos).
                            Se a família específica tiver < voto_min_fracao do
                            voto total, fica com esse subtipo mas incerta (→ fila).
      maioria               regra anterior (votar_maioria).
    """
    if m4.get("voto", "especifico") == "maioria":
        return votar_maioria(membros, m4)
    cap = float(m4.get("voto_lado_max_px", 100))
    fmin = float(m4.get("voto_min_fracao", 0.6))
    esp: dict[str, float] = defaultdict(float)
    num: dict[str, float] = defaultdict(float)
    n_esp: Counter = Counter()
    total = 0.0
    for m in membros:
        sub, e = m.get("subclasse") or "outro_sinal", m["extra"]
        if sub == "costas" or (e.get("m4_incerto") and sub != "limite_desconhecido"):
            continue
        w = max(e.get("confianca_classificacao") or 0.0, 1e-3) * min(lado_px(m["bbox"]), cap) / cap
        total += w
        fam = familia(sub)
        if fam in ESPECIFICAS and not e.get("m4_incerto"):
            esp[fam] += w
            n_esp[fam] += 1
            if fam == "limite":
                num[sub] += w
    if not esp:
        sub, frac, incerto, motivo = votar_maioria(membros, m4)
        # anel vermelho visto mas valor por ler: limite por confirmar, não "outro sinal" automático
        if not incerto and any(m.get("subclasse") == "limite_desconhecido" for m in membros):
            return "limite_desconhecido", frac, True, "anel vermelho numa vista, valor do limite não lido"
        return sub, frac, incerto, motivo
    fam = max(esp, key=esp.get)
    f_esp = esp[fam] / sum(esp.values())          # concordância entre as famílias específicas
    f_tot = esp[fam] / total                      # peso face a todas as vistas certas
    if f_esp < fmin:
        return "outro_sinal", round(f_esp, 3), True, f"vistas específicas discordam ({dict(esp)})"
    sub = fam
    if fam == "limite":
        v = max(num, key=num.get)
        if num[v] / sum(num.values()) < fmin:
            return "limite_desconhecido", round(f_tot, 3), True, f"valores discordam ({dict(num)})"
        sub = v
    if f_tot < fmin:
        return sub, round(f_tot, 3), True, f"{sub} em minoria face a outro sinal ({f_tot:.2f} do voto)"
    if n_esp[fam] < int(m4.get("voto_min_vistas_especificas", 2)):
        # uma só vista certa: com as placas empilhadas separadas por família (fuse.py), uma vista
        # do STOP/cedência do mesmo poste pode juntar-se aos raios incertos da placa de baixo
        return sub, round(f_tot, 3), True, f"{sub} visto numa só vista certa"
    return sub, round(f_tot, 3), False, None


def votar_maioria(membros: list[dict], m4: dict) -> tuple[str, float | None, bool, str | None]:
    """Subtipo do sinal fundido → (subtipo, fração do voto, incerto, motivo).

    Abstêm-se: vistas de costas e vistas incertas da M4 (outro_sinal incerto).
    "limite_desconhecido" vota na família limite mas não no número.
    Peso de cada voto = confiança da classificação × min(lado, voto_lado_max_px)
    / voto_lado_max_px (recortes maiores leem-se melhor).
    1.º a família, depois o número; abaixo de voto_min_fracao fica incerto
    (→ fila, como outro_sinal ou limite_desconhecido).
    """
    cap = float(m4.get("voto_lado_max_px", 100))
    fmin = float(m4.get("voto_min_fracao", 0.6))
    fam_v: dict[str, float] = defaultdict(float)
    num_v: dict[str, float] = defaultdict(float)
    costas = 0
    for m in membros:
        sub, e = m.get("subclasse") or "outro_sinal", m["extra"]
        if sub == "costas":
            costas += 1
            continue
        if e.get("m4_incerto") and sub != "limite_desconhecido":
            continue
        w = max(e.get("confianca_classificacao") or 0.0, 1e-3) * min(lado_px(m["bbox"]), cap) / cap
        fam = "limite" if sub.startswith("limite_") else sub
        fam_v[fam] += w
        if fam == "limite" and sub != "limite_desconhecido":
            num_v[sub] += w
    if not fam_v:
        return "outro_sinal", None, True, "só visto de costas" if costas == len(membros) else "sem votos certos"
    fam = max(fam_v, key=fam_v.get)
    frac = fam_v[fam] / sum(fam_v.values())
    if frac < fmin:
        return "outro_sinal", round(frac, 3), True, f"vistas discordam ({dict(fam_v)})"
    if fam != "limite":
        return fam, round(frac, 3), False, None
    if not num_v:
        return "limite_desconhecido", round(frac, 3), True, "valor do limite não lido"
    v = max(num_v, key=num_v.get)
    fv = num_v[v] / sum(num_v.values())
    if fv < fmin:
        return "limite_desconhecido", round(frac, 3), True, f"valores discordam ({dict(num_v)})"
    return v, round(frac * fv, 3), False, None


def votar_tipo_contentor(membros: list[dict]) -> tuple[str | None, float | None]:
    """Tipo do contentor fundido: voto pesado pela confiança de deteção."""
    votos: dict[str, float] = defaultdict(float)
    for m in membros:
        if m.get("subclasse"):
            votos[m["subclasse"]] += m["confianca"]
    if not votos:
        return None, None
    t = max(votos, key=votos.get)
    return t, round(votos[t] / max(1e-9, sum(votos.values())), 3)


def subtipo(classe: str, membros: list[dict], m4: dict | None) -> tuple[str | None, float | None, bool, str | None]:
    if classe == "sinal":
        return votar_subtipo(membros, m4 or {})
    if classe == "contentor":
        t, c = votar_tipo_contentor(membros)
        return t, c, False, None
    return None, None, False, None
