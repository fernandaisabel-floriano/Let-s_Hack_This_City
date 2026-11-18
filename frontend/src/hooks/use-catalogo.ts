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
import { gerarDemo } from '@/lib/demo'
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
}

type Acao = { acao: 'decisao'; validacao: NonNullable<Evento['validacao']> } | { acao: 'desfazer'; id: string } | { acao: 'limpar' }

export function useCatalogo(tecnico: Tecnico | null, onExpirou: () => void) {
  const [base, setBase] = useState<DadosBase | null>(null)
  const [origem, setOrigem] = useState<Origem>('demo')
  const [nomeFicheiro, setNomeFicheiro] = useState<string | null>(null)
  const [brutos, setBrutos] = useState<Elemento[]>([])
  const [registo, setRegisto] = useState<Evento[]>([])
  const [estadoPublico, setEstadoPublico] = useState<Record<string, Validacao>>({})
  const [deteccoes, setDeteccoes] = useState<Map<string, Deteccao> | null>(null)
  const [metrica, setMetrica] = useState<{ ficheiro: string; dados: Metrica } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

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
  }, [])

  // dados só para técnicos
  useEffect(() => {
    if (!tecnico || origem !== 'pipeline') {
      setDeteccoes(null)
      setMetrica(null)
      return
    }
    carregarDeteccoes().then(setDeteccoes)
    carregarMetrica().then(setMetrica)
  }, [tecnico, origem])

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
        .then(async (r) => r.ok && setEstadoPublico(await r.json()))
        .catch(() => {})
    }
  }, [storageKey, origem, tecnico, onExpirou])

  const validacoes = useMemo(
    () => (origem === 'pipeline' && !tecnico ? estadoPublico : estadoAtual(registo)),
    [origem, tecnico, estadoPublico, registo],
  )

  const enviar = useCallback(
    async (a: Acao) => {
      if (!tecnico) return
      const local: Evento = {
        seq: (registo.at(-1)?.seq ?? 0) + 1,
        quando: new Date().toISOString(),
        tecnico,
        ...a,
        ...('validacao' in a ? { id: a.validacao.id } : {}),
      }
      const seguinte = [...registo, local]
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

  const elementos = useMemo<Elemento[]>(
    () =>
      brutos.map((e) => {
        const v = validacoes[e.id]
        if (!v) return e
        return {
          ...e,
          estado: v.estado,
          tipo: v.classe_corrigida ?? e.tipo,
          subtipo: v.subtipo_corrigido !== undefined ? v.subtipo_corrigido : e.subtipo,
          lat: v.lat ?? e.lat,
          lon: v.lon ?? e.lon,
        }
      }),
    [brutos, validacoes],
  )

  const decidir = useCallback(
    (id: string, estado: Validacao['estado'], opts: DecisaoOpts = {}) => {
      const e = brutos.find((x) => x.id === id)
      if (!e) return
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
      // corrigido sem mudança efetiva → validado
      if (estado === 'corrigido' && !v.classe_corrigida && v.subtipo_corrigido === undefined && v.lat === undefined) v.estado = 'validado'
      enviar({ acao: 'decisao', validacao: v })
    },
    [brutos, deteccoes, validacoes, enviar],
  )

  const desfazer = useCallback((id: string) => enviar({ acao: 'desfazer', id }), [enviar])
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
    validacoes,
    registo,
    metrica,
    erro,
    tecnico,
    decidir,
    desfazer,
    limparValidacoes,
    carregarFicheiro,
    usarDemo,
    usarPipeline,
  }
}

export type Catalogo = ReturnType<typeof useCatalogo>
