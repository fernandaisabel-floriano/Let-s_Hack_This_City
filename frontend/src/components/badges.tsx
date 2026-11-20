import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ESTADO_LABEL, TIPO_COR, type Estado, type Tipo } from '@/lib/types'

/** Estado como texto sóbrio com um ponto de cor. */
/** Verde = validado (pelo técnico, com ou sem correção), laranja = pendente, vermelho = rejeitado, azul = automático. */
export const ESTADO_COR_VAR: Record<Estado, string> = {
  auto: 'var(--estado-auto)',
  pendente: 'var(--pendente)',
  validado: 'var(--success)',
  corrigido: 'var(--success)',
  rejeitado: 'var(--destructive)',
}

const ESTADO_PONTO: Record<Estado, string> = {
  auto: 'bg-estado-auto',
  pendente: 'bg-pendente',
  validado: 'bg-success',
  corrigido: 'bg-success',
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

export function ConfiancaBar({ valor, limiar }: { valor: number | null | undefined; limiar?: number }) {
  if (valor === null || valor === undefined) return <span className="text-xs text-muted-foreground">sem calibração</span>
  // mesmas cores do ponto nos marcadores do mapa (map-view.tsx, corConfianca)
  const cor = valor >= (limiar ?? 0.9) ? 'bg-success' : valor >= 0.5 ? 'bg-gold' : 'bg-destructive'
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(valor * 100)} aria-label="Confiança">
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', cor)} style={{ width: `${Math.round(valor * 100)}%` }} />
        {limiar !== undefined && <div className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${limiar * 100}%` }} />}
      </div>
      <span className="w-8 text-right text-xs tabular-nums">{(valor * 100).toFixed(0)}%</span>
    </div>
  )
}
