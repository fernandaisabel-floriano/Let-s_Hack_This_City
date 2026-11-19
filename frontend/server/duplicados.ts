/**
 * Deteção de elementos duplicados no catálogo (elementos.json + deteccoes.json).
 *
 * Medido a 18/11 na zona piloto: dos pares da mesma classe a ≤ 8 m, a maioria
 * aparece na MESMA foto em caixas DIFERENTES, ou seja, são objetos distintos
 * (ou um deles é falso). Por isso a distância sozinha não serve. Regras:
 *
 *   certo     (D7, 19/11) só os casos ÓBVIOS, fundidos sem perguntar: mesma classe e
 *             mesmo subtipo (nos sinais, um subtipo lido com certeza), a ≤ DIST_CERTO_M,
 *             os dois com confiança ≥ CONF_CERTO, e nunca em caixas distintas na mesma
 *             foto. O técnico pode separar.
 *   possivel  o resto que pode ser o mesmo objeto, para o técnico decidir ("Qual fica?"):
 *             - mesma classe, ≤ raio de fusão, caixas sobrepostas numa foto partilhada
 *               (IoU ≥ IOU_MIN) — antes fundido automaticamente nos candeeiros e contentores;
 *               nos sinais, vários no mesmo poste sobrepõem-se e são objetos diferentes;
 *             - mesma classe, ≤ DIST_POSSIVEL_M, nenhuma foto em comum (ex.: um visto só
 *               no Mapillary e outro só no vídeo) e subtipos compatíveis.
 *   (nada)    partilham uma foto com caixas distintas: objetos diferentes.
 *
 * Medir depois da fase 1 quantos "possivel" sobram e ajustar DIST_CERTO_M / CONF_CERTO.
 */
import fs from 'node:fs'
import path from 'node:path'

export const IOU_MIN = 0.3
export const DIST_POSSIVEL_M = 5
/** D7: junção automática só abaixo desta distância… */
export const DIST_CERTO_M = 1.5
/** …e com os dois elementos acima desta confiança (calibrada; sem calibração, a do detetor) */
export const CONF_CERTO = 0.9

export interface ParDuplicado {
  a: string
  b: string
  tipo: string
  dist_m: number
  motivo: 'certo' | 'possivel'
  /** IoU máximo numa foto partilhada (só "certo") */
  iou?: number
}

interface El {
  id: string
  tipo: string
  subtipo: string | null
  lat: number
  lon: number
  confianca?: number | null
  confianca_max_vista?: number
  deteccoes?: string[]
}

interface Det {
  id: string
  image_id: string
  view: number | null
  bbox: number[]
  extra?: { imagem_id?: string }
}

function distM(a: El, b: El) {
  const kx = 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 111320)
}

function iou(p: number[], q: number[]) {
  const w = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0]))
  const h = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]))
  const i = w * h
  const u = (p[2] - p[0]) * (p[3] - p[1]) + (q[2] - q[0]) * (q[3] - q[1]) - i
  return u > 0 ? i / u : 0
}

const confAlta = (e: El) => (e.confianca ?? e.confianca_max_vista ?? 0) >= CONF_CERTO

/** D7: mesma classe e subtipo, perto, os dois confiantes (nos sinais, o subtipo tem de ter sido lido). */
function obvio(a: El, b: El, dist: number) {
  if (dist > DIST_CERTO_M || !confAlta(a) || !confAlta(b)) return false
  if ((a.subtipo ?? null) !== (b.subtipo ?? null)) return false
  return a.tipo !== 'sinal' || !SUBTIPO_VAGO.has(a.subtipo)
}

/** Sinais com subtipos lidos com certeza e diferentes (ex.: STOP e limite 50) não são o mesmo. */
const SUBTIPO_VAGO = new Set([null, '', 'outro_sinal', 'limite_desconhecido', 'costas'])
function subtiposCompativeis(a: El, b: El) {
  if (a.tipo !== 'sinal') return true
  return SUBTIPO_VAGO.has(a.subtipo) || SUBTIPO_VAGO.has(b.subtipo) || a.subtipo === b.subtipo
}

export function calcularDuplicados(els: El[], dets: Det[], raio: (tipo: string) => number): ParDuplicado[] {
  const porId = new Map(dets.map((d) => [d.id, d]))
  // por elemento: foto (imagem + vista) → caixas
  const fotos = new Map<string, Map<string, number[][]>>()
  for (const e of els) {
    const m = new Map<string, number[][]>()
    for (const did of e.deteccoes ?? []) {
      const d = porId.get(did)
      if (!d) continue
      const k = `${d.extra?.imagem_id ?? d.image_id}|${d.view ?? ''}`
      m.set(k, [...(m.get(k) ?? []), d.bbox])
    }
    fotos.set(e.id, m)
  }

  const pares: ParDuplicado[] = []
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i]
      const b = els[j]
      if (a.tipo !== b.tipo) continue
      const dist = distM(a, b)
      if (dist > raio(a.tipo)) continue
      const fa = fotos.get(a.id)!
      const fb = fotos.get(b.id)!
      let comum = false
      let melhor = 0
      for (const [k, caixasA] of fa) {
        const caixasB = fb.get(k)
        if (!caixasB) continue
        comum = true
        for (const p of caixasA) for (const q of caixasB) melhor = Math.max(melhor, iou(p, q))
      }
      const base = { a: a.id, b: b.id, tipo: a.tipo, dist_m: Math.round(dist * 10) / 10 }
      // caixas distintas numa foto partilhada: objetos diferentes
      if (comum && melhor < IOU_MIN) continue
      if (obvio(a, b, dist)) pares.push({ ...base, motivo: 'certo', ...(comum ? { iou: Math.round(melhor * 100) / 100 } : {}) })
      else if (comum) pares.push({ ...base, motivo: 'possivel', iou: Math.round(melhor * 100) / 100 })
      else if (fa.size && fb.size && dist <= DIST_POSSIVEL_M && subtiposCompativeis(a, b)) pares.push({ ...base, motivo: 'possivel' })
    }
  }
  return pares
}

// ------------------------------------------------------------------ cache por ficheiro

let cache: { chave: string; pares: ParDuplicado[] } | null = null

export function duplicadosDaZona(zonaDir: string, raio: (tipo: string) => number): ParDuplicado[] {
  const fe = path.join(zonaDir, 'catalogo', 'elementos.json')
  const fd = path.join(zonaDir, 'deteccoes', 'deteccoes.json')
  if (!fs.existsSync(fe) || !fs.existsSync(fd)) return []
  const chave = `${zonaDir}|${fs.statSync(fe).mtimeMs}|${fs.statSync(fd).mtimeMs}|${raio('sinal')},${raio('candeeiro')},${raio('contentor')}`
  if (cache?.chave === chave) return cache.pares
  const els = JSON.parse(fs.readFileSync(fe, 'utf-8')) as El[]
  const dets = JSON.parse(fs.readFileSync(fd, 'utf-8')) as Det[]
  const pares = calcularDuplicados(els, dets, raio)
  cache = { chave, pares }
  return pares
}
