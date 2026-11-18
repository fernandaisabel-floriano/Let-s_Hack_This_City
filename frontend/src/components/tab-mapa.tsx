import { Lock, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Acoes, Detalhes, Recorte, titulo } from '@/components/ficha'
import { aplicarFiltros, Filtros, filtrosAtivos, filtrosIniciais, type FiltrosState } from '@/components/filtros'
import { MapView } from '@/components/map-view'
import { TipoIcon } from '@/components/tipo-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Catalogo } from '@/hooks/use-catalogo'

interface Props {
  cat: Catalogo
  escuro: boolean
  onPedirLogin: () => void
}

const flutuante = 'rounded-xl border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85'

export function TabMapa({ cat, escuro, onPedirLogin }: Props) {
  const tecnico = !!cat.tecnico
  const [filtros, setFiltros] = useState<FiltrosState>(() => filtrosIniciais(tecnico))
  const [verFiltros, setVerFiltros] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [editarPos, setEditarPos] = useState(false)
  const cfg = cat.base!.config

  const visiveis = useMemo(() => aplicarFiltros(cat.elementos, filtros), [cat.elementos, filtros])
  const contagens = useMemo(() => {
    const tipo: Record<string, number> = {}
    const estado: Record<string, number> = {}
    for (const e of cat.elementos) {
      estado[e.estado] = (estado[e.estado] ?? 0) + 1
      if (filtros.estados.includes(e.estado)) tipo[e.tipo] = (tipo[e.tipo] ?? 0) + 1
    }
    return { tipo, estado }
  }, [cat.elementos, filtros.estados])
  const el = cat.elementos.find((e) => e.id === sel)
  const nAtivos = filtrosAtivos(filtros, tecnico)

  const selecionar = (id: string) => {
    setSel(id)
    setEditarPos(false)
    setVerFiltros(false)
  }

  return (
    <div className="relative size-full">
      <MapView
        elementos={visiveis}
        vias={cat.base!.vias}
        zona={cat.base!.zona}
        bbox={cfg.bbox}
        selecionado={sel}
        onSelect={selecionar}
        escuro={escuro}
        onMover={tecnico && editarPos ? (id, lat, lon) => cat.decidir(id, 'corrigido', { lat, lon }) : undefined}
      />

      {/* pesquisa + filtros */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-start gap-2 sm:right-auto sm:w-80">
        <div className={cn('pointer-events-auto flex w-full items-center gap-1 p-1', flutuante)}>
          <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder="Procurar…"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={filtros.texto}
            onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })}
          />
          <Button className="shrink-0" variant={verFiltros ? 'secondary' : 'ghost'} size="sm" onClick={() => setVerFiltros(!verFiltros)} aria-expanded={verFiltros}>
            <SlidersHorizontal />
            Filtros
            {nAtivos > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{nAtivos}</span>}
          </Button>
        </div>
        {verFiltros && (
          <div className={cn('pointer-events-auto w-full p-4', flutuante)}>
            <Filtros value={filtros} onChange={setFiltros} contagens={contagens} tecnico={tecnico} />
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => setFiltros(filtrosIniciais(tecnico))}>Repor</Button>
              <Button size="sm" onClick={() => setVerFiltros(false)}>Ver {visiveis.length} no mapa</Button>
            </div>
          </div>
        )}
      </div>

      {/* contagem discreta */}
      {!el && (
        <div className={cn('absolute bottom-6 left-3 z-10 px-3 py-1.5 text-xs text-muted-foreground', flutuante)}>
          <strong className="font-semibold text-foreground tabular-nums">{visiveis.length}</strong> elementos no mapa
        </div>
      )}

      {/* ficha */}
      {el && (
        <aside
          className={cn(
            'absolute inset-x-3 bottom-3 z-20 flex max-h-[60%] flex-col overflow-hidden sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-6 sm:max-h-none sm:w-[360px]',
            flutuante,
          )}
        >
          <header className="flex items-start gap-3 border-b p-4">
            <TipoIcon tipo={el.tipo} subtipo={el.subtipo} className="size-9" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg leading-tight font-semibold">{titulo(el)}</h2>
              <p className="font-mono text-xs text-muted-foreground">{el.id}</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setSel(null)} aria-label="Fechar">
              <X />
            </Button>
          </header>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 p-4">
              <Recorte el={el} className="aspect-[4/3] w-full" />
              {tecnico ? (
                <Acoes
                  el={el}
                  validado={!!cat.validacoes[el.id]}
                  onDecidir={(estado, opts) => cat.decidir(el.id, estado, opts)}
                  onDesfazer={() => cat.desfazer(el.id)}
                  editarPosicao={editarPos}
                  onEditarPosicao={setEditarPos}
                />
              ) : (
                el.estado === 'pendente' && (
                  <button onClick={onPedirLogin} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent">
                    <Lock className="size-3.5 shrink-0" />
                    Este elemento ainda não foi confirmado por um técnico. É técnico da Câmara? Entre para validar.
                  </button>
                )
              )}
              <Detalhes el={el} crs={cfg.crs_local} limiar={cfg.limiar_auto} validacao={cat.validacoes[el.id]} tecnico={tecnico} />
            </div>
          </ScrollArea>
        </aside>
      )}
    </div>
  )
}
