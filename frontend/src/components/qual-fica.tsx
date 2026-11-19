import { Check, MapPin, Split } from 'lucide-react'
import { Recorte, titulo } from '@/components/ficha'
import { MapView } from '@/components/map-view'
import { Button } from '@/components/ui/button'
import { data, fonteLabel, pct } from '@/lib/format'
import { distM } from '@/lib/geo'
import { cn } from '@/lib/utils'
import type { Elemento } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

const confirmado = (e: Elemento) => e.estado === 'validado' || e.estado === 'corrigido'

/**
 * Grupo de duplicados de um elemento: o representante, os que a app juntou automaticamente
 * e os possíveis por decidir. Sem rejeitados.
 */
export function grupoDuplicados(cat: Catalogo, el: Elemento): Elemento[] {
  const rep = cat.duplicados.escondidoEm.get(el.id) ?? el.id
  const porId = new Map(cat.todos.map((e) => [e.id, e]))
  const ids = new Set([rep, el.id, ...cat.duplicados.fundidosEm(rep).map((f) => f.el.id), ...cat.duplicados.paresDe(rep).map((p) => p.outro.id)])
  return [...ids].map((i) => porId.get(i)).filter((e): e is Elemento => !!e && e.estado !== 'rejeitado')
}

/** O que fica por omissão: o já confirmado por um técnico; senão mais vistas, mais confiança, imagem mais recente. */
export function melhorDoGrupo(g: Elemento[]) {
  return [...g].sort(
    (a, b) =>
      Number(confirmado(b)) - Number(confirmado(a)) ||
      b.n_vistas - a.n_vistas ||
      (b.confianca ?? b.confianca_max_vista ?? 0) - (a.confianca ?? a.confianca_max_vista ?? 0) ||
      b.ultima_vista.localeCompare(a.ultima_vista),
  )[0]
}

interface Props {
  cat: Catalogo
  grupo: Elemento[]
  escolhido: string
  pos: { lat: number; lon: number } | null
  onEscolher: (id: string) => void
  onMover: (lat: number, lon: number) => void
  onConfirmar: () => void
  onDiferentes: () => void
  escuro?: boolean
}

/** "Qual fica?": uma posição e uma imagem por objeto. Os outros ficam como duplicados do escolhido. */
export function QualFica({ cat, grupo, escolhido, pos, onEscolher, onMover, onConfirmar, onDiferentes, escuro }: Props) {
  const cfg = cat.base!.config
  const esc = grupo.find((e) => e.id === escolhido) ?? grupo[0]
  const noMapa = grupo.map((e) => (e.id === esc.id && pos ? { ...e, ...pos } : e))
  const ref = pos ?? esc

  return (
    <section className="flex flex-col gap-3" aria-labelledby="qual-fica">
      <div>
        <h3 id="qual-fica" className="text-sm font-medium">Qual fica? {grupo.length} deteções parecem ser o mesmo objeto</h3>
        <p className="text-xs text-muted-foreground">
          Escolha a que tem a melhor imagem e a posição certa (no cartão ou no marcador). Pode arrastar o marcador escolhido para acertar a
          posição. As outras ficam como duplicados desta.
        </p>
      </div>

      <div className="h-64 overflow-hidden rounded-lg border">
        <MapView
          compacto
          escuro={escuro}
          elementos={noMapa}
          vias={cat.base!.vias}
          zona={cat.base!.zona}
          bbox={cfg.bbox}
          selecionado={esc.id}
          onSelect={onEscolher}
          onMover={(id, lat, lon) => id === esc.id && onMover(lat, lon)}
        />
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {grupo.map((e) => {
          const sel = e.id === esc.id
          const d = sel ? null : distM(ref.lon, ref.lat, e.lon, e.lat)
          return (
            <li key={e.id}>
              <button
                onClick={() => onEscolher(e.id)}
                aria-pressed={sel}
                className={cn(
                  'flex w-full flex-col gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:bg-accent',
                  sel && 'border-primary bg-primary/5 ring-2 ring-primary/40',
                )}
              >
                <Recorte el={e} className="aspect-[4/3] w-full" />
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{titulo(e)} <span className="font-mono font-normal text-muted-foreground">{e.id}</span></span>
                  {sel && <span className="flex shrink-0 items-center gap-1 text-primary"><Check className="size-3.5" /> fica</span>}
                </span>
                <span className="text-muted-foreground">
                  {e.n_vistas} {e.n_vistas === 1 ? 'imagem' : 'imagens'} · {data(e.ultima_vista)} · {fonteLabel(e.fonte.split('+')[0])}
                  {e.confianca !== null ? ` · ${pct(e.confianca)}` : ''}
                  {confirmado(e) && ' · já confirmado'}
                  {d !== null && <> · a {d.toFixed(1).replace('.', ',')} m</>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onConfirmar} className="bg-success text-white hover:bg-success/90">
          <Check /> Ficar com {esc.id} <kbd className="border-white/30">Enter</kbd>
        </Button>
        <Button variant="outline" onClick={onDiferentes}>
          <Split /> São objetos diferentes
        </Button>
        {pos && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" /> posição ajustada à mão
          </span>
        )}
      </div>
    </section>
  )
}
