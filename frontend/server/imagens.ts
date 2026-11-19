/**
 * Proveniência e privacidade de cada imagem limpa da zona, a partir dos images.csv
 * que o pipeline grava (schema.IMAGE_FIELDS): fonte, autor, licença, atribuição,
 * ligação de origem, data, e quantas regiões foram desfocadas (rostos, matrículas,
 * cabeças) ANTES de a imagem ser gravada.
 *
 * Chave: caminho da imagem relativo à pasta da zona (igual a elemento.imagem).
 */
import fs from 'node:fs'
import path from 'node:path'

export interface InfoImagem {
  fonte: string
  autor: string
  licenca: string
  atribuicao: string
  url_origem: string
  captured_at: string
  coord_fonte: string
  heading_fonte: string
  /** null = não registado (imagens antigas) */
  rostos: number | null
  matriculas: number | null
  cabecas: number | null
}

export interface TotaisFonte {
  imagens: number
  rostos: number
  matriculas: number
  cabecas: number
  com_desfoque: number
  sem_registo: number
  licenca: string
}

/** CSV simples (RFC 4180: aspas e aspas duplicadas). */
function lerCsv(txt: string): Record<string, string>[] {
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') {
      linha.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++
      linha.push(campo)
      campo = ''
      if (linha.some((x) => x !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  if (campo || linha.length) {
    linha.push(campo)
    linhas.push(linha)
  }
  const [cab, ...resto] = linhas
  return (resto ?? []).map((l) => Object.fromEntries((cab ?? []).map((k, i) => [k, l[i] ?? ''])))
}

const num = (v: string) => (v === '' || v === undefined ? null : Number(v))

function csvs(dir: string): string[] {
  const out: string[] = []
  const andar = (d: string, nivel: number) => {
    if (nivel > 3 || !fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && !['images', 'recortes', 'catalogo', 'deteccoes'].includes(e.name)) andar(path.join(d, e.name), nivel + 1)
      else if (e.isFile() && e.name === 'images.csv') out.push(path.join(d, e.name))
    }
  }
  andar(dir, 0)
  return out
}

let cache: { chave: string; valor: { imagens: Record<string, InfoImagem>; totais: Record<string, TotaisFonte> } } | null = null

export function imagensDaZona(zonaDir: string) {
  const ficheiros = csvs(zonaDir)
  const chave = ficheiros.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|')
  if (cache?.chave === chave) return cache.valor
  const imagens: Record<string, InfoImagem> = {}
  const totais: Record<string, TotaisFonte> = {}
  for (const f of ficheiros) {
    const base = path.relative(zonaDir, path.dirname(f)).split(path.sep).join('/')
    for (const r of lerCsv(fs.readFileSync(f, 'utf-8'))) {
      if (!r.ficheiro) continue
      const info: InfoImagem = {
        fonte: r.fonte,
        autor: r.autor,
        licenca: r.licenca,
        atribuicao: r.atribuicao,
        url_origem: r.url_origem,
        captured_at: r.captured_at,
        coord_fonte: r.coord_fonte,
        heading_fonte: r.heading_fonte,
        rostos: num(r.rostos),
        matriculas: num(r.matriculas),
        cabecas: num(r.cabecas),
      }
      imagens[`${base}/${r.ficheiro}`] = info
      const t = (totais[r.fonte] ??= { imagens: 0, rostos: 0, matriculas: 0, cabecas: 0, com_desfoque: 0, sem_registo: 0, licenca: r.licenca })
      t.imagens++
      if (info.rostos === null && info.matriculas === null) t.sem_registo++
      t.rostos += info.rostos ?? 0
      t.matriculas += info.matriculas ?? 0
      t.cabecas += info.cabecas ?? 0
      if ((info.rostos ?? 0) + (info.matriculas ?? 0) + (info.cabecas ?? 0) > 0) t.com_desfoque++
    }
  }
  cache = { chave, valor: { imagens, totais } }
  return cache.valor
}
