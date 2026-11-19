import { useMemo } from 'react'
import { nomeBonito } from '@/components/app-sidebar'
import { TipoIcon } from '@/components/tipo-icon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { MetricaClasse } from '@/lib/data'
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

/** Indicadores do inventário. `embutido`: dentro do Dashboard, sem a introdução nem os cartões por categoria (já lá estão). */
export function TabPainel({ cat, embutido }: { cat: Catalogo; embutido?: boolean }) {
  const cfg = cat.base!.config
  const calib = cat.base!.calibracao
  const tecnico = !!cat.tecnico

  const r = useMemo(() => {
    const { cat: noCat } = separarCatalogo(cat.elementos, cfg, cat.base!.zona)
    const els = noCat as unknown as typeof cat.elementos
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

  const metrica = cat.metrica
  const provisoria = metrica?.ficheiro.includes('osm')

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

          {metrica && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Avaliação contra a referência (M10)</CardTitle>
                <CardDescription>
                  <code className="text-xs">catalogo/{metrica.ficheiro}</code>
                  {provisoria && ' · referência provisória do OpenStreetMap, incompleta: os "falsos" incluem elementos reais que o OSM não tem.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classe</TableHead>
                      <TableHead className="text-right">Referência</TableHead>
                      <TableHead className="text-right">Encontrados</TableHead>
                      <TableHead className="text-right">Falsos</TableHead>
                      <TableHead className="text-right">Em falta</TableHead>
                      <TableHead className="text-right">Precisão</TableHead>
                      <TableHead className="text-right">Recall</TableHead>
                      <TableHead className="text-right">Erro mediano</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(['todas', ...TIPOS] as const).map((k) => {
                      const m = metrica.dados[k] as MetricaClasse | undefined
                      if (!m || typeof m !== 'object' || !('referencia' in m)) return null
                      return (
                        <TableRow key={k}>
                          <TableCell>{k === 'todas' ? <strong>Todas</strong> : TIPO_LABEL[k]}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.referencia}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.encontrados}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.falsos}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.em_falta}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(m.precisao)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(m.recall)}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.erro_posicao_m ? `${m.erro_posicao_m.mediana} m` : '—'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

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
