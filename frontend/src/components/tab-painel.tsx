import { useMemo, useState } from 'react'
import { Calculator, TriangleAlert } from 'lucide-react'
import { nomeBonito } from '@/components/app-sidebar'
import { TipoIcon } from '@/components/tipo-icon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { separarCatalogo } from '@/lib/export'
import { data, duracao, pct, subtipoLabel } from '@/lib/format'
import { ESTADOS_CONFIRMADOS, METODO_LABEL, TIPOS, TIPOS_CONTENTOR, TIPO_LABEL, TIPO_PLURAL, type MetodoPosicao } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

function Barras({ itens, total }: { itens: { label: React.ReactNode; n: number; key: string }[]; total: number }) {
  return (
    <div className="flex flex-col gap-3">
      {itens.map((i) => (
        <div key={i.key} className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span className="truncate">{i.label}</span>
            <span className="text-muted-foreground tabular-nums">{i.n}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${total ? (i.n / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Numero({ label, valor, nota }: { label: string; valor: React.ReactNode; nota?: string }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-primary/50 pl-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-3xl font-semibold tabular-nums">{valor}</span>
      {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
    </div>
  )
}

const SUBTIPO_M10: Record<string, string> = { stop: 'STOP', cedencia: 'Cedência de passagem', limite: 'Limite de velocidade', outro: 'Outros sinais' }

/** M10: precisão (validação de todos os elementos da zona) e recall (contagem manual). Ver pipeline/evaluate.py. */
function CartaoM10({ cat }: { cat: Catalogo }) {
  const [aCalcular, setACalcular] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const m = cat.metrica?.dados ?? null
  const ultimaDecisao = cat.registo.filter((e) => e.acao !== 'limpar').at(-1)?.quando
  const desatualizada = !!(m && ultimaDecisao && ultimaDecisao > m.gerado_em)
  const recalcular = async () => {
    setACalcular(true)
    const r = await cat.recalcularMetrica()
    setErro(r.ok ? null : r.saida)
    setACalcular(false)
  }
  const t = m?.tempo
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base font-medium">Precisão e recall (M10)</CardTitle>
          <CardDescription>
            Precisão: o que o sistema propôs, confirmado elemento a elemento na fila (modo "Todos da zona"). Recall: elementos reais
            encontrados ÷ contagem manual (<code className="text-xs">contagem.json</code>).
            {m && <> Calculado em {data(m.gerado_em)} {m.gerado_em.slice(11, 16)}.</>}
            {m?.contagem_info?.contado_por && <> Contagem de {m.contagem_info.contado_por}.</>}
          </CardDescription>
        </div>
        <Button size="sm" variant={desatualizada || !m ? 'default' : 'outline'} onClick={recalcular} disabled={aCalcular}>
          <Calculator /> {aCalcular ? 'A calcular…' : 'Recalcular'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {erro && <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">{erro}</pre>}
        {!m ? (
          <p className="text-sm text-muted-foreground">
            Ainda sem métricas. Valide os elementos na fila (modo "Todos da zona"), preencha <code className="text-xs">contagem.json</code> e
            carregue em Recalcular.
          </p>
        ) : (
          <>
            {(desatualizada || m.avisos.length > 0) && (
              <ul className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                {desatualizada && (
                  <li className="flex gap-2"><TriangleAlert className="size-3.5 shrink-0 text-warning" /> Há decisões mais recentes do que estas métricas: carregue em Recalcular.</li>
                )}
                {m.avisos.map((a) => (
                  <li key={a} className="flex gap-2"><TriangleAlert className="size-3.5 shrink-0 text-warning" /> {a}</li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <Numero label="Precisão" valor={pct(m.todas.precisao)} nota={`${m.todas.reais} reais em ${m.todas.decididos} decididos`} />
              <Numero
                label="Recall"
                valor={pct(m.todas.recall)}
                nota={m.todas.contagem !== null ? `${m.todas.reais_unicos} de ${m.todas.contagem} contados` : 'falta a contagem'}
              />
              <Numero label="Tempo de validação" valor={t?.tempo_ativo_s ? duracao(t.tempo_ativo_s) : '—'} nota={t?.relogio_s ? `${duracao(t.relogio_s)} de relógio (M11)` : 'M11'} />
              <Numero label="Por elemento" valor={t?.s_por_elemento ? `${t.s_por_elemento.toFixed(1)} s` : '—'} nota={t?.elementos ? `${t.elementos} elementos decididos` : undefined} />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Classe</TableHead>
                  <TableHead className="text-right">Propostos</TableHead>
                  <TableHead className="text-right">Reais</TableHead>
                  <TableHead className="text-right">Falsos</TableHead>
                  <TableHead className="text-right">Duplicados</TableHead>
                  <TableHead className="text-right">Tipo errado</TableHead>
                  <TableHead className="text-right">Por validar</TableHead>
                  <TableHead className="text-right">Precisão</TableHead>
                  <TableHead className="text-right">Únicos / contagem</TableHead>
                  <TableHead className="text-right">Recall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(['todas', ...TIPOS] as const).map((k) => {
                  const c = m[k]
                  return (
                    <TableRow key={k}>
                      <TableCell>{k === 'todas' ? <strong>Todas</strong> : TIPO_LABEL[k]}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.propostos}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.reais}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.falsos}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.duplicados}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.tipo_errado}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.por_validar || ''}</TableCell>
                      <TableCell className="text-right tabular-nums" title={`contando duplicados como objetos reais: ${pct(c.precisao_objeto)}`}>{pct(c.precisao)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.reais_unicos} / {c.contagem ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(c.recall)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Sinais por tipo</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Encontrados</TableHead>
                      <TableHead className="text-right">Contagem</TableHead>
                      <TableHead className="text-right">Recall</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(['stop', 'cedencia', 'limite', 'outro'] as const).map((k) => (
                      <TableRow key={k}>
                        <TableCell>{SUBTIPO_M10[k]}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.sinal_subtipo[k].reais_unicos}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.sinal_subtipo[k].contagem ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(m.sinal_subtipo[k].recall)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground">
                  Tipo de sinal certo sem correção: {m.sinal_subtipo.subtipo_certo} de {m.sinal_subtipo.sinais_reais} ({pct(m.sinal_subtipo.precisao_subtipo)}).
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Quem validou</p>
                {t?.por_tecnico && Object.keys(t.por_tecnico).length ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {Object.entries(t.por_tecnico).map(([nome, v]) => (
                      <li key={nome} className="flex justify-between gap-2">
                        <span className="truncate">{nome}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {v.elementos} elementos · {duracao(v.tempo_ativo_s ?? 0)} · {v.s_por_elemento?.toFixed(1) ?? '—'} s/el.
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Ainda sem validações.</p>
                )}
                {m.erro_posicao_m?.todas && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Erro de posição (opcional, contra {m.erro_posicao_m.pontos_referencia} pontos de <code>referencia.csv</code>): mediana{' '}
                    {m.erro_posicao_m.todas.mediana} m, p90 {m.erro_posicao_m.todas.p90} m (n = {m.erro_posicao_m.todas.n}).
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Indicadores do inventário. `embutido`: dentro do Dashboard, sem a introdução nem os cartões por categoria (já lá estão). */
export function TabPainel({ cat, embutido }: { cat: Catalogo; embutido?: boolean }) {
  const cfg = cat.base!.config
  const calib = cat.base!.calibracao
  const tecnico = !!cat.tecnico

  const r = useMemo(() => {
    const { cat: noCat } = separarCatalogo(cat.consolidados, cfg, cat.base!.zona)
    const els = noCat as unknown as typeof cat.consolidados
    const confirmados = els.filter((e) => ESTADOS_CONFIRMADOS.includes(e.estado))
    const count = (xs: string[]) => xs.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {})
    const datas = els.flatMap((e) => [e.primeira_vista, e.ultima_vista]).filter(Boolean).sort()
    const vals = Object.values(cat.validacoes)
    const porTipoVal: Record<string, { reais: number; falsos: number; tipoErrado: number }> = {}
    for (const v of vals) {
      const p = (porTipoVal[v.classe] ??= { reais: 0, falsos: 0, tipoErrado: 0 })
      if (v.estado === 'rejeitado') p.falsos++
      else if (v.classe_corrigida && v.classe_corrigida !== v.classe) p.tipoErrado++
      else p.reais++
    }
    const tempos = vals.map((v) => v.tempo_s ?? 0).filter((t) => t > 0)
    return {
      total: els.length,
      confirmados: confirmados.length,
      porTipoConf: count(confirmados.map((e) => e.tipo)),
      porTipoPend: count(els.filter((e) => e.estado === 'pendente').map((e) => e.tipo)),
      porSubtipo: count(els.filter((e) => e.tipo === 'sinal').map((e) => e.subtipo ?? 'outro_sinal')),
      nSinais: els.filter((e) => e.tipo === 'sinal').length,
      // contentores do catálogo (confirmados e por confirmar), pelo tipo: dado pelo técnico ou sugerido
      porContentor: count(els.filter((e) => e.tipo === 'contentor').map((e) => e.subtipo ?? (cat.sugestoes[e.id] ? `~${cat.sugestoes[e.id].tipo}` : 'por_identificar'))),
      nContentores: els.filter((e) => e.tipo === 'contentor').length,
      porFonte: count(els.flatMap((e) => e.fonte.split('+'))),
      metodo: count(els.map((e) => e.metodo_posicao ?? 'desconhecido')),
      vistas: count(els.map((e) => String(Math.min(e.n_vistas, 5)))),
      auto: els.filter((e) => e.estado === 'auto').length,
      pendentes: els.filter((e) => e.estado === 'pendente').length,
      desde: datas[0],
      ate: datas.at(-1),
      porTipoVal,
      nVal: vals.length,
      tempoTotal: tempos.reduce((a, b) => a + b, 0),
      tempoMedio: tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null,
    }
  }, [cat, cfg])


  return (
    <div className="flex flex-col gap-8 pb-6">
      {!embutido && (
      <>
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold sm:text-3xl">Inventário de {nomeBonito(cfg.zona, cat)}</h2>
        <p className="max-w-2xl text-muted-foreground">
          {r.confirmados} elementos de mobiliário urbano confirmados
          {r.pendentes > 0 && <>, e mais {r.pendentes} identificados automaticamente à espera de verificação por um técnico</>}.
          {r.desde && <> Imagens de {data(r.desde)} a {data(r.ate)}.</>}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {TIPOS.map((t) => (
          <Card key={t} className="gap-4">
            <CardHeader className="flex flex-row items-center gap-3">
              <TipoIcon tipo={t} className="size-9" />
              <CardTitle className="text-base font-medium">{TIPO_PLURAL[t]}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-baseline gap-2">
              <span className="font-heading text-4xl font-semibold tabular-nums">{r.porTipoConf[t] ?? 0}</span>
              <span className="text-sm text-muted-foreground">confirmados</span>
              {!!r.porTipoPend[t] && <span className="ml-auto text-xs text-muted-foreground">+{r.porTipoPend[t]} por confirmar</span>}
            </CardContent>
          </Card>
        ))}
      </section>
      </>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Contentores e ecopontos por tipo</CardTitle>
            <CardDescription>Inclui os por confirmar; o tipo é confirmado por um técnico</CardDescription>
          </CardHeader>
          <CardContent>
            <Barras
              total={r.nContentores}
              itens={[...TIPOS_CONTENTOR, 'papeleira', ...TIPOS_CONTENTOR.map((t) => `~${t}`), 'por_identificar']
                .filter((k) => r.porContentor[k])
                .map((k) => ({
                  key: k,
                  label:
                    k === 'por_identificar'
                      ? 'Tipo por identificar'
                      : k.startsWith('~')
                        ? `${subtipoLabel(k.slice(1))} (sugestão)`
                        : subtipoLabel(k),
                  n: r.porContentor[k],
                }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Sinais de trânsito por tipo</CardTitle>
            <CardDescription>Classificação automática; inclui os por confirmar</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(r.porSubtipo).length ? (
              <Barras
                total={r.nSinais}
                itens={Object.entries(r.porSubtipo).sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ key: s, label: subtipoLabel(s), n }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Ainda não há sinais no catálogo.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">De onde vêm as imagens</CardTitle>
            <CardDescription>Um elemento pode ter sido visto em várias fontes</CardDescription>
          </CardHeader>
          <CardContent>
            <Barras
              total={r.total}
              itens={Object.entries(r.porFonte).map(([f, n]) => ({
                key: f,
                label: f === 'video_proprio' ? 'Vídeo gravado pela Câmara' : f === 'mapillary' ? 'Mapillary (imagens abertas)' : f,
                n,
              }))}
            />
          </CardContent>
        </Card>
      </section>

      {tecnico && (
        <section className="flex flex-col gap-4">
          <div className="border-t pt-6">
            <h2 className="text-xl font-semibold">Indicadores técnicos</h2>
            <p className="text-sm text-muted-foreground">Visíveis só para técnicos.</p>
          </div>

          <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">
            <Numero label="Entrada automática" valor={pct(r.total ? r.auto / r.total : null)} nota={`confiança ≥ ${cfg.limiar_auto} e ≥ ${cfg.min_vistas} vistas`} />
            <Numero label="Na fila" valor={r.pendentes} nota="por confirmar" />
            <Numero label="Validações" valor={r.nVal} nota="guardadas como dados rotulados" />
            <Numero
              label="Duplicados fundidos"
              valor={cat.duplicados.nAutomaticos}
              nota={cat.duplicados.porDecidir.length ? `${cat.duplicados.porDecidir.length} possíveis por decidir na fila` : 'nenhum por decidir'}
            />
            <Numero label="Tempo por validação" valor={r.tempoMedio ? `${r.tempoMedio.toFixed(1)} s` : '—'} nota={r.tempoMedio ? `${duracao(r.tempoTotal)} no total (M11)` : 'M11'} />
          </div>

          <CartaoM10 cat={cat} />

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Como foi calculada a posição</CardTitle>
              </CardHeader>
              <CardContent>
                <Barras
                  total={r.total}
                  itens={Object.entries(r.metodo).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ key: m, label: METODO_LABEL[m as MetodoPosicao] ?? m, n }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Vistas por elemento</CardTitle>
                <CardDescription>"visto em N imagens" (5 = 5 ou mais)</CardDescription>
              </CardHeader>
              <CardContent>
                <Barras total={r.total} itens={['1', '2', '3', '4', '5'].map((k) => ({ key: k, label: k === '5' ? '5 ou mais' : k, n: r.vistas[k] ?? 0 }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Precisão observada nas validações</CardTitle>
                <CardDescription>reais / decididos, por classe detetada</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Reais</TableHead>
                      <TableHead className="text-right">Falsos</TableHead>
                      <TableHead className="text-right">Tipo errado</TableHead>
                      <TableHead className="text-right">Precisão</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TIPOS.map((t) => {
                      const v = r.porTipoVal[t]
                      const n = v ? v.reais + v.falsos + v.tipoErrado : 0
                      return (
                        <TableRow key={t}>
                          <TableCell>{TIPO_LABEL[t]}</TableCell>
                          <TableCell className="text-right tabular-nums">{v?.reais ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{v?.falsos ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{v?.tipoErrado ?? 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{n ? pct(v!.reais / n) : '—'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Calibração da confiança (M8)</CardTitle>
                <CardDescription>
                  P(real) = σ(a + b · logit(média top-k)){calib?.atualizado_em && <> · {data(calib.atualizado_em)}</>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">a</TableHead>
                      <TableHead className="text-right">b</TableHead>
                      <TableHead className="text-right">Rótulos</TableHead>
                      <TableHead className="text-right">Média p/ limiar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TIPOS.map((t) => {
                      const c = calib?.classes[t]
                      return (
                        <TableRow key={t}>
                          <TableCell>{TIPO_LABEL[t]}</TableCell>
                          {c ? (
                            <>
                              <TableCell className="text-right font-mono text-xs">{c.a.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{c.b.toFixed(2)}</TableCell>
                              <TableCell className="text-right tabular-nums">{c.n_reais}/{c.n_falsos}</TableCell>
                              <TableCell className="text-right tabular-nums">{pct(c.media_top_k_para_limiar, 1)}</TableCell>
                            </>
                          ) : (
                            <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">sem calibração: tudo para a fila</TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </div>
  )
}
