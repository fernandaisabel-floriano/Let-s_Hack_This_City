import { RotateCcw, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { nomeBonito } from '@/lib/vistas'
import { TipoIcon } from '@/components/tipo-icon'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { efeitoLimiar, type ValoresLimiar } from '@/lib/estado'
import { pct } from '@/lib/format'
import { TIPOS, TIPO_PLURAL, type Tipo } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

/** Medido a 18/11 (reports/contentores/filtro_clip.md): CLIP ≥ 0,8, validação cruzada, por deteção. */
const CONTENTOR_MEDIDO = { limiar: 0.8, precisao: 0.93 }

const BASE_LABEL: Record<ValoresLimiar['base'], string> = {
  calibrada: 'confiança calibrada',
  clip: '2.ª opinião do CLIP',
  detetor: 'confiança do detetor',
}

function igual(a: ValoresLimiar, b: ValoresLimiar) {
  return a.ativo === b.ativo && a.limiar === b.limiar && a.min_vistas === b.min_vistas
}

function LinhaTipo({ cat, tipo }: { cat: Catalogo; tipo: Tipo }) {
  const atual = cat.limZona[tipo]
  const padrao = cat.limiares?.padrao[tipo] ?? atual
  const [rascunho, setRascunho] = useState<ValoresLimiar>(atual)
  const [aGravar, setAGravar] = useState(false)
  const mudou = !igual(rascunho, atual)
  const ePadrao = igual(atual, padrao)

  const efeito = useMemo(() => efeitoLimiar(cat.todos, cat.validacoes, tipo, atual, rascunho), [cat.todos, cat.validacoes, tipo, atual, rascunho])
  // contentores desligados: mostra sempre o que aconteceria com o limiar medido
  const simulado = useMemo(
    () =>
      tipo === 'contentor' && !rascunho.ativo
        ? efeitoLimiar(cat.todos, cat.validacoes, tipo, atual, { ...rascunho, ativo: true, limiar: CONTENTOR_MEDIDO.limiar })
        : null,
    [cat.todos, cat.validacoes, tipo, atual, rascunho],
  )
  const total = cat.todos.filter((e) => e.tipo === tipo).length

  const gravar = async (valores: ValoresLimiar | null) => {
    setAGravar(true)
    try {
      await cat.gravarLimiar(tipo, valores && { ativo: valores.ativo, limiar: valores.limiar, min_vistas: valores.min_vistas })
      if (!valores) setRascunho(padrao)
      toast.success(`${TIPO_PLURAL[tipo]}: limiares gravados`)
    } catch (e) {
      toast.error(`Não foi possível gravar: ${e instanceof Error ? e.message : e}`)
    } finally {
      setAGravar(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 border-b py-4 last:border-b-0" aria-labelledby={`lim-${tipo}`}>
      <div className="flex items-center gap-2.5">
        <TipoIcon tipo={tipo} className="size-7" />
        <h3 id={`lim-${tipo}`} className="flex-1 text-sm font-medium">{TIPO_PLURAL[tipo]}</h3>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {rascunho.ativo ? 'ligada' : 'desligada'}
          <Switch checked={rascunho.ativo} onCheckedChange={(v) => setRascunho({ ...rascunho, ativo: v })} aria-label={`Entrada automática de ${TIPO_PLURAL[tipo].toLowerCase()}`} />
        </label>
      </div>

      {rascunho.ativo ? (
        <div className="flex flex-col gap-3 pl-9">
          <div className="flex items-center gap-3">
            <Slider className="flex-1" min={0.5} max={1} step={0.01} value={[rascunho.limiar]} onValueChange={([v]) => setRascunho({ ...rascunho, limiar: v })} aria-label="Limiar" />
            <span className="w-12 text-right font-mono text-sm tabular-nums">{pct(rascunho.limiar)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{BASE_LABEL[rascunho.base]} ≥ limiar, e visto em</span>
            <Select value={String(rascunho.min_vistas)} onValueChange={(v) => setRascunho({ ...rascunho, min_vistas: Number(v) })}>
              <SelectTrigger size="sm" className="w-28" aria-label="Vistas mínimas"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>≥ {n} {n === 1 ? 'imagem' : 'imagens'}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <p className="pl-9 text-xs text-muted-foreground">Todos vão para a fila do técnico.</p>
      )}

      <div className="ml-9 rounded-md bg-muted/60 p-2.5 text-xs">
        {mudou ? (
          <p>
            <strong className="text-success">+{efeito.entram} entram</strong> · <strong className="text-destructive">−{efeito.saem} saem</strong> do catálogo automático
            {' '}(ficam {efeito.auto} automáticos de {total}).
          </p>
        ) : (
          <p>{efeito.auto} de {total} entram automaticamente.</p>
        )}
        {rascunho.ativo && efeito.precisaoValidacoes !== null && (
          <p className="mt-1 text-muted-foreground">
            Nas validações já feitas, este limiar deixaria entrar {efeito.decididos.reais} reais e {efeito.decididos.falsos} falsos
            {' '}(precisão {pct(efeito.precisaoValidacoes)}).
          </p>
        )}
        {simulado && (
          <p className="mt-1 text-muted-foreground">
            Se ligar com {pct(CONTENTOR_MEDIDO.limiar)}: +{simulado.entram} entrariam
            {simulado.precisaoValidacoes !== null && <>; nas validações feitas, precisão {pct(simulado.precisaoValidacoes)} ({simulado.decididos.reais} reais, {simulado.decididos.falsos} falsos)</>}.
            {' '}Precisão medida a 18/11: {pct(CONTENTOR_MEDIDO.precisao)} (por deteção).
          </p>
        )}
        {rascunho.base === 'clip' && efeito.semPontuacao > 0 && (
          <p className="mt-1 text-warning">
            {efeito.semPontuacao} de {total} sem pontuação do CLIP: corra o pipeline (passo contentores_clip) para a calcular.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pl-9">
        {!ePadrao && (
          <Button variant="ghost" size="sm" disabled={aGravar} onClick={() => gravar(null)} title={`Padrão: ${padrao.ativo ? `${pct(padrao.limiar)}, ≥ ${padrao.min_vistas} imagens` : 'desligado'}`}>
            <RotateCcw /> Repor padrão
          </Button>
        )}
        {mudou && (
          <>
            <Button variant="ghost" size="sm" disabled={aGravar} onClick={() => setRascunho(atual)}>Cancelar</Button>
            <Button size="sm" disabled={aGravar} onClick={() => gravar(rascunho)}>Gravar</Button>
          </>
        )}
      </div>
    </section>
  )
}

/** Discreto: botão pequeno no cabeçalho da vista do técnico; não é para mexer todos os dias. */
export function Limiares({ cat }: { cat: Catalogo }) {
  const zona = cat.base!.config.zona
  const historico = (cat.limiares?.historico ?? []).filter((h) => h.zona === zona).slice(-5).reverse()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Settings2 aria-hidden="true" /> Entrada automática
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <div className="flex flex-col gap-1 border-b p-4">
          <SheetTitle>Entrada automática</SheetTitle>
          <SheetDescription>
            Zona {nomeBonito(zona, cat)}. Acima do limiar, o elemento entra no catálogo sem passar pela fila. Uma decisão de um técnico nunca muda
            com o limiar.
          </SheetDescription>
        </div>
        <div className="px-4">
          {TIPOS.map((t) => (
            <LinhaTipo key={`${zona}-${t}-${JSON.stringify(cat.limZona[t])}`} cat={cat} tipo={t} />
          ))}
        </div>
        {historico.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Últimas alterações</p>
            {historico.map((h) => (
              <p key={h.quando + h.tipo}>
                {new Date(h.quando).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })} · {h.tecnico.nome} · {TIPO_PLURAL[h.tipo]}:{' '}
                {resumo(h.antes)} → {resumo(h.depois)}
              </p>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function resumo(v: Partial<ValoresLimiar>) {
  return v.ativo === false ? 'desligado' : `${pct(v.limiar ?? null)}, ≥ ${v.min_vistas} img.`
}
