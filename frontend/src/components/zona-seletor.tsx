import { MapPinned } from 'lucide-react'
import { useEffect, useState } from 'react'
import { nomeBonito } from '@/lib/vistas'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { escolherZona, obterZonas, type ZonaInfo } from '@/lib/api'
import type { Catalogo } from '@/hooks/use-catalogo'

/** painel branco do mapa: raio 4 px, borda 1 px #E2E6EA (token --border), sem sombra */
export const painelMapa = 'rounded-[4px] border border-border bg-card'

/**
 * Etapa 5 / D4: zona atual, no canto superior esquerdo do mapa. Com mais de uma zona, o nome é
 * também o seletor — é ele que mostra, na própria interface, que o sistema se replica. Mudar de zona
 * grava a escolha (cookie) e recarrega a app com os dados dela. Em ecrãs estreitos fica só o nome.
 */
export function ZonaSeletor({ cat }: { cat: Catalogo }) {
  const atual = cat.base!.config.zona
  const [zonas, setZonas] = useState<ZonaInfo[]>([])
  useEffect(() => {
    obterZonas()
      .then((r) => setZonas(r.zonas))
      .catch(() => setZonas([]))
  }, [])
  const nome = zonas.find((z) => z.id === atual)?.nome ?? nomeBonito(atual, cat)
  const rotulo = <span className="hidden text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:inline">Zona</span>

  return (
    <div className={`pointer-events-auto flex min-w-0 items-center ${painelMapa}`} data-tour="zona">
      {zonas.length < 2 ? (
        <p className="flex h-11 min-w-0 items-center gap-2 px-3 text-sm">
          <MapPinned className="size-4 shrink-0" aria-hidden="true" />
          {rotulo}
          <span className="truncate font-semibold text-titulo">{nome}</span>
        </p>
      ) : (
        <Select value={atual} onValueChange={(id) => id !== atual && void escolherZona(id)}>
          <SelectTrigger
            className="h-11! min-w-0 gap-2 border-0 bg-transparent px-3 font-semibold text-titulo shadow-none dark:bg-transparent [&_.ctrlf-zona-n]:hidden sm:[&_.ctrlf-zona-n]:inline"
            aria-label={`Zona: ${nome}. Mudar de zona`}
          >
            <MapPinned className="size-4 shrink-0" aria-hidden="true" />
            {rotulo}
            <span className="min-w-0 truncate">
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {zonas.map((z) => (
              <SelectItem key={z.id} value={z.id}>
                {z.nome}
                <span className="ctrlf-zona-n font-normal text-muted-foreground"> · {z.elementos === null ? 'a processar' : `${z.elementos} elementos`}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
