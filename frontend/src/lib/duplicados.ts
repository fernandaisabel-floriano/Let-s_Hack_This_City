import type { Elemento, Evento } from './types'

/** Par de elementos que podem ser o mesmo objeto (server/duplicados.ts). */
export interface ParDuplicado {
  a: string
  b: string
  tipo: string
  dist_m: number
  /** certo = fundido automaticamente; possivel = decide o técnico */
  motivo: 'certo' | 'possivel'
  iou?: number
}

export interface DecisaoPar {
  a: string
  b: string
  mesmo: boolean
}

const chave = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Última decisão sobre cada par, a partir do registo (igual a paresDecididos() no servidor). */
export function paresDecididos(reg: Evento[]): DecisaoPar[] {
  const m = new Map<string, DecisaoPar>()
  for (const e of reg) {
    if (e.acao === 'limpar') m.clear()
    else if (e.acao === 'par' && e.a && e.b) m.set(chave(e.a, e.b), { a: e.a, b: e.b, mesmo: !!e.mesmo })
  }
  return [...m.values()]
}

export interface Agrupamento {
  /** um elemento por objeto: o representante de cada grupo, com `fundidos` */
  elementos: Elemento[]
  /** id escondido → id do representante */
  escondidoEm: Map<string, string>
  /** possíveis duplicados ainda por decidir, entre elementos visíveis */
  porDecidir: (ParDuplicado & { aEl: Elemento; bEl: Elemento })[]
  /** pares de um elemento visível ainda por decidir */
  paresDe: (id: string) => (ParDuplicado & { outro: Elemento })[]
  /** id → membros fundidos nele, com a distância */
  fundidosEm: (id: string) => { el: Elemento; dist_m: number | null; automatico: boolean }[]
  nAutomaticos: number
}

/** Representante do grupo: o confirmado por um técnico; nunca um rejeitado (senão o grupo todo desaparecia). */
const PRIORIDADE_ESTADO: Record<string, number> = { validado: 4, corrigido: 4, auto: 2, pendente: 1, rejeitado: 0 }

/**
 * Junta os duplicados num só elemento.
 * Ligações: pares "certo" (exceto os que o técnico separou), pares que o técnico disse serem o mesmo,
 * e elementos que o técnico marcou como "duplicado de" outro (fica o outro: posição e imagem).
 * Representante: o que já tem decisão do técnico; senão o automático; depois mais vistas e mais confiança.
 *
 * consolidar: junta também os pares "possivel" ainda por decidir — vista da Câmara, onde cada
 * objeto aparece uma só vez enquanto o técnico não decide (se forem diferentes, separa-os).
 */
export function agrupar(els: Elemento[], pares: ParDuplicado[], decisoes: DecisaoPar[], consolidar = false): Agrupamento {
  const porId = new Map(els.map((e) => [e.id, e]))
  const decisao = new Map(decisoes.map((d) => [chave(d.a, d.b), d.mesmo]))
  const parInfo = new Map(pares.map((p) => [chave(p.a, p.b), p]))

  const pai = new Map<string, string>()
  const raiz = (x: string): string => {
    let r = x
    while (pai.get(r) && pai.get(r) !== r) r = pai.get(r)!
    pai.set(x, r)
    return r
  }
  const unir = (a: string, b: string) => {
    if (!porId.has(a) || !porId.has(b)) return
    pai.set(raiz(a), raiz(b))
  }
  for (const e of els) pai.set(e.id, e.id)

  const automaticas = new Set<string>()
  for (const p of pares) {
    const d = decisao.get(chave(p.a, p.b))
    if (d === false) continue
    if (p.motivo === 'certo' || d === true || consolidar) {
      unir(p.a, p.b)
      if (p.motivo === 'certo' && d === undefined) automaticas.add(chave(p.a, p.b))
    }
  }
  for (const d of decisoes) if (d.mesmo) unir(d.a, d.b)
  for (const e of els) if (e.estado === 'rejeitado' && e.duplicado_de) unir(e.id, e.duplicado_de)

  const grupos = new Map<string, Elemento[]>()
  for (const e of els) grupos.set(raiz(e.id), [...(grupos.get(raiz(e.id)) ?? []), e])

  const escondidoEm = new Map<string, string>()
  const membros = new Map<string, Elemento[]>()
  const visiveis: Elemento[] = []
  for (const g of grupos.values()) {
    const [rep, ...resto] = [...g].sort(
      (x, y) =>
        (PRIORIDADE_ESTADO[y.estado] ?? 0) - (PRIORIDADE_ESTADO[x.estado] ?? 0) ||
        y.n_vistas - x.n_vistas ||
        (y.confianca ?? -1) - (x.confianca ?? -1),
    )
    for (const m of resto) escondidoEm.set(m.id, rep.id)
    membros.set(rep.id, resto)
    visiveis.push(resto.length ? { ...rep, fundidos: resto.map((m) => m.id) } : rep)
  }
  // mantém a ordem original
  const ordem = new Map(els.map((e, i) => [e.id, i]))
  visiveis.sort((x, y) => ordem.get(x.id)! - ordem.get(y.id)!)
  const visivelPorId = new Map(visiveis.map((e) => [e.id, e]))

  const porDecidir: Agrupamento['porDecidir'] = []
  const vistos = new Set<string>()
  for (const p of pares) {
    if (p.motivo !== 'possivel' || decisao.has(chave(p.a, p.b))) continue
    const ra = escondidoEm.get(p.a) ?? p.a
    const rb = escondidoEm.get(p.b) ?? p.b
    if (ra === rb) continue
    const k = chave(ra, rb)
    if (vistos.has(k)) continue
    const aEl = visivelPorId.get(ra)
    const bEl = visivelPorId.get(rb)
    if (!aEl || !bEl || aEl.estado === 'rejeitado' || bEl.estado === 'rejeitado') continue
    vistos.add(k)
    porDecidir.push({ ...p, a: ra, b: rb, aEl, bEl })
  }

  return {
    elementos: visiveis,
    escondidoEm,
    porDecidir,
    paresDe: (id) =>
      porDecidir
        .filter((p) => p.a === id || p.b === id)
        .map((p) => ({ ...p, outro: p.a === id ? p.bEl : p.aEl })),
    fundidosEm: (id) =>
      (membros.get(id) ?? []).map((el) => {
        const p = parInfo.get(chave(id, el.id))
        return { el, dist_m: p?.dist_m ?? null, automatico: automaticas.has(chave(id, el.id)) }
      }),
    nAutomaticos: [...membros.values()].reduce((n, m) => n + m.length, 0),
  }
}
