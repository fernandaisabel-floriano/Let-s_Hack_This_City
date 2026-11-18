import proj4 from 'proj4'

// PT-TM06 / ETRS89 (crs_local por omissão)
proj4.defs(
  'EPSG:3763',
  '+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

export function toLocal(lon: number, lat: number, crs = 'EPSG:3763'): [number, number] | null {
  try {
    const [x, y] = proj4('EPSG:4326', crs, [lon, lat])
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
  } catch {
    return null
  }
}

type Ring = number[][]
type Geometry = { type: string; coordinates: unknown }
export interface FeatureCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: Record<string, unknown>; geometry: Geometry }[]
}

function inRing(lon: number, lat: number, ring: Ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(lon: number, lat: number, rings: Ring[]) {
  if (!inRing(lon, lat, rings[0])) return false
  return !rings.slice(1).some((h) => inRing(lon, lat, h))
}

/** Equivalente a zona.zone_contains: o ponto cai no polígono de avaliação? */
export function zoneContains(zona: FeatureCollection | null) {
  if (!zona) return () => true
  const polys: Ring[][] = []
  for (const f of zona.features) {
    if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates as Ring[])
    if (f.geometry.type === 'MultiPolygon') polys.push(...(f.geometry.coordinates as Ring[][]))
  }
  return (lon: number, lat: number) => polys.some((p) => inPolygon(lon, lat, p))
}

export function distM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371008.8
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
