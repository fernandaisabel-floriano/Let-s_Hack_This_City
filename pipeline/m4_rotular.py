#!/usr/bin/env python3
"""Página local de rotulagem: sinais (M4) e contentores (teste do YOLO-World).

    python pipeline/m4_rotular.py [--versao=v4_video]   → <m4.relatorios>/rotular.html
    python pipeline/m4_rotular.py importar-contentores [--versao=v4_video]
    python pipeline/m4_rotular.py folha-incertos   → contentores_incertos.html
    (versão do teste de prompts por omissão: m4.contentores_versao)

Abrir o HTML no browser (file://, sem servidor). Um recorte de cada vez, com a
caixa marcada e a imagem inteira ao lado. Dois modos (separadores no topo):

  Sinais — recortes da M4 (deteccoes.json, lado maior ≥ m4.rotular_lado_min_px)
    s stop   c cedência   3/4/5 limite 30/40/50   l limite (outro valor)
    o outro sinal de frente   k de costas   n não é sinal
    → m4.rotulos (reports/m4/rotulos.json)

  Contentores — tudo o que ainda não tem rótulo em labels.json, sem duplicados:
    as deteções de contentor da M3 (deteccoes.json, recorte largo) e os objetos
    do teste de prompts m4.contentores_versao cuja imagem ainda exista em data/
    (ampliação da imagem; #número = o das folhas _rotular/)
    v verdadeiro   1/2/3 verdadeiro: subterrâneo / ilha / indiferenciado
    f falso (papeleiras são falsos)   i incerto
    tipo do falso, opcional: p papeleira  a armário/caixa técnica
                             b banco/floreira  m mota/carro  x outra coisa
    → m4.rotulos_contentores (reports/m4/rotulos_contentores.json)

  Em ambos: z desfazer, ← → navegar (rotular por cima substitui).

Gravação: Chrome/Edge — "Ligar ao ficheiro" (escolher o .json acima) e grava a
cada rótulo; qualquer browser — grava no browser e "Descarregar" gera o .json.

`importar-contentores` junta os verdadeiros/falsos ao labels.json do teste de
prompts, no formato que `test_yolo_world_prompts.py score` lê
({image, grupo, bbox, real} + tipo / falso_tipo / conf / fonte / det_id quando
existem; o score ignora os campos a mais). Os incertos não entram
(o score recusa enquanto houver objetos por rotular: decidir esses à parte).
"""
from __future__ import annotations

import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, lado_px, load_config, recorte_largo_janela, zone_dir  # noqa: E402

TECLAS_SINAIS = [
    ["s", "stop", "STOP"], ["c", "cedencia", "Cedência de passagem"],
    ["3", "limite_30", "Limite 30"], ["4", "limite_40", "Limite 40"], ["5", "limite_50", "Limite 50"],
    ["l", "limite_outro", "Limite (outro valor)"], ["o", "outro_frente", "Outro sinal, de frente"],
    ["k", "costas", "De costas"], ["n", "nao_sinal", "Não é sinal"],
]
# tecla, rótulo, nome, campos gravados
TECLAS_CONTENTORES = [
    ["v", "verdadeiro", "Verdadeiro", {"real": True, "tipo": None}],
    ["1", "subterraneo", "Verdadeiro: subterrâneo", {"real": True, "tipo": "subterraneo"}],
    ["2", "ilha", "Verdadeiro: ilha de reciclagem", {"real": True, "tipo": "ilha_reciclagem"}],
    ["3", "indiferenciado", "Verdadeiro: indiferenciado", {"real": True, "tipo": "indiferenciado"}],
    ["f", "falso", "Falso (sem tipo)", {"real": False, "tipo": None, "falso_tipo": None}],
    # tipo do falso, opcional (para o relatório dos falsos mais frequentes)
    ["p", "falso_papeleira", "Falso: papeleira", {"real": False, "tipo": None, "falso_tipo": "papeleira"}],
    ["a", "falso_armario", "Falso: armário / caixa técnica", {"real": False, "tipo": None, "falso_tipo": "armario"}],
    ["b", "falso_banco", "Falso: banco / floreira", {"real": False, "tipo": None, "falso_tipo": "banco_floreira"}],
    ["m", "falso_veiculo", "Falso: mota / carro", {"real": False, "tipo": None, "falso_tipo": "veiculo"}],
    ["x", "falso_outro", "Falso: outra coisa", {"real": False, "tipo": None, "falso_tipo": "outro"}],
    ["i", "incerto", "Incerto", {"real": None, "tipo": None}],
]


def _arg(name: str, default=None):
    return next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{name}=")), default)


def _ler(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def itens_sinais(cfg: dict, out_dir: Path) -> list[dict] | None:
    m4 = cfg.get("m4") or {}
    lmin = float(m4.get("rotular_lado_min_px", 30))
    zdir = zone_dir(cfg)
    p = zdir / "deteccoes/deteccoes.json"
    if not p.exists():
        return None
    out = []
    for d in json.load(open(p, encoding="utf-8")):
        if d["classe"] != "sinal" or lado_px(d["bbox"]) < lmin:
            continue
        e = d["extra"]
        W, H = e["width"], e["height"]
        x1, y1, x2, y2 = d["bbox"]
        wx0, wy0, wx1, wy1 = recorte_largo_janela(d["bbox"], W, H)
        cw, ch = wx1 - wx0, wy1 - wy0
        out.append({
            "id": d["id"], "lado": round(lado_px(d["bbox"]), 1),
            "base": {"imagem_id": e["imagem_id"], "bbox": d["bbox"], "lado_px": round(lado_px(d["bbox"]), 1)},
            "recorte": os.path.relpath(zdir / d["recorte"], out_dir),
            "imagem": os.path.relpath(zdir / e["imagem"], out_dir),
            # caixa em frações do recorte e da imagem (para a moldura em CSS)
            "cx": [(x1 - wx0) / cw, (y1 - wy0) / ch, (x2 - x1) / cw, (y2 - y1) / ch],
            "ix": [x1 / W, y1 / H, (x2 - x1) / W, (y2 - y1) / H],
            "info": f"{d['id']} · lado {lado_px(d['bbox']):.0f} px · {e.get('fonte')} · conf. deteção {d['confianca']}",
        })
    return out


def _yw(cfg: dict) -> tuple[Path, str]:
    versao = _arg("versao", (cfg.get("m4") or {}).get("contentores_versao", "v4_video"))
    return ROOT / (cfg.get("relatorios_yolo_world") or "reports/yolo_world_test"), versao


def contentores_por_rotular(cfg: dict) -> tuple[list[dict], dict] | None:
    """Objetos 'contentor' do raw_detections.json ainda sem rótulo em labels.json."""
    from test_yolo_world_prompts import match_label
    base, versao = _yw(cfg)
    raw = _ler(base / versao / "raw_detections.json")
    if raw is None:
        return None
    labels = (_ler(base / "labels.json") or {}).get("caixas", [])
    return [o for o in raw["objetos"] if o["grupo"] == "contentor" and match_label(o, labels) is None], raw


def _imagens(cfg: dict) -> dict:
    imgs = {}
    for csvp in zone_dir(cfg).glob("**/images.csv"):
        for row in csv.DictReader(open(csvp, encoding="utf-8")):
            imgs[row["id"]] = (csvp.parent / row["ficheiro"], int(row["width"]), int(row["height"]))
    return imgs


def itens_contentores(cfg: dict, out_dir: Path) -> tuple[list[dict], dict] | None:
    """Contentores por rotular, sem duplicados:

    1. objetos do teste de prompts (m4.contentores_versao) cuja imagem ainda existe;
    2. deteções de contentor da M3 (deteccoes.json) sem rótulo em labels.json e
       que não sejam já um objeto de 1. (mesma imagem, IoU ≥ 0,5).
    Devolve (itens, contagens).
    """
    from test_yolo_world_prompts import iou, load_labels, match_label
    base, versao = _yw(cfg)
    labels = (_ler(base / "labels.json") or {}).get("caixas", [])
    imgs = _imagens(cfg)
    zdir = zone_dir(cfg)
    out, cont = [], {"teste_por_rotular": 0, "teste_sem_imagem": 0, "pipeline_total": 0,
                     "pipeline_ja_rotulados": 0, "pipeline_duplicados_do_teste": 0}
    r = contentores_por_rotular(cfg)
    for o in (r[0] if r else []):
        cont["teste_por_rotular"] += 1
        if o["image"] not in imgs:
            cont["teste_sem_imagem"] += 1
            continue
        path, W, H = imgs[o["image"]]
        x1, y1, x2, y2 = o["bbox"]
        # janela como nas folhas _rotular/ (metade da caixa de cada lado, mínimo 40 px)
        pw, ph = max(40, (x2 - x1) / 2), max(40, (y2 - y1) / 2)
        X1, Y1, X2, Y2 = max(0, x1 - pw), max(0, y1 - ph), min(W, x2 + pw), min(H, y2 + ph)
        ww, wh = X2 - X1, Y2 - Y1
        out.append({
            "id": f"{versao}#{o['obj']}",
            "base": {"image": o["image"], "grupo": "contentor", "bbox": o["bbox"], "obj": o["obj"], "versao": versao,
                     "conf": o["max_conf"], "origem": "teste_prompts"},
            "imagem": os.path.relpath(path, out_dir),
            "zoom": {"janela": [X1 / W, Y1 / H, ww / W, wh / H], "aspeto": ww / max(wh, 1)},
            "cx": [(x1 - X1) / ww, (y1 - Y1) / wh, (x2 - x1) / ww, (y2 - y1) / wh],
            "ix": [x1 / W, y1 / H, (x2 - x1) / W, (y2 - y1) / H],
            "info": f"teste {versao} #{o['obj']} · {o['image']} · conf. máx. {o['max_conf']}",
        })
    teste = [(it["base"]["image"], it["base"]["bbox"]) for it in out]
    p = zdir / "deteccoes/deteccoes.json"
    dets = json.load(open(p, encoding="utf-8")) if p.exists() else []
    novos = []
    for d in dets:
        if d["classe"] != "contentor":
            continue
        cont["pipeline_total"] += 1
        e = d["extra"]
        o = {"image": e["imagem_id"], "grupo": "contentor", "bbox": d["bbox"]}
        if match_label(o, labels) is not None:
            cont["pipeline_ja_rotulados"] += 1
            continue
        if any(im == o["image"] and iou(bb, d["bbox"]) >= 0.5 for im, bb in teste):
            cont["pipeline_duplicados_do_teste"] += 1
            continue
        W, H = e["width"], e["height"]
        x1, y1, x2, y2 = d["bbox"]
        wx0, wy0, wx1, wy1 = recorte_largo_janela(d["bbox"], W, H)
        cw, ch = wx1 - wx0, wy1 - wy0
        novos.append({
            "id": d["id"],
            "base": {**o, "det_id": d["id"], "fonte": e.get("fonte"), "conf": d["confianca"],
                     "prompt": e.get("prompt"), "lado_px": round(lado_px(d["bbox"]), 1), "origem": "pipeline_m3"},
            "recorte": os.path.relpath(zdir / d["recorte"], out_dir),
            "imagem": os.path.relpath(zdir / e["imagem"], out_dir),
            "cx": [(x1 - wx0) / cw, (y1 - wy0) / ch, (x2 - x1) / cw, (y2 - y1) / ch],
            "ix": [x1 / W, y1 / H, (x2 - x1) / W, (y2 - y1) / H],
            "info": f"{d['id']} · {e.get('fonte')} · lado {lado_px(d['bbox']):.0f} px · conf. {d['confianca']} · {e.get('prompt')}",
            "_ordem": (e.get("fonte") or "", e["imagem"], x1),
        })
    novos.sort(key=lambda it: it.pop("_ordem"))
    cont["pipeline_por_rotular"] = len(novos)
    return out + novos, cont


def main() -> None:
    cfg = load_config()
    m4 = cfg.get("m4") or {}
    out_dir = ROOT / m4.get("relatorios", "reports/m4")
    out_dir.mkdir(parents=True, exist_ok=True)
    modos = []
    sin = itens_sinais(cfg, out_dir)
    if sin is not None:
        rp = ROOT / m4.get("rotulos", "reports/m4/rotulos.json")
        modos.append({"nome": "sinais", "titulo": "Sinais", "itens": sin, "rotulos": _ler(rp),
                      "teclas": [[k, r, n, {"rotulo": r}] for k, r, n in TECLAS_SINAIS],
                      "ficheiro": rp.name, "vista": "recorte"})
    con, cont = itens_contentores(cfg, out_dir)
    if con:
        rp = ROOT / m4.get("rotulos_contentores", "reports/m4/rotulos_contentores.json")
        modos.append({"nome": "contentores", "titulo": "Contentores", "itens": con, "rotulos": _ler(rp),
                      "teclas": [[k, r, n, {"rotulo": r, **campos}] for k, r, n, campos in TECLAS_CONTENTORES],
                      "ficheiro": rp.name, "vista": "zoom"})
        print(f"Contentores: {cont}")
    if not modos:
        sys.exit("nada para rotular: sem deteccoes.json nem raw_detections.json")
    dados = {"zona": f"{cfg['municipio']}/{cfg['zona']}", "modos": modos}
    html = PAGINA.replace("/*DADOS*/null", json.dumps(dados, ensure_ascii=False).replace("</", "<\\/"))
    (out_dir / "rotular.html").write_text(html, encoding="utf-8")
    for m in modos:
        print(f"{m['titulo']}: {len(m['itens'])} recortes, {len((m['rotulos'] or {}).get('rotulos', {}))} já rotulados")
    if cont["teste_sem_imagem"]:
        print(f"  aviso: {cont['teste_sem_imagem']} objetos do teste {_yw(cfg)[1]} sem imagem em data/ "
              "(frames reprocessados?) — não aparecem na página")
    print(f"→ {(out_dir / 'rotular.html').relative_to(ROOT)}")


def importar_contentores() -> None:
    from test_yolo_world_prompts import match_label
    cfg = load_config()
    m4 = cfg.get("m4") or {}
    rp = ROOT / m4.get("rotulos_contentores", "reports/m4/rotulos_contentores.json")
    rot = _ler(rp)
    if rot is None:
        sys.exit(f"sem {rp.relative_to(ROOT)}")
    base, _ = _yw(cfg)
    lp = base / "labels.json"
    data = _ler(lp) or {}
    caixas = data.setdefault("caixas", [])
    novos = incertos = ja = 0
    for r in rot["rotulos"].values():
        if r.get("real") is None:
            incertos += 1
            continue
        o = {"image": r["image"], "grupo": "contentor", "bbox": r["bbox"]}
        if match_label(o, caixas) is not None:
            ja += 1
            continue
        caixas.append({**o, "real": bool(r["real"]),
                       **{k: r[k] for k in ("tipo", "falso_tipo", "conf", "fonte", "det_id") if r.get(k) is not None}})
        novos += 1
    data.setdefault("rotulado_por", {})
    if isinstance(data["rotulado_por"], dict):
        data["rotulado_por"]["contentores_pagina_m4"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lp.write_text(json.dumps(data, indent=0, ensure_ascii=False), encoding="utf-8")
    print(f"{novos} rótulos novos em {lp.relative_to(ROOT)} ({ja} já existiam, {incertos} incertos não importados)")
    r = contentores_por_rotular(cfg)
    if r is not None and r[0]:
        print(f"  ainda {len(r[0])} contentores por rotular nesta versão — o score só corre com tudo rotulado")


PAGINA = r"""<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rotular recortes</title>
<style>
  :root { --bg:#f6f6f4; --fg:#1d1d1b; --muted:#6b6b66; --card:#fff; --line:#d9d9d4; --acc:#c62828; --ok:#2e7d32; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1b1b1a; --fg:#ecece8; --muted:#a3a39c; --card:#262624; --line:#3a3a37; --acc:#ef5350; --ok:#66bb6a; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.4 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  header { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0 6px 0 0; }
  .tabs { display:flex; gap:4px; }
  .tabs button[aria-selected="true"] { background:var(--fg); color:var(--bg); border-color:var(--fg); }
  .barra { flex:1; min-width:120px; height:8px; background:var(--line); border-radius:4px; overflow:hidden; }
  .barra > div { height:100%; background:var(--ok); width:0; }
  button, label.btn { font:inherit; padding:5px 10px; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:6px; cursor:pointer; }
  #estadoGravar { color:var(--muted); font-size:13px; }
  main { display:grid; grid-template-columns: minmax(0,1fr) 300px; gap:16px; padding:16px; max-width:1300px; margin:0 auto; }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
  .palco, aside { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; min-width:0; }
  .vistas { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; }
  .moldura { position:relative; display:inline-block; line-height:0; max-width:100%; }
  .moldura img { display:block; max-width:100%; }
  #recorte { height:min(56vh, 460px); width:auto; image-rendering:pixelated; }
  #zoom { position:relative; overflow:hidden; width:min(100%, 460px); }
  #zoom img { position:absolute; max-width:none; }
  #inteira { width:min(100%, 420px); height:auto; }
  .caixa { position:absolute; border:2px solid var(--acc); pointer-events:none; }
  .info { margin-top:8px; color:var(--muted); font-size:13px; overflow-wrap:anywhere; }
  #atual { font-size:18px; font-weight:600; margin-top:6px; min-height:1.4em; }
  table { border-collapse:collapse; width:100%; }
  td { padding:4px 6px; border-bottom:1px solid var(--line); }
  kbd { display:inline-block; min-width:22px; text-align:center; padding:1px 5px; border:1px solid var(--line); border-bottom-width:2px; border-radius:4px; font:13px ui-monospace, monospace; background:var(--bg); }
  td.n { text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
  .feito { text-align:center; padding:60px 20px; font-size:18px; }
</style>
</head>
<body>
<header>
  <h1>Rotular</h1>
  <div class="tabs" id="tabs"></div>
  <div class="barra"><div id="barra"></div></div>
  <span id="progresso"></span>
  <button id="ligar" title="Chrome/Edge: escolher o ficheiro de rótulos deste modo">Ligar ao ficheiro</button>
  <button id="rever" title="Percorrer só os recortes marcados incerto (rotular por cima substitui)">Rever incertos</button>
  <button id="descarregar">Descarregar</button>
  <label class="btn">Carregar…<input id="carregar" type="file" accept=".json" hidden></label>
  <span id="estadoGravar"></span>
</header>
<main>
  <section class="palco" id="palco">
    <div class="vistas" id="vistas">
      <div class="moldura" id="molduraR"><img id="recorte" alt="recorte"><div class="caixa" id="caixaR"></div></div>
      <div class="moldura" id="molduraZ"><div id="zoom"><img id="zoomImg" alt="ampliação"><div class="caixa" id="caixaZ"></div></div></div>
      <div class="moldura"><img id="inteira" alt="imagem inteira"><div class="caixa" id="caixaI"></div></div>
    </div>
    <div id="atual"></div>
    <div class="info" id="info"></div>
  </section>
  <aside>
    <table id="teclas"></table>
    <p class="info"><kbd>z</kbd> desfazer · <kbd>←</kbd> <kbd>→</kbd> navegar (rotular por cima substitui)</p>
  </aside>
</main>
<script>
const DADOS = /*DADOS*/null;
const $ = id => document.getElementById(id);
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

// um estado por modo; o mais recente entre o .json embutido na geração e o do browser
const MODOS = DADOS.modos.map(m => {
  const chave = "rotular:" + DADOS.zona + ":" + m.nome;
  let estado = { versao: 1, modo: m.nome, zona: DADOS.zona, atualizado: null, rotulos: {} };
  const escolhido = [m.rotulos, lsGet(chave)].filter(Boolean)
    .sort((x, y) => String(y.atualizado || "").localeCompare(String(x.atualizado || "")))[0];
  if (escolhido) estado = { ...estado, ...escolhido, rotulos: { ...(escolhido.rotulos || {}) } };
  const md = { ...m, chave, estado, historico: [], idx: 0, ficheiro: null, fila: Promise.resolve(),
    tecla: Object.fromEntries(m.teclas.map(t => [t[0], t])), nome_rotulo: Object.fromEntries(m.teclas.map(t => [t[1], t[2]])) };
  md.idx = proximo(md, 0);
  return md;
});
let M = MODOS.find(m => m.nome === lsGet("rotular:modo")) || MODOS[0];

// "Rever incertos": a fila passa a ser os recortes ainda sem rótulo OU marcados incerto
function porFazer(m, it) {
  const r = m.estado.rotulos[it.id];
  return !r || (m.rever && r.rotulo === "incerto");
}
function proximo(m, desde) {
  for (let k = 0; k < m.itens.length; k++) {
    const j = (desde + k) % m.itens.length;
    if (porFazer(m, m.itens[j])) return j;
  }
  return -1;
}

function gravar(m) {
  m.estado.atualizado = new Date().toISOString();
  lsSet(m.chave, m.estado);
  const el = $("estadoGravar");
  if (!m.ficheiro) { el.textContent = "gravado no browser — Descarregar ou Ligar"; return; }
  const texto = JSON.stringify(m.estado, null, 1);
  m.fila = m.fila.then(async () => {
    const w = await m.ficheiro.createWritable(); await w.write(texto); await w.close();
    el.textContent = "gravado em " + m.ficheiro.name + " " + new Date().toLocaleTimeString();
  }).catch(e => { el.textContent = "erro a gravar: " + e.message; });
}

function rotular(t) {
  if (M.idx < 0) return;
  const it = M.itens[M.idx];
  M.estado.rotulos[it.id] = { ...it.base, ...t[3], quando: new Date().toISOString() };
  M.historico.push(it.id);
  gravar(M);
  M.idx = proximo(M, M.idx + 1);
  mostrar();
}

function desfazer() {
  const id = M.historico.pop();
  if (!id) return;
  delete M.estado.rotulos[id];
  M.idx = M.itens.findIndex(i => i.id === id);
  gravar(M);
  mostrar();
}

function caixa(el, f) {
  el.style.left = (f[0] * 100) + "%"; el.style.top = (f[1] * 100) + "%";
  el.style.width = (f[2] * 100) + "%"; el.style.height = (f[3] * 100) + "%";
}

function mostrar() {
  $("tabs").innerHTML = MODOS.map((m, i) =>
    `<button data-i="${i}" aria-selected="${m === M}">${m.titulo}</button>`).join("");
  const ids = new Set(M.itens.map(i => i.id));
  const n = Object.keys(M.estado.rotulos).filter(id => ids.has(id)).length;
  const nInc = M.itens.filter(i => (M.estado.rotulos[i.id] || {}).rotulo === "incerto").length;
  $("progresso").textContent = n + " / " + M.itens.length + " rotulados" + (nInc ? " · " + nInc + " incertos" : "");
  $("rever").textContent = M.rever ? "Sair de rever incertos" : "Rever incertos";
  $("rever").style.display = M.teclas.some(t => t[1] === "incerto") ? "" : "none";
  $("barra").style.width = (100 * n / Math.max(1, M.itens.length)) + "%";
  const cont = {};
  Object.values(M.estado.rotulos).forEach(v => cont[v.rotulo] = (cont[v.rotulo] || 0) + 1);
  $("teclas").innerHTML = M.teclas.map(([k, r, nome]) =>
    `<tr><td><kbd>${k}</kbd></td><td>${nome}</td><td class="n">${cont[r] || 0}</td></tr>`).join("");
  if (M.idx < 0) {
    $("vistas").style.display = "none"; $("atual").textContent = "";
    $("info").innerHTML = '<div class="feito">' + (M.rever ? "Sem incertos por rever." : "Tudo rotulado.") +
      ' Confirme que o ' + M.ficheiro_nome() + ' foi gravado.</div>';
    return;
  }
  $("vistas").style.display = "";
  const it = M.itens[M.idx];
  const zoom = !it.recorte;
  $("molduraR").style.display = zoom ? "none" : "";
  $("molduraZ").style.display = zoom ? "" : "none";
  if (zoom) {
    const [x0, y0, ww, wh] = it.zoom.janela;
    $("zoom").style.aspectRatio = String(it.zoom.aspeto);
    const im = $("zoomImg");
    im.src = it.imagem;
    im.style.width = (100 / ww) + "%"; im.style.left = (-100 * x0 / ww) + "%"; im.style.top = (-100 * y0 / wh) + "%";
    caixa($("caixaZ"), it.cx);
  } else {
    $("recorte").src = it.recorte;
    caixa($("caixaR"), it.cx);
  }
  $("inteira").src = it.imagem;
  caixa($("caixaI"), it.ix);
  const r = M.estado.rotulos[it.id];
  $("atual").textContent = r ? "Rótulo: " + M.nome_rotulo[r.rotulo] : "";
  $("info").textContent = `${M.idx + 1} de ${M.itens.length} · ${it.info}`;
}
MODOS.forEach(m => m.ficheiro_nome = () => m.ficheiro ? m.ficheiro.name : m.ficheiro_padrao);
MODOS.forEach((m, i) => m.ficheiro_padrao = DADOS.modos[i].ficheiro);

$("tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  M = MODOS[+b.dataset.i]; lsSet("rotular:modo", M.nome); $("estadoGravar").textContent = ""; mostrar();
});

document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (M.tecla[k]) { rotular(M.tecla[k]); e.preventDefault(); }
  else if (k === "z") { desfazer(); e.preventDefault(); }
  else if (e.key === "ArrowRight") { M.idx = Math.min(M.itens.length - 1, Math.max(0, M.idx) + 1); mostrar(); }
  else if (e.key === "ArrowLeft") { M.idx = Math.max(0, (M.idx < 0 ? M.itens.length : M.idx) - 1); mostrar(); }
});

$("ligar").onclick = async () => {
  if (!window.showSaveFilePicker) { alert("Este browser não deixa gravar diretamente. Use Descarregar e ponha o ficheiro em reports/m4/" + M.ficheiro_padrao + "."); return; }
  try {
    M.ficheiro = await window.showSaveFilePicker({ suggestedName: M.ficheiro_padrao, types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
    gravar(M);
  } catch (e) { /* cancelado */ }
};

$("rever").onclick = () => {
  M.rever = !M.rever; M.idx = proximo(M, 0); mostrar();
};

$("descarregar").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(M.estado, null, 1)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: M.ficheiro_padrao });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$("carregar").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    M.estado = { ...M.estado, ...j, rotulos: { ...(j.rotulos || {}) } };
    M.historico = []; M.idx = proximo(M, 0); gravar(M); mostrar();
  } catch (err) { alert("Ficheiro inválido: " + err.message); }
  e.target.value = "";
};

window.addEventListener("beforeunload", e => {
  if (MODOS.some(m => !m.ficheiro && m.historico.length)) { e.preventDefault(); e.returnValue = ""; }
});
MODOS.forEach(m => lsSet(m.chave, m.estado));
// leitura para os testes automáticos (tests/percurso_m4.py)
window.__rotular = { modos: () => MODOS.map(m => m.nome), atual: () => M };
mostrar();
</script>
</body>
</html>
"""

def folha_incertos() -> None:
    """reports/m4/contentores_incertos.html: os contentores marcados incerto, numerados."""
    import html as H
    cfg = load_config()
    m4 = cfg.get("m4") or {}
    out_dir = ROOT / m4.get("relatorios", "reports/m4")
    rot = (_ler(ROOT / m4.get("rotulos_contentores", "reports/m4/rotulos_contentores.json")) or {}).get("rotulos", {})
    itens = {it["id"]: it for it in itens_contentores(cfg, out_dir)[0]}
    inc = [(k, r) for k, r in rot.items() if r.get("real") is None]
    cart = []
    for n, (k, r) in enumerate(inc, 1):
        it = itens.get(k)
        if it is None:
            cart.append(f"<figure><figcaption><b>{n}</b> {H.escape(k)} (já não está na página)</figcaption></figure>")
            continue
        def caixa(f):
            return f"left:{100*f[0]:.1f}%;top:{100*f[1]:.1f}%;width:{100*f[2]:.1f}%;height:{100*f[3]:.1f}%"
        img = (f'<div class="m"><img src="{H.escape(it["recorte"])}" loading="lazy" alt=""><div class="b" style="{caixa(it["cx"])}"></div></div>'
               if it.get("recorte") else "")
        cart.append(f'<figure>{img}<div class="m t"><img src="{H.escape(it["imagem"])}" loading="lazy" alt="">'
                    f'<div class="b" style="{caixa(it["ix"])}"></div></div><figcaption><b>{n}</b> · {H.escape(str(r.get("fonte")))} · '
                    f'conf {r.get("conf")} · {r.get("lado_px")} px<br><span class="id">{H.escape(k)}</span></figcaption></figure>')
    pagina = f"""<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contentores incertos</title><style>
:root{{--bg:#f6f6f4;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#d9d9d4;--acc:#c62828}}
@media (prefers-color-scheme: dark){{:root{{--bg:#1b1b1a;--fg:#ecece8;--muted:#a3a39c;--card:#262624;--line:#3a3a37;--acc:#ef5350}}}}
body{{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg)}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}}
figure{{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px}}
.m{{position:relative;line-height:0;margin-bottom:4px}} .m img{{width:100%;height:auto}} .m:not(.t) img{{image-rendering:pixelated}}
.b{{position:absolute;border:2px solid var(--acc)}} figcaption{{font-size:12px;color:var(--muted);overflow-wrap:anywhere}}
figcaption b{{color:var(--fg);font-size:14px}} .id{{font-size:11px}}
</style></head><body><h1 style="font-size:18px">Contentores marcados incerto — {len(inc)}</h1>
<p style="color:var(--muted)">Recorte (em cima) e imagem inteira (em baixo). Para decidir: página de rotulagem → Contentores → "Rever incertos".</p>
<div class="g">{"".join(cart)}</div></body></html>"""
    (out_dir / "contentores_incertos.html").write_text(pagina, encoding="utf-8")
    print(f"{len(inc)} incertos → {(out_dir / 'contentores_incertos.html').relative_to(ROOT)}")


if __name__ == "__main__":
    if sys.argv[1:2] == ["importar-contentores"]:
        importar_contentores()
    elif sys.argv[1:2] == ["folha-incertos"]:
        folha_incertos()
    else:
        main()
