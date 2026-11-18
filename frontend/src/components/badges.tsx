import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ESTADO_LABEL, TIPO_COR, TIPO_LABEL, type Estado, type Tipo } from '@/lib/types'

/** Estado como texto sóbrio com um ponto de cor. */
const ESTADO_PONTO: Record<Estado, string> = {
  auto: 'bg-primary',
  pendente: 'bg-warning',
  validado: 'bg-success',
  corrigido: 'bg-gold',
  rejeitado: 'bg-destructive',
}

export function EstadoBadge({ estado, className }: { estado: Estado; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-normal', className)}>
      <span className={cn('size-1.5 rounded-full', ESTADO_PONTO[estado])} />
      {ESTADO_LABEL[estado]}
    </Badge>
  )
}

export function TipoDot({ tipo, className }: { tipo: Tipo; className?: string }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: TIPO_COR[tipo] }} />
}

export function TipoBadge({ tipo }: { tipo: Tipo }) {
  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <TipoDot tipo={tipo} />
      {TIPO_LABEL[tipo]}
    </Badge>
  )
}

export function ConfiancaBar({ valor, limiar }: { valor: number | null | undefined; limiar?: number }) {
  if (valor === null || valor === undefined) return <span className="text-xs text-muted-foreground">sem calibração</span>
  const cor = valor >= (limiar ?? 0.9) ? 'bg-success' : valor >= 0.5 ? 'bg-warning' : 'bg-destructive/80'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', cor)} style={{ width: `${Math.round(valor * 100)}%` }} />
        {limiar !== undefined && <div className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${limiar * 100}%` }} />}
      </div>
      <span className="w-8 text-right text-xs tabular-nums">{(valor * 100).toFixed(0)}%</span>
    </div>
  )
}
