import type { FeatureCollection } from './geo'
import type { Elemento, Estado, Tipo } from './types'

/**
 * Dados de DEMONSTRAÇÃO, gerados ao longo das vias da zona piloto, para ver o
 * front a funcionar sem data/ (que não entra no git). Não são deteções reais.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gerarDemo(vias: FeatureCollection | null): Elemento[] {
  const rnd = mulberry32(17112026)
  const linhas: number[][][] = []
  for (const f of vias?.features ?? []) {
    if (f.geometry.type === 'LineString') linhas.push(f.geometry.coordinates as number[][])
    if (f.geometry.type === 'MultiLineString') linhas.push(...(f.geometry.coordinates as number[][][]))
  }
  if (!linhas.length) linhas.push([[-8.6587, 40.6378], [-8.6569, 40.6393]])

  const pesos: [Tipo, number][] = [['sinal', 0.45], ['candeeiro', 0.4], ['contentor', 0.15]]
  const subSinal = ['stop', 'cedencia_passagem', 'limite_50', 'limite_30', 'limite_desconhecido', 'outro_sinal', 'costas']
  const subCont = ['subterraneo', 'ilha_reciclagem', 'indiferenciado']
  const els: Elemento[] = []
  const n = 46
  for (let i = 1; i <= n; i++) {
    const linha = linhas[Math.floor(rnd() * linhas.length)]
    const k = Math.floor(rnd() * (linha.length - 1))
    const [a, b] = [linha[k], linha[k + 1] ?? linha[k]]
    const t = rnd()
    const lado = rnd() < 0.5 ? -1 : 1
    // ~5–9 m para o lado da via
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const off = (5 + rnd() * 4) / 111000
    const lon = a[0] + dx * t + (-dy / len) * off * lado * 1.3
    const lat = a[1] + dy * t + (dx / len) * off * lado
    let r = rnd()
    let tipo: Tipo = 'sinal'
    for (const [tp, p] of pesos) {
      if ((r -= p) <= 0) { tipo = tp; break }
    }
    const nv = 1 + Math.floor(rnd() * 9)
    const conf = tipo === 'contentor' ? null : Math.round((0.3 + rnd() * 0.7) * 1000) / 1000
    const estado: Estado = conf !== null && conf >= 0.9 && nv >= 2 ? 'auto' : 'pendente'
    const video = rnd() < 0.7
    const d1 = video ? '2026-11-17T11:17:00Z' : '2019-08-09T10:12:00Z'
    els.push({
      id: `${tipo.slice(0, 3)}_${String(i).padStart(4, '0')}`,
      tipo,
      subtipo: tipo === 'sinal' ? subSinal[Math.floor(rnd() * subSinal.length)] : tipo === 'contentor' ? subCont[Math.floor(rnd() * subCont.length)] : null,
      lon: Math.round(lon * 1e7) / 1e7,
      lat: Math.round(lat * 1e7) / 1e7,
      confianca: conf,
      confianca_max_vista: Math.round((0.2 + rnd() * 0.75) * 1000) / 1000,
      confianca_subtipo: tipo === 'sinal' ? Math.round((0.4 + rnd() * 0.6) * 1000) / 1000 : null,
      n_vistas: nv,
      estado,
      primeira_vista: d1,
      ultima_vista: video ? '2026-11-17T16:31:00Z' : '2021-08-28T09:00:00Z',
      imagem: '',
      recorte: null,
      fonte: video ? (rnd() < 0.3 ? 'mapillary+video_proprio' : 'video_proprio') : 'mapillary',
      atribuicao: video ? 'equipa' : 'Mapillary, CC BY-SA – autor de demonstração',
      metodo_posicao: nv >= 3 ? 'triangulado' : video ? 'trajeto' : 'via',
      residuo_raios_m: Math.round(rnd() * 150) / 100,
      ajustado_edificio: false,
    })
  }
  return els
}
