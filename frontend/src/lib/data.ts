import type { FeatureCollection } from './geo'
import type { Calibracao, Elemento, MunicipioConfig } from './types'

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

const FALLBACK_CONFIG: MunicipioConfig = {
  municipio: 'aveiro',
  zona: 'santos-martires',
  saida: 'data/clean',
  bbox: [-8.65901, 40.637523, -8.656677, 40.639757],
  rua_geojson: 'config/ruas/santos-martires-v3.geojson',
  zona_avaliacao_geojson: 'config/ruas/santos-martires-v3-zona.geojson',
  crs_local: 'EPSG:3763',
  limiar_auto: 0.9,
  min_vistas: 2,
  raio_fusao_m: { sinal: 8, candeeiro: 8, contentor: 8 },
  so_dentro_da_zona: true,
}

export interface Deteccao {
  id: string
  confianca: number
  /** [x1, y1, x2, y2] em px na imagem gravada */
  bbox?: number[]
  view?: number | null
  extra?: { imagem_id?: string }
}

export interface DadosBase {
  config: MunicipioConfig
  vias: FeatureCollection | null
  zona: FeatureCollection | null
  calibracao: Calibracao | null
  elementos: Elemento[] | null
}

/** Só técnicos: confiança de cada deteção, para montar confiancas_vistas por elemento. */
export async function carregarDeteccoes() {
  const dets = await getJson<Deteccao[]>('/zona/deteccoes/deteccoes.json')
  return dets ? new Map(dets.map((d) => [d.id, d])) : null
}

/** M10 (pipeline/evaluate.py): métricas contra a referência. Só técnicos. */
export interface MetricaClasse {
  referencia: number
  catalogo: number
  encontrados: number
  falsos: number
  duplicados: number
  em_falta: number
  precisao: number | null
  recall: number | null
  erro_posicao_m: { n: number; mediana: number; p90: number } | null
}
export type Metrica = Record<string, MetricaClasse | unknown>

export async function carregarMetrica(): Promise<{ ficheiro: string; dados: Metrica } | null> {
  for (const f of ['metrica.json', 'metrica_osm.json']) {
    const dados = await getJson<Metrica>(`/zona/catalogo/${f}`)
    if (dados) return { ficheiro: f, dados }
  }
  return null
}

export async function carregarBase(): Promise<DadosBase> {
  const config = (await getJson<MunicipioConfig>('/api/config')) ?? FALLBACK_CONFIG
  const [vias, zona, calibracao, elementos] = await Promise.all([
    config.rua_geojson ? getJson<FeatureCollection>('/' + config.rua_geojson) : null,
    config.zona_avaliacao_geojson ? getJson<FeatureCollection>('/' + config.zona_avaliacao_geojson) : null,
    getJson<Calibracao>('/config/calibracao.json'),
    getJson<Elemento[]>('/zona/catalogo/elementos.json'),
  ])
  return {
    config,
    vias,
    zona,
    calibracao,
    elementos,
  }
}

/** Aceita elementos.json (lista) ou catalogo.geojson (FeatureCollection). */
export function lerFicheiroElementos(txt: string): Elemento[] {
  const j = JSON.parse(txt)
  if (Array.isArray(j)) return j as Elemento[]
  if (j?.type === 'FeatureCollection') {
    return (j.features as { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[]).map(
      (f) => ({ ...(f.properties as unknown as Elemento), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }),
    )
  }
  throw new Error('Formato não reconhecido: esperava elementos.json ou catalogo.geojson')
}

/** Uma confiança por imagem (a melhor), como em fuse.element(). */
export function confiancasVistas(e: Elemento, dets: Map<string, Deteccao> | null): number[] {
  if (dets && e.deteccoes?.length) {
    const porImagem = new Map<string, number>()
    for (const id of e.deteccoes) {
      const d = dets.get(id)
      if (!d) continue
      const k = d.extra?.imagem_id ?? d.id
      porImagem.set(k, Math.max(porImagem.get(k) ?? 0, d.confianca))
    }
    if (porImagem.size) return [...porImagem.values()].sort((a, b) => b - a)
  }
  return e.confianca_max_vista !== undefined ? [e.confianca_max_vista] : []
}

/** URL de um caminho relativo à pasta da zona (recorte, imagem). */
export function urlZona(rel: string | null | undefined) {
  if (!rel) return null
  if (/^https?:\/\//.test(rel)) return rel
  return '/zona/' + rel.replace(/\\/g, '/').replace(/^\/+/, '')
}
