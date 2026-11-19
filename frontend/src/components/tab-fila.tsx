import { ArrowDownWideNarrow, ArrowUpNarrowWide, Copy, CircleCheck, Timer, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Acoes, CoordenadasEditor, Detalhes, Recorte, titulo } from '@/components/ficha'
import { bboxDe } from '@/components/ficha-painel'
import { TipoIcon } from '@/components/tipo-icon'
import { Duplicados } from '@/components/duplicados'
import { MapView } from '@/components/map-view'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import { duracao } from '@/lib/format'
import { posicaoARever } from '@/lib/revisao'
import { TIPOS, type Validacao } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { Catalogo, DecisaoOpts } from '@/hooks/use-catalogo'

export function TabFila({ cat, escuro }: { cat: Catalogo; escuro?: boolean }) {
  const cfg = cat.base!.config
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('asc')
  const [atualId, setAtualId] = useState<string | null>(null)
  const [historico, setHistorico] = useState<string[]>([])
  const inicioItem = useRef(Date.now())
  const [inicioSessao, setInicioSessao] = useState<number | null>(null)
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const [limiar, setLimiar] = useState(cfg.limiar_auto)

  // Pendentes com confiança abaixo do limiar escolhido. Sem calibração (null) ou com
  // menos vistas do que m8.min_vistas entram sempre: são duvidosos de qualquer forma.
  const fila = useMemo(() => {
    const p = cat.elementos.filter(
      (e) =>
        (e.estado === 'pendente' && (e.confianca === null || e.confianca < limiar || e.n_vistas < cfg.min_vistas)) ||
        // possíveis duplicados por decidir entram na fila mesmo que já estejam confirmados
        (e.estado !== 'rejeitado' && cat.duplicados.paresDe(e.id).length > 0) ||
        // posição incerta e ainda sem decisão de um técnico (inclui os aceites automaticamente)
        ((e.estado === 'pendente' || e.estado === 'auto') && posicaoARever(e)),
    )
    // sem calibração (null) = mais duvidoso
    const k = (c: number | null) => c ?? -1
    return p.sort((a, b) => (ordem === 'asc' ? k(a.confianca) - k(b.confianca) : k(b.confianca) - k(a.confianca)))
  }, [cat.elementos, cat.duplicados, ordem, limiar, cfg.min_vistas])
  const naFila = new Set(fila.map((e) => e.id))
  const escondidos = cat.elementos.filter((e) => e.estado === 'pendente' && !naFila.has(e.id)).length

  const feitos = Object.keys(cat.validacoes).length
  const totalParaValidar = fila.length + feitos
  const atual = fila.find((e) => e.id === atualId) ?? fila[0]

  useEffect(() => {
    inicioItem.current = Date.now()
  }, [atual?.id])

  const decidir = useCallback(
    (estado: Validacao['estado'], opts: DecisaoOpts = {}) => {
      if (!atual) return
      if (inicioSessao === null) setInicioSessao(inicioItem.current)
      const tempo_s = Math.round((Date.now() - inicioItem.current) / 100) / 10
      cat.decidir(atual.id, estado, { ...opts, tempo_s })
      setHistorico((h) => [...h, atual.id])
      setAtualId(null)
    },
    [atual, cat, inicioSessao],
  )

  const desfazerUltimo = useCallback(() => {
    const id = historico.at(-1)
    if (!id) return
    cat.desfazer(id)
    setHistorico((h) => h.slice(0, -1))
    setAtualId(id)
  }, [historico, cat])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const k = ev.key.toLowerCase()
      if (k === 'v' || k === 'enter') decidir('validado')
      else if (k === 'x' || k === 'delete') decidir('rejeitado')
      else if (k === 'z') desfazerUltimo()
      else if (['1', '2', '3'].includes(k) && atual) {
        const t = TIPOS[Number(k) - 1]
        if (t !== atual.tipo) decidir('corrigido', { tipo: t, subtipo: t === 'sinal' ? 'outro_sinal' : null })
      } else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decidir, desfazerUltimo, atual])

  const tempos = Object.values(cat.validacoes).map((v) => v.tempo_s ?? 0).filter((t) => t > 0)
  const tempoTotal = tempos.reduce((a, b) => a + b, 0)
  const progresso = totalParaValidar ? (feitos / totalParaValidar) * 100 : 100

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
      <Card className="min-h-0 gap-0 py-0">
        <CardHeader className="gap-3 py-4">
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
              <span>{fila.length} na fila · {feitos} decididos</span>
              <span className="flex items-center gap-1 tabular-nums">
                <Timer className="size-3" />
                {inicioSessao ? duracao((agora - inicioSessao) / 1000) : '—'}
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
            <div className="flex items-center justify-between text-xs">
              <span>Confiança abaixo de</span>
              <span className="font-mono tabular-nums">{(limiar * 100).toFixed(1)}%</span>
            </div>
            <Slider min={0} max={1} step={0.005} value={[limiar]} onValueChange={([v]) => setLimiar(v)} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{escondidos ? `${escondidos} pendentes acima do limiar` : 'todos os pendentes'}</span>
              {limiar !== cfg.limiar_auto && (
                <button className="underline underline-offset-2" onClick={() => setLimiar(cfg.limiar_auto)}>
                  repor {(cfg.limiar_auto * 100).toFixed(0)}%
                </button>
              )}
            </div>
          </div>
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
                <Recorte el={atual} className="aspect-video w-full" />
                <Duplicados cat={cat} el={atual} compacto />
                <div className="h-52 overflow-hidden rounded-lg border">
                  <MapView
                    compacto
                    escuro={escuro}
                    elementos={[atual, ...cat.duplicados.paresDe(atual.id).map((p) => p.outro)]}
                    vias={cat.base!.vias}
                    zona={cat.base!.zona}
                    bbox={cfg.bbox}
                    selecionado={atual.id}
                    onSelect={() => {}}
                    onMover={(id, lat, lon) => cat.decidir(id, 'corrigido', { lat, lon })}
                  />
                </div>
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
                <details className="rounded-lg border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Corrigir coordenadas (ou arraste o marcador no mapa)</summary>
                  <div className="pt-3">
                    <CoordenadasEditor el={atual} onGuardar={(lat, lon) => cat.decidir(atual.id, 'corrigido', { lat, lon })} />
                  </div>
                </details>
                <Detalhes
                  el={atual}
                  crs={cfg.crs_local}
                  limiar={cfg.limiar_auto}
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
            <CardTitle className="font-heading text-xl">Fila vazia</CardTitle>
            <CardDescription className="max-w-sm">
              Todos os casos duvidosos foram decididos
              {tempos.length ? ` em ${duracao(tempoTotal)} (${(tempoTotal / tempos.length).toFixed(1)} s por elemento)` : ''}.
              Exporte as validações para recalibrar a confiança com <code className="text-xs">confianca.py recalibrar</code>.
            </CardDescription>
            {historico.length > 0 && (
              <Button variant="outline" size="sm" onClick={desfazerUltimo}><Undo2 /> Desfazer a última</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
