import type { StyleSpecification } from 'maplibre-gl'

/**
 * Base cartográfica técnica, ao estilo das plataformas de SIG municipais.
 *
 * Geografia real: mosaicos vetoriais do OpenFreeMap (dados OpenStreetMap, sem chave),
 * partindo do estilo "Liberty" e redesenhados aqui:
 *  - fundo quase branco; quarteirões, edifícios e arruamentos em cinzentos suaves;
 *  - ruas brancas com contorno fino, mais largas e com contorno mais escuro conforme a hierarquia;
 *  - tudo em tons de cinzento: água e espaços verdes distinguem-se só pela luminosidade;
 *  - toponímia pequena e cinzenta;
 *  - sem pontos de interesse, setas de sentido, escudos de estradas, relevo ou 3D.
 * Assim, só os marcadores do inventário têm cor. No tema escuro, a mesma lógica em escuro.
 */
export const ESTILO_BASE = 'https://tiles.openfreemap.org/styles/liberty'

interface Paleta {
  terreno: string
  verde: string
  agua: string
  aguaTexto: string
  edificio: string
  edificioContorno: string
  /** preenchimento das vias */
  via: string
  /** contorno das vias, da mais local à mais importante */
  contorno: { local: string; media: string; principal: string; autoestrada: string }
  caminho: string
  ferrovia: string
  texto: string
  textoLocal: string
  halo: string
}

const CLARO: Paleta = {
  terreno: '#f6f6f6',
  verde: '#eeeeee',
  agua: '#dedede',
  aguaTexto: '#8e8e8e',
  edificio: '#e3e3e3',
  edificioContorno: '#c8c8c8',
  via: '#ffffff',
  contorno: { local: '#d9d9d9', media: '#c8c8c8', principal: '#b8b8b8', autoestrada: '#a9a9a9' },
  caminho: '#cbcbcb',
  ferrovia: '#bcbcbc',
  texto: '#616161',
  textoLocal: '#7c7c7c',
  halo: '#f6f6f6',
}

const ESCURO: Paleta = {
  terreno: '#161616',
  verde: '#1b1b1b',
  agua: '#101010',
  aguaTexto: '#666666',
  edificio: '#222222',
  edificioContorno: '#303030',
  via: '#2c2c2c',
  contorno: { local: '#1e1e1e', media: '#1b1b1b', principal: '#181818', autoestrada: '#151515' },
  caminho: '#333333',
  ferrovia: '#3a3a3a',
  texto: '#a0a0a0',
  textoLocal: '#838383',
  halo: '#161616',
}

type Expr = unknown
type Camada = { id: string; type: string; maxzoom?: number; paint?: Record<string, Expr>; layout?: Record<string, Expr> }

/** Multiplica as saídas numéricas de uma expressão de largura/tamanho (interpolate, step, stops ou número). */
function escalar(v: Expr, f: number): Expr {
  if (typeof v === 'number') return Math.round(v * f * 100) / 100
  if (Array.isArray(v)) {
    if (v[0] === 'interpolate') return v.map((x, i) => (i >= 4 && i % 2 === 0 ? escalar(x, f) : x))
    if (v[0] === 'step') return v.map((x, i) => (i >= 2 && i % 2 === 0 ? escalar(x, f) : x))
    return v
  }
  if (v && typeof v === 'object' && 'stops' in (v as object)) {
    const o = v as { stops: [number, number][] }
    return { ...o, stops: o.stops.map(([z, w]) => [z, typeof w === 'number' ? Math.round(w * f * 100) / 100 : w]) }
  }
  return v
}

/** Camadas que não pertencem a um mapa técnico. */
const REMOVER = /^(poi|airport|natural_earth|building-3d|road_one_way|highway-shield|road_shield|aeroway|tunnel_.*_hatching|road_.*_hatching|bridge_.*_hatching|road_area_pattern)/

function redesenhar(c: Camada, p: Paleta): 'remover' | void {
  const id = c.id
  const pintar = (k: string, v: Expr) => {
    c.paint = { ...(c.paint ?? {}), [k]: v }
  }
  if (REMOVER.test(id)) return 'remover'
  if (c.type === 'fill' && c.paint?.['fill-pattern'] !== undefined) return 'remover'

  // ---- superfícies
  if (c.type === 'background') return pintar('background-color', p.terreno)
  if (id === 'building') {
    // o Liberty só desenha os edifícios planos até ao zoom 14 (depois usa 3D, que retiramos):
    // aqui ficam planos em todos os zooms
    delete c.maxzoom
    pintar('fill-color', p.edificio)
    pintar('fill-outline-color', p.edificioContorno)
    pintar('fill-opacity', 1)
    return
  }
  if (id === 'water') return pintar('fill-color', p.agua)
  if (id.startsWith('waterway') && c.type === 'line') {
    pintar('line-color', p.agua)
    if (c.paint?.['line-width'] !== undefined) pintar('line-width', escalar(c.paint['line-width'], 0.7))
    return
  }
  if (/^(park|landcover_(grass|wood|wetland)|landuse_(pitch|track|cemetery))$/.test(id) || id === 'park_outline') {
    if (c.type === 'fill') {
      pintar('fill-color', p.verde)
      if (id === 'park') pintar('fill-outline-color', p.verde)
    } else pintar('line-color', p.verde)
    return
  }
  if (c.type === 'fill' && /^(landuse_|landcover_)/.test(id)) {
    // residencial, escolas, hospitais, areia, gelo: tudo neutro (sem manchas de cor)
    pintar('fill-color', p.terreno)
    return
  }

  // ---- vias: largura e contorno conforme a hierarquia
  if (c.type === 'line' && /rail/.test(id)) {
    pintar('line-color', p.ferrovia)
    if (c.paint?.['line-width'] !== undefined) pintar('line-width', escalar(c.paint['line-width'], 0.6))
    return
  }
  if (c.type === 'line' && /^(road|bridge|tunnel)_/.test(id)) {
    const contorno = id.endsWith('_casing')
    const nivel = /motorway/.test(id) ? 'autoestrada' : /trunk_primary/.test(id) ? 'principal' : /secondary_tertiary|_link/.test(id) ? 'media' : 'local'
    if (/path_pedestrian/.test(id)) {
      pintar('line-color', contorno ? p.terreno : p.caminho)
      if (c.paint?.['line-width'] !== undefined) pintar('line-width', escalar(c.paint['line-width'], 0.35))
      return
    }
    pintar('line-color', contorno ? p.contorno[nivel] : p.via)
    const fator = nivel === 'local' ? 0.5 : nivel === 'media' ? 0.6 : 0.65
    if (c.paint?.['line-width'] !== undefined) pintar('line-width', escalar(c.paint['line-width'], fator))
    if (id.startsWith('tunnel_')) pintar('line-opacity', 0.5)
    return
  }
  if (c.type === 'line' && /^boundary/.test(id)) {
    pintar('line-color', p.contorno.media)
    return
  }

  // ---- toponímia discreta
  if (c.type === 'symbol') {
    const texto = id.startsWith('water') ? p.aguaTexto : id.startsWith('highway-name') ? p.textoLocal : p.texto
    pintar('text-color', texto)
    pintar('text-halo-color', p.halo)
    pintar('text-halo-width', 1.2)
    if (c.layout?.['text-size'] !== undefined) c.layout = { ...c.layout, 'text-size': escalar(c.layout['text-size'], id.startsWith('highway-name') ? 0.85 : 0.9) }
    // sem ícones (os do mapa base competiriam com os marcadores do inventário)
    if (c.layout?.['icon-image'] !== undefined) {
      const resto = { ...c.layout }
      delete resto['icon-image']
      c.layout = resto
    }
  }
}

const cache = new Map<string, StyleSpecification>()
let original: Promise<StyleSpecification> | null = null

/** Estilo pronto a usar (claro ou escuro). Lança erro se o servidor de mapas não responder. */
export async function estiloMapa(escuro: boolean): Promise<StyleSpecification> {
  const chave = escuro ? 'escuro' : 'claro'
  const c = cache.get(chave)
  if (c) return c
  original ??= fetch(ESTILO_BASE).then((r) => {
    if (!r.ok) throw new Error(`estilo do mapa: ${r.status}`)
    return r.json() as Promise<StyleSpecification>
  })
  const base = structuredClone(await original)
  const p = escuro ? ESCURO : CLARO
  base.layers = (base.layers as unknown as Camada[]).filter((l) => redesenhar(l, p) !== 'remover') as unknown as StyleSpecification['layers']
  // sem relevo sombreado (raster de fundo do Natural Earth)
  if (base.sources) delete (base.sources as Record<string, unknown>).ne2_shaded
  cache.set(chave, base)
  return base
}

export const ATRIBUICAO_MAPA =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · dados &copy; contribuidores do <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
