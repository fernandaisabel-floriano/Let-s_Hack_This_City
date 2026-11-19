import { Braces, Download, FileJson, FileSpreadsheet, Map as MapIcon } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { EstadoBadge } from '@/components/badges'
import { titulo } from '@/components/ficha'
import { TipoIcon } from '@/components/tipo-icon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { download, separarCatalogo, toCSV, toGeoJSON, validacoesParaRecalibrar } from '@/lib/export'
import { coord, pct } from '@/lib/format'
import type { Elemento } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

function Ficheiro({ icon: Icon, titulo, descricao, acao, onClick, disabled }: {
  icon: typeof MapIcon
  titulo: string
  descricao: React.ReactNode
  acao: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="size-4" /></div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base font-medium">{titulo}</CardTitle>
          <CardDescription>{descricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto">
        <Button variant="outline" className="w-full" onClick={onClick} disabled={disabled}>
          <Download /> {acao}
        </Button>
      </CardContent>
    </Card>
  )
}

export function TabExportar({ cat }: { cat: Catalogo }) {
  const cfg = cat.base!.config
  const tecnico = !!cat.tecnico
  const { cat: rows, fora } = useMemo(() => separarCatalogo(cat.consolidados, cfg, cat.base!.zona), [cat.consolidados, cfg, cat.base])
  const prefixo = `${cfg.municipio}_${cfg.zona}`
  const vals = Object.values(cat.validacoes)

  const exportar = (nome: string, conteudo: string, tipo?: string) => {
    download(nome, conteudo, tipo)
    toast.success(`${nome} descarregado`)
  }

  return (
    <div className="flex flex-col gap-8 pb-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold sm:text-3xl">Dados abertos</h2>
        <p className="max-w-2xl text-muted-foreground">
          O inventário da zona ({rows.length} elementos) em formatos que abrem em qualquer SIG ou folha de cálculo. A coluna <code className="text-sm">estado</code> indica
          se cada elemento já foi confirmado. As imagens de origem do Mapillary são CC BY-SA: a autoria vem na coluna <code className="text-sm">atribuicao</code>.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Ficheiro
          icon={MapIcon}
          titulo="GeoJSON"
          descricao="Coordenadas WGS84 (EPSG:4326). Abre em QGIS, ArcGIS ou geojson.io."
          acao={`catalogo.geojson · ${rows.length}`}
          onClick={() => exportar(`${prefixo}_catalogo.geojson`, JSON.stringify(toGeoJSON(rows, cfg), null, 1), 'application/geo+json')}
        />
        <Ficheiro
          icon={FileSpreadsheet}
          titulo="CSV"
          descricao={<>Latitude/longitude e também x/y em {cfg.crs_local}, o sistema de coordenadas local.</>}
          acao={`catalogo.csv · ${rows.length}`}
          onClick={() => exportar(`${prefixo}_catalogo.csv`, toCSV(rows), 'text/csv')}
        />
      </section>

      {tecnico && (
        <section className="flex flex-col gap-4">
          <div className="border-t pt-6">
            <h2 className="text-xl font-semibold">Ficheiros de trabalho</h2>
            <p className="text-sm text-muted-foreground">Visíveis só para técnicos.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Ficheiro
              icon={FileJson}
              titulo="Validações"
              descricao={<>Para recalibrar a confiança: <code className="text-xs">python pipeline/confianca.py recalibrar</code>. Inclui quem validou.</>}
              acao={`validacoes.json · ${vals.length}`}
              disabled={!vals.length}
              onClick={() => exportar(`${prefixo}_validacoes.json`, JSON.stringify(validacoesParaRecalibrar(vals), null, 1))}
            />
            <Ficheiro
              icon={Braces}
              titulo="Elementos"
              descricao={<>Com as correções dos técnicos, incluindo os {fora.length} fora da zona ou rejeitados.</>}
              acao={`elementos.json · ${cat.elementos.length}`}
              onClick={() => exportar(`${prefixo}_elementos.json`, JSON.stringify(cat.elementos, null, 1))}
            />
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="py-4">
              <CardTitle className="text-base font-medium">Pré-visualização do catálogo</CardTitle>
            </CardHeader>
            <ScrollArea className="h-[420px] border-t">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="pl-6">Elemento</TableHead>
                    <TableHead>Coordenadas</TableHead>
                    <TableHead className="text-right">Confiança</TableHead>
                    <TableHead className="text-right">Vistas</TableHead>
                    <TableHead className="pr-6">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows as unknown as Elemento[]).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6">
                        <span className="flex items-center gap-2.5">
                          <TipoIcon tipo={r.tipo} subtipo={r.subtipo} className="size-6" />
                          <span>
                            <span className="block text-sm">{titulo(r)}</span>
                            <span className="block font-mono text-[11px] text-muted-foreground">{r.id}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{coord(r.lat, 5)}, {coord(r.lon, 5)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.confianca)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.n_vistas}</TableCell>
                      <TableCell className="pr-6"><EstadoBadge estado={r.estado} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </section>
      )}
    </div>
  )
}
