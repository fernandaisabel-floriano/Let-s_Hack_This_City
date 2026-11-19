import { Check, Copy, LayoutGrid, ListChecks, TriangleAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ConfiancaBar, EstadoBadge } from '@/components/badges'
import { Recorte, titulo } from '@/components/ficha'
import { FichaPainel } from '@/components/ficha-painel'
import { Limiares } from '@/components/limiares'
import { TabFila } from '@/components/tab-fila'
import { TipoIcon } from '@/components/tipo-icon'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { pct } from '@/lib/format'
import { posicaoARever } from '@/lib/revisao'
import { cn } from '@/lib/utils'
import { CATEGORIA_LABEL, TIPOS, type Elemento, type Tipo } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

type Vista = 'baixa' | 'pendentes' | 'rever' | 'duplicados' | 'todas'

/** Ordenação: primeiro as de confiança calibrada mais baixa, depois as que não têm calibração. */
const confianca = (e: Elemento) => e.confianca ?? 0.5
/** baixa confiança = calibrada abaixo de 50 %; sem calibração é outro caso (vai sempre a validação) */
const baixa = (e: Elemento) => e.confianca !== null && e.confianca < 0.5
const semCalibracao = (e: Elemento) => e.confianca === null

/** Grelha com todas as deteções: destaca as de baixa confiança; aprovar/rejeitar com um clique. */
function Grelha({ cat }: { cat: Catalogo }) {
  const cfg = cat.base!.config
  const [vista, setVista] = useState<Vista>('baixa')
  const [categoria, setCategoria] = useState<Tipo | 'todas'>('todas')
  const [sel, setSel] = useState<string | null>(null)

  const contagem = useMemo(() => {
    const ativos = cat.elementos.filter((e) => e.estado !== 'rejeitado')
    return {
      baixa: ativos.filter((e) => e.estado === 'pendente' && (baixa(e) || semCalibracao(e))).length,
      pendentes: ativos.filter((e) => e.estado === 'pendente').length,
      rever: ativos.filter((e) => posicaoARever(e) && (e.estado === 'pendente' || e.estado === 'auto')).length,
      duplicados: ativos.filter((e) => cat.duplicados.paresDe(e.id).length > 0).length,
      todas: cat.elementos.length,
    }
  }, [cat.elementos, cat.duplicados])

  const lista = useMemo(() => {
    const f = cat.elementos.filter((e) => {
      if (categoria !== 'todas' && e.tipo !== categoria) return false
      if (vista === 'baixa') return e.estado === 'pendente' && (baixa(e) || semCalibracao(e))
      if (vista === 'pendentes') return e.estado === 'pendente'
      if (vista === 'rever') return posicaoARever(e) && (e.estado === 'pendente' || e.estado === 'auto')
      if (vista === 'duplicados') return e.estado !== 'rejeitado' && cat.duplicados.paresDe(e.id).length > 0
      return true
    })
    return f.sort((a, b) => confianca(a) - confianca(b))
  }, [cat.elementos, cat.duplicados, vista, categoria])

  const el = cat.elementos.find((e) => e.id === sel)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={vista} onValueChange={(v) => v && setVista(v as Vista)} className="flex-wrap">
          <ToggleGroupItem value="baixa" className="gap-1.5 text-xs"><span className="size-2 rounded-full bg-destructive" aria-hidden="true" />Baixa confiança ou sem calibração <span className="tabular-nums text-muted-foreground">{contagem.baixa}</span></ToggleGroupItem>
          <ToggleGroupItem value="pendentes" className="gap-1.5 text-xs"><span className="size-2 rounded-full bg-warning" aria-hidden="true" />Pendentes <span className="tabular-nums text-muted-foreground">{contagem.pendentes}</span></ToggleGroupItem>
          <ToggleGroupItem value="rever" className="gap-1.5 text-xs"><TriangleAlert className="size-3 text-warning" aria-hidden="true" />Posição a rever <span className="tabular-nums text-muted-foreground">{contagem.rever}</span></ToggleGroupItem>
          <ToggleGroupItem value="duplicados" className="gap-1.5 text-xs"><Copy className="size-3" aria-hidden="true" />Possíveis duplicados <span className="tabular-nums text-muted-foreground">{contagem.duplicados}</span></ToggleGroupItem>
          <ToggleGroupItem value="todas" className="text-xs">Todas <span className="tabular-nums text-muted-foreground">{contagem.todas}</span></ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" variant="outline" size="sm" value={categoria} onValueChange={(v) => v && setCategoria(v as Tipo | 'todas')}>
          <ToggleGroupItem value="todas" className="text-xs">Todas</ToggleGroupItem>
          {TIPOS.map((t) => (
            <ToggleGroupItem key={t} value={t} className="text-xs" aria-label={CATEGORIA_LABEL[t]}>
              <TipoIcon tipo={t} className="size-5" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <p className="text-xs text-muted-foreground">Ordenadas da menor para a maior confiança. Clique num cartão para ver a ficha completa, corrigir o tipo ou as coordenadas.</p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
        {lista.map((e) => {
          const destaque = e.estado === 'pendente' && baixa(e)
          return (
            <article
              key={e.id}
              className={cn(
                'group flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md',
                destaque && 'border-destructive/50 ring-1 ring-destructive/20',
              )}
            >
              <button className="relative text-left" onClick={() => setSel(e.id)} aria-label={`Abrir ${titulo(e)} ${e.id}`}>
                <Recorte el={e} className="aspect-[4/3] w-full rounded-none" />
                {destaque && (
                  <span className="absolute top-2 left-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium text-white shadow">Baixa confiança</span>
                )}
                {e.estado === 'pendente' && semCalibracao(e) && (
                  <span className="absolute top-2 left-2 rounded-full bg-foreground/75 px-2 py-0.5 text-[10px] font-medium text-background shadow" title="Ainda não há calibração para esta categoria: um técnico confirma sempre">
                    Sem calibração
                  </span>
                )}
                {posicaoARever(e) && (
                  <span className="absolute top-2 right-2 rounded-full bg-card/90 p-1 text-warning shadow" title="Posição a rever">
                    <TriangleAlert className="size-3.5" aria-label="Posição a rever" />
                  </span>
                )}
              </button>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-start gap-2">
                  <TipoIcon tipo={e.tipo} subtipo={e.subtipo} className="size-6" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{titulo(e)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{e.rua ?? e.id}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  {e.confianca !== null ? (
                    <ConfiancaBar valor={e.confianca} limiar={cfg.limiar_auto} />
                  ) : (
                    <span className="text-xs text-muted-foreground" title="confiança do detetor, ainda não calibrada">detetor {pct(e.confianca_max_vista)}</span>
                  )}
                  <EstadoBadge estado={e.estado} />
                </div>
                {(e.estado === 'pendente' || e.estado === 'auto') && (
                  <div className="mt-auto grid grid-cols-2 gap-1.5 pt-1">
                    <Button size="sm" className="h-7 bg-success text-xs text-white hover:bg-success/90" onClick={() => cat.decidir(e.id, 'validado')}>
                      <Check aria-hidden="true" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => cat.decidir(e.id, 'rejeitado')}>
                      <X aria-hidden="true" /> Rejeitar
                    </Button>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
      {!lista.length && <p className="py-12 text-center text-sm text-muted-foreground">Não há deteções nesta vista.</p>}

      <Sheet open={!!el} onOpenChange={(v) => !v && setSel(null)}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">{el ? titulo(el) : 'Deteção'}</SheetTitle>
          <SheetDescription className="sr-only">Ficha da deteção</SheetDescription>
          {el && <FichaPainel cat={cat} el={el} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function TabDeteccoes({ cat, escuro }: { cat: Catalogo; escuro?: boolean }) {
  const [aba, setAba] = useState<'fila' | 'grelha'>('fila')
  return (
    <Tabs value={aba} onValueChange={(v) => setAba(v as 'fila' | 'grelha')} className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Deteções e validação</h2>
          <p className="text-sm text-muted-foreground">A IA deteta; o técnico supervisiona, corrige e valida. Cada decisão fica no registo com o seu nome.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Limiares cat={cat} />
        <TabsList>
          <TabsTrigger value="fila"><ListChecks aria-hidden="true" /> Fila de validação</TabsTrigger>
          <TabsTrigger value="grelha"><LayoutGrid aria-hidden="true" /> Todas as deteções</TabsTrigger>
        </TabsList>
        </div>
      </div>
      <TabsContent value="fila" className="min-h-[600px] flex-1"><TabFila cat={cat} escuro={escuro} /></TabsContent>
      <TabsContent value="grelha" className="pb-6"><Grelha cat={cat} /></TabsContent>
    </Tabs>
  )
}
