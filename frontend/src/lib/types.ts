/** Espelha pipeline/schema.py e a saída de pipeline/fuse.py (elementos.json). */

export const TIPOS = ['sinal', 'candeeiro', 'contentor'] as const
export type Tipo = (typeof TIPOS)[number]

/** pendente = na fila do técnico; auto = entrou direto (M8) */
export const ESTADOS = ['auto', 'pendente', 'validado', 'corrigido', 'rejeitado'] as const
export type Estado = (typeof ESTADOS)[number]

/** Estados que contam como "no catálogo" para o público. */
export const ESTADOS_CONFIRMADOS: Estado[] = ['auto', 'validado', 'corrigido']

export const EXPORT_FIELDS = [
  'id', 'tipo', 'subtipo', 'lat', 'lon', 'x', 'y', 'epsg_local',
  'confianca', 'n_vistas', 'estado', 'primeira_vista', 'ultima_vista',
  'imagem', 'fonte', 'atribuicao',
] as const

/** Como fuse.py calculou a posição. */
export type MetodoPosicao = 'triangulado' | 'tamanho' | 'via' | 'trajeto'

export interface Elemento {
  id: string
  tipo: Tipo
  subtipo: string | null
  /** M4: o subtipo é incerto (vai para a fila) e porquê */
  subtipo_incerto?: boolean | null
  subtipo_motivo?: string | null
  lon: number
  lat: number
  confianca: number | null
  confianca_max_vista?: number
  /** etapa 1: visto só em vistas fracas (pequenas, tremidas, escuras): vai sempre para a fila */
  so_vistas_fracas?: boolean
  /** imagens com vista boa (não fraca): é o que conta para a entrada automática */
  n_vistas_boas?: number
  /** nitidez (variância do Laplaciano) do recorte escolhido */
  nitidez_imagem?: number | null
  /** contentores: 2.ª opinião do CLIP (média das melhores imagens), para o limiar com base "clip" */
  confianca_clip?: number | null
  confianca_subtipo?: number | null
  n_vistas: number
  estado: Estado
  primeira_vista: string
  ultima_vista: string
  imagem: string
  recorte: string | null
  fonte: string
  atribuicao: string
  metodo_posicao?: MetodoPosicao
  residuo_raios_m?: number | null
  ajustado_edificio?: boolean
  /** rua mais próxima (calculada no cliente a partir das vias da zona) */
  rua?: string | null
  /** decisão do técnico: rejeitado por ser duplicado deste id (M10) */
  duplicado_de?: string
  /** aviso da Câmara aberto (depois da última decisão do técnico) */
  ticket?: { quando: string; motivo: string; texto: string }
  /** ids dos duplicados fundidos neste elemento (lib/duplicados.ts) */
  fundidos?: string[]
  /** versões antigas do fuse.py */
  espalhamento_m?: number
  deteccoes?: string[]
}

/** Uma decisão do técnico. Compatível com `confianca.py recalibrar VALIDACOES.json`. */
export interface Validacao {
  id: string
  classe: Tipo
  confiancas_vistas: number[]
  estado: 'validado' | 'corrigido' | 'rejeitado'
  classe_corrigida?: Tipo
  subtipo_corrigido?: string | null
  lat?: number
  lon?: number
  validado_em: string
  validado_por?: Tecnico
  tempo_s?: number
  /** rejeitado por ser o mesmo objeto que outro elemento (M10) */
  duplicado_de?: string
}

export interface Tecnico {
  utilizador: string
  nome: string
}

/** Uma linha do registo de auditoria (registo_validacoes.jsonl). */
export interface Evento {
  seq: number
  quando: string
  tecnico: Tecnico
  acao: 'decisao' | 'desfazer' | 'limpar' | 'par' | 'ticket'
  id?: string
  /** acao "ticket": aviso de quem consulta o catálogo (volta à fila do técnico) */
  ticket?: { motivo: string; texto: string }
  validacao?: Omit<Validacao, 'validado_em' | 'validado_por'>
  /** acao "par": a e b são (mesmo = true) ou não são (false) o mesmo objeto */
  a?: string
  b?: string
  mesmo?: boolean
}

export interface MunicipioConfig {
  municipio: string
  zona: string
  /** nome da zona para mostrar (municipio.yaml ou config/zonas/<id>.yaml) */
  nome_zona?: string | null
  saida: string
  bbox: number[] | null
  rua_geojson: string | null
  zona_avaliacao_geojson: string | null
  crs_local: string
  limiar_auto: number
  min_vistas: number
  /** número único ou um valor por classe ({sinal: 8, ...}) */
  raio_fusao_m: number | Record<string, number>
  so_dentro_da_zona: boolean
}

export interface Calibracao {
  classes: Record<string, { a: number; b: number; n_reais: number; n_falsos: number; media_top_k_para_limiar: number }>
  atualizado_em?: string
  ultima_fonte?: string
}

export type Origem = 'pipeline' | 'ficheiro' | 'demo'

export const TIPO_LABEL: Record<Tipo, string> = {
  sinal: 'Sinal de trânsito',
  candeeiro: 'Candeeiro',
  contentor: 'Contentor',
}

/** Categorias do catálogo (enunciado da Câmara). */
export const CATEGORIA_LABEL: Record<Tipo, string> = {
  sinal: 'Sinalização vertical',
  candeeiro: 'Iluminação pública',
  contentor: 'Resíduos',
}

export const TIPO_PLURAL: Record<Tipo, string> = {
  sinal: 'Sinais',
  candeeiro: 'Candeeiros e postes',
  contentor: 'Contentores e ecopontos',
}

export const ESTADO_LABEL: Record<Estado, string> = {
  auto: 'Automático',
  pendente: 'Por confirmar',
  validado: 'Validado',
  corrigido: 'Corrigido',
  rejeitado: 'Rejeitado',
}

/** Subclasses de pipeline/classify_signs.py (M4) e tipos de contentor. */
export const SUBTIPOS: Record<Tipo, string[]> = {
  sinal: ['stop', 'cedencia_passagem', 'limite_20', 'limite_30', 'limite_40', 'limite_50', 'limite_desconhecido', 'outro_sinal', 'costas'],
  candeeiro: ['candeeiro', 'poste_iluminacao'],
  contentor: ['subterraneo', 'ilha_reciclagem', 'indiferenciado', 'papeleira'],
}

/** Tipos de contentor pedidos no enunciado (o pipeline usa os mesmos nomes em contentores_clip.py). */
export const TIPOS_CONTENTOR = ['subterraneo', 'ilha_reciclagem', 'indiferenciado'] as const

/** Cores por tipo: tokens CSS (index.css), funcionam também nos ícones do mapa. */
export const TIPO_COR: Record<Tipo, string> = {
  sinal: 'var(--tipo-sinal)',
  candeeiro: 'var(--tipo-candeeiro)',
  contentor: 'var(--tipo-contentor)',
}

export const METODO_LABEL: Record<MetodoPosicao, string> = {
  triangulado: 'Triangulado entre várias imagens',
  tamanho: 'Estimado pelo tamanho na imagem',
  via: 'Junto ao lancil da via',
  trajeto: 'Ao lado do trajeto a pé',
}

export function raioFusao(cfg: MunicipioConfig, tipo?: Tipo) {
  const r = cfg.raio_fusao_m
  if (typeof r === 'number') return r
  if (tipo && r[tipo] !== undefined) return r[tipo]
  const vs = Object.values(r)
  return vs.length ? Math.max(...vs) : 8
}

/** Motivos de um aviso (igual a MOTIVOS_TICKET em server/api.ts; avisos da Câmara, components/reportar-problema.tsx). */
export const MOTIVOS_TICKET = ['nao_existe', 'tipo_errado', 'posicao_errada', 'outro'] as const
export const MOTIVO_LABEL: Record<string, string> = {
  nao_existe: 'Já não existe',
  tipo_errado: 'Tipo errado',
  posicao_errada: 'Posição errada',
  outro: 'Outro problema',
}
