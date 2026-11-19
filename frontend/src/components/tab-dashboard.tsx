import { CircleCheck, Clock, Copy, Globe, History, Layers, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { nomeBonito } from '@/components/app-sidebar'
import { titulo } from '@/components/ficha'
import { TabPainel } from '@/components/tab-painel'
import { TipoIcon } from '@/components/tipo-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { data, fonteLabel } from '@/lib/format'
import { posicaoARever } from '@/lib/revisao'
import { CATEGORIA_LABEL, TIPOS, TIPO_COR, type Evento, type Tipo } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

function Kpi({ label, valor, nota, icon, cor }: { label: string; valor: number; nota?: React.ReactNode; icon: React.ReactNode; cor?: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums" style={cor ? { color: cor } : undefined}>{valor}</p>
          {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
        </div>
        <div className="shrink-0">{icon}</div>
      </CardContent>
    </Card>
  )
}

/** Anel com a distribuição por categoria (SVG, sem bibliotecas). */
function Anel({ valores }: { valores: { tipo: Tipo; n: number }[] }) {
  const total = valores.reduce((a, v) => a + v.n, 0)
  const r = 52
  const c = 2 * Math.PI * r
  // início de cada fatia (fração acumulada das anteriores)
  const inicios = valores.map((_, i) => valores.slice(0, i).reduce((a, v) => a + v.n, 0) / (total || 1))
  return (
    <svg viewBox="0 0 140 140" className="size-40 shrink-0" role="img" aria-label={`Distribuição por categoria: ${valores.map((v) => `${CATEGORIA_LABEL[v.tipo]} ${v.n}`).join(', ')}`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--muted)" strokeWidth="18" />
      {total > 0 &&
        valores.map((v, i) => {
          const frac = v.n / total
          return (
            <circle
              key={v.tipo}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={TIPO_COR[v.tipo]}
              strokeWidth="18"
              strokeDasharray={`${Math.max(0, frac * c - 2)} ${c}`}
              strokeDashoffset={-inicios[i] * c}
              transform="rotate(-90 70 70)"
            />
          )
        })}
      <text x="70" y="66" textAnchor="middle" className="fill-foreground text-[22px] font-semibold">{total}</text>
      <text x="70" y="84" textAnchor="middle" className="fill-muted-foreground text-[10px]">elementos</text>
    </svg>
  )
}

const ESTADO_GRUPO = [
  { k: 'validado', label: 'Validados', cor: 'var(--success)', estados: ['validado', 'corrigido'] },
  { k: 'auto', label: 'Automáticos', cor: 'var(--estado-auto)', estados: ['auto'] },
  { k: 'pendente', label: 'Pendentes', cor: 'var(--warning)', estados: ['pendente'] },
] as const

function relativo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora mesmo'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return new Date(iso).toLocaleDateString('pt-PT')
}

function descricaoEvento(e: Evento, nome: (id?: string) => string) {
  if (e.acao === 'limpar') return 'apagou todas as decisões'
  if (e.acao === 'desfazer') return `desfez a decisão sobre ${nome(e.id)}`
  if (e.acao === 'par') return `${e.mesmo ? 'juntou como duplicados' : 'separou'} ${e.a} e ${e.b}`
  const v = e.validacao!
  if (v.estado === 'rejeitado') return `rejeitou ${nome(e.id)}`
  if (v.lat !== undefined) return `corrigiu a posição de ${nome(e.id)}`
  if (v.estado === 'corrigido') return `corrigiu a classificação de ${nome(e.id)}`
  return `validou ${nome(e.id)}`
}

export function TabDashboard({ cat, onIr }: { cat: Catalogo; onIr: (v: 'mapa' | 'deteccoes' | 'catalogo' | 'importacao') => void }) {
  const cfg = cat.base!.config
  const tecnico = !!cat.tecnico

  const r = useMemo(() => {
    const ativos = cat.elementos.filter((e) => e.estado !== 'rejeitado')
    const porTipo = (t: Tipo) => ativos.filter((e) => e.tipo === t)
    return {
      total: ativos.length,
      porTipo: Object.fromEntries(TIPOS.map((t) => [t, porTipo(t).length])) as Record<Tipo, number>,
      porTipoEstado: Object.fromEntries(
        TIPOS.map((t) => [t, Object.fromEntries(ESTADO_GRUPO.map((g) => [g.k, porTipo(t).filter((e) => (g.estados as readonly string[]).includes(e.estado)).length]))]),
      ) as Record<Tipo, Record<string, number>>,
      pendentes: ativos.filter((e) => e.estado === 'pendente').length,
      aprovadas: ativos.filter((e) => e.estado === 'validado' || e.estado === 'corrigido').length,
      auto: ativos.filter((e) => e.estado === 'auto').length,
      rejeitadas: cat.elementos.length - ativos.length,
      rever: ativos.filter((e) => posicaoARever(e) && (e.estado === 'pendente' || e.estado === 'auto')).length,
      fundidos: cat.duplicados.nAutomaticos,
    }
  }, [cat.elementos, cat.duplicados])

  const nomeEl = (id?: string) => {
    const e = id ? cat.todos.find((x) => x.id === id) : undefined
    return e ? `${titulo(e)} (${e.id})` : (id ?? '')
  }
  const recentes = [...cat.registo].reverse().slice(0, 8)

  // fontes de imagens: última data de captura por fonte
  const fontes = useMemo(() => {
    if (!cat.imagens) return []
    const ultima: Record<string, string> = {}
    for (const i of Object.values(cat.imagens.imagens)) if (i.captured_at && (!ultima[i.fonte] || i.captured_at > ultima[i.fonte])) ultima[i.fonte] = i.captured_at
    return Object.entries(cat.imagens.totais).map(([f, t]) => ({ fonte: f, ...t, ultima: ultima[f] }))
  }, [cat.imagens])

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Visão geral</h2>
          <p className="text-sm text-muted-foreground">
            Mobiliário urbano identificado na zona piloto {nomeBonito(cfg.zona, cat)}, {nomeBonito(cfg.municipio)}
            {cat.origem === 'demo' && <Badge variant="outline" className="ml-2 border-warning/50 font-normal text-warning">dados de demonstração (fictícios)</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onIr('mapa')}><Layers aria-hidden="true" /> Abrir mapa</Button>
          {tecnico && <Button size="sm" onClick={() => onIr('deteccoes')}><CircleCheck aria-hidden="true" /> Validar pendentes ({r.pendentes})</Button>}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Indicadores principais">
        <Kpi label="Elementos identificados" valor={r.total} nota={r.fundidos ? `${r.fundidos} duplicados fundidos` : 'sem duplicados'} icon={<Layers className="size-5 text-primary" aria-hidden="true" />} />
        {TIPOS.map((t) => (
          <Kpi key={t} label={CATEGORIA_LABEL[t]} valor={r.porTipo[t]} icon={<TipoIcon tipo={t} className="size-8" />} />
        ))}
        <Kpi label="Pendentes de validação" valor={r.pendentes} cor="var(--warning)" nota={r.rever ? `${r.rever} com posição a rever` : undefined} icon={<Clock className="size-5 text-warning" aria-hidden="true" />} />
        <Kpi label="Aprovadas por técnico" valor={r.aprovadas} cor="var(--success)" nota={`+${r.auto} aceites automaticamente`} icon={<CircleCheck className="size-5 text-success" aria-hidden="true" />} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Distribuição por categoria</CardTitle>
            <CardDescription>E estado de validação dentro de cada categoria</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row">
            <Anel valores={TIPOS.map((t) => ({ tipo: t, n: r.porTipo[t] }))} />
            <div className="flex w-full flex-col gap-4">
              {TIPOS.map((t) => {
                const tot = r.porTipo[t] || 1
                return (
                  <div key={t} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: TIPO_COR[t] }} aria-hidden="true" />{CATEGORIA_LABEL[t]}</span>
                      <span className="tabular-nums">{r.porTipo[t]}</span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={ESTADO_GRUPO.map((g) => `${g.label}: ${r.porTipoEstado[t][g.k]}`).join(', ')}>
                      {ESTADO_GRUPO.map((g) => (
                        <div key={g.k} style={{ width: `${(r.porTipoEstado[t][g.k] / tot) * 100}%`, background: g.cor }} />
                      ))}
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {ESTADO_GRUPO.map((g) => (
                  <span key={g.k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: g.cor }} aria-hidden="true" />{g.label}</span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {tecnico ? (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base font-medium"><History className="size-4" aria-hidden="true" /> Atividade recente</CardTitle>
                <CardDescription>Últimas decisões dos técnicos</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {recentes.length ? (
                <ol className="flex flex-col gap-3">
                  {recentes.map((e) => (
                    <li key={`${e.seq}-${e.quando}`} className="flex items-start gap-3 text-sm">
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ background: e.validacao?.estado === 'rejeitado' ? 'var(--destructive)' : e.acao === 'decisao' ? 'var(--success)' : 'var(--muted-foreground)' }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{e.tecnico.nome}</span> {descricaoEvento(e, nomeEl)}
                        <span className="block text-xs text-muted-foreground">{relativo(e.quando)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Ainda não há decisões registadas.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-medium"><Globe className="size-4" aria-hidden="true" /> Fontes das imagens</CardTitle>
              <CardDescription>Proveniência e privacidade</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {fontes.map((f) => (
                <div key={f.fonte} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="font-medium">{fonteLabel(f.fonte)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {f.imagens} imagens{f.ultima && <> · última de {data(f.ultima)}</>}
                      {f.licenca && <> · {f.licenca}</>}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-success" aria-hidden="true" />{f.com_desfoque} desfocadas</span>
                </div>
              ))}
              {!fontes.length && <p className="text-muted-foreground">Sem informação de proveniência.</p>}
            </CardContent>
          </Card>
        )}
      </section>

      {tecnico && (r.rever > 0 || cat.duplicados.porDecidir.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          {r.rever > 0 && (
            <button onClick={() => onIr('deteccoes')} className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-left text-sm hover:bg-warning/10">
              <TriangleAlert className="size-5 shrink-0 text-warning" aria-hidden="true" />
              <span><strong>{r.rever}</strong> elementos com posição a rever (localização incerta)</span>
            </button>
          )}
          {cat.duplicados.porDecidir.length > 0 && (
            <button onClick={() => onIr('deteccoes')} className="flex items-center gap-3 rounded-xl border p-4 text-left text-sm hover:bg-accent">
              <Copy className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <span><strong>{cat.duplicados.porDecidir.length}</strong> possíveis duplicados à espera de decisão</span>
            </button>
          )}
        </section>
      )}

      <TabPainel cat={cat} embutido />
    </div>
  )
}
