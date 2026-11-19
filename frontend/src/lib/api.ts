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

export type TipoImportacao = 'fotos' | 'video' | 'mapillary' | 'demo'
export type EstadoImportacao = 'rascunho' | 'a_aguardar' | 'em_processamento' | 'concluido' | 'erro' | 'cancelado'

export interface Importacao {
  id: string
  tipo: TipoImportacao
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
