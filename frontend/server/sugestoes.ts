/**
 * Tipo de contentor sugerido (subterrâneo | ilha de reciclagem | indiferenciado).
 *
 * pipeline/contentores_clip.py anota extra.clip_tipo em cada deteção de contentor.
 * A equipa decidiu (18/11, config contentores_clip.escrever_tipo: false) NÃO escrever
 * o tipo no catálogo, porque acerta só 6 de 12. Aqui junta-se o voto das deteções de
 * cada elemento e mostra-se como SUGESTÃO ao técnico, que confirma com um clique.
 * Sem anotações CLIP em deteccoes.json, devolve {}.
 */
import fs from 'node:fs'
import path from 'node:path'

export interface SugestaoTipo {
  tipo: string
  /** fração das deteções do elemento que votam neste tipo */
  fracao: number
  n: number
}

interface El {
  id: string
  tipo: string
  deteccoes?: string[]
}
interface Det {
  id: string
  extra?: { clip_tipo?: string | null; clip_contentor?: number | null }
}

let cache: { chave: string; valor: Record<string, SugestaoTipo> } | null = null

export function sugestoesDaZona(zonaDir: string): Record<string, SugestaoTipo> {
  const fe = path.join(zonaDir, 'catalogo', 'elementos.json')
  const fd = path.join(zonaDir, 'deteccoes', 'deteccoes.json')
  if (!fs.existsSync(fe) || !fs.existsSync(fd)) return {}
  const chave = `${zonaDir}|${fs.statSync(fe).mtimeMs}|${fs.statSync(fd).mtimeMs}`
  if (cache?.chave === chave) return cache.valor

  const els = JSON.parse(fs.readFileSync(fe, 'utf-8')) as El[]
  const dets = new Map((JSON.parse(fs.readFileSync(fd, 'utf-8')) as Det[]).map((d) => [d.id, d]))
  const valor: Record<string, SugestaoTipo> = {}
  for (const e of els) {
    if (e.tipo !== 'contentor') continue
    const votos = new Map<string, number>()
    let n = 0
    for (const id of e.deteccoes ?? []) {
      const t = dets.get(id)?.extra?.clip_tipo
      if (!t) continue
      // peso = confiança CLIP de ser contentor, quando existe
      const w = dets.get(id)?.extra?.clip_contentor ?? 1
      votos.set(t, (votos.get(t) ?? 0) + w)
      n++
    }
    if (!n) continue
    const total = [...votos.values()].reduce((a, b) => a + b, 0)
    const [tipo, v] = [...votos.entries()].sort((a, b) => b[1] - a[1])[0]
    valor[e.id] = { tipo, fracao: Math.round((v / total) * 100) / 100, n }
  }
  cache = { chave, valor }
  return valor
}
