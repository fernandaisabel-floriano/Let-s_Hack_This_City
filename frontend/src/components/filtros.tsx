import { Check } from 'lucide-react'
import { TipoIcon } from '@/components/tipo-icon'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { ESTADOS, ESTADOS_CONFIRMADOS, ESTADO_LABEL, TIPOS, TIPO_PLURAL, type Elemento, type Estado, type Tipo } from '@/lib/types'

export interface FiltrosState {
  tipos: Tipo[]
  estados: Estado[]
  confMin: number
  texto: string
}

export function filtrosIniciais(tecnico: boolean): FiltrosState {
  return {
    tipos: [...TIPOS],
    // o público vê o catálogo confirmado; o técnico vê também o que está por confirmar
    estados: tecnico ? ['auto', 'pendente', 'validado', 'corrigido'] : [...ESTADOS_CONFIRMADOS],
    confMin: 0,
    texto: '',
  }
}

export function aplicarFiltros(els: Elemento[], f: FiltrosState) {
  const q = f.texto.trim().toLowerCase()
  return els.filter(
    (e) =>
      f.tipos.includes(e.tipo) &&
      f.estados.includes(e.estado) &&
      (f.confMin === 0 || (e.confianca ?? 0) >= f.confMin) &&
      (!q || e.id.toLowerCase().includes(q) || (e.subtipo ?? '').toLowerCase().includes(q)),
  )
}

/** Quantos filtros diferem do estado inicial (para o número no botão "Filtros"). */
export function filtrosAtivos(f: FiltrosState, tecnico: boolean) {
  const i = filtrosIniciais(tecnico)
  return (
    Number(f.tipos.length !== i.tipos.length) +
    Number(f.estados.slice().sort().join() !== i.estados.slice().sort().join()) +
    Number(f.confMin > 0)
  )
}

function alternar<T>(lista: T[], v: T) {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]
}

export function Filtros({ value, onChange, contagens, tecnico }: {
  value: FiltrosState
  onChange: (f: FiltrosState) => void
  contagens: { tipo: Record<string, number>; estado: Record<string, number> }
  tecnico: boolean
}) {
  const incluiPorConfirmar = value.estados.includes('pendente')
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Mobiliário</h3>
        {TIPOS.map((t) => {
          const ativo = value.tipos.includes(t)
          return (
            <button
              key={t}
              onClick={() => onChange({ ...value, tipos: alternar(value.tipos, t) })}
              className={cn('flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent', !ativo && 'opacity-45')}
              aria-pressed={ativo}
            >
              <TipoIcon tipo={t} className="size-6" />
              <span className="flex-1">{TIPO_PLURAL[t]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{contagens.tipo[t] ?? 0}</span>
              <Check className={cn('size-4 text-primary', !ativo && 'invisible')} />
            </button>
          )
        })}
      </section>

      {tecnico ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Estado</h3>
          {ESTADOS.map((s) => (
            <Label key={s} className="flex items-center gap-2.5 font-normal">
              <Checkbox checked={value.estados.includes(s)} onCheckedChange={() => onChange({ ...value, estados: alternar(value.estados, s) })} />
              <span className="flex-1">{ESTADO_LABEL[s]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{contagens.estado[s] ?? 0}</span>
            </Label>
          ))}
        </section>
      ) : (
        <Label className="flex items-start gap-2.5 font-normal leading-snug">
          <Checkbox
            className="mt-0.5"
            checked={incluiPorConfirmar}
            onCheckedChange={() => onChange({ ...value, estados: alternar(value.estados, 'pendente') })}
          />
          <span>
            Mostrar também os que estão por confirmar
            <span className="block text-xs text-muted-foreground">Deteções automáticas que um técnico ainda não verificou ({contagens.estado.pendente ?? 0}).</span>
          </span>
        </Label>
      )}

      {tecnico && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">Confiança mínima</h3>
            <span className="text-xs tabular-nums">{Math.round(value.confMin * 100)}%</span>
          </div>
          <Slider min={0} max={1} step={0.05} value={[value.confMin]} onValueChange={([v]) => onChange({ ...value, confMin: v })} />
        </section>
      )}
    </div>
  )
}
