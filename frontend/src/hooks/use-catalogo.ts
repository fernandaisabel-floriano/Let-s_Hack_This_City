import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  carregarBase,
  carregarDeteccoes,
  carregarMetrica,
  confiancasVistas,
  lerFicheiroElementos,
  type DadosBase,
  type Deteccao,
  type Metrica,
} from '@/lib/data'
import { obterImagens, type InfoImagem, type TotaisFonte } from '@/lib/api'
import { gerarDemo } from '@/lib/demo'
import { estadoEfetivo, limiaresZona, padraoLimiares, type Limiares, type ValoresLimiar } from '@/lib/estado'
import { ruaMaisProxima } from '@/lib/revisao'
import { agrupar, paresDecididos, type DecisaoPar, type ParDuplicado } from '@/lib/duplicados'
import type { Elemento, Evento, Origem, Tecnico, Tipo, Validacao } from '@/lib/types'

/**
 * Catálogo + decisões dos técnicos.
 *
 * Cada decisão é um evento num registo só de acrescentar (quem, quando, o quê);
 * o estado atual de cada elemento é a última decisão no registo.
 *  - dados do pipeline: o registo vive no servidor. Técnicos leem-no inteiro
 *    (/api/decisoes); o público só recebe o estado atual, sem nomes (/api/estado).
 *  - demonstração / ficheiro carregado: o registo vive no browser.
 */

function lerStorage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function gravarStorage(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* modo privado / sem espaço: fica só em memória */
  }
}

/** Igual a estadoAtual() em server/api.ts. */
export function estadoAtual(reg: Evento[]) {
  const atual: Record<string, Validacao> = {}
  for (const e of reg) {
    if (e.acao === 'limpar') for (const k of Object.keys(atual)) delete atual[k]
    else if (e.acao === 'desfazer' && e.id) delete atual[e.id]
    else if (e.acao === 'decisao' && e.validacao)
      atual[e.validacao.id] = { ...e.validacao, validado_em: e.quando, validado_por: e.tecnico }
  }
  return atual
}

export interface DecisaoOpts {
  tipo?: Tipo
  subtipo?: string | null
  lat?: number
  lon?: number
  tempo_s?: number
  /** só com estado rejeitado: o elemento é o mesmo objeto que este id (M10) */
  duplicado_de?: string
}

type Acao =
  | { acao: 'decisao'; validacao: NonNullable<Evento['validacao']> }
  | { acao: 'desfazer'; id: string }
  | { acao: 'limpar' }
  | { acao: 'par'; a: string; b: string; mesmo: boolean }
  /** várias decisões de uma vez (ex.: "ficar com este" num grupo de duplicados) */
  | { acao: 'lote'; acoes: ({ acao: 'decisao'; validacao: NonNullable<Evento['validacao']> } | { acao: 'desfazer'; id: string } | { acao: 'par'; a: string; b: string; mesmo: boolean })[] }

export function useCatalogo(tecnico: Tecnico | null, onExpirou: () => void) {
  const [base, setBase] = useState<DadosBase | null>(null)
  const [origem, setOrigem] = useState<Origem>('demo')
  const [nomeFicheiro, setNomeFicheiro] = useState<string | null>(null)
  const [brutos, setBrutos] = useState<Elemento[]>([])
  const [registo, setRegisto] = useState<Evento[]>([])
  const [estadoPublico, setEstadoPublico] = useState<{ elementos: Record<string, Validacao>; pares: DecisaoPar[] }>({ elementos: {}, pares: [] })
  const [paresDuplicados, setParesDuplicados] = useState<ParDuplicado[]>([])
  /** tipo de contentor sugerido pelo CLIP, por elemento (server/sugestoes.ts) */
  const [sugestoes, setSugestoes] = useState<Record<string, { tipo: string; fracao: number; n: number }>>({})
  const [deteccoes, setDeteccoes] = useState<Map<string, Deteccao> | null>(null)
  const [metrica, setMetrica] = useState<{ ficheiro: string; dados: Metrica } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  /** proveniência (fonte, autor, licença) e desfocagem de cada imagem */
  const [imagens, setImagens] = useState<{ imagens: Record<string, InfoImagem>; totais: Record<string, TotaisFonte> } | null>(null)
  /** limiares de entrada automática (config/limiares.json): o estado "auto" é calculado aqui */
  const [limiares, setLimiares] = useState<Limiares | null>(null)
  /** incrementa para voltar a ler o catálogo (ex.: quando um processamento termina) */
  const [versao, setVersao] = useState(0)

  const storageKey = base ? `ctrlf:registo:${base.config.municipio}/${base.config.zona}:${origem}` : null

  useEffect(() => {
    carregarBase().then((b) => {
      setBase(b)
      if (b.elementos?.length) {
        setOrigem('pipeline')
        setBrutos(b.elementos)
      } else {
        setOrigem('demo')
        setBrutos(gerarDemo(b.vias))
      }
    })
    obterImagens().then(setImagens).catch(() => setImagens(null))
  }, [versao])

  // limiares: público (sem histórico) ou técnico (com histórico)
  useEffect(() => {
    fetch('/api/limiares')
      .then(async (r) => (r.ok ? setLimiares(await r.json()) : setLimiares(null)))
      .catch(() => setLimiares(null))
  }, [tecnico, versao])

  // pares de duplicados (calculados no servidor a partir das deteções)
  useEffect(() => {
    if (origem !== 'pipeline') {
      setParesDuplicados([])
      setSugestoes({})
      return
    }
    fetch('/api/duplicados')
      .then(async (r) => (r.ok ? setParesDuplicados(await r.json()) : setParesDuplicados([])))
      .catch(() => setParesDuplicados([]))
    fetch('/api/sugestoes')
      .then(async (r) => r.ok && setSugestoes(await r.json()))
      .catch(() => {})
  }, [origem, base])

  // dados só para técnicos
  useEffect(() => {
    if (!tecnico || origem !== 'pipeline') {
      setDeteccoes(null)
      setMetrica(null)
      return
    }
    carregarDeteccoes().then(setDeteccoes)
    carregarMetrica().then(setMetrica)
  }, [tecnico, origem, versao])

  useEffect(() => {
    if (!storageKey) return
    if (origem !== 'pipeline') {
      setRegisto(lerStorage<Evento[]>(storageKey, []))
      return
    }
    if (tecnico) {
      fetch('/api/decisoes')
        .then(async (r) => {
          if (r.status === 401) return onExpirou()
          if (r.ok) setRegisto(((await r.json()) as { registo: Evento[] }).registo)
        })
        .catch(() => setErro('Não foi possível ler o registo de validações.'))
    } else {
      setRegisto([])
      fetch('/api/estado')
        .then(async (r) => {
          if (!r.ok) return
          const j = await r.json()
          setEstadoPublico({ elementos: j.elementos ?? {}, pares: j.pares ?? [] })
        })
        .catch(() => {})
    }
  }, [storageKey, origem, tecnico, onExpirou])

  const publico = origem === 'pipeline' && !tecnico
  const validacoes = useMemo(() => (publico ? estadoPublico.elementos : estadoAtual(registo)), [publico, estadoPublico, registo])
  const decisoesPares = useMemo(() => (publico ? estadoPublico.pares : paresDecididos(registo)), [publico, estadoPublico, registo])

  const enviar = useCallback(
    async (a: Acao) => {
      if (!tecnico) return
      const quando = new Date().toISOString()
      const seq0 = registo.at(-1)?.seq ?? 0
      const locais: Evento[] = (a.acao === 'lote' ? a.acoes : [a]).map((x, i) => ({
        seq: seq0 + i + 1,
        quando,
        tecnico,
        ...x,
        ...('validacao' in x ? { id: x.validacao.id } : {}),
      }))
      const seguinte = [...registo, ...locais]
      setRegisto(seguinte) // otimista: o servidor devolve o registo oficial
      if (origem !== 'pipeline') {
        if (storageKey) gravarStorage(storageKey, seguinte)
        return
      }
      try {
        const r = await fetch('/api/decisoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a),
        })
        if (r.status === 401) {
          setRegisto(registo)
          return onExpirou()
        }
        const j = await r.json()
        if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
        setRegisto(j.registo)
        setErro(null)
      } catch (e) {
        setRegisto(registo)
        setErro(`A decisão não foi gravada: ${e instanceof Error ? e.message : e}`)
      }
    },
    [registo, origem, storageKey, tecnico, onExpirou],
  )

  const ruaDe = useMemo(() => ruaMaisProxima(base?.vias ?? null), [base])

  /** limiares efetivos da zona atual (padrão + o que a zona muda); sem ficheiro, os valores por omissão */
  const limZona = useMemo(() => {
    const cfg = base?.config
    const l = limiares ?? { padrao: padraoLimiares(cfg?.limiar_auto, cfg?.min_vistas), zonas: {} }
    return limiaresZona(l, cfg?.zona ?? '')
  }, [limiares, base])

  /** todos os elementos, com as decisões aplicadas (inclui os duplicados) e a rua mais próxima */
  const todos = useMemo<Elemento[]>(
    () =>
      brutos.map((e) => {
        const v = validacoes[e.id]
        // estado calculado aqui (estado.ts): decisão do técnico > ticket > limiares > por confirmar
        const estado = estadoEfetivo(e, v, undefined, limZona[e.tipo] ?? limZona.sinal)
        const el = !v
          ? { ...e, estado }
          : {
              ...e,
              estado,
              tipo: v.classe_corrigida ?? e.tipo,
              subtipo: v.subtipo_corrigido !== undefined ? v.subtipo_corrigido : e.subtipo,
              lat: v.lat ?? e.lat,
              lon: v.lon ?? e.lon,
              duplicado_de: v.duplicado_de,
            }
        return { ...el, rua: ruaDe(el.lon, el.lat) }
      }),
    [brutos, validacoes, ruaDe, limZona],
  )

  /** um elemento por objeto: duplicados fundidos (lib/duplicados.ts) */
  const duplicados = useMemo(() => agrupar(todos, paresDuplicados, decisoesPares), [todos, paresDuplicados, decisoesPares])
  const elementos = duplicados.elementos
  /** vista da Câmara: um ponto por objeto, mesmo com duplicados ainda por decidir */
  const consolidados = useMemo(() => agrupar(todos, paresDuplicados, decisoesPares, true).elementos, [todos, paresDuplicados, decisoesPares])

  const construir = useCallback(
    (id: string, estado: Validacao['estado'], opts: DecisaoOpts = {}): NonNullable<Evento['validacao']> | null => {
      const e = brutos.find((x) => x.id === id)
      if (!e) return null
      const anterior = validacoes[id]
      const v: NonNullable<Evento['validacao']> = {
        id,
        classe: e.tipo,
        confiancas_vistas: confiancasVistas(e, deteccoes),
        estado,
      }
      const tipo = opts.tipo ?? anterior?.classe_corrigida
      if (tipo && tipo !== e.tipo) v.classe_corrigida = tipo
      const sub = opts.subtipo !== undefined ? opts.subtipo : anterior?.subtipo_corrigido
      if (sub !== undefined && sub !== e.subtipo) v.subtipo_corrigido = sub
      const lat = opts.lat ?? anterior?.lat
      const lon = opts.lon ?? anterior?.lon
      if (lat !== undefined && lon !== undefined) Object.assign(v, { lat, lon })
      if (opts.tempo_s !== undefined) v.tempo_s = opts.tempo_s
      if (estado === 'rejeitado' && opts.duplicado_de) v.duplicado_de = opts.duplicado_de
      // corrigido sem mudança efetiva → validado
      if (estado === 'corrigido' && !v.classe_corrigida && v.subtipo_corrigido === undefined && v.lat === undefined) v.estado = 'validado'
      return v
    },
    [brutos, deteccoes, validacoes],
  )

  const decidir = useCallback(
    (id: string, estado: Validacao['estado'], opts: DecisaoOpts = {}) => {
      const v = construir(id, estado, opts)
      if (v) enviar({ acao: 'decisao', validacao: v })
    },
    [construir, enviar],
  )

  /** várias decisões num só pedido (ficam seguidas no registo) */
  const decidirVarios = useCallback(
    (lista: { id: string; estado: Validacao['estado']; opts?: DecisaoOpts }[]) => {
      const acoes = lista.flatMap((d) => {
        const v = construir(d.id, d.estado, d.opts)
        return v ? [{ acao: 'decisao' as const, validacao: v }] : []
      })
      if (acoes.length) enviar({ acao: 'lote', acoes })
    },
    [construir, enviar],
  )

  /** técnico: grava os limiares de um tipo na zona atual (null = repor o padrão) */
  const gravarLimiar = useCallback(
    async (tipo: Tipo, valores: Pick<ValoresLimiar, 'ativo' | 'limiar' | 'min_vistas'> | null) => {
      const r = await fetch('/api/limiares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zona: base?.config.zona, tipo, valores }),
      })
      if (r.status === 401) {
        onExpirou()
        throw new Error('sessão expirada')
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
      setLimiares(j)
    },
    [base, onExpirou],
  )

  /** M10: corre evaluate.py no servidor e volta a ler catalogo/metrica.json */
  const recalcularMetrica = useCallback(async (): Promise<{ ok: boolean; saida: string }> => {
    try {
      const r = await fetch('/api/metrica', { method: 'POST' })
      if (r.status === 401) {
        onExpirou()
        return { ok: false, saida: 'sessão expirada' }
      }
      const j = await r.json()
      if (r.ok) carregarMetrica().then(setMetrica)
      return { ok: r.ok, saida: j.saida ?? j.erro ?? '' }
    } catch (e) {
      return { ok: false, saida: String(e instanceof Error ? e.message : e) }
    }
  }, [onExpirou])

  const desfazer = useCallback((id: string) => enviar({ acao: 'desfazer', id }), [enviar])
  const desfazerVarios = useCallback(
    (ids: string[]) => ids.length && enviar(ids.length === 1 ? { acao: 'desfazer', id: ids[0] } : { acao: 'lote', acoes: ids.map((id) => ({ acao: 'desfazer' as const, id })) }),
    [enviar],
  )
  /** o técnico diz se dois elementos são o mesmo objeto (true) ou não (false) */
  const decidirPar = useCallback((a: string, b: string, mesmo: boolean) => enviar({ acao: 'par', a, b, mesmo }), [enviar])
  /** vários pares de uma vez (ex.: "são objetos diferentes" num grupo de 3: todos os pares entre eles) */
  const decidirPares = useCallback(
    (pares: { a: string; b: string; mesmo: boolean }[]) => pares.length && enviar({ acao: 'lote', acoes: pares.map((p) => ({ acao: 'par' as const, ...p })) }),
    [enviar],
  )
  const limparValidacoes = useCallback(() => enviar({ acao: 'limpar' }), [enviar])

  const carregarFicheiro = useCallback(async (f: File) => {
    try {
      const els = lerFicheiroElementos(await f.text())
      setBrutos(els)
      setOrigem('ficheiro')
      setNomeFicheiro(f.name)
      setErro(null)
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e))
    }
  }, [])

  const usarDemo = useCallback(() => {
    setBrutos(gerarDemo(base?.vias ?? null))
    setOrigem('demo')
    setNomeFicheiro(null)
  }, [base])

  const usarPipeline = useCallback(() => {
    if (!base?.elementos?.length) return
    setBrutos(base.elementos)
    setOrigem('pipeline')
    setNomeFicheiro(null)
  }, [base])

  return {
    base,
    origem,
    nomeFicheiro,
    elementos,
    consolidados,
    todos,
    duplicados,
    sugestoes,
    imagens,
    deteccoes,
    recarregar: () => setVersao((v) => v + 1),
    recalcularMetrica,
    limiares,
    limZona,
    gravarLimiar,
    validacoes,
    registo,
    metrica,
    erro,
    tecnico,
    decidir,
    decidirVarios,
    desfazer,
    desfazerVarios,
    decidirPar,
    decidirPares,
    limparValidacoes,
    carregarFicheiro,
    usarDemo,
    usarPipeline,
  }
}

export type Catalogo = ReturnType<typeof useCatalogo>
