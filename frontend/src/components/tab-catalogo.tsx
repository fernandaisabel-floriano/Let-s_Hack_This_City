import { ArrowDownUp, Download, FileSpreadsheet, Map as MapIcon, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfiancaBar, EstadoBadge } from '@/components/badges'
import { titulo } from '@/components/ficha'
import { FichaPainel } from '@/components/ficha-painel'
import { textoPesquisa } from '@/components/filtros'
import { TipoIcon } from '@/components/tipo-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { download, separarCatalogo, toCSV, toGeoJSON } from '@/lib/export'
import { coord, fonteLabel, pct, subtipoLabel } from '@/lib/format'
import { nomesVias, posicaoARever } from '@/lib/revisao'
import { cn } from '@/lib/utils'
import { CATEGORIA_LABEL, ESTADO_LABEL, SUBTIPOS, TIPOS, type Elemento, type Estado, type Tipo } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

type FiltroEstado = 'confirmados' | 'todos' | Estado
type Ordem = 'id' | 'tipo' | 'rua' | 'confianca' | 'estado' | 'vistas'

const ORDEM_ESTADO: Record<Estado, number> = { pendente: 0, auto: 1, corrigido: 2, validado: 3, rejeitado: 4 }

/** Cabeçalho de coluna ordenável. */
function Cabecalho({ k, ordem, onOrdem, children, className }: {
  k: Ordem
  ordem: { k: Ordem; asc: boolean }
  onOrdem: (o: { k: Ordem; asc: boolean }) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <TableHead className={className} aria-sort={ordem.k === k ? (ordem.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onOrdem({ k, asc: ordem.k === k ? !ordem.asc : true })}>
        {children}
        <ArrowDownUp className={cn('size-3', ordem.k === k ? 'opacity-100' : 'opacity-30')} aria-hidden="true" />
      </button>
    </TableHead>
  )
}

/** Catálogo central: todos os elementos (sem duplicados), pesquisáveis, filtráveis e editáveis por técnicos. */
export function TabCatalogo({ cat, onPedirLogin }: { cat: Catalogo; onPedirLogin: () => void }) {
  const tecnico = !!cat.tecnico
  const cfg = cat.base!.config
  const ruas = useMemo(() => nomesVias(cat.base!.vias), [cat.base])
  const [texto, setTexto] = useState('')
  const [categoria, setCategoria] = useState<Tipo | 'todas'>('todas')
  const [subtipo, setSubtipo] = useState<string>('todos')
  const [estado, setEstado] = useState<FiltroEstado>(tecnico ? 'todos' : 'confirmados')
  const [rua, setRua] = useState<string>('todas')
  const [rever, setRever] = useState(false)
  const [ordem, setOrdem] = useState<{ k: Ordem; asc: boolean }>({ k: 'tipo', asc: true })
  const [sel, setSel] = useState<string | null>(null)

  const linhas = useMemo(() => {
    const q = texto.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const f = cat.elementos.filter(
      (e) =>
        (categoria === 'todas' || e.tipo === categoria) &&
        (subtipo === 'todos' || (subtipo === '__sem' ? !e.subtipo : e.subtipo === subtipo)) &&
        (estado === 'todos' ? e.estado !== 'rejeitado' : estado === 'confirmados' ? ['auto', 'validado', 'corrigido'].includes(e.estado) : e.estado === estado) &&
        (rua === 'todas' || (rua === '__fora' ? !e.rua : e.rua === rua)) &&
        (!rever || posicaoARever(e)) &&
        (!q || q.split(/\s+/).every((p) => textoPesquisa(e).includes(p))),
    )
    const chave = (e: Elemento): string | number => {
      switch (ordem.k) {
        case 'id':
          return e.id
        case 'tipo':
          return `${e.tipo}|${titulo(e)}`
        case 'rua':
          return e.rua ?? '~'
        case 'confianca':
          return e.confianca ?? e.confianca_max_vista ?? -1
        case 'estado':
          return ORDEM_ESTADO[e.estado]
        case 'vistas':
          return e.n_vistas
      }
    }
    return f.sort((a, b) => {
      const x = chave(a)
      const y = chave(b)
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt')
      return ordem.asc ? r : -r
    })
  }, [cat.elementos, texto, categoria, subtipo, estado, rua, rever, ordem])

  const el = cat.elementos.find((e) => e.id === sel)
  const porCategoria = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of linhas) c[e.tipo] = (c[e.tipo] ?? 0) + 1
    return c
  }, [linhas])

  const exportar = (formato: 'geojson' | 'csv') => {
    const rows = separarCatalogo(linhas, cfg, cat.base!.zona).cat
    const nome = `${cfg.municipio}_${cfg.zona}_catalogo_filtrado.${formato}`
    if (formato === 'geojson') download(nome, JSON.stringify(toGeoJSON(rows, cfg), null, 1), 'application/geo+json')
    else download(nome, toCSV(rows), 'text/csv')
    toast.success(`${nome} descarregado (${rows.length} elementos)`)
  }


  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Catálogo de mobiliário urbano</h2>
          <p className="text-sm text-muted-foreground">
            {linhas.length} de {cat.elementos.length} elementos · {TIPOS.map((t) => `${porCategoria[t] ?? 0} ${CATEGORIA_LABEL[t].toLowerCase()}`).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportar('geojson')}>
            <MapIcon aria-hidden="true" /> GeoJSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportar('csv')}>
            <FileSpreadsheet aria-hidden="true" /> CSV
          </Button>
        </div>
      </div>

      <Card className="gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              className="pl-8"
              placeholder="Procurar por rua, tipo ou identificador"
              aria-label="Procurar no catálogo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <Select
            value={categoria}
            onValueChange={(v) => {
              setCategoria(v as Tipo | 'todas')
              setSubtipo('todos')
            }}
          >
            <SelectTrigger className="w-48" aria-label="Categoria"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as categorias</SelectItem>
              {TIPOS.map((t) => <SelectItem key={t} value={t}>{CATEGORIA_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={subtipo} onValueChange={setSubtipo}>
            <SelectTrigger className="w-52" aria-label="Tipo de elemento"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="__sem">Tipo por identificar</SelectItem>
              {(categoria === 'todas' ? TIPOS : [categoria]).map((t) => (
                <SelectGroup key={t}>
                  <SelectLabel>{CATEGORIA_LABEL[t]}</SelectLabel>
                  {SUBTIPOS[t].map((s) => <SelectItem key={`${t}-${s}`} value={s}>{subtipoLabel(s)}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Select value={estado} onValueChange={(v) => setEstado(v as FiltroEstado)}>
            <SelectTrigger className="w-48" aria-label="Estado de validação"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="confirmados">Confirmados</SelectItem>
              <SelectItem value="todos">Todos (exceto rejeitados)</SelectItem>
              <SelectItem value="pendente">{ESTADO_LABEL.pendente}</SelectItem>
              <SelectItem value="validado">{ESTADO_LABEL.validado}</SelectItem>
              <SelectItem value="corrigido">{ESTADO_LABEL.corrigido}</SelectItem>
              <SelectItem value="auto">{ESTADO_LABEL.auto}</SelectItem>
              {tecnico && <SelectItem value="rejeitado">{ESTADO_LABEL.rejeitado}</SelectItem>}
            </SelectContent>
          </Select>
          <Select value={rua} onValueChange={setRua}>
            <SelectTrigger className="w-56" aria-label="Rua"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as ruas</SelectItem>
              {ruas.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              <SelectItem value="__fora">Longe das vias da zona</SelectItem>
            </SelectContent>
          </Select>
          <Label className="flex items-center gap-2 px-1 text-sm font-normal">
            <Switch checked={rever} onCheckedChange={setRever} />
            <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" /> Posição a rever
          </Label>
        </div>
      </Card>

      <Card className="min-h-0 flex-1 gap-0 overflow-hidden py-0">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
              <TableRow>
                <Cabecalho ordem={ordem} onOrdem={setOrdem} k="tipo" className="pl-4">Elemento</Cabecalho>
                <TableHead>Categoria</TableHead>
                <Cabecalho ordem={ordem} onOrdem={setOrdem} k="rua">Rua</Cabecalho>
                <TableHead>Coordenadas</TableHead>
                <Cabecalho ordem={ordem} onOrdem={setOrdem} k="confianca" className="text-right">Confiança</Cabecalho>
                <Cabecalho ordem={ordem} onOrdem={setOrdem} k="vistas" className="text-right">Vistas</Cabecalho>
                <Cabecalho ordem={ordem} onOrdem={setOrdem} k="estado">Estado</Cabecalho>
                <TableHead className="pr-4">Fonte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((e) => (
                <TableRow
                  key={e.id}
                  className={cn('cursor-pointer', sel === e.id && 'bg-accent')}
                  onClick={() => setSel(e.id)}
                  onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setSel(e.id))}
                  tabIndex={0}
                  aria-label={`${titulo(e)}, ${e.id}`}
                >
                  <TableCell className="pl-4">
                    <span className="flex items-center gap-2.5">
                      <TipoIcon tipo={e.tipo} subtipo={e.subtipo} className="size-7" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{titulo(e)}</span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {e.id}
                          {!!e.fundidos?.length && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">+{e.fundidos.length}</Badge>}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{CATEGORIA_LABEL[e.tipo]}</TableCell>
                  <TableCell className="text-sm">{e.rua ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {coord(e.lat, 5)}, {coord(e.lon, 5)}
                    {posicaoARever(e) && <TriangleAlert className="ml-1 inline size-3.5 text-warning" aria-label="posição a rever" />}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.confianca !== null ? (
                      <span className="inline-flex justify-end"><ConfiancaBar valor={e.confianca} limiar={cfg.limiar_auto} /></span>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="confiança do detetor, ainda não calibrada">{pct(e.confianca_max_vista)}*</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.n_vistas}</TableCell>
                  <TableCell><EstadoBadge estado={e.estado} /></TableCell>
                  <TableCell className="pr-4 text-xs text-muted-foreground">{fonteLabel(e.fonte)}</TableCell>
                </TableRow>
              ))}
              {!linhas.length && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">Nenhum elemento corresponde aos filtros.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          * confiança do detetor na melhor imagem, ainda não calibrada para esta categoria. <Download className="inline size-3" aria-hidden="true" /> A exportação respeita os filtros e
          só inclui elementos dentro da zona de avaliação.
        </p>
      </Card>

      <Sheet open={!!el} onOpenChange={(v) => !v && setSel(null)}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-md" aria-describedby={undefined}>
          <SheetTitle className="sr-only">{el ? titulo(el) : 'Elemento'}</SheetTitle>
          <SheetDescription className="sr-only">Ficha do elemento do catálogo</SheetDescription>
          {el && <FichaPainel cat={cat} el={el} onPedirLogin={onPedirLogin} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}
