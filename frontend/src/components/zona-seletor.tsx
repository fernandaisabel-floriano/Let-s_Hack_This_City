import { MapPinned } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { escolherZona, obterZonas, type ZonaInfo } from '@/lib/api'

/**
 * Etapa 5 / D4: só aparece com mais de uma zona — é ele que mostra, na própria interface, que o
 * sistema se replica. Mudar de zona grava a escolha (cookie) e recarrega a app com os dados dela.
 */
export function ZonaSeletor({ atual }: { atual: string }) {
  const [zonas, setZonas] = useState<ZonaInfo[]>([])
  useEffect(() => {
    obterZonas()
      .then((r) => setZonas(r.zonas))
      .catch(() => setZonas([]))
  }, [])
  if (zonas.length < 2) return null
  return (
    <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
      <Select value={atual} onValueChange={(id) => id !== atual && void escolherZona(id)}>
        <SelectTrigger size="sm" className="w-full border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground" aria-label="Zona">
          <MapPinned className="size-3.5" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {zonas.map((z) => (
            <SelectItem key={z.id} value={z.id}>
              {z.nome}
              <span className="text-muted-foreground"> · {z.elementos === null ? 'a processar' : `${z.elementos} elementos`}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
