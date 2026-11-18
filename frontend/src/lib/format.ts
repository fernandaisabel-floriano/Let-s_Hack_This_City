export function pct(v: number | null | undefined, casas = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(casas)}%`
}

export function data(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

const SUBTIPO_LABEL: Record<string, string> = {
  stop: 'STOP',
  cedencia_passagem: 'Cedência de passagem',
  cedencia: 'Cedência de passagem',
  proibido_estacionar: 'Proibido estacionar',
  passadeira: 'Passadeira',
  outro_sinal: 'Outro sinal',
  limite_desconhecido: 'Limite de velocidade (valor por ler)',
  costas: 'Sinal de costas',
  subterraneo: 'Subterrâneo',
  ilha_reciclagem: 'Ilha de reciclagem',
  indiferenciado: 'Indiferenciado',
  papeleira: 'Papeleira',
  candeeiro: 'Candeeiro',
}

export function subtipoLabel(s: string | null | undefined) {
  if (!s) return '—'
  const lim = s.match(/^(?:limite|velocidade)_(\d+)$/)
  if (lim) return `Limite ${lim[1]} km/h`
  return SUBTIPO_LABEL[s] ?? s.replace(/_/g, ' ')
}

export function coord(v: number, casas = 6) {
  return v.toFixed(casas)
}

export function duracao(s: number) {
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`
}

export function iniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function semAcentos(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Nome legível da zona: "santos-martires" → "Santos Mártires", indo buscar a grafia
 * (com acentos) aos nomes das vias do GeoJSON; senão, só capitaliza.
 */
export function nomeLegivel(slug: string, nomesVias: string[] = []) {
  const alvo = slug.replace(/-/g, ' ').toLowerCase()
  for (const n of nomesVias) {
    const nfc = n.normalize('NFC')
    const i = semAcentos(nfc).indexOf(alvo)
    if (i >= 0 && semAcentos(nfc).length === nfc.length) return nfc.slice(i, i + alvo.length)
  }
  return alvo.replace(/\b\w/g, (c) => c.toUpperCase())
}
