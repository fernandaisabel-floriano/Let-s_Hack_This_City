/**
 * Cliente da API da plataforma.
 *
 * Hoje a API é servida pelo servidor de desenvolvimento (frontend/server/*.ts), que lê
 * os ficheiros do pipeline Python e chama os seus scripts. A interface só fala com a
 * API através destas funções: para passar a um backend FastAPI + PostGIS basta manter
 * os mesmos caminhos e formatos (ou mudar BASE).
 */
import type { Tecnico } from './types'

const BASE = ''

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, init)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error((j as { erro?: string }).erro ?? `Erro ${r.status}`), { status: r.status })
  return j as T
}

const post = <T>(url: string, body?: unknown) =>
  pedir<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

// ------------------------------------------------------------------ imagens: proveniência e privacidade

export interface InfoImagem {
  fonte: string
  autor: string
  licenca: string
  atribuicao: string
  url_origem: string
  captured_at: string
  coord_fonte: string
  heading_fonte: string
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

export const obterImagens = () => pedir<{ imagens: Record<string, InfoImagem>; totais: Record<string, TotaisFonte> }>('/api/imagens')

// ------------------------------------------------------------------ importação e processamento

export type TipoImportacao = 'fotos' | 'video' | 'mapillary' | 'demo' | 'zona'
export type EstadoImportacao = 'rascunho' | 'a_aguardar' | 'em_processamento' | 'concluido' | 'erro' | 'cancelado'

export interface Importacao {
  id: string
  tipo: TipoImportacao
  /** zona em que corre; numa importação "zona", a zona criada */
  zona?: string
  zona_nome?: string
  n_vias?: number
  nome: string
  rua: string
  offset_s?: number
  estado: EstadoImportacao
  criado_em: string
  criado_por: Tecnico
  iniciado_em?: string
  terminado_em?: string
  ficheiros: { nome: string; bytes: number }[]
  passo?: string
  passos: string[]
  progresso: number
  log: string[]
  erro?: string
  demo?: boolean
  originais_apagados?: boolean
}

export interface EstadoMotor {
  python: string | null
  versao: string | null
  modulos: Record<string, boolean>
  disponivel: boolean
  em_falta: string[]
  mapillary_token: boolean
  kartaview: false
  verificado_em: string
  passos: Record<string, string>
}

export const obterMotor = () => pedir<EstadoMotor>('/api/motor')
export const listarImportacoes = () => pedir<Importacao[]>('/api/importacoes')
export const criarImportacao = (dados: { tipo: TipoImportacao; nome: string; rua: string; offset_s?: number }) =>
  post<Importacao>('/api/importacoes', dados)

/** Etapa 5: zona nova a partir das vias escolhidas (GeoJSON) e, opcionalmente, do polígono de um bairro. */
export const criarZona = (dados: { zona_nome: string; vias: GeoFC; poligono?: GeoFC | null }) =>
  post<Importacao>('/api/importacoes', { tipo: 'zona', nome: dados.zona_nome, ...dados })

export interface GeoFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: { tipo?: 'rua' | 'area'; name?: string; highway?: string; osm_id?: number; osm_type?: string; local?: string; [k: string]: unknown }
}
export type GeoFC = { type: 'FeatureCollection'; features: GeoFeature[] }

export interface ZonaInfo {
  id: string
  nome: string
  bbox: number[] | null
  /** elementos no catálogo (null = ainda não processada) */
  elementos: number | null
}
export async function obterZonas(): Promise<{ atual: string; zonas: ZonaInfo[] }> {
  const r = await fetch(`${BASE}/api/zonas`)
  if (!r.ok) throw new Error(`Erro ${r.status}`)
  return r.json()
}
/** escolhe a zona (cookie) e recarrega a app com os dados dela */
export async function escolherZona(id: string) {
  await post('/api/zona', { id })
  window.location.reload()
}
export async function procurarOsm(q: string): Promise<GeoFC> {
  const r = await fetch(`${BASE}/api/osm/procurar?q=${encodeURIComponent(q)}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
  return j
}
export async function ruaNoPonto(lat: number, lon: number): Promise<GeoFeature | null> {
  const r = await fetch(`${BASE}/api/osm/inversa?lat=${lat}&lon=${lon}`)
  if (r.status === 404) return null
  const j = await r.json()
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
  return j
}
export const iniciarImportacao = (id: string) => post<Importacao>(`/api/importacoes/${id}/iniciar`)
export const cancelarImportacao = (id: string) => post<Importacao>(`/api/importacoes/${id}/cancelar`)

/** Envia um ficheiro (corpo binário), com progresso. */
export function enviarFicheiro(id: string, f: File, onProgresso: (fracao: number) => void): Promise<Importacao> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', `${BASE}/api/importacoes/${id}/ficheiros?nome=${encodeURIComponent(f.name)}`)
    x.upload.onprogress = (e) => e.lengthComputable && onProgresso(e.loaded / e.total)
    x.onload = () => {
      let j: unknown = {}
      try {
        j = JSON.parse(x.responseText)
      } catch {
        /* ignore */
      }
      if (x.status >= 200 && x.status < 300) resolve(j as Importacao)
      else reject(new Error((j as { erro?: string }).erro ?? `Erro ${x.status}`))
    }
    x.onerror = () => reject(new Error('falha de rede ao enviar o ficheiro'))
    x.send(f)
  })
}

// ------------------------------------------------------------------ atualizar dados (esqueleto)

export interface RespostaAtualizar {
  implementado: boolean
  mensagem: string
}

/** POST /api/atualizar — por agora o servidor responde 501 ("em desenvolvimento"); devolve a mensagem dele. */
export async function atualizarDados(): Promise<RespostaAtualizar> {
  const r = await fetch(BASE + '/api/atualizar', { method: 'POST' })
  const j = (await r.json().catch(() => ({}))) as Partial<RespostaAtualizar> & { erro?: string }
  if (r.status === 501) return { implementado: false, mensagem: j.mensagem ?? 'Atualização automática em desenvolvimento.' }
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
  return { implementado: j.implementado ?? true, mensagem: j.mensagem ?? 'Dados atualizados.' }
}

// ------------------------------------------------------------------ zonas por processar (botão "+" do mapa)

export interface RuaOsm {
  type: 'Feature'
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] }
  properties: { osm_id: number; osm_type: string; name: string; freguesia: string | null; concelho: string | null }
}

/** GET /api/osm/ruas — ruas de Portugal com a geometria (Nominatim pelo servidor, ≤ 1 pedido/s). */
export const procurarRuas = (q: string, signal?: AbortSignal) =>
  pedir<{ type: 'FeatureCollection'; features: RuaOsm[] }>(`/api/osm/ruas?q=${encodeURIComponent(q)}`, { signal })
