import { ArrowDownWideNarrow, ArrowUpNarrowWide, Calculator, Copy, CircleCheck, Timer, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Acoes, CoordenadasEditor, Detalhes, Recorte, titulo } from '@/components/ficha'
import { bboxDe } from '@/components/ficha-painel'
import { TipoIcon } from '@/components/tipo-icon'
import { Duplicados } from '@/components/duplicados'
import { grupoDuplicados, melhorDoGrupo, QualFica } from '@/components/qual-fica'
import { MapView } from '@/components/map-view'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { duracao } from '@/lib/format'
import { maQualidade } from '@/lib/estado'
import { distM, zoneContains } from '@/lib/geo'
import { posicaoARever } from '@/lib/revisao'
import { TIPOS, type Elemento, type Validacao } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { Catalogo, DecisaoOpts } from '@/hooks/use-catalogo'

/** raio (m) em que se procuram elementos da mesma classe para "duplicado de…" */
const RAIO_DUPLICADO_M = 15

/**
 * Candidatos a "este elemento é duplicado de…": mesma classe, até RAIO_DUPLICADO_M, não
 * rejeitados. Primeiro aquele em que a app já o fundiu automaticamente, depois os já
 * confirmados por um técnico, depois os mais próximos.
 */
function candidatosDuplicado(cat: Catalogo, el: Elemento) {
  const fundidoEm = cat.duplicados.escondidoEm.get(el.id)
  return cat.todos
    .filter((o) => o.id !== el.id && o.tipo === el.tipo && o.estado !== 'rejeitado')
    .map((o) => ({ el: o, dist: distM(el.lon, el.lat, o.lon, o.lat), fundido: o.id === fundidoEm }))
    .filter((c) => c.fundido || c.dist <= RAIO_DUPLICADO_M)
    .sort(
      (a, b) =>
        Number(b.fundido) - Number(a.fundido) ||
        Number(['validado', 'corrigido'].includes(b.el.estado)) - Number(['validado', 'corrigido'].includes(a.el.estado)) ||
        a.dist - b.dist,
    )
    .slice(0, 4)
}

function DuplicadoDe({ cands, onEscolher }: { cands: ReturnType<typeof candidatosDuplicado>; onEscolher: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3" aria-labelledby="dup-de">
      <p id="dup-de" className="flex items-center gap-2 text-sm font-medium">
        <Copy className="size-4 text-muted-foreground" /> Duplicado de…
        <span className="text-xs font-normal text-muted-foreground">mesmo objeto que outro elemento</span>
      </p>
      {cands.length ? (
        <ul className="flex flex-col gap-1.5">
          {cands.map((c, i) => (
            <li key={c.el.id}>
              <button
                onClick={() => onEscolher(c.el.id)}
                className="flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <Recorte el={c.el} className="size-12 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{titulo(c.el)} <span className="font-mono font-normal">{c.el.id}</span></span>
                  <span className="block text-muted-foreground">
                    a {c.dist.toFixed(1).replace('.', ',')} m
                    {c.fundido && ' · a app já os juntou'}
                    {['validado', 'corrigido'].includes(c.el.estado) && ' · já confirmado'}
                  </span>
                </span>
                {i === 0 && <kbd>D</kbd>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum elemento da mesma classe a menos de {RAIO_DUPLICADO_M} m.</p>
      )}
    </section>
  )
}

/** Relógio da sessão num componente à parte: atualizar a cada segundo não re-renderiza a fila (nem o mapa). */
function Relogio({ inicio }: { inicio: number | null }) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (inicio === null) return
    const t = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [inicio])
  return <>{inicio !== null ? duracao(Math.max(0, agora - inicio) / 1000) : '—'}</>
}

export function TabFila({ cat, escuro }: { cat: Catalogo; escuro?: boolean }) {
  const cfg = cat.base!.config
  /** duvidosos = fila normal (M8); zona = todos os elementos da zona de avaliação por validar (M10) */
  /**
   * duvidosos = fila normal (M8); zona = todos os da zona de avaliação (M10);
   * fracas = rejeitados automaticamente por má qualidade, só se o técnico os quiser rever
   */
  const [modo, setModo] = useState<'duvidosos' | 'zona' | 'fracas'>('duvidosos')
  const dentro = useMemo(() => zoneContains(cat.base!.zona), [cat.base])
  const [msgMetrica, setMsgMetrica] = useState<{ ok: boolean; saida: string } | null>(null)
  const [aCalcular, setACalcular] = useState(false)
  const recalcular = async () => {
    setACalcular(true)
    setMsgMetrica(await cat.recalcularMetrica())
    setACalcular(false)
  }
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('asc')
  const [atualId, setAtualId] = useState<string | null>(null)
  /** cada passo pode decidir vários elementos (um grupo de duplicados): desfazer desfaz o passo todo */
  const [historico, setHistorico] = useState<string[][]>([])
  const inicioItem = useRef(Date.now())
  const [inicioSessao, setInicioSessao] = useState<number | null>(null)

  // Pendentes = abaixo dos limiares de entrada automática do tipo (estado calculado em estado.ts;
  // os limiares mudam-se em "Entrada automática", no cabeçalho).
  // M10: os rejeitados por má qualidade não foram propostos pelo sistema, não entram (evaluate.py também não)
  const naZona = useMemo(() => cat.todos.filter((e) => dentro(e.lon, e.lat) && (!maQualidade(e) || cat.validacoes[e.id])), [cat.todos, dentro, cat.validacoes])
  const fracas = useMemo(() => cat.todos.filter((e) => maQualidade(e)), [cat.todos])
  const nFracasPorRever = fracas.filter((e) => !cat.validacoes[e.id]).length
  const fila = useMemo(() => {
    // M10: todos os elementos propostos dentro da zona, ainda sem decisão de um técnico
    // (inclui os automáticos e os que a app juntou a outro, para os marcar como duplicados)
    const p = modo === 'fracas' ? fracas.filter((e) => !cat.validacoes[e.id]) : modo === 'zona' ? naZona.filter((e) => !cat.validacoes[e.id]) : cat.elementos.filter(
      (e) =>
        e.estado === 'pendente' ||
        // possíveis duplicados por decidir entram na fila mesmo que já estejam confirmados
        (e.estado !== 'rejeitado' && cat.duplicados.paresDe(e.id).length > 0) ||
        // posição incerta e ainda sem decisão de um técnico (inclui os aceites automaticamente)
        (e.estado === 'auto' && posicaoARever(e)),
    )
    // sem calibração (null) = mais duvidoso
    const k = (c: number | null) => c ?? -1
    // avisos da Câmara primeiro
    return p.sort((a, b) => Number(!!b.ticket) - Number(!!a.ticket) || (ordem === 'asc' ? k(a.confianca) - k(b.confianca) : k(b.confianca) - k(a.confianca)))
  }, [modo, naZona, fracas, cat.validacoes, cat.elementos, cat.duplicados, ordem])

  const feitos = modo === 'zona' ? naZona.length - fila.length : modo === 'fracas' ? fracas.length - fila.length : Object.keys(cat.validacoes).length
  const totalParaValidar = modo === 'zona' ? naZona.length : modo === 'fracas' ? fracas.length : fila.length + feitos
  const atual = fila.find((e) => e.id === atualId) ?? fila[0]
  const cands = useMemo(() => (atual ? candidatosDuplicado(cat, atual) : []), [cat, atual])
  // "Qual fica?": grupo de duplicados do elemento atual, o escolhido e a posição ajustada à mão
  const grupo = useMemo(() => (atual ? grupoDuplicados(cat, atual) : []), [cat, atual])
  const temGrupo = grupo.length > 1
  const [escolha, setEscolha] = useState<{ para: string; id: string; pos: { lat: number; lon: number } | null } | null>(null)
  const escolhido = escolha && escolha.para === atual?.id && grupo.some((e) => e.id === escolha.id) ? escolha : null
  const escolhidoId = escolhido?.id ?? (temGrupo ? melhorDoGrupo(grupo).id : null)
  // posição ajustada à mão (arrastar ou escrever) do elemento atual: só se grava ao confirmar (V)
  const [ajuste, setAjuste] = useState<{ para: string; lat: number; lon: number } | null>(null)
  const posAjustada = useMemo(() => (ajuste && ajuste.para === atual?.id ? { lat: ajuste.lat, lon: ajuste.lon } : null), [ajuste, atual?.id])

  useEffect(() => {
    inicioItem.current = Date.now()
  }, [atual?.id])

  const decidir = useCallback(
    (estado: Validacao['estado'], opts: DecisaoOpts = {}) => {
      if (!atual) return
      if (inicioSessao === null) setInicioSessao(inicioItem.current)
      const tempo_s = Math.round((Date.now() - inicioItem.current) / 100) / 10
      // confirmar com a posição ajustada grava-a (fica "corrigido")
      const pos = posAjustada && estado !== 'rejeitado' && opts.lat === undefined ? posAjustada : {}
      cat.decidir(atual.id, 'lat' in pos ? (estado === 'validado' ? 'corrigido' : estado) : estado, { ...opts, ...pos, tempo_s })
      setHistorico((h) => [...h, [atual.id]])
      setAtualId(null)
      setAjuste(null)
    },
    [atual, cat, inicioSessao, posAjustada],
  )

  /** fica o escolhido (com a posição ajustada, se houver); os outros do grupo ficam duplicados dele */
  const confirmarGrupo = useCallback(() => {
    if (!atual || !escolhidoId) return
    if (inicioSessao === null) setInicioSessao(inicioItem.current)
    const tempo_s = Math.round((Date.now() - inicioItem.current) / 100) / 10
    const pos = escolhido?.pos ?? null
    const outros = grupo.filter((e) => e.id !== escolhidoId)
    cat.decidirVarios([
      { id: escolhidoId, estado: pos ? 'corrigido' : 'validado', opts: { ...(pos ?? {}), tempo_s } },
      ...outros.map((e) => ({ id: e.id, estado: 'rejeitado' as const, opts: { duplicado_de: escolhidoId } })),
    ])
    setHistorico((h) => [...h, [escolhidoId, ...outros.map((e) => e.id)]])
    setAtualId(null)
  }, [atual, escolhidoId, escolhido, grupo, cat, inicioSessao])

  /**
   * O técnico diz que não são o mesmo objeto: cada um volta à fila sozinho.
   * Todos os pares entre eles, num só pedido — separar só do representante deixava-os ligados
   * por um terceiro (19/11: um par foi marcado "diferente" 14 vezes sem efeito).
   */
  const separarGrupo = useCallback(() => {
    if (!atual) return
    const pares = grupo.flatMap((a, i) => grupo.slice(i + 1).map((b) => ({ a: a.id, b: b.id, mesmo: false })))
    cat.decidirPares(pares)
  }, [atual, grupo, cat])

  const desfazerUltimo = useCallback(() => {
    const ids = historico.at(-1)
    if (!ids) return
    cat.desfazerVarios(ids)
    setHistorico((h) => h.slice(0, -1))
    setAtualId(ids[0])
  }, [historico, cat])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const k = ev.key.toLowerCase()
      // Enter num botão focado já o carrega: não decidir duas vezes
      if (k === 'enter' && ev.target instanceof HTMLElement && ev.target.closest('button, a, [role="tab"]')) return
      if ((k === 'v' || k === 'enter') && temGrupo) confirmarGrupo()
      else if (k === 'v' || k === 'enter') decidir('validado')
      else if (k === 'x' || k === 'delete') decidir('rejeitado')
      else if (k === 'z') desfazerUltimo()
      else if (k === 'd' && cands[0]) decidir('rejeitado', { duplicado_de: cands[0].el.id })
      else if (['1', '2', '3'].includes(k) && atual) {
        const t = TIPOS[Number(k) - 1]
        if (t !== atual.tipo) decidir('corrigido', { tipo: t, subtipo: t === 'sinal' ? 'outro_sinal' : null })
      } else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decidir, desfazerUltimo, atual, cands, temGrupo, confirmarGrupo])

  const tempos = Object.values(cat.validacoes).map((v) => v.tempo_s ?? 0).filter((t) => t > 0)
  const tempoTotal = tempos.reduce((a, b) => a + b, 0)
  const progresso = totalParaValidar ? (feitos / totalParaValidar) * 100 : 100

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="gap-3 py-4">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs" role="tablist" aria-label="Que elementos validar">
            {(
              [
                ['duvidosos', 'Duvidosos'],
                ['zona', 'Zona (M10)'],
                ['fracas', `Má qualidade${nFracasPorRever ? ` (${nFracasPorRever})` : ''}`],
              ] as const
            ).map(([m, l]) => (
              <button
                key={m}
                role="tab"
                aria-selected={modo === m}
                onClick={() => {
                  setModo(m)
                  setAtualId(null)
                }}
                className={cn('rounded-md px-2 py-1.5 font-medium', modo === m ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">Fila</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setOrdem(ordem === 'asc' ? 'desc' : 'asc')}>
              {ordem === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
              {ordem === 'asc' ? 'Menos confiantes' : 'Mais confiantes'}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Progress value={progresso} />
            <CardDescription className="flex justify-between text-xs">
              <span>
                {modo === 'zona'
                  ? `${fila.length} por validar · ${feitos} de ${totalParaValidar} na zona`
                  : modo === 'fracas'
                    ? `${fila.length} por rever · ${feitos} revistos`
                    : `${fila.length} na fila · ${feitos} decididos`}
              </span>
              <span className="flex items-center gap-1 tabular-nums">
                <Timer className="size-3" />
                <Relogio inicio={inicioSessao} />
              </span>
            </CardDescription>
          </div>
          {modo === 'zona' ? (
            <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              Para medir a precisão: decida <strong>todos</strong> os elementos da zona de avaliação.{' '}
              <kbd>V</kbd> real, <kbd>X</kbd> falso, <kbd>D</kbd> duplicado do primeiro sugerido, <kbd>1</kbd>–<kbd>3</kbd> outro tipo.
              Cada decisão é cronometrada.
            </p>
          ) : modo === 'fracas' ? (
            <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              Vistos só em imagens pequenas, tremidas ou escuras: <strong>ficam rejeitados por má qualidade</strong> sem ninguém os ver. Reveja só se quiser:
              {' '}<kbd>V</kbd> recupera um elemento real, <kbd>X</kbd> confirma a rejeição. Medido a 19/11: 3 em cada 4 eram falsos ou duplicados.
            </p>
          ) : null}
        </CardHeader>
        <ScrollArea className="min-h-0 flex-1 border-t">
          <ul className="p-2">
            {fila.map((e, i) => (
              <li key={e.id}>
                <button
                  onClick={() => setAtualId(e.id)}
                  className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', atual?.id === e.id && 'bg-accent')}
                >
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <TipoIcon tipo={e.tipo} subtipo={e.subtipo} className="size-6" />
                  <span className="min-w-0 flex-1 truncate">{titulo(e)}</span>
                  {cat.duplicados.paresDe(e.id).length > 0 && (
                    <Copy className="ctrlf-dup size-3.5 shrink-0 text-warning" aria-label="possível duplicado" />
                  )}
                  <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {e.confianca !== null ? `${Math.round(e.confianca * 100)}%` : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Card>

      {atual ? (
        <Card className="min-h-0 gap-0 py-0">
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <TipoIcon tipo={atual.tipo} subtipo={atual.subtipo} className="size-9" />
              <div className="min-w-0">
                <CardTitle className="truncate font-heading text-lg">{titulo(atual)}</CardTitle>
                <CardDescription className="font-mono text-xs">
                  {atual.id}
                  {atual.confianca === null && <span className="font-sans"> · sem calibração, vem sempre para a fila</span>}
                  {atual.so_vistas_fracas && !cat.validacoes[atual.id] && (
                    <span className="font-sans text-warning" title="Medido a 19/11: 13 de 17 elementos assim eram falsos ou duplicados">
                      {' '}· rejeitado por má qualidade (só imagens pequenas, tremidas ou escuras): confirme ou recupere
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" disabled={!historico.length} onClick={desfazerUltimo}>
              <Undo2 /> Desfazer <kbd>Z</kbd>
            </Button>
          </CardHeader>
          <ScrollArea className="min-h-0 flex-1 border-t">
            <CardContent className="grid gap-4 py-4 xl:grid-cols-[1fr_340px]">
              <div className="flex min-w-0 flex-col gap-4">
                {temGrupo && escolhidoId ? (
                  <QualFica
                    cat={cat}
                    grupo={grupo}
                    escolhido={escolhidoId}
                    pos={escolhido?.pos ?? null}
                    escuro={escuro}
                    onEscolher={(id) => setEscolha({ para: atual.id, id, pos: null })}
                    onMover={(lat, lon) => setEscolha({ para: atual.id, id: escolhidoId, pos: { lat, lon } })}
                    onConfirmar={confirmarGrupo}
                    onDiferentes={separarGrupo}
                  />
                ) : (
                  <>
                    <Recorte el={atual} className="aspect-video w-full" />
                    <Duplicados cat={cat} el={atual} compacto />
                    <div className="h-52 overflow-hidden rounded-lg border">
                      <MapView
                        compacto
                        escuro={escuro}
                        elementos={[posAjustada ? { ...atual, ...posAjustada } : atual, ...cands.map((c) => c.el)]}
                        vias={cat.base!.vias}
                        zona={cat.base!.zona}
                        bbox={cfg.bbox}
                        selecionado={atual.id}
                        onSelect={() => {}}
                        onMover={(id, lat, lon) => id === atual.id && setAjuste({ para: atual.id, lat, lon })}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-4">
                <Acoes
                  el={atual}
                  atalhos
                  sugestao={cat.sugestoes[atual.id]}
                  validado={false}
                  onDecidir={(estado, opts) => decidir(estado, opts)}
                  onDesfazer={() => {}}
                />
                {posAjustada && !temGrupo && (
                  <p className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                    Posição ajustada: carregue em <kbd>V</kbd> (Confirmar) para a gravar.
                    <button className="underline underline-offset-2" onClick={() => setAjuste(null)}>repor a original</button>
                  </p>
                )}
                {!temGrupo && <DuplicadoDe cands={cands} onEscolher={(id) => decidir('rejeitado', { duplicado_de: id })} />}
                <details className="rounded-lg border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Corrigir coordenadas (ou arraste o marcador no mapa)</summary>
                  <div className="pt-3">
                    <CoordenadasEditor el={posAjustada ? { ...atual, ...posAjustada } : atual} onGuardar={(lat, lon) => setAjuste({ para: atual.id, lat, lon })} />
                  </div>
                </details>
                <Detalhes
                  el={atual}
                  crs={cfg.crs_local}
                  limiar={cat.limZona[atual.tipo].limiar}
                  tecnico
                  sugestao={cat.sugestoes[atual.id]}
                  imagemInfo={cat.imagens?.imagens[atual.imagem]}
                  bbox={bboxDe(cat, atual)}
                />
              </div>
            </CardContent>
          </ScrollArea>
        </Card>
      ) : (
        <Card className="items-center justify-center text-center">
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <CircleCheck className="size-10 text-success" />
            <CardTitle className="font-heading text-xl">{modo === 'zona' ? 'Zona toda validada' : modo === 'fracas' ? 'Nada de má qualidade por rever' : 'Fila vazia'}</CardTitle>
            <CardDescription className="max-w-sm">
              {modo === 'zona'
                ? `Os ${totalParaValidar} elementos da zona de avaliação foram decididos`
                : modo === 'fracas'
                  ? fracas.length
                    ? `Os ${fracas.length} elementos de má qualidade foram revistos`
                    : 'Não há elementos vistos só em imagens fracas (o passo de qualidade corre no pipeline)'
                  : 'Todos os casos duvidosos foram decididos'}
              {tempos.length ? ` em ${duracao(tempoTotal)} (${(tempoTotal / tempos.length).toFixed(1)} s por elemento)` : ''}.
              Exporte as validações para recalibrar a confiança com <code className="text-xs">confianca.py recalibrar</code>.
            </CardDescription>
            <div className="flex flex-wrap justify-center gap-2">
              {modo === 'zona' && (
                <Button size="sm" onClick={recalcular} disabled={aCalcular}>
                  <Calculator /> {aCalcular ? 'A calcular…' : 'Calcular métricas (M10)'}
                </Button>
              )}
              {historico.length > 0 && (
                <Button variant="outline" size="sm" onClick={desfazerUltimo}><Undo2 /> Desfazer a última</Button>
              )}
            </div>
            {msgMetrica && (
              <pre className={cn('max-w-xl overflow-x-auto rounded-md bg-muted p-3 text-left text-[11px]', !msgMetrica.ok && 'text-destructive')}>
                {msgMetrica.ok ? 'Métricas atualizadas: veja o Dashboard.\n\n' : ''}
                {msgMetrica.saida}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
