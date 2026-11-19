import type { FeatureCollection } from './geo'
import type { Elemento } from './types'

/**
 * Posição a rever: a localização não pôde ser determinada com segurança.
 * As coordenadas vêm do pipeline (GPS da câmara + direção + distância; triangulação
 * quando há várias imagens). Medido na zona piloto a 18/11:
 *  - 36 elementos vistos numa só imagem, com a distância estimada (sem triangulação);
 *  - resíduo dos raios > 1,5 m = pior 5 % (as direções das várias imagens não coincidem bem).
 */
export const RESIDUO_MAX_M = 1.5

export function motivosPosicao(e: Elemento): string[] {
  const m: string[] = []
  if (e.n_vistas < 2 && e.metodo_posicao !== 'triangulado')
    m.push(e.metodo_posicao === 'tamanho' ? 'vista numa só imagem; distância estimada pelo tamanho do objeto' : 'vista numa só imagem; posição estimada, não triangulada')
  if ((e.residuo_raios_m ?? 0) > RESIDUO_MAX_M) m.push(`as direções das várias imagens não coincidem bem (resíduo ${e.residuo_raios_m} m)`)
  return m
}

export const posicaoARever = (e: Elemento) => motivosPosicao(e).length > 0

// ------------------------------------------------------------------ rua mais próxima

type Linha = { via: string; pts: [number, number][] }

/** distância em metros de um ponto a um segmento (projeção local equirretangular) */
function distSegmento(lon: number, lat: number, a: [number, number], b: [number, number]) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const px = (lon - a[0]) * kx
  const py = (lat - a[1]) * ky
  const bx = (b[0] - a[0]) * kx
  const by = (b[1] - a[1]) * ky
  const l2 = bx * bx + by * by
  const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0
  return Math.hypot(px - t * bx, py - t * by)
}

/** Devolve uma função que dá a rua (propriedade "via" ou "name" do GeoJSON das vias) mais próxima, até `max` metros. */
export function ruaMaisProxima(vias: FeatureCollection | null, max = 40) {
  const linhas: Linha[] = []
  for (const f of vias?.features ?? []) {
    const via = String(f.properties.via ?? f.properties.name ?? '').trim()
    if (!via) continue
    if (f.geometry.type === 'LineString') linhas.push({ via, pts: f.geometry.coordinates as [number, number][] })
    if (f.geometry.type === 'MultiLineString') for (const l of f.geometry.coordinates as [number, number][][]) linhas.push({ via, pts: l })
  }
  return (lon: number, lat: number): string | null => {
    let melhor: string | null = null
    let d = max
    for (const l of linhas)
      for (let i = 0; i < l.pts.length - 1; i++) {
        const x = distSegmento(lon, lat, l.pts[i], l.pts[i + 1])
        if (x < d) {
          d = x
          melhor = l.via
        }
      }
    return melhor
  }
}

export function nomesVias(vias: FeatureCollection | null): string[] {
  return [...new Set((vias?.features ?? []).map((f) => String(f.properties.via ?? f.properties.name ?? '').trim()).filter(Boolean))].sort()
}
