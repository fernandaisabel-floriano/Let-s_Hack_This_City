import { Loader2, MapPin, Plus, Search, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { painelMapa } from '@/components/zona-seletor'
import { procurarRuas, type RuaOsm } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Rua acrescentada no mapa, ainda por processar. Só existe neste browser (localStorage). */
export interface ZonaNova {
  id: string
  nome: string
  local: string
  geometry: RuaOsm['geometry']
}

const CHAVE = 'mapeya:zonas-por-processar'

function ler(): ZonaNova[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '[]')
    return Array.isArray(v) ? v.filter((z) => z && typeof z.id === 'string' && z.geometry) : []
  } catch {
    return []
  }
}

function gravar(z: ZonaNova[]) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(z))
  } catch {
    /* sem armazenamento (modo privado, bloqueado): fica só nesta sessão */
  }
}

/** Zonas por processar, guardadas no browser. `enquadrar` muda quando se acrescenta ou escolhe uma. */
export function useZonasNovas() {
  const [zonas, setZonas] = useState<ZonaNova[]>(ler)
  const [enquadrar, setEnquadrar] = useState<{ id: string; n: number } | null>(null)
  const acrescentar = useCallback((z: ZonaNova) => {
    setZonas((zs) => {
      const novo = [...zs.filter((x) => x.id !== z.id), z]
      gravar(novo)
      return novo
    })
    setEnquadrar((e) => ({ id: z.id, n: (e?.n ?? 0) + 1 }))
  }, [])
  const remover = useCallback((id: string) => {
    setZonas((zs) => {
      const novo = zs.filter((x) => x.id !== id)
      gravar(novo)
      return novo
    })
  }, [])
  const ver = useCallback((id: string) => setEnquadrar((e) => ({ id, n: (e?.n ?? 0) + 1 })), [])
  return { zonas, acrescentar, remover, ver, enquadrar }
}

/** junta os troços com o mesmo nome, freguesia e concelho numa só rua (MultiLineString) */
function juntarTrocos(fs: RuaOsm[]): RuaOsm[] {
  const m = new Map<string, RuaOsm[]>()
  for (const f of fs) {
    const k = [f.properties.name, f.properties.freguesia, f.properties.concelho].join('|')
    m.set(k, [...(m.get(k) ?? []), f])
  }
  return [...m.values()].map((g) =>
    g.length === 1
      ? g[0]
      : {
          ...g[0],
          geometry: {
            type: 'MultiLineString',
            coordinates: g.flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates as number[][]] : (f.geometry.coordinates as number[][][]))),
          },
        },
  )
}

const local = (r: RuaOsm) => [r.properties.freguesia, r.properties.concelho].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')

/**
 * Botão "+ Adicionar zona" do mapa (junto ao painel da zona) e janela "Adicionar nova zona": pesquisa uma rua no OpenStreetMap (Nominatim, pelo
 * servidor: identificação no pedido, ≤ 1 pedido/s, só Portugal) e desenha-a como "Zona por processar".
 * Não grava nada no servidor. Sem internet, mostra o erro e o resto da app continua igual.
 * (A criação real de uma zona, com recolha e processamento, está em Importação → Nova zona.)
 */
export function AdicionarZona({ zonas }: { zonas: ReturnType<typeof useZonasNovas> }) {
  const [aberto, setAberto] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<RuaOsm[] | null>(null)
  const [aProcurar, setAProcurar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ultimoPedido = useRef(0)

  // pesquisa ao escrever: ≥ 3 letras, 500 ms depois da última tecla, nunca mais de 1 pedido por segundo
  useEffect(() => {
    const t = q.trim()
    setErro(null)
    if (t.length < 3) {
      setRes(null)
      setAProcurar(false)
      return
    }
    const ctl = new AbortController()
    const espera = Math.max(500, ultimoPedido.current + 1000 - Date.now())
    const timer = window.setTimeout(async () => {
      ultimoPedido.current = Date.now()
      setAProcurar(true)
      try {
        const fc = await procurarRuas(t, ctl.signal)
        setRes(juntarTrocos(fc.features))
      } catch (e) {
        if (ctl.signal.aborted) return
        const st = (e as { status?: number }).status
        setRes(null)
        setErro(
          !navigator.onLine || st === undefined // sem resposta do servidor = sem ligação
            ? 'Sem ligação: não foi possível pesquisar. O resto da plataforma continua a funcionar.'
            : `A pesquisa do OpenStreetMap falhou${st ? ` (${st})` : ''}. Tente de novo dentro de momentos.`,
        )
      } finally {
        if (!ctl.signal.aborted) setAProcurar(false)
      }
    }, espera)
    return () => {
      window.clearTimeout(timer)
      ctl.abort()
    }
  }, [q])

  const escolher = (r: RuaOsm) => {
    zonas.acrescentar({ id: `${r.properties.osm_type}${r.properties.osm_id}`, nome: r.properties.name, local: local(r), geometry: r.geometry })
    setAberto(false)
    setQ('')
    setRes(null)
  }

  return (
    <>
      <Button
        className="pointer-events-auto h-11 shrink-0 gap-1 bg-destaque px-3 text-xs font-semibold tracking-wide text-destaque-foreground uppercase hover:bg-destaque/90"
        onClick={() => setAberto(true)}
      >
        <Plus className="size-4" aria-hidden="true" /> Adicionar zona
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="rounded-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar nova zona</DialogTitle>
            <DialogDescription>Procure uma rua em Portugal. Fica marcada no mapa como zona por processar, só neste browser.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ex.: Rua de Viana do Castelo"
              aria-label="Procurar rua"
              aria-describedby="adicionar-zona-estado"
              className="h-11 pl-9"
            />
            {aProcurar && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
          </div>
          <p id="adicionar-zona-estado" className="sr-only" aria-live="polite">
            {aProcurar ? 'A procurar…' : res ? `${res.length} resultados` : ''}
          </p>
          {q.trim().length > 0 && q.trim().length < 3 && <p className="text-xs text-muted-foreground">Escreva pelo menos 3 letras.</p>}
          {erro && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {erro}
            </p>
          )}
          {res && !erro && (
            res.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma rua com esse nome.</p>
            ) : (
              <ul className="-mx-1 flex max-h-72 flex-col overflow-y-auto" aria-label="Resultados">
                {res.map((r) => (
                  <li key={`${r.properties.osm_type}${r.properties.osm_id}`}>
                    <button
                      className={cn('flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-realce focus-visible:outline-none')}
                      onClick={() => escolher(r)}
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.properties.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{local(r) || 'Portugal'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          <p className="text-[11px] text-muted-foreground">Pesquisa: Nominatim · © contribuidores do OpenStreetMap (ODbL)</p>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Lista das zonas por processar (canto superior direito do mapa), com a opção de as remover. */
export function ListaZonasNovas({ zonas }: { zonas: ReturnType<typeof useZonasNovas> }) {
  return (
    <>
      {zonas.zonas.length > 0 && (
        <section aria-label="Zonas por processar" className={`pointer-events-auto w-64 p-2 text-sm ${painelMapa}`}>
          <p className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
            <span className="inline-block h-0 w-5 border-t-2 border-dashed border-zona-nova" aria-hidden="true" /> Zonas por processar ({zonas.zonas.length})
          </p>
          <ul className="flex max-h-48 flex-col overflow-y-auto">
            {zonas.zonas.map((z) => (
              <li key={z.id} className="flex items-center">
                <button className="min-h-11 min-w-0 flex-1 rounded-md px-1 text-left hover:bg-accent" onClick={() => zonas.ver(z.id)} title="Mostrar no mapa">
                  <span className="block truncate font-medium">{z.nome}</span>
                  {z.local && <span className="block truncate text-xs text-muted-foreground">{z.local}</span>}
                </button>
                <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground" aria-label={`Remover ${z.nome}`} onClick={() => zonas.remover(z.id)}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

    </>
  )
}
