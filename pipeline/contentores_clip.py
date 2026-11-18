#!/usr/bin/env python3
"""Contentores — filtro CLIP (contentor vs. falsos típicos) e tipo de contentor.

Para cada deteção de contentor da M3, o CLIP (weights/clip, ViT-B/32) escolhe
entre "contentor do lixo / ecoponto" e as classes negativas (papeleira presa a
poste, marco de incêndio, pilarete, armário técnico, floreira, mota/carro,
outro), com várias frases por classe. P(classe) = média das probabilidades das
suas frases, renormalizada entre classes; p_contentor = P("contentor").

Tipo (só para o que passa o filtro): ilha de reciclagem se o recorte tiver pelo
menos 2 das 3 cores (azul, amarelo, verde) com área suficiente; senão o CLIP
escolhe entre subterrâneo, ilha e indiferenciado.

Uso:
    python pipeline/contentores_clip.py medir     # contra labels.json → reports/contentores/filtro_clip.{md,json}
    python pipeline/contentores_clip.py           # passo do pipeline (só se contentores_clip.ativo)

Passo do pipeline (opcional, `contentores_clip.ativo` na config), em deteccoes.json:
  extra.clip_contentor   p_contentor
  extra.clip_classe      classe mais provável
  extra.clip_rejeitado   p_contentor < contentores_clip.limiar (só se o limiar não for null)
  extra.clip_tipo        tipo do contentor (subterraneo | ilha_reciclagem | indiferenciado)
  subclasse              = clip_tipo, só com contentores_clip.escrever_tipo: true (passa a subtipo no catálogo)
A fusão (fuse.py) ignora as deteções com clip_rejeitado e vota o subtipo do
contentor; o catálogo continua com os mesmos campos (subtipo já existe).
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, load_config, recorte_largo_janela, zone_dir  # noqa: E402

CLASSES_V1 = None   # preenchido abaixo (versão original, mantida para comparação na medição)
CLASSES = {
    "contentor": [
        "a large underground waste container on the sidewalk",
        "a set of recycling containers, blue, yellow and green",
        "a large public garbage container on the street",
        "a recycling igloo container",
        "a big green dumpster bin on the street",
        "a waste collection point with large bins",
        # v2 (18/11): acrescentadas depois de ver os verdadeiros que a v1 deitava fora —
        # contentores de rodas escuros (confundidos com papeleiras) e iglôs laranja (com marcos de incêndio)
        "a black wheeled garbage container with a lid on the street",
        "a dark green plastic wheelie bin for household waste",
        "an orange recycling igloo container",
        "a glass recycling bell container",
    ],
    "papeleira": [
        "a small litter bin attached to a pole",
        "a small black trash can mounted on a post",
        "a small public litter bin on a lamp post",
    ],
    "marco_incendio": [
        "a red fire hydrant",
        "a fire hydrant on the sidewalk",
        "a red and white fire hydrant",
    ],
    "pilarete": [
        "a bollard on the sidewalk",
        "a short metal post on the pavement",
        "a red and white traffic bollard",
    ],
    "armario": [
        "an electrical utility cabinet",
        "a grey metal electrical box on the street",
        "a telecom street cabinet",
    ],
    "floreira": [
        "a concrete flower planter",
        "a stone planter box on the sidewalk",
        "a planter with plants on the sidewalk",
    ],
    "veiculo": [
        "a parked motorcycle",
        "a parked car",
        "a scooter",
    ],
    "outro": [
        "a building wall",
        "a door",
        "a tree trunk",
        "a person walking",
        "a bench",
        "a shop window",
    ],
}
CLASSES_V1 = {**CLASSES, "contentor": CLASSES["contentor"][:6]}
TIPOS = {
    "subterraneo": ["an underground waste container with a metal chute opening on the sidewalk",
                    "a stainless steel underground bin inlet"],
    "ilha_reciclagem": ["a row of blue, yellow and green recycling containers",
                        "a recycling point with colored containers"],
    "indiferenciado": ["a single dark green garbage container", "a grey general waste bin"],
}
DEFAULTS = {"ativo": False, "limiar": None, "escrever_tipo": False, "recorte": "justo", "margem_justo": 0.10,
            "cor_frac_min": 0.04, "cor_s_min": 100, "cor_v_min": 60}
CORES_H = {"azul": (95, 130), "amarelo": (18, 35), "verde": (40, 85)}   # OpenCV H: 0–180


def cfg_filtro(cfg: dict) -> dict:
    return {**DEFAULTS, **(cfg.get("contentores_clip") or {})}


# ---------------------------------------------------------------------- CLIP

class ClipTexto:
    """CLIP com conjuntos de frases agrupadas por classe."""

    def __init__(self, conjuntos: dict[str, dict[str, list[str]]]):
        import clip
        import torch
        self.torch = torch
        self.model, self.pre = clip.load("ViT-B/32", device="cpu", download_root=str(ROOT / "weights/clip"))
        self.conj = {}
        for nome, classes in conjuntos.items():
            frases, dono = [], []
            for c, fs in classes.items():
                for f in fs:
                    frases.append(f)
                    dono.append(c)
            with torch.no_grad():
                t = self.model.encode_text(clip.tokenize([f"a photo of {f}" for f in frases])).float()
            self.conj[nome] = (t / t.norm(dim=-1, keepdim=True), dono, list(classes))

    def probs(self, imgs_bgr: list[np.ndarray], nome: str) -> list[dict[str, float]]:
        from PIL import Image
        torch = self.torch
        text, dono, classes = self.conj[nome]
        out = []
        for k in range(0, len(imgs_bgr), 32):
            batch = torch.stack([self.pre(Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))) for im in imgs_bgr[k:k + 32]])
            with torch.no_grad():
                im = self.model.encode_image(batch).float()
                im /= im.norm(dim=-1, keepdim=True)
                pr = (100.0 * im @ text.T).softmax(dim=-1).numpy()
            for row in pr:
                media = {c: float(np.mean([p for p, d in zip(row, dono) if d == c])) for c in classes}
                s = sum(media.values())
                out.append({c: v / s for c, v in media.items()})
        return out


# ------------------------------------------------------------------ recortes

def recorte(img: np.ndarray, bbox, f: dict) -> np.ndarray:
    if f["recorte"] == "justo":
        from classify_signs import recorte_justo
        return recorte_justo(img, bbox, float(f["margem_justo"]))
    x0, y0, x1, y1 = recorte_largo_janela(bbox, img.shape[1], img.shape[0])
    return img[y0:y1, x0:x1]


def recortes(dets: list[dict], zdir: Path, f: dict) -> list[np.ndarray]:
    out, cache = [], {}
    for d in dets:
        p = zdir / d["extra"]["imagem"]
        if p not in cache:
            cache = {p: cv2.imread(str(p))}
        out.append(recorte(cache[p], d["bbox"], f))
    return out


def cores(crop: np.ndarray, f: dict) -> dict[str, float]:
    """Fração do recorte com azul / amarelo / verde saturados."""
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    sat = (s >= f["cor_s_min"]) & (v >= f["cor_v_min"])
    return {c: float(((h >= a) & (h <= b) & sat).mean()) for c, (a, b) in CORES_H.items()}


def tipo(crop: np.ndarray, p_tipo: dict[str, float], f: dict) -> tuple[str, str]:
    """(tipo, motivo): ilha pela cor (≥ 2 das 3 cores), senão o tipo mais provável do CLIP."""
    cs_ = cores(crop, f)
    presentes = [c for c, v in cs_.items() if v >= f["cor_frac_min"]]
    if len(presentes) >= 2:
        return "ilha_reciclagem", f"cores {'+'.join(presentes)}"
    t = max(p_tipo, key=p_tipo.get)
    return t, f"CLIP {p_tipo[t]:.2f}"


def classificar(crops: list[np.ndarray], clip: ClipTexto, f: dict, conjunto: str = "classes") -> list[dict]:
    pc = clip.probs(crops, conjunto)
    pt = clip.probs(crops, "tipos")
    out = []
    for crop, a, b in zip(crops, pc, pt):
        classe = max(a, key=a.get)
        t, mot = tipo(crop, b, f)
        out.append({"p_contentor": round(a["contentor"], 4), "classe": classe,
                    "classe_negativa": max((k for k in a if k != "contentor"), key=a.get),
                    "p": {k: round(v, 4) for k, v in a.items()}, "tipo": t, "tipo_motivo": mot})
    return out


def novo_clip() -> ClipTexto:
    return ClipTexto({"classes": CLASSES, "classes_v1": CLASSES_V1, "tipos": TIPOS})


# ------------------------------------------------------------------- medição

def _met(linhas, keep) -> dict:
    n_r = sum(x["real"] for x in linhas)
    k = [x for x, m in zip(linhas, keep) if m]
    r = sum(x["real"] for x in k)
    return {"fila": len(k), "verdadeiros": r, "precisao": round(r / len(k), 3) if k else None,
            "recall": round(r / n_r, 3) if n_r else None, "verdadeiros_deitados_fora": n_r - r,
            "falsos_tirados": sum(not x["real"] for x, m in zip(linhas, keep) if not m)}


def escolher_auto(linhas, ps, alvo_p: float, grelha, min_n: int = 5) -> float | None:
    """Menor limiar com precisão ≥ alvo_p e ≥ min_n deteções (None se não houver)."""
    for t in grelha:
        k = [x["real"] for x, p in zip(linhas, ps) if p >= t]
        if len(k) >= min_n and sum(k) / len(k) >= alvo_p:
            return t
    return None


def escolher(linhas, ps, alvo_recall: float, grelha) -> float:
    """Maior limiar que ainda guarda ≥ alvo_recall dos verdadeiros."""
    n_r = sum(x["real"] for x in linhas)
    ok = [t for t in grelha if n_r and sum(x["real"] and p >= t for x, p in zip(linhas, ps)) / n_r >= alvo_recall]
    return max(ok) if ok else min(grelha)


def medir() -> None:
    from contentores_medir import fmt, rotulados
    cfg = load_config()
    f = cfg_filtro(cfg)
    alvo = float(sys.argv[sys.argv.index("--alvo-recall") + 1]) if "--alvo-recall" in sys.argv else 0.90
    out = ROOT / (cfg.get("contentores_relatorios") or "reports/contentores")
    out.mkdir(parents=True, exist_ok=True)
    zdir = zone_dir(cfg)
    _, linhas, sem = rotulados(cfg)
    clip = novo_clip()
    grelha = [0.0, 0.005, 0.01, 0.02, 0.03, 0.04] + [round(x, 2) for x in np.arange(0.05, 0.96, 0.05)]
    res_modos, por_modo = {}, {}
    t0 = time.time()
    crops_por = {m: recortes([x["_det"] for x in linhas], zdir, {**f, "recorte": m}) for m in ("justo", "largo")}
    for modo, (conj, rec) in {"v2 justo": ("classes", "justo"), "v2 largo": ("classes", "largo"),
                              "v1 justo": ("classes_v1", "justo")}.items():
        fm = {**f, "recorte": rec}
        crops = crops_por[rec]
        cl = classificar(crops, clip, fm, conj)
        por_modo[modo] = (crops, cl)
        ps = [c["p_contentor"] for c in cl]
        # AUC (Mann-Whitney)
        pr = [p for x, p in zip(linhas, ps) if x["real"]]
        pf = [p for x, p in zip(linhas, ps) if not x["real"]]
        auc = float(np.mean([(a > b) + 0.5 * (a == b) for a in pr for b in pf])) if pr and pf else None
        varr = {str(t): _met(linhas, [p >= t for p in ps]) for t in grelha}
        # validação cruzada: 200 partições estratificadas ao meio; escolhe o limiar numa metade, mede na outra
        rng = np.random.default_rng(0)
        reais = [i for i, x in enumerate(linhas) if x["real"]]
        falsos = [i for i, x in enumerate(linhas) if not x["real"]]
        cv = []
        for _ in range(200):
            a = set(rng.choice(reais, len(reais) // 2, replace=False)) | set(rng.choice(falsos, len(falsos) // 2, replace=False))
            tr = [i for i in range(len(linhas)) if i in a]
            te = [i for i in range(len(linhas)) if i not in a]
            t = escolher([linhas[i] for i in tr], [ps[i] for i in tr], alvo, grelha)
            m = _met([linhas[i] for i in te], [ps[i] >= t for i in te])
            base = _met([linhas[i] for i in te], [True] * len(te))
            ta = escolher_auto([linhas[i] for i in tr], [ps[i] for i in tr], 0.95, grelha)
            ka = [linhas[i]["real"] for i in te if ta is not None and ps[i] >= ta]
            cv.append({"t": t, **m, "fila_sem_filtro": base["fila"], "precisao_sem_filtro": base["precisao"],
                       "auto_t": ta, "auto_n": len(ka), "auto_precisao": (sum(ka) / len(ka)) if ka else None})

        def resumo(k):
            v = [c[k] for c in cv if c[k] is not None]
            if not v:
                return {"media": None, "p10": None, "p90": None}
            return {"media": round(float(np.mean(v)), 3), "p10": round(float(np.percentile(v, 10)), 3),
                    "p90": round(float(np.percentile(v, 90)), 3)}

        t_rec = escolher(linhas, ps, alvo, grelha)
        t_auto = escolher_auto(linhas, ps, 0.95, grelha)
        res_modos[modo] = {"auc": round(auc, 3) if auc is not None else None, "varrimento": varr,
                           "limiar_recomendado": t_rec, "com_limiar_recomendado": varr[str(t_rec)],
                           "entra_direto_todos": {"t": t_auto, **(varr[str(t_auto)] if t_auto is not None else {})},
                           "validacao_cruzada": {k: resumo(k) for k in
                                                 ("t", "precisao", "recall", "fila", "fila_sem_filtro", "precisao_sem_filtro",
                                                  "verdadeiros_deitados_fora", "auto_t", "auto_n", "auto_precisao")},
                           "cv_sem_auto": sum(c["auto_t"] is None for c in cv)}
    modo = max((m for m in res_modos if m.startswith("v2")), key=lambda m: res_modos[m]["auc"] or 0)
    crops, cl = por_modo[modo]
    t_rec = res_modos[modo]["limiar_recomendado"]
    sem_filtro = _met(linhas, [True] * len(linhas))
    # contagem dos falsos por classe negativa (para o pitch) e cruzamento com os rótulos de tipo do técnico
    falsos = [(x, c) for x, c in zip(linhas, cl) if not x["real"]]
    por_classe = Counter(c["classe_negativa"] if c["classe"] == "contentor" else c["classe"] for x, c in falsos)
    cruz = Counter((x.get("falso_tipo") or "(sem tipo)", c["classe"]) for x, c in falsos)
    verd_fora = [(x, c) for x, c in zip(linhas, cl) if x["real"] and c["p_contentor"] < t_rec]
    # tipo dos verdadeiros
    tipos = [(x.get("tipo"), c["tipo"], c["tipo_motivo"]) for x, c in zip(linhas, cl) if x["real"]]
    com_rot = [(a, b) for a, b, _ in tipos if a]
    tipo_res = {"rotulados_com_tipo": len(com_rot), "certos": sum(a == b for a, b in com_rot),
                "confusao": dict(Counter(f"{a} → {b}" for a, b in com_rot)),
                "previsto_nos_verdadeiros": dict(Counter(b for _, b, _ in tipos))}
    # exemplos por classe negativa
    ex = out / "exemplos_filtro_clip"
    if ex.exists():
        import shutil
        shutil.rmtree(ex)
    exemplos = {}
    for k in por_classe:
        sel = sorted([(x, c, cr) for (x, c), cr in zip(zip(linhas, cl), crops)
                      if not x["real"] and (c["classe_negativa"] if c["classe"] == "contentor" else c["classe"]) == k],
                     key=lambda t: -t[1]["p"][k])[:3]
        pasta = ex / f"falso_{k}"
        pasta.mkdir(parents=True, exist_ok=True)
        for x, c, cr in sel:
            cv2.imwrite(str(pasta / f"{x['id']}_p{c['p'][k]:.2f}.jpg"), cr)
        exemplos[k] = str(pasta.relative_to(ROOT))
    pasta = ex / "verdadeiros_deitados_fora"
    pasta.mkdir(parents=True, exist_ok=True)
    for x, c in verd_fora:
        cv2.imwrite(str(pasta / f"{x['id']}_p{c['p_contentor']:.2f}.jpg"), crops[linhas.index(x)])

    res = {"gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rotuladas": len(linhas),
           "sem_rotulo": sem, "segundos": round(time.time() - t0, 1), "alvo_recall": alvo, "modo_escolhido": modo,
           "sem_filtro": sem_filtro, "modos": res_modos, "falsos_por_classe_negativa": dict(por_classe.most_common()),
           "cruzamento_rotulo_tecnico": {f"{a} × {b}": n for (a, b), n in cruz.most_common()},
           "verdadeiros_deitados_fora": [{"id": x["id"], "p": c["p_contentor"], "classe": c["classe"]} for x, c in verd_fora],
           "tipo": tipo_res, "exemplos": exemplos}
    (out / "filtro_clip.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    M = res_modos[modo]
    cvr = M["validacao_cruzada"]
    md = [f"# Contentores — filtro CLIP\n\n{res['gerado_em']} · {len(linhas)} deteções rotuladas "
          f"({sem_filtro['verdadeiros']} verdadeiras) · {res['segundos']} s\n",
          f"Frases e recorte usados: **{modo}** (AUC {M['auc']}; os outros: "
          + ", ".join(f"{m} {r['auc']}" for m, r in res_modos.items() if m != modo) + "). "
          "A v2 acrescenta 4 frases positivas escolhidas depois de ver os erros da v1 — a diferença v1→v2 "
          "pode estar inflacionada (sobreajuste às frases); a validação cruzada só protege a escolha do limiar.\n",
          "## Sem filtro vs. com filtro (limiar recomendado, todos os dados)\n",
          "| | sem filtro | com filtro |\n|---|---:|---:|",
          f"| limiar p_contentor | — | {t_rec} |",
          f"| fila (deteções) | {sem_filtro['fila']} | {M['com_limiar_recomendado']['fila']} |",
          f"| precisão | {fmt(sem_filtro['precisao'])} | {fmt(M['com_limiar_recomendado']['precisao'])} |",
          f"| recall | 1,00 | {fmt(M['com_limiar_recomendado']['recall'])} |",
          f"| verdadeiros deitados fora | 0 | {M['com_limiar_recomendado']['verdadeiros_deitados_fora']} |",
          f"| falsos tirados da fila | 0 | {M['com_limiar_recomendado']['falsos_tirados']} |",
          "", f"Limiar recomendado = maior limiar que guarda ≥ {alvo:.0%} dos verdadeiros.\n",
          "## Validação cruzada (200 × metade para escolher o limiar, metade para medir)\n",
          "| | média | p10 | p90 |\n|---|---:|---:|---:|"]
    nomes = {"t": "limiar escolhido", "precisao_sem_filtro": "precisão sem filtro", "precisao": "precisão com filtro",
             "recall": "recall com filtro", "fila_sem_filtro": "fila sem filtro (metade)", "fila": "fila com filtro (metade)",
             "verdadeiros_deitados_fora": "verdadeiros deitados fora (metade)",
             "auto_t": "limiar 'entra direto' (precisão ≥ 95 % na metade de escolha)",
             "auto_n": "entram direto (metade de medida)", "auto_precisao": "precisão de quem entra direto"}
    md += [f"| {nomes[k]} | {fmt(v['media'])} | {fmt(v['p10'])} | {fmt(v['p90'])} |" for k, v in cvr.items()]
    md += [f"", f"Em {M['cv_sem_auto']} das 200 partições não houve limiar 'entra direto' com precisão ≥ 95 %."]
    md += ["", "## Comparação de frases e recortes (todos os dados)\n",
           "| versão | AUC | limiar (recall ≥ alvo) | fila | precisão | verdadeiros fora | CV precisão | CV recall |",
           "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for m_, r in res_modos.items():
        c_ = r["com_limiar_recomendado"]
        md.append(f"| {m_} | {r['auc']} | {r['limiar_recomendado']} | {c_['fila']} | {fmt(c_['precisao'])} | "
                  f"{c_['verdadeiros_deitados_fora']} | {fmt(r['validacao_cruzada']['precisao']['media'])} | "
                  f"{fmt(r['validacao_cruzada']['recall']['media'])} |")
    md += ["", "## Varrimento do limiar\n", "| p_contentor ≥ | fila | verdadeiros | precisão | recall | verdadeiros fora |",
           "|---:|---:|---:|---:|---:|---:|"]
    md += [f"| {t} | {m['fila']} | {m['verdadeiros']} | {fmt(m['precisao'])} | {fmt(m['recall'])} | {m['verdadeiros_deitados_fora']} |"
           for t, m in M["varrimento"].items()]
    md += ["", "## Falsos por classe negativa (saída do filtro — contagem para o pitch)\n", "| Classe | n |", "|---|---:|"]
    md += [f"| {k} | {v} |" for k, v in res["falsos_por_classe_negativa"].items()]
    md += ["", "Exemplos (3 por classe, maior probabilidade primeiro):", ""] + [f"- {k}: `{v}`" for k, v in exemplos.items()]
    md += ["", "Cruzamento com os tipos que o técnico marcou (rótulo × classe do CLIP):", ""]
    md += [f"- {k}: {v}" for k, v in list(res["cruzamento_rotulo_tecnico"].items())[:15]]
    md += ["", f"## Verdadeiros deitados fora com o limiar {t_rec}: {len(verd_fora)}\n",
           f"Recortes em `{(ex / 'verdadeiros_deitados_fora').relative_to(ROOT)}`.", "",
           "## Tipo de contentor (só verdadeiros)\n",
           f"**Vale pouco: só {tipo_res['rotulados_com_tipo']} verdadeiros têm tipo marcado.** "
           f"Certos: {tipo_res['certos']} de {tipo_res['rotulados_com_tipo']}.", "",
           f"- rótulo → previsto: {tipo_res['confusao']}", f"- previsto em todos os verdadeiros: {tipo_res['previsto_nos_verdadeiros']}"]
    (out / "filtro_clip.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


# ----------------------------------------------------------------- pipeline

def main() -> None:
    cfg = load_config()
    f = cfg_filtro(cfg)
    if not f["ativo"]:
        print("contentores_clip: desligado (contentores_clip.ativo: false) — nada a fazer")
        return
    zdir = zone_dir(cfg)
    p = zdir / "deteccoes/deteccoes.json"
    dets = json.load(open(p, encoding="utf-8"))
    cont = [d for d in dets if d["classe"] == "contentor"]
    cl = classificar(recortes(cont, zdir, f), novo_clip(), f)
    lim = f["limiar"]
    for d, c in zip(cont, cl):
        d["extra"].update(clip_contentor=c["p_contentor"], clip_classe=c["classe"],
                          clip_rejeitado=(lim is not None and c["p_contentor"] < float(lim)),
                          clip_tipo=c["tipo"], tipo_motivo=c["tipo_motivo"])
        if f["escrever_tipo"]:      # tipo → subclasse → subtipo do catálogo (18/11: acerta 6 de 12)
            d["subclasse"] = c["tipo"]
    json.dump(dets, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"{len(cont)} contentores: classes {dict(Counter(c['classe'] for c in cl))}; "
          f"rejeitados {sum(d['extra']['clip_rejeitado'] for d in cont)} (limiar {lim}); "
          f"tipos {dict(Counter(d['subclasse'] for d in cont))}")


if __name__ == "__main__":
    medir() if sys.argv[1:2] == ["medir"] else main()
