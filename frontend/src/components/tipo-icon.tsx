import { createElement } from 'react'
import { Gauge, Lightbulb, Octagon, Recycle, Signpost, Trash2, Triangle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TIPO_COR, type Tipo } from '@/lib/types'

/** Ícone de um elemento: por tipo e, nos sinais, por subtipo. */
export function iconeDe(tipo: Tipo, subtipo?: string | null): LucideIcon {
  if (tipo === 'candeeiro') return Lightbulb
  if (tipo === 'contentor') return subtipo === 'ilha_reciclagem' ? Recycle : Trash2
  if (subtipo === 'stop') return Octagon
  if (subtipo === 'cedencia_passagem') return Triangle
  if (subtipo?.startsWith('limite')) return Gauge
  return Signpost
}

export function TipoIcon({ tipo, subtipo, className }: { tipo: Tipo; subtipo?: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white', className)}
      style={{ background: TIPO_COR[tipo] }}
    >
      {createElement(iconeDe(tipo, subtipo), { className: 'size-4', strokeWidth: 2.25 })}
    </span>
  )
}
