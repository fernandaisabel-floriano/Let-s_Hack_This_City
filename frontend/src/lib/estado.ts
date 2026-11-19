/**
 * Estado de cada elemento: igual a pipeline/estado.py (decisão 3, opção B).
 *
 *   1. decisão de um técnico (validado / corrigido / rejeitado) — nunca muda com o limiar
 *   2. ticket aberto depois da última decisão → pendente (em revisão)
 *   3. tipo ativo, subtipo certo, pontuação ≥ limiar e vistas ≥ mínimo → auto
 *   4. senão → pendente
 */
import type { Elemento, Estado, Tipo, Validacao } from './types'

export type BaseLimiar = 'calibrada' | 'clip' | 'detetor'

export interface ValoresLimiar {
  ativo: boolean
  base: BaseLimiar
  limiar: number
  min_vistas: number
}

export interface AlteracaoLimiar {
  quando: string
  tecnico: { utilizador: string; nome: string }
  zona: string
  tipo: Tipo
  antes: Partial<ValoresLimiar>
  depois: Partial<ValoresLimiar>
}

/** config/limiares.json (via /api/limiares). */
export interface Limiares {
  padrao: Record<Tipo, ValoresLimiar>
  zonas: Record<string, Partial<Record<Tipo, Partial<ValoresLimiar>>>>
  /** só para técnicos */
  historico?: AlteracaoLimiar[]
}

export type LimiaresZona = Record<Tipo, ValoresLimiar>

/** Igual a estado.padrao(). */
export function padraoLimiares(limiarAuto = 0.9, minVistas = 2): Record<Tipo, ValoresLimiar> {
  const base = { ativo: true, base: 'calibrada' as const, limiar: limiarAuto, min_vistas: minVistas }
  return { sinal: { ...base }, candeeiro: { ...base }, contentor: { ativo: false, base: 'clip', limiar: 0.8, min_vistas: minVistas } }
}

export function limiaresZona(l: Limiares, zona: string): LimiaresZona {
  const z = l.zonas[zona] ?? {}
  return {
    sinal: { ...l.padrao.sinal, ...z.sinal },
    candeeiro: { ...l.padrao.candeeiro, ...z.candeeiro },
    contentor: { ...l.padrao.contentor, ...z.contentor },
  }
}

export function pontuacao(e: Elemento, p: ValoresLimiar): number | null {
  if (p.base === 'clip') return e.confianca_clip ?? null
  if (p.base === 'detetor') return e.confianca_max_vista ?? null
  return e.confianca
}

export function estadoAuto(e: Elemento, p: ValoresLimiar): 'auto' | 'pendente' {
  if (!p.ativo || e.subtipo_incerto) return 'pendente'
  const s = pontuacao(e, p)
  if (s === null || s < p.limiar || e.n_vistas < p.min_vistas) return 'pendente'
  return 'auto'
}

export function estadoEfetivo(e: Elemento, v: Validacao | undefined, ticket: { quando: string } | undefined, p: ValoresLimiar): Estado {
  if (ticket && (!v || ticket.quando > v.validado_em)) return 'pendente'
  if (v) return v.estado
  return estadoAuto(e, p)
}

/**
 * Efeito de mudar os limiares de um tipo, nos elementos ainda sem decisão de um técnico.
 * Com as validações já feitas, diz também quantos dos que passariam a entrar eram reais / falsos.
 */
export function efeitoLimiar(els: Elemento[], validacoes: Record<string, Validacao>, tipo: Tipo, atual: ValoresLimiar, novo: ValoresLimiar) {
  let entram = 0
  let saem = 0
  let auto = 0
  const decididos = { reais: 0, falsos: 0 }
  for (const e of els) {
    if (e.tipo !== tipo) continue
    const depois = estadoAuto(e, novo)
    const v = validacoes[e.id]
    if (v) {
      // o técnico já decidiu: o limiar não muda nada, mas serve para medir quantos teriam entrado bem
      if (depois === 'auto') {
        if (v.estado === 'rejeitado') decididos.falsos++
        else if (!v.classe_corrigida || v.classe_corrigida === tipo) decididos.reais++
        else decididos.falsos++
      }
      continue
    }
    const antes = estadoAuto(e, atual)
    if (depois === 'auto') auto++
    if (antes !== 'auto' && depois === 'auto') entram++
    if (antes === 'auto' && depois !== 'auto') saem++
  }
  const n = decididos.reais + decididos.falsos
  return { entram, saem, auto, decididos, precisaoValidacoes: n ? decididos.reais / n : null, semPontuacao: els.filter((e) => e.tipo === tipo && pontuacao(e, novo) === null).length }
}
