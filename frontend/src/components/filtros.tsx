import { Check, TriangleAlert } from 'lucide-react'
import { ESTADO_COR_VAR } from '@/components/badges'
import { TipoIcon } from '@/components/tipo-icon'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { subtipoLabel } from '@/lib/format'
import { posicaoARever } from '@/lib/revisao'
import { cn } from '@/lib/utils'
import { CATEGORIA_LABEL, ESTADOS, ESTADOS_CONFIRMADOS, ESTADO_LABEL, TIPOS, TIPO_LABEL, type Elemento, type Estado, type Tipo } from '@/lib/types'

export type CorPor = 'categoria' | 'estado'

export interface FiltrosState {
  tipos: Tipo[]
  estados: Estado[]
  confMin: number
  texto: string
  /** rua mais próxima (null = todas) */
  rua: string | null
  /** só os elementos cuja posição tem de ser revista */
  rever: boolean
}

export function filtrosIniciais(_tecnico?: boolean): FiltrosState {
  return {
    tipos: [...TIPOS],
    // por omissão só os confirmados, para todos (19/11); os por confirmar ligam-se nos filtros
    estados: [...ESTADOS_CONFIRMADOS],
    confMin: 0,
    texto: '',
    rua: null,
    rever: false,
  }
}

/** Texto pesquisável de um elemento: id, tipo, subtipo, rua. */
export function textoPesquisa(e: Elemento) {
  return [e.id, TIPO_LABEL[e.tipo], CATEGORIA_LABEL[e.tipo], e.subtipo ?? '', e.subtipo ? subtipoLabel(e.subtipo) : '', e.rua ?? '']
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function aplicarFiltros(els: Elemento[], f: FiltrosState) {
  const q = f.texto.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return els.filter(
    (e) =>
      f.tipos.includes(e.tipo) &&
      f.estados.includes(e.estado) &&
      (f.confMin === 0 || (e.confianca ?? 0) >= f.confMin) &&
      (!f.rua || e.rua === f.rua) &&
      (!f.rever || posicaoARever(e)) &&
      (!q || q.split(/\s+/).every((p) => textoPesquisa(e).includes(p))),
  )
}

/** Quantos filtros diferem do estado inicial (para o número no botão "Filtros"). */
export function filtrosAtivos(f: FiltrosState, tecnico: boolean) {
  const i = filtrosIniciais(tecnico)
  return (
    Number(f.tipos.length !== i.tipos.length) +
    Number(f.estados.slice().sort().join() !== i.estados.slice().sort().join()) +
    Number(f.confMin > 0) +
    Number(!!f.rua) +
    Number(f.rever)
  )
}

function alternar<T>(lista: T[], v: T) {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]
}

function Legenda({ limiar, corPor }: { limiar: number; corPor: CorPor }) {
  const ponto = (cor: string) => (
    <span className={cn('inline-block size-2.5 shrink-0 rounded-full ring-2', 'ring-card')} style={{ background: cor }} aria-hidden="true" />
  )
  return (
    <section className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3 text-xs" aria-labelledby="legenda-titulo">
      <h3 id="legenda-titulo" className="mb-0.5 font-medium text-muted-foreground">Legenda</h3>
      {corPor === 'estado' && (
        <>
          <p className="flex items-center gap-2">{ponto('var(--success)')} Validado por técnico</p>
          <p className="flex items-center gap-2">{ponto('var(--estado-auto)')} Aceite automaticamente (confiança alta)</p>
          <p className="flex items-center gap-2">{ponto('var(--pendente)')} Pendente de validação</p>
          <p className="flex items-center gap-2">{ponto('var(--destructive)')} Rejeitado</p>
          <p className="mt-1 text-muted-foreground">Ponto no canto: confiança da IA</p>
        </>
      )}
      <p className="flex items-center gap-2">{ponto('var(--success)')} Confiança alta (≥ {Math.round(limiar * 100)} %)</p>
      <p className="flex items-center gap-2">{ponto('var(--gold)')} Confiança média (50 a {Math.round(limiar * 100)} %)</p>
      <p className="flex items-center gap-2">{ponto('var(--destructive)')} Confiança baixa (&lt; 50 %)</p>
      <p className="flex items-center gap-2">{ponto('var(--muted-foreground)')} Sem calibração (ex.: contentores)</p>
      <p className="flex items-center gap-2">
        <span className="inline-block size-2.5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground" aria-hidden="true" /> Contorno tracejado: por confirmar
      </p>
      <p className="flex items-center gap-2">
        <span className="rounded-full bg-foreground px-1 text-[9px] font-semibold text-background" aria-hidden="true">+1</span> Duplicados juntados num só objeto
      </p>
    </section>
  )
}

export function Filtros({ value, onChange, contagens, tecnico, limiar = 0.9, ruas = [], corPor, onCorPor }: {
  value: FiltrosState
  onChange: (f: FiltrosState) => void
  contagens: { tipo: Record<string, number>; estado: Record<string, number>; rever?: number }
  tecnico: boolean
  limiar?: number
  ruas?: string[]
  corPor?: CorPor
  onCorPor?: (c: CorPor) => void
}) {
  const estadosVisiveis = tecnico ? ESTADOS : ESTADOS.filter((s) => s !== 'rejeitado')
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Categoria</h3>
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
              <span className="flex-1">{CATEGORIA_LABEL[t]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{contagens.tipo[t] ?? 0}</span>
              <Check className={cn('size-4 text-primary', !ativo && 'invisible')} aria-hidden="true" />
            </button>
          )
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Estado de validação</h3>
        {estadosVisiveis.map((s) => (
          <Label key={s} className="flex items-center gap-2.5 font-normal">
            <Checkbox checked={value.estados.includes(s)} onCheckedChange={() => onChange({ ...value, estados: alternar(value.estados, s) })} />
            <span className="size-2 rounded-full" style={{ background: ESTADO_COR_VAR[s] }} aria-hidden="true" />
            <span className="flex-1">{ESTADO_LABEL[s]}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{contagens.estado[s] ?? 0}</span>
          </Label>
        ))}
      </section>

      {ruas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Rua</h3>
          <Select value={value.rua ?? '__todas'} onValueChange={(v) => onChange({ ...value, rua: v === '__todas' ? null : v })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Filtrar por rua"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas">Todas as ruas da zona</SelectItem>
              {ruas.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </section>
      )}

      <Label className="flex items-start gap-2.5 font-normal leading-snug">
        <Checkbox className="mt-0.5" checked={value.rever} onCheckedChange={(v) => onChange({ ...value, rever: !!v })} />
        <span>
          <span className="flex items-center gap-1.5"><TriangleAlert className="size-3.5 text-warning" aria-hidden="true" /> Só posições a rever</span>
          <span className="block text-xs text-muted-foreground">Localização incerta: vistos numa só imagem ou com direções pouco coerentes ({contagens.rever ?? 0}).</span>
        </span>
      </Label>

      {tecnico && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">Confiança mínima</h3>
            <span className="text-xs tabular-nums">{Math.round(value.confMin * 100)}%</span>
          </div>
          <Slider aria-label="Confiança mínima" min={0} max={1} step={0.05} value={[value.confMin]} onValueChange={([v]) => onChange({ ...value, confMin: v })} />
        </section>
      )}

      {corPor && onCorPor && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Cor dos marcadores</h3>
          <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={corPor} onValueChange={(v) => v && onCorPor(v as CorPor)}>
            <ToggleGroupItem value="categoria" className="flex-1 text-xs">Por categoria</ToggleGroupItem>
            <ToggleGroupItem value="estado" className="flex-1 text-xs">Por estado</ToggleGroupItem>
          </ToggleGroup>
        </section>
      )}

      <Legenda limiar={limiar} corPor={corPor ?? 'categoria'} />
    </div>
  )
}
