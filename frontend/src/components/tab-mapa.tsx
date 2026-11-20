import { Download, FileSpreadsheet, Map as MapIcon, Merge, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FichaPainel } from '@/components/ficha-painel'
import { UnirDuplicados } from '@/components/unir-duplicados'
import { aplicarFiltros, Filtros, filtrosAtivos, filtrosIniciais, type CorPor, type FiltrosState } from '@/components/filtros'
import { MapView } from '@/components/map-view'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { download, separarCatalogo, toCSV, toGeoJSON } from '@/lib/export'
import { nomesVias, posicaoARever } from '@/lib/revisao'
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
  const movel = useIsMobile()
  const [filtros, setFiltros] = useState<FiltrosState>(() => filtrosIniciais(tecnico))
  const [verFiltros, setVerFiltros] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [editarPos, setEditarPos] = useState(false)
  const [corPor, setCorPor] = useState<CorPor>('categoria')
  /** técnico: unir à mão duplicados que o sistema não detetou (null = desligado) */
  const [unir, setUnir] = useState<{ ids: string[]; fica: string | null } | null>(null)

  // modo lite: no telemóvel junta os marcadores próximos por omissão
  const [agruparEscolha, setAgrupar] = useState<boolean | null>(null)
  const agrupar = agruparEscolha ?? movel
  const cfg = cat.base!.config
  const ruas = useMemo(() => nomesVias(cat.base!.vias), [cat.base])

  // a unir duplicados, mostra todos os que não estão rejeitados (um duplicado por unir pode estar por confirmar)
  const unirAtivo = !!unir
  const visiveis = useMemo(
    () => aplicarFiltros(cat.consolidados, unirAtivo ? { ...filtros, estados: ['auto', 'pendente', 'validado', 'corrigido'] } : filtros),
    [cat.consolidados, filtros, unirAtivo],
  )
  const contagens = useMemo(() => {
    const tipo: Record<string, number> = {}
    const estado: Record<string, number> = {}
    let rever = 0
    for (const e of cat.consolidados) {
      estado[e.estado] = (estado[e.estado] ?? 0) + 1
      if (filtros.estados.includes(e.estado)) {
        tipo[e.tipo] = (tipo[e.tipo] ?? 0) + 1
        if (posicaoARever(e)) rever++
      }
    }
    return { tipo, estado, rever }
  }, [cat.consolidados, filtros.estados])
  const el = cat.consolidados.find((e) => e.id === sel)
  const nAtivos = filtrosAtivos(filtros, tecnico)

  const selecionar = (id: string) => {
    if (unir) {
      setUnir((u) => (u ? { ...u, ids: u.ids.includes(id) ? u.ids.filter((x) => x !== id) : [...u.ids, id] } : u))
      return
    }
    setSel(id)
    setEditarPos(false)
    setVerFiltros(false)
  }

  /** exportação rápida: o que está no mapa ou o catálogo (mesmas regras do Exportar: dentro da zona, sem rejeitados) */
  const paraExportar = useMemo(
    () => ({
      mapa: separarCatalogo(visiveis, cfg, cat.base!.zona).cat,
      tudo: separarCatalogo(cat.consolidados, cfg, cat.base!.zona).cat,
    }),
    [visiveis, cat.consolidados, cfg, cat.base],
  )
  const exportar = (formato: 'geojson' | 'csv', tudo: boolean) => {
    const rows = tudo ? paraExportar.tudo : paraExportar.mapa
    const nome = `${cfg.municipio}_${cfg.zona}_${tudo ? 'catalogo' : 'mapa'}.${formato}`
    if (formato === 'geojson') download(nome, JSON.stringify(toGeoJSON(rows, cfg), null, 1), 'application/geo+json')
    else download(nome, toCSV(rows), 'text/csv')
    toast.success(`${nome} descarregado (${rows.length} elementos)`)
  }

  return (
    <div className="relative size-full" data-tour="mapa">
      <MapView
        elementos={visiveis}
        vias={cat.base!.vias}
        zona={cat.base!.zona}
        bbox={cfg.bbox}
        selecionado={sel}
        onSelect={selecionar}
        escuro={escuro}
        limiar={cfg.limiar_auto}
        agrupar={agrupar}
        corPor={corPor}
        onMover={tecnico && editarPos && !unir ? (id, lat, lon) => cat.decidir(id, 'corrigido', { lat, lon }) : undefined}
        marcados={unir?.ids}
      />

      {/* pesquisa + filtros + exportação rápida */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-start gap-2 sm:right-auto sm:w-96">
        <div className={cn('pointer-events-auto flex w-full items-center gap-1 p-1', flutuante)} role="search">
          <Search className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            data-tour="pesquisa"
            type="search"
            aria-label="Procurar por rua, tipo ou identificador"
            placeholder="Procurar rua, tipo, ex.: «cais stop»"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={filtros.texto}
            onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })}
          />
          <Button
            data-tour="filtros"
            className="shrink-0"
            variant={verFiltros ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setVerFiltros(!verFiltros)}
            aria-expanded={verFiltros}
            aria-controls="painel-filtros"
          >
            <SlidersHorizontal aria-hidden="true" />
            Filtros
            {nAtivos > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground" aria-label={`${nAtivos} filtros ativos`}>
                {nAtivos}
              </span>
            )}
          </Button>
          {tecnico && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={unir ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  className="shrink-0"
                  aria-pressed={!!unir}
                  aria-label="Unir duplicados: escolher vários marcadores do mesmo objeto"
                  onClick={() => {
                    setUnir(unir ? null : { ids: sel ? [sel] : [], fica: null })
                    setSel(null)
                    setEditarPos(false)
                  }}
                >
                  <Merge aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Unir duplicados</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button data-tour="exportar" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Transferir dados (GeoJSON ou CSV)">
                    <Download aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Transferir dados</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">O que está no mapa ({paraExportar.mapa.length})</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportar('geojson', false)}>
                <MapIcon aria-hidden="true" /> GeoJSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportar('csv', false)}>
                <FileSpreadsheet aria-hidden="true" /> CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Catálogo completo ({paraExportar.tudo.length})</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportar('geojson', true)}>
                <MapIcon aria-hidden="true" /> GeoJSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportar('csv', true)}>
                <FileSpreadsheet aria-hidden="true" /> CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {verFiltros && (
          <div id="painel-filtros" className={cn('pointer-events-auto max-h-[calc(100svh-12rem)] w-full overflow-y-auto p-4', flutuante)}>
            <Filtros
              value={filtros}
              onChange={setFiltros}
              contagens={contagens}
              tecnico={tecnico}
              limiar={cfg.limiar_auto}
              ruas={ruas}
              corPor={corPor}
              onCorPor={setCorPor}
            />
            <Label className="mt-5 flex items-center justify-between gap-3 font-normal">
              <span>
                Agrupar elementos próximos
                <span className="block text-xs text-muted-foreground">Mais leve em telemóveis; amplie para separar.</span>
              </span>
              <Switch checked={agrupar} onCheckedChange={(v) => setAgrupar(v)} />
            </Label>
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => setFiltros(filtrosIniciais(tecnico))}>Repor</Button>
              <Button size="sm" onClick={() => setVerFiltros(false)}>Ver {visiveis.length} no mapa</Button>
            </div>
          </div>
        )}
      </div>

      {/* contagem discreta */}
      {!el && (
        <div className={cn('absolute bottom-6 left-3 z-10 px-3 py-1.5 text-xs text-muted-foreground', flutuante)} aria-live="polite">
          <strong className="font-semibold text-foreground tabular-nums">{visiveis.length}</strong> elementos no mapa
          {filtros.rua && <> · {filtros.rua}</>}
        </div>
      )}

      {/* unir duplicados (técnico) */}
      {unir && (
        <aside
          aria-label="Unir duplicados"
          className={cn('absolute inset-x-3 bottom-3 z-20 flex max-h-[60%] flex-col overflow-hidden sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-6 sm:max-h-none sm:w-[380px]', flutuante)}
        >
          <UnirDuplicados
            cat={cat}
            ids={unir.ids}
            fica={unir.fica}
            onFica={(id) => setUnir((u) => (u ? { ...u, fica: id } : u))}
            onRemover={(id) => setUnir((u) => (u ? { ...u, ids: u.ids.filter((x) => x !== id), fica: u.fica === id ? null : u.fica } : u))}
            onCancelar={() => setUnir(null)}
            onUnido={(fica, decididos) => {
              setUnir({ ids: [], fica: null })
              toast.success(`Unidos em ${fica}`, { action: { label: 'Desfazer', onClick: () => cat.desfazerVarios(decididos) } })
            }}
          />
        </aside>
      )}

      {/* ficha */}
      {el && !unir && (
        <aside
          aria-label="Ficha do elemento"
          className={cn(
            'absolute inset-x-3 bottom-3 z-20 flex max-h-[60%] flex-col overflow-hidden sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-6 sm:max-h-none sm:w-[380px]',
            flutuante,
          )}
        >
          <FichaPainel
            cat={cat}
            el={el}
            onFechar={() => setSel(null)}
            onPedirLogin={onPedirLogin}
            editarPosicao={editarPos}
            onEditarPosicao={setEditarPos}
          />
        </aside>
      )}
    </div>
  )
}
