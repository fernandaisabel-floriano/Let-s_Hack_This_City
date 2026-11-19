import L from 'leaflet'
import { Loader2, MapPinPlus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { criarZona, procurarOsm, ruaNoPonto, type GeoFeature, type Importacao } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Catalogo } from '@/hooks/use-catalogo'

const chave = (f: GeoFeature) => `${f.properties.osm_type ?? 'w'}${f.properties.osm_id ?? JSON.stringify(f.geometry).slice(0, 40)}`

/** comprimento aproximado de uma LineString/MultiLineString, em metros */
function metros(f: GeoFeature) {
  const linhas = f.geometry.type === 'LineString' ? [f.geometry.coordinates as number[][]] : f.geometry.type === 'MultiLineString' ? (f.geometry.coordinates as number[][][]) : []
  let m = 0
  for (const l of linhas)
    for (let i = 1; i < l.length; i++) {
      const kx = 111320 * Math.cos((l[i][1] * Math.PI) / 180)
      m += Math.hypot((l[i][0] - l[i - 1][0]) * kx, (l[i][1] - l[i - 1][1]) * 111320)
    }
  return m
}

function Clique({ onClique }: { onClique: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClique(e.latlng.lat, e.latlng.lng) })
  return null
}

function Enquadrar({ alvo }: { alvo: GeoFeature[] }) {
  const map = useMap()
  const k = alvo.map(chave).join('|')
  useEffect(() => {
    if (!alvo.length) return
    const b = L.geoJSON({ type: 'FeatureCollection', features: alvo } as GeoJSON.FeatureCollection).getBounds()
    if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando muda o que se procurou
  }, [k, map])
  return null
}

/**
 * Etapa 5 — Nova zona: o técnico escolhe as ruas (pesquisa ou clique no mapa) e, se quiser, o bairro
 * que delimita a zona. O servidor cria a zona (pipeline/nova_zona.py), recolhe o Mapillary dessa área e
 * corre o mesmo pipeline da zona piloto; no fim a zona aparece no seletor de zonas.
 */
export function NovaZona({ cat, onCriada }: { cat: Catalogo; onCriada: (j: Importacao) => void }) {
  const cfg = cat.base!.config
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<GeoFeature[]>([])
  const [aProcurar, setAProcurar] = useState(false)
  const [vias, setVias] = useState<GeoFeature[]>([])
  const [bairro, setBairro] = useState<GeoFeature | null>(null)
  const [nome, setNome] = useState('')
  const [aEnviar, setAEnviar] = useState(false)
  const [aClicar, setAClicar] = useState(false)
  const centro: [number, number] = cfg.bbox ? [(cfg.bbox[1] + cfg.bbox[3]) / 2, (cfg.bbox[0] + cfg.bbox[2]) / 2] : [40.6405, -8.6538]
  const escolhidas = useMemo(() => new Set(vias.map(chave)), [vias])

  const procurar = async () => {
    if (q.trim().length < 3) return
    setAProcurar(true)
    try {
      const fc = await procurarOsm(q.trim())
      setResultados(fc.features)
      if (!fc.features.length) toast.info('Nenhuma rua ou bairro com esse nome')
    } catch (e) {
      toast.error(`Pesquisa falhou: ${e instanceof Error ? e.message : e}`)
    } finally {
      setAProcurar(false)
    }
  }

  // ruas: todos os troços com o mesmo nome entram de uma vez; depois o técnico tira os que não quer
  const ruasPorNome = useMemo(() => {
    const m = new Map<string, GeoFeature[]>()
    for (const f of resultados.filter((r) => r.properties.tipo === 'rua')) m.set(f.properties.name ?? '?', [...(m.get(f.properties.name ?? '?') ?? []), f])
    return [...m.entries()]
  }, [resultados])
  const areas = resultados.filter((r) => r.properties.tipo === 'area')

  const juntar = (fs: GeoFeature[]) => {
    setVias((v) => [...v, ...fs.filter((f) => !v.some((x) => chave(x) === chave(f)))])
    if (!nome && fs[0]?.properties.name) setNome(fs[0].properties.name)
  }
  const alternar = (f: GeoFeature) => setVias((v) => (v.some((x) => chave(x) === chave(f)) ? v.filter((x) => chave(x) !== chave(f)) : [...v, f]))

  const clicarMapa = async (lat: number, lon: number) => {
    setAClicar(true)
    try {
      const f = await ruaNoPonto(lat, lon)
      if (!f || f.properties.tipo !== 'rua') toast.info('Sem rua nesse ponto: clique em cima da rua')
      else {
        alternar(f)
        if (!nome && f.properties.name) setNome(f.properties.name)
      }
    } catch (e) {
      toast.error(`Não foi possível ler a rua: ${e instanceof Error ? e.message : e}`)
    } finally {
      setAClicar(false)
    }
  }

  const total = vias.reduce((s, f) => s + metros(f), 0)
  const criar = async () => {
    setAEnviar(true)
    try {
      const j = await criarZona({
        zona_nome: nome.trim(),
        vias: { type: 'FeatureCollection', features: vias },
        poligono: bairro ? { type: 'FeatureCollection', features: [bairro] } : null,
      })
      toast.success(`Zona "${nome.trim()}" criada: a recolher o Mapillary e a processar`)
      setVias([])
      setBairro(null)
      setNome('')
      setResultados([])
      onCriada(j)
    } catch (e) {
      toast.error(`Não foi possível criar a zona: ${e instanceof Error ? e.message : e}`)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium"><MapPinPlus className="size-4" aria-hidden="true" /> Nova zona</CardTitle>
        <CardDescription>
          Escolha as ruas: pesquise pelo nome (rua ou bairro) ou clique numa rua no mapa para a juntar ou tirar. As imagens do Mapillary dessa área passam pelo
          mesmo processo da zona piloto e a zona aparece no seletor de zonas.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void procurar()
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Avenida Doutor Lourenço Peixinho, Glória…" aria-label="Procurar rua ou bairro" />
            <Button type="submit" variant="outline" disabled={aProcurar || q.trim().length < 3}>
              {aProcurar ? <Loader2 className="animate-spin" /> : <Search />} Procurar
            </Button>
          </form>

          {(ruasPorNome.length > 0 || areas.length > 0) && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-1.5 text-sm">
              {ruasPorNome.map(([n, fs]) => (
                <li key={`r-${n}`}>
                  <button className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => juntar(fs)}>
                    <span className="min-w-0 truncate">{n}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">rua · {fs.length} {fs.length === 1 ? 'troço' : 'troços'} · {Math.round(fs.reduce((s, f) => s + metros(f), 0))} m</span>
                  </button>
                </li>
              ))}
              {areas.map((f) => (
                <li key={chave(f)}>
                  <button className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => setBairro(f)}>
                    <span className="min-w-0 truncate">{f.properties.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">bairro · delimita a zona</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={cn('relative h-80 overflow-hidden rounded-lg border', aClicar && 'cursor-progress')}>
            <MapContainer center={centro} zoom={16} maxZoom={19} className="size-full">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" maxZoom={19} />
              <Clique onClique={clicarMapa} />
              <Enquadrar alvo={resultados.length ? resultados : vias} />
              {bairro && (
                <GeoJSON key={`b-${chave(bairro)}`} data={bairro as unknown as GeoJSON.GeoJsonObject} style={{ color: '#6b7280', weight: 1.5, dashArray: '5 4', fillOpacity: 0.06 }} interactive={false} />
              )}
              {resultados
                .filter((f) => f.properties.tipo === 'rua' && !escolhidas.has(chave(f)))
                .map((f) => (
                  <GeoJSON key={`c-${chave(f)}`} data={f as unknown as GeoJSON.GeoJsonObject} style={{ color: '#9ca3af', weight: 5, opacity: 0.7 }} eventHandlers={{ click: (e) => (L.DomEvent.stopPropagation(e), alternar(f)) }} />
                ))}
              {vias.map((f) => (
                <GeoJSON key={`v-${chave(f)}`} data={f as unknown as GeoJSON.GeoJsonObject} style={{ color: '#1a73e8', weight: 6 }} eventHandlers={{ click: (e) => (L.DomEvent.stopPropagation(e), alternar(f)) }} />
              ))}
            </MapContainer>
            {aClicar && (
              <div className="pointer-events-none absolute top-2 left-2 z-[500] flex items-center gap-1.5 rounded-full bg-card/95 px-3 py-1 text-xs shadow">
                <Loader2 className="size-3.5 animate-spin" /> a ler a rua…
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Azul = escolhido · cinzento = encontrado na pesquisa. Clique num troço para o juntar ou tirar.</p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nz-nome">Nome da zona</Label>
            <Input id="nz-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Av. Lourenço Peixinho" />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="font-medium">
              {vias.length} {vias.length === 1 ? 'troço' : 'troços'} · {Math.round(total)} m
            </p>
            {vias.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
                {vias.map((f) => (
                  <li key={chave(f)} className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1">
                    <span className="min-w-0 truncate">{f.properties.name} · {Math.round(metros(f))} m</span>
                    <button aria-label="Tirar este troço" onClick={() => alternar(f)} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            {bairro && (
              <p className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="truncate">Delimitada por: {bairro.properties.name}</span>
                <button aria-label="Tirar o bairro" onClick={() => setBairro(null)} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
              </p>
            )}
          </div>
          {total > 2000 && <p className="text-xs text-warning">Mais de 2 km: a recolha e a deteção podem demorar bastante.</p>}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {vias.length > 0 && (
          <Button variant="ghost" onClick={() => (setVias([]), setBairro(null))}><Trash2 /> Limpar</Button>
        )}
        <Button onClick={criar} disabled={!vias.length || nome.trim().length < 2 || aEnviar}>
          {aEnviar ? <Loader2 className="animate-spin" /> : <MapPinPlus />} Criar zona e processar
        </Button>
      </CardFooter>
    </Card>
  )
}
