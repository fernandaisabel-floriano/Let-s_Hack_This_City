import { Download, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EstadoBadge, TipoDot } from '@/components/badges'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { download } from '@/lib/export'
import { duracao, iniciais, subtipoLabel } from '@/lib/format'
import { TIPO_LABEL, type Evento } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

function descricao(e: Evento) {
  if (e.acao === 'limpar') return <span className="text-muted-foreground">apagou todas as decisões</span>
  if (e.acao === 'desfazer') return <span className="text-muted-foreground">desfez a decisão</span>
  if (e.acao === 'par')
    return (
      <span className="text-xs">
        {e.mesmo ? 'juntou como o mesmo objeto' : 'marcou como objetos diferentes'}: <span className="font-mono">{e.a}</span> e <span className="font-mono">{e.b}</span>
      </span>
    )
  const v = e.validacao!
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <EstadoBadge estado={v.estado} />
      {v.classe_corrigida && v.classe_corrigida !== v.classe && (
        <span className="text-xs">
          {TIPO_LABEL[v.classe]} → <strong>{TIPO_LABEL[v.classe_corrigida]}</strong>
        </span>
      )}
      {v.subtipo_corrigido !== undefined && <span className="text-xs">subtipo → <strong>{subtipoLabel(v.subtipo_corrigido)}</strong></span>}
      {v.lat !== undefined && <span className="text-xs">posição corrigida</span>}
    </div>
  )
}

function csv(eventos: Evento[]) {
  const head = ['seq', 'quando', 'utilizador', 'nome', 'acao', 'elemento', 'classe', 'estado', 'classe_corrigida', 'subtipo_corrigido', 'lat', 'lon', 'tempo_s']
  const q = (v: unknown) => (v === undefined || v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const rows = eventos.map((e) =>
    [e.seq, e.quando, e.tecnico.utilizador, e.tecnico.nome, e.acao, e.id, e.validacao?.classe, e.validacao?.estado, e.validacao?.classe_corrigida,
      e.validacao?.subtipo_corrigido, e.validacao?.lat, e.validacao?.lon, e.validacao?.tempo_s].map(q).join(','),
  )
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

export function TabRegisto({ cat }: { cat: Catalogo }) {
  const [quem, setQuem] = useState<string>('todos')
  const cfg = cat.base!.config

  const tecnicos = useMemo(() => {
    const m = new Map<string, { nome: string; decisoes: number; rejeicoes: number; correcoes: number; tempo: number; ultima: string }>()
    for (const e of cat.registo) {
      const t = m.get(e.tecnico.utilizador) ?? { nome: e.tecnico.nome, decisoes: 0, rejeicoes: 0, correcoes: 0, tempo: 0, ultima: e.quando }
      t.ultima = e.quando
      if (e.acao === 'decisao') {
        t.decisoes++
        if (e.validacao?.estado === 'rejeitado') t.rejeicoes++
        if (e.validacao?.estado === 'corrigido') t.correcoes++
        t.tempo += e.validacao?.tempo_s ?? 0
      }
      m.set(e.tecnico.utilizador, t)
    }
    return [...m.entries()]
  }, [cat.registo])

  const eventos = useMemo(
    () => [...cat.registo].reverse().filter((e) => quem === 'todos' || e.tecnico.utilizador === quem),
    [cat.registo, quem],
  )

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tecnicos.map(([u, t]) => (
          <Card key={u} className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center gap-3 px-4">
              <Avatar><AvatarFallback>{iniciais(t.nome)}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <CardTitle className="truncate text-sm">{t.nome}</CardTitle>
                <CardDescription className="text-xs">{u} · última atividade {new Date(t.ultima).toLocaleDateString('pt-PT')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 px-4 text-center">
              <div><div className="text-lg font-semibold tabular-nums">{t.decisoes}</div><div className="text-[11px] text-muted-foreground">decisões</div></div>
              <div><div className="text-lg font-semibold tabular-nums">{t.rejeicoes}</div><div className="text-[11px] text-muted-foreground">rejeitados</div></div>
              <div><div className="text-lg font-semibold tabular-nums">{t.decisoes ? `${(t.tempo / t.decisoes).toFixed(1)}s` : '—'}</div><div className="text-[11px] text-muted-foreground">por decisão</div></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm"><History className="size-4" /> Registo de validações</CardTitle>
            <CardDescription>
              {cat.origem === 'pipeline'
                ? <>Só acrescenta, nunca apaga: <code className="text-xs">catalogo/registo_validacoes.jsonl</code>. O técnico é o da sessão.</>
                : 'Dados de demonstração ou ficheiro carregado: este registo fica só neste browser.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={quem} onValueChange={setQuem}>
              <SelectTrigger className="w-48" aria-label="Filtrar por técnico"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os técnicos</SelectItem>
                {tecnicos.map(([u, t]) => <SelectItem key={u} value={u}>{t.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={!eventos.length} onClick={() => download(`${cfg.municipio}_${cfg.zona}_registo_validacoes.csv`, csv([...eventos].reverse()), 'text/csv')}>
              <Download /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <ScrollArea className="h-[calc(100svh-22rem)] min-h-80 border-t">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="pl-6">Quando</TableHead>
                  <TableHead>Técnico</TableHead>
                  <TableHead>Elemento</TableHead>
                  <TableHead>Decisão</TableHead>
                  <TableHead className="pr-6 text-right">Tempo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((e) => {
                  const el = e.id ? cat.todos.find((x) => x.id === e.id) : undefined
                  return (
                    <TableRow key={`${e.seq}-${e.quando}`}>
                      <TableCell className="pl-6 text-xs whitespace-nowrap tabular-nums">{new Date(e.quando).toLocaleString('pt-PT')}</TableCell>
                      <TableCell className="text-sm">{e.tecnico.nome}</TableCell>
                      <TableCell>
                        {e.id ? (
                          <span className="flex items-center gap-2 font-mono text-xs">
                            {el && <TipoDot tipo={el.tipo} />}
                            {e.id}
                          </span>
                        ) : e.acao === 'par' ? (
                          <span className="font-mono text-xs">{e.a} + {e.b}</span>
                        ) : (
                          <Badge variant="outline">todos</Badge>
                        )}
                      </TableCell>
                      <TableCell>{descricao(e)}</TableCell>
                      <TableCell className="pr-6 text-right text-xs tabular-nums">{e.validacao?.tempo_s ? duracao(e.validacao.tempo_s) : ''}</TableCell>
                    </TableRow>
                  )
                })}
                {!eventos.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Ainda não há decisões registadas.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
