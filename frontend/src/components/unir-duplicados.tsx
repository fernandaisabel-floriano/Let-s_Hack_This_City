import { Check, Merge, MousePointerClick, Trash2, TriangleAlert, X } from 'lucide-react'
import { Recorte, titulo } from '@/components/ficha'
import { melhorDoGrupo } from '@/components/qual-fica'
import { Button } from '@/components/ui/button'
import { data } from '@/lib/format'
import { distM } from '@/lib/geo'
import { cn } from '@/lib/utils'
import type { Elemento } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

interface Props {
  cat: Catalogo
  ids: string[]
  fica: string | null
  onFica: (id: string) => void
  /** posição arrastada no mapa para o que fica (null = a dele) */
  pos: { lat: number; lon: number } | null
  onRepor: () => void
  onRemover: (id: string) => void
  /** decididos = ids com decisão nova (para desfazer) */
  onUnido: (fica: string, decididos: string[]) => void
  onRejeitados: (decididos: string[]) => void
  onCancelar: () => void
}

/**
 * Selecionar vários (técnico, mapa): escolhe marcadores no mapa e
 *  - une-os como duplicados: escolhe o que fica (imagem) e a posição (a dele, ou arrastada no mapa);
 *    os outros, e os que já estavam fundidos neles, ficam "duplicado de" esse;
 *  - ou rejeita-os todos de uma vez (igual ao ✗ da fila: estado rejeitado).
 */
export function UnirDuplicados({ cat, ids, fica, pos, onRepor, onFica, onRemover, onUnido, onRejeitados, onCancelar }: Props) {
  const porId = new Map(cat.consolidados.map((e) => [e.id, e]))
  const sel = ids.map((i) => porId.get(i)).filter((e): e is Elemento => !!e)
  const esc = sel.find((e) => e.id === fica) ?? (sel.length ? melhorDoGrupo(sel) : null)
  const tipos = new Set(sel.map((e) => e.tipo))
  const longe = esc ? sel.filter((e) => e.id !== esc.id && distM(esc.lon, esc.lat, e.lon, e.lat) > 25) : []

  const unir = () => {
    if (!esc || sel.length < 2) return
    const outros = sel.filter((e) => e.id !== esc.id).flatMap((e) => [e.id, ...(e.fundidos ?? [])])
    // o que fica: confirmado (mantém correções de tipo/posição que já tivesse); posição arrastada → corrigido
    const decidirFica = !!pos || !(esc.estado === 'validado' || esc.estado === 'corrigido')
    cat.decidirVarios([
      ...(pos ? [{ id: esc.id, estado: 'corrigido' as const, opts: pos }] : decidirFica ? [{ id: esc.id, estado: 'validado' as const }] : []),
      ...outros.map((id) => ({ id, estado: 'rejeitado' as const, opts: { duplicado_de: esc.id } })),
    ])
    onUnido(esc.id, [...(decidirFica ? [esc.id] : []), ...outros])
  }

  const rejeitar = () => {
    const todos = sel.flatMap((e) => [e.id, ...(e.fundidos ?? [])])
    if (!todos.length) return
    cat.decidirVarios(todos.map((id) => ({ id, estado: 'rejeitado' as const })))
    onRejeitados(todos)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div>
          <p className="flex items-center gap-2 font-medium"><MousePointerClick className="size-4" aria-hidden="true" /> Selecionar vários</p>
          <p className="text-xs text-muted-foreground">
            Clique no mapa nos marcadores. Para unir duplicados, escolha aqui o que fica; a posição é a dele ou arraste-o no mapa. Os outros passam a duplicados dele.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Sair de selecionar vários" onClick={onCancelar}><X /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {sel.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum marcador escolhido.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2">
            {sel.map((e) => {
              const ativo = esc?.id === e.id
              return (
                <li key={e.id} className="relative">
                  <button
                    onClick={() => onFica(e.id)}
                    aria-pressed={ativo}
                    className={cn('flex w-full flex-col gap-1.5 rounded-lg border p-1.5 text-left text-[11px] hover:bg-accent', ativo && 'border-primary bg-primary/5 ring-2 ring-primary/40')}
                  >
                    <Recorte el={e} className="aspect-[4/3] w-full" />
                    <span className="truncate font-medium">{titulo(e)}</span>
                    <span className="text-muted-foreground">
                      <span className="font-mono">{e.id}</span> · {data(e.ultima_vista)} · {e.n_vistas} img.
                    </span>
                    {ativo && <span className="flex items-center gap-1 text-primary"><Check className="size-3" /> fica este</span>}
                  </button>
                  <button
                    aria-label={`Tirar ${e.id} da seleção`}
                    onClick={() => onRemover(e.id)}
                    className="absolute top-2.5 right-2.5 rounded-full bg-background/90 p-0.5 text-muted-foreground shadow hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {esc && sel.length > 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Posição: {pos ? <>ajustada no mapa · <button className="text-primary hover:underline" onClick={onRepor}>repor a de {esc.id}</button></> : <>a de {esc.id} (arraste o marcador para ajustar)</>}
          </p>
        )}
        {tipos.size > 1 && (
          <p className="mt-3 flex gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5 shrink-0" /> Tipos diferentes: fica o tipo do escolhido.</p>
        )}
        {longe.length > 0 && (
          <p className="mt-2 flex gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5 shrink-0" /> {longe.map((e) => e.id).join(', ')} a mais de 25 m: confirme que é o mesmo objeto.
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t p-3">
        <Button variant="destructive" onClick={rejeitar} disabled={sel.length < 1} className="mr-auto">
          <Trash2 /> {sel.length < 1 ? 'Rejeitar' : `Rejeitar ${sel.length}`}
        </Button>
        <Button onClick={unir} disabled={sel.length < 2}>
          <Merge /> {sel.length < 2 ? 'Escolha 2 ou mais' : `Unir ${sel.length} em 1`}
        </Button>
      </div>
    </div>
  )
}
