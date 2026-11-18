import { toLocal, zoneContains, type FeatureCollection } from './geo'
import { EXPORT_FIELDS, type Elemento, type MunicipioConfig, type Validacao } from './types'

/** Mesmas regras de pipeline/export.py (M9). */
export function separarCatalogo(els: Elemento[], cfg: MunicipioConfig, zona: FeatureCollection | null) {
  const inside = zoneContains(zona)
  const epsg = Number(cfg.crs_local.split(':')[1] ?? 3763)
  const cat: Record<string, unknown>[] = []
  const fora: Record<string, unknown>[] = []
  for (const e of els) {
    const xy = toLocal(e.lon, e.lat, cfg.crs_local)
    const row = { ...e, x: xy?.[0] ?? null, y: xy?.[1] ?? null, epsg_local: epsg }
    const dentro = inside(e.lon, e.lat) || !cfg.so_dentro_da_zona
    ;(dentro && e.estado !== 'rejeitado' ? cat : fora).push(row)
  }
  return { cat, fora }
}

function props(r: Record<string, unknown>) {
  const p: Record<string, unknown> = {}
  for (const k of EXPORT_FIELDS) if (k !== 'lat' && k !== 'lon') p[k] = r[k] ?? null
  p.recorte = r.recorte ?? null
  p.espalhamento_m = r.espalhamento_m ?? null
  return p
}

export function toGeoJSON(rows: Record<string, unknown>[], cfg: MunicipioConfig) {
  return {
    type: 'FeatureCollection',
    name: `${cfg.municipio}_${cfg.zona}`,
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: props(r),
    })),
  }
}

function csvCell(v: unknown) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(rows: Record<string, unknown>[]) {
  const lines = [EXPORT_FIELDS.join(',')]
  for (const r of rows) lines.push(EXPORT_FIELDS.map((k) => csvCell(r[k])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function download(nome: string, conteudo: string, tipo = 'application/json') {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function validacoesParaRecalibrar(vals: Validacao[]) {
  return vals.map((v) => ({
    classe: v.classe,
    confiancas_vistas: v.confiancas_vistas,
    estado: v.estado,
    ...(v.classe_corrigida && v.classe_corrigida !== v.classe ? { classe_corrigida: v.classe_corrigida } : {}),
    id: v.id,
    validado_em: v.validado_em,
    ...(v.validado_por ? { validado_por: v.validado_por } : {}),
    ...(v.tempo_s !== undefined ? { tempo_s: v.tempo_s } : {}),
    ...(v.lat !== undefined ? { lat: v.lat, lon: v.lon } : {}),
    ...(v.subtipo_corrigido !== undefined ? { subtipo_corrigido: v.subtipo_corrigido } : {}),
  }))
}
