#!/usr/bin/env python3
"""Percurso completo da M4 sobre dados FALSOS, para apanhar erros de caminhos,
formatos e exceções antes do teste com os dados reais.

    python tests/percurso_m4.py [--sem-browser]

  1. gera tests/dados_falsos/ (tests/gerar_dados_falsos.py)
  2. classificação → M5 → fusão → exportação (run_all.py --desde classify_signs),
     com o CLIP/torch falsos de tests/fakes/
  3. página de rotulagem (sinais + contentores)
  4. rotulagem: no browser (Firefox/geckodriver + selenium, se houver), com as
     teclas reais da página; senão escreve os .json no mesmo formato
  5. smoke test (m4_verificar.py) e medição (m4_medir.py --varrer)
  6. contentores: importar para labels.json → score do teste de prompts
     (primeiro com um incerto: o score tem de recusar; depois resolvido) →
     contentores_medir.py

Tudo escreve em tests/dados_falsos/ (CTRLF_CONFIG); nada em data/ nem em reports/.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ROOT = AQUI.parent
BASE = AQUI / "dados_falsos"
PY = sys.executable
sys.path.insert(0, str(ROOT / "pipeline"))

ENV = {**os.environ, "CTRLF_CONFIG": str(BASE / "config.yaml"), "CTRLF_CLIP_ORACULO": str(BASE / "clip_oraculo.json"),
       "PYTHONPATH": os.pathsep.join([str(AQUI / "fakes"), os.environ.get("PYTHONPATH", "")])}
ZDIR = BASE / "data/clean/aveiro/santos-martires"
M4 = BASE / "reports/m4"
falhas: list[str] = []


def correr(*args, espera_ok=True) -> subprocess.CompletedProcess:
    print(f"\n$ python {' '.join(args)}", flush=True)
    r = subprocess.run([PY, *args], cwd=ROOT, env=ENV, capture_output=True, text=True)
    print(r.stdout.rstrip())
    if r.stderr.strip():
        print(r.stderr.rstrip(), file=sys.stderr)
    if "CLIP FALSO" in r.stderr:
        falhas.append(f"{args[0]}: o CLIP falso recebeu imagens fora do oráculo (recorte diferente do esperado)")
    if espera_ok and r.returncode:
        sys.exit(f"FALHOU ({r.returncode}): {' '.join(args)}")
    return r


def verifica(cond: bool, msg: str) -> None:
    print(("  ok    " if cond else "  FALHA ") + msg)
    if not cond:
        falhas.append(msg)


# ---------------------------------------------------------------- rotulagem

def teclas_sinais() -> dict[str, str]:
    from m4_rotular import TECLAS_SINAIS
    return {r: k for k, r, _ in TECLAS_SINAIS}


def rotular_browser(verdade: dict) -> bool:
    try:
        from selenium import webdriver
        from selenium.webdriver.firefox.options import Options
        from selenium.webdriver.firefox.service import Service
    except ImportError:
        print("  (sem selenium: rótulos escritos diretamente)")
        return False
    gd = shutil.which("geckodriver") or ("/snap/bin/geckodriver" if Path("/snap/bin/geckodriver").exists() else None)
    if not gd:
        print("  (sem geckodriver: rótulos escritos diretamente)")
        return False
    o = Options()
    o.add_argument("-headless")
    d = webdriver.Firefox(options=o, service=Service(gd))
    try:
        d.get((M4 / "rotular.html").as_uri())
        q = d.execute_script
        corpo = d.find_element("tag name", "body")
        tk = teclas_sinais()
        modos = q("return window.__rotular.modos()")
        verifica(modos == ["sinais", "contentores"], f"página com os dois modos ({modos})")
        for i, nome in enumerate(modos):
            d.find_elements("css selector", "#tabs button")[i].click()
            verifica(q("return window.__rotular.atual().nome") == nome, f"separador {nome} ativo")
            primeiro = True
            while (iid := q("const M = window.__rotular.atual(); return M.idx < 0 ? null : M.itens[M.idx].id")) is not None:
                v = verdade["sinais"][iid]["rotulo"] if nome == "sinais" else verdade["contentores"][iid]["tecla"]
                tecla = tk[v] if nome == "sinais" else v
                if primeiro:   # testa o desfazer: rótulo errado, z, rótulo certo
                    corpo.send_keys("n" if nome == "sinais" else "v")
                    corpo.send_keys("z")
                    verifica(q("const M = window.__rotular.atual(); return M.itens[M.idx].id") == iid
                             and not q(f"return !!window.__rotular.atual().estado.rotulos['{iid}']"),
                             f"{nome}: z desfaz e volta ao recorte")
                    primeiro = False
                corpo.send_keys(tecla)
            verifica("Tudo rotulado" in q("return document.getElementById('info').textContent"), f"{nome}: fim da fila")
            estado = json.loads(q("return JSON.stringify(window.__rotular.atual().estado)"))   # = o que "Descarregar" grava
            destino = M4 / ("rotulos.json" if nome == "sinais" else "rotulos_contentores.json")
            destino.write_text(json.dumps(estado, indent=1, ensure_ascii=False), encoding="utf-8")
        d.set_window_size(390, 800)
        verifica(not q("return document.documentElement.scrollWidth > document.documentElement.clientWidth"),
                 "sem scroll horizontal à largura de telemóvel")
    finally:
        d.quit()
    return True


def rotular_direto(verdade: dict) -> None:
    """Mesmo formato que a página grava."""
    import m4_rotular as mr
    from common import load_config
    os.environ.update(CTRLF_CONFIG=ENV["CTRLF_CONFIG"])
    cfg = load_config()
    sys.argv = [sys.argv[0], "--versao=v_teste"]
    agora = "2026-11-18T00:00:00Z"
    sin = {it["id"]: {**it["base"], "rotulo": verdade["sinais"][it["id"]]["rotulo"], "quando": agora}
           for it in mr.itens_sinais(cfg, M4)}
    campos = {k: (r, c) for k, r, _, c in mr.TECLAS_CONTENTORES}
    con = {}
    for it in mr.itens_contentores(cfg, M4)[0]:
        r, c = campos[verdade["contentores"][it["id"]]["tecla"]]
        con[it["id"]] = {**it["base"], "rotulo": r, **c, "quando": agora}
    for nome, rot in (("rotulos.json", sin), ("rotulos_contentores.json", con)):
        (M4 / nome).write_text(json.dumps({"versao": 1, "atualizado": agora, "rotulos": rot}, indent=1), encoding="utf-8")


# --------------------------------------------------------------------- main

def main() -> None:
    correr("tests/gerar_dados_falsos.py")
    verdade = json.loads((BASE / "verdade.json").read_text(encoding="utf-8"))

    # 2. classificação → posição → fusão → exportação
    correr("pipeline/run_all.py", "--desde", "classify_signs")
    dets = json.loads((ZDIR / "deteccoes/deteccoes.json").read_text(encoding="utf-8"))
    sinais = [d for d in dets if d["classe"] == "sinal"]
    verifica(all(d["extra"].get("classificador") == "m4-p5" for d in sinais), "todos os sinais classificados com p5")
    # pelo menos um STOP certo, cedência e limite_40 por algarismos
    por_obj = {}
    for d in sinais:
        por_obj.setdefault(verdade["sinais"][d["id"]]["objeto"], []).append(d["subclasse"])
    print("  subclasses por objeto:", por_obj)
    verifica("stop" in por_obj["B"], "STOP (octógono + prompt stop sign)")
    verifica("cedencia_passagem" in por_obj["C"], "cedência pela forma")
    verifica("limite_40" in por_obj["A"], "limite 40 pelos algarismos")
    verifica(set(por_obj["G"]) == {"outro_sinal"} and all(
        d["extra"]["m4_incerto"] for d in sinais if verdade["sinais"][d["id"]]["objeto"] == "G"),
        "prompt stop sign sem octógono → fila (veto)")
    verifica(set(por_obj["D"]) <= {"costas", "outro_sinal"}, "sinal de costas não vira sinal específico")
    els = json.loads((ZDIR / "catalogo/elementos.json").read_text(encoding="utf-8"))
    print("  elementos:", [(e["id"], e["subtipo"], e["n_vistas"], e["estado"], e.get("subtipo_motivo")) for e in els])
    verifica(all(e["estado"] == "pendente" for e in els if e.get("subtipo_incerto")), "subtipo incerto → pendente")
    verifica((ZDIR / "catalogo/catalogo.geojson").exists() and (ZDIR / "catalogo/catalogo.csv").exists(), "exportação escrita")
    # filtro CLIP dos contentores (ligado na config falsa, limiar 0,5)
    cont = [d for d in dets if d["classe"] == "contentor"]
    obj = {d["id"]: verdade["contentores"].get(d["id"], {}).get("objeto") for d in cont}
    verifica(all("clip_contentor" in d["extra"] for d in cont), "filtro CLIP anotou todos os contentores")
    ilha = [d for d in cont if d["extra"]["clip_classe"] == "contentor"]
    pap = [d for d in cont if d["extra"]["clip_classe"] == "papeleira"]
    verifica(len(ilha) == 3 and len(pap) == 3, f"filtro: 3 contentores e 3 papeleiras ({len(ilha)}/{len(pap)})")
    verifica(all(d["extra"]["clip_rejeitado"] for d in pap) and not any(d["extra"]["clip_rejeitado"] for d in ilha),
             "filtro: papeleiras rejeitadas, contentores mantidos")
    verifica(all(d["subclasse"] == "ilha_reciclagem" for d in ilha), "tipo: ilha de reciclagem pela cor")
    els_c = [e for e in els if e["tipo"] == "contentor"]
    verifica(len(els_c) == 1 and els_c[0]["subtipo"] == "ilha_reciclagem",
             f"fusão: só o contentor verdadeiro chega ao catálogo, com subtipo ({[(e['subtipo'], e['n_vistas']) for e in els_c]})")

    # 3–4. página + rotulagem
    correr("pipeline/m4_rotular.py", "--versao=v_teste")
    verifica((M4 / "rotular.html").exists(), "página gerada")
    if "--sem-browser" in sys.argv or not rotular_browser(verdade):
        rotular_direto(verdade)
    rot = json.loads((M4 / "rotulos.json").read_text(encoding="utf-8"))["rotulos"]
    n_pag = sum(1 for d in sinais if max(d["bbox"][2] - d["bbox"][0], d["bbox"][3] - d["bbox"][1]) >= 30)
    verifica(len(rot) == n_pag, f"rotulos.json com {len(rot)} recortes (esperados {n_pag}, lado ≥ 30 px)")
    verifica(all({"rotulo", "imagem_id", "bbox"} <= set(r) for r in rot.values()), "formato dos rótulos de sinais")
    # regenerar a página não perde rótulos
    r = correr("pipeline/m4_rotular.py", "--versao=v_teste")
    verifica(f"{len(rot)} já rotulados" in r.stdout, "regenerar a página mantém os rótulos")

    # 5. smoke test + medição
    correr("pipeline/m4_verificar.py")
    smk = json.loads((M4 / "smoke.json").read_text(encoding="utf-8"))
    verifica(not smk["erros"] and list(smk["variantes"]) == ["atual", "p1", "p3", "p4", "p5"], "smoke: 5 variantes sem erros")
    verifica(all(set(v) <= {"limite_30", "limite_40", "limite_50", "limite_desconhecido"}
                 for k, v in smk["valores_de_limite_previstos"].items() if k != "atual"), "smoke: só 30/40/50 em p1–p5")
    verifica((M4 / "folha_contactos.html").exists(), "folha de contactos")
    correr("pipeline/m4_medir.py", "--varrer")
    med = json.loads((M4 / "medicao.json").read_text(encoding="utf-8"))
    verifica(list(med["variantes"]) == ["atual", "p1", "p3", "p4", "p5"], "medição das 5 variantes")
    verifica(med["passo_final"] == "p5" and med["confusao_final"], "matriz de confusão do passo final")
    verifica(med["variantes"]["p5"]["_resumo"]["erros_especificos"] == 0, "p5 sem erros específicos nos dados falsos")
    for e in med["erros_frequentes"]:
        verifica(any((ROOT / e["pasta"]).glob("*_largo.jpg")) and any((ROOT / e["pasta"]).glob("*_justo.jpg")),
                 f"exemplos em {e['pasta']}")
    verifica((M4 / "medicao.md").exists() and (M4 / "predicoes.json").exists(), "medicao.md e predicoes.json")

    # 6. contentores → labels.json → score
    lp = BASE / "reports/yolo_world_test/labels.json"
    antes = len(json.loads(lp.read_text())["caixas"])
    r = correr("pipeline/m4_rotular.py", "importar-contentores", "--versao=v_teste")
    depois = json.loads(lp.read_text())["caixas"]
    verifica(len(depois) == antes + len(verdade["contentores"]) - 1, "importados todos menos o incerto")
    verifica(all(set(c) >= {"image", "grupo", "bbox", "real"} for c in depois), "formato de labels.json")
    verifica(any(c.get("tipo") == "ilha_reciclagem" for c in depois), "tipo de contentor guardado")
    verifica(any(c.get("falso_tipo") == "papeleira" for c in depois), "tipo do falso guardado")
    verifica(any(c.get("det_id") for c in depois), "contentor só do pipeline rotulado pelo id da deteção")
    r = correr("pipeline/test_yolo_world_prompts.py", "score", "--versao=v_teste", espera_ok=False)
    verifica(r.returncode != 0 and "por rotular" in (r.stdout + r.stderr), "score recusa enquanto há um incerto")
    rc = M4 / "rotulos_contentores.json"
    j = json.loads(rc.read_text(encoding="utf-8"))
    for v in j["rotulos"].values():
        if v.get("real") is None:
            v.update(rotulo="ilha", real=True, tipo="ilha_reciclagem")
    rc.write_text(json.dumps(j, indent=1), encoding="utf-8")
    correr("pipeline/m4_rotular.py", "importar-contentores", "--versao=v_teste")
    correr("pipeline/test_yolo_world_prompts.py", "score", "--versao=v_teste")
    verifica((BASE / "reports/yolo_world_test/v_teste/resultados.json").exists(), "score dos contentores corre")
    correr("pipeline/contentores_medir.py")
    cm = json.loads((BASE / "reports/contentores/medicao.json").read_text(encoding="utf-8"))
    verifica(cm["rotuladas"] == cm["deteccoes"] and cm["verdadeiros"] == 3 and cm["falsos"] == 3,
             f"medição dos contentores ({cm['verdadeiros']} verdadeiros / {cm['falsos']} falsos de {cm['deteccoes']})")
    verifica("falso_papeleira" in cm["exemplos"], "exemplos por tipo de falso")
    correr("pipeline/contentores_clip.py", "medir")
    fc = json.loads((BASE / "reports/contentores/filtro_clip.json").read_text(encoding="utf-8"))
    verifica(fc["modos"][fc["modo_escolhido"]]["auc"] == 1.0, f"medição do filtro (AUC {fc['modos'][fc['modo_escolhido']]['auc']})")
    verifica(fc["falsos_por_classe_negativa"] == {"papeleira": 3}, f"falsos por classe negativa {fc['falsos_por_classe_negativa']}")

    print("\n" + ("TUDO OK" if not falhas else f"{len(falhas)} FALHAS:\n  - " + "\n  - ".join(falhas)))
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
