import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet/dist/leaflet.css'
import { Loader2 } from 'lucide-react'
import { setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// o Vite junta o maplibre-gl noutro sítio: indica-lhe onde está o worker (ficheiro autónomo)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import type { ZonaNova } from '@/components/adicionar-zona'
import { ESTADO_COR_VAR } from '@/components/badges'
import type { CorPor } from '@/components/filtros'
import { iconeDe } from '@/components/tipo-icon'
import { ATRIBUICAO_MAPA, estiloMapa } from '@/lib/estilo-mapa'
import type { FeatureCollection } from '@/lib/geo'
import { pct, subtipoLabel } from '@/lib/format'
import { ESTADO_LABEL, TIPO_COR, TIPO_LABEL, type Elemento } from '@/lib/types'

setWorkerUrl(workerUrl)

interface Props {
  elementos: Elemento[]
  vias: FeatureCollection | null
  zona: FeatureCollection | null
  bbox: number[] | null
  selecionado: string | null
  onSelect: (id: string) => void
  /** quando definido, o elemento selecionado pode ser arrastado (P1.3) */
  onMover?: (id: string, lat: number, lon: number) => void
  escuro?: boolean
  /** mapa pequeno (fila de validação): sem zoom, sem indicador de carregamento */
  compacto?: boolean
  /** limiar de entrada automática (m8.limiar_auto), para a cor da confiança */
  limiar?: number
  /** junta marcadores próximos em grupos (modo lite, para telemóveis) */
  agrupar?: boolean
  /** cor dos marcadores: categoria (omissão) ou estado de validação */
  corPor?: CorPor
  /** marcadores assinalados (ex.: escolhidos para unir duplicados), com um visto */
  marcados?: string[]
  /** ruas acrescentadas no botão "+" (zonas por processar), tracejado #7A5C48 */
  zonasNovas?: ZonaNova[]
  /** muda quando se escolhe uma zona nova: enquadra a zona base e essa rua */
  enquadrar?: { id: string; n: number } | null
}

// ------------------------------------------------------------------ confiança

/** Cor da confiança: azul-tinta (#2F4A6D) ≥ limiar, azul-petróleo (#006E90) ≥ 50 %, vermelho-escuro (#8B2E2E) abaixo, cinzento sem calibração. */
export function corConfianca(c: number | null | undefined, limiar = 0.9) {
  if (c === null || c === undefined) return 'var(--muted-foreground)'
  if (c >= limiar) return 'var(--success)'
  if (c >= 0.5) return 'var(--gold)'
  return 'var(--destructive)'
}

export function textoConfianca(c: number | null | undefined) {
  return c === null || c === undefined ? 'confiança sem calibração' : `confiança ${pct(c)}`
}

/** Descrição de um elemento para leitores de ecrã e tooltips. */
export function descricaoElemento(e: Elemento) {
  const nome = e.tipo === 'sinal' && e.subtipo ? subtipoLabel(e.subtipo) : TIPO_LABEL[e.tipo]
  const fund = e.fundidos?.length ? `, junta ${e.fundidos.length + 1} deteções do mesmo objeto` : ''
  return `${nome}, ${ESTADO_LABEL[e.estado].toLowerCase()}, ${textoConfianca(e.confianca)}${fund}`
}

// ------------------------------------------------------------------ mapa base

function FitBounds({ bbox }: { bbox: number[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (bbox?.length === 4) map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [16, 16] })
  }, [bbox, map])
  return null
}

/** Enquadra a zona base (polígono, vias ou bbox) e a rua nova escolhida, com margem. */
function EnquadrarNova({ alvo, zonas, base, bbox }: { alvo: { id: string; n: number } | null | undefined; zonas: ZonaNova[]; base: FeatureCollection | null; bbox: number[] | null }) {
  const map = useMap()
  useEffect(() => {
    const z = alvo && zonas.find((x) => x.id === alvo.id)
    if (!z) return
    const b = L.geoJSON({ type: 'Feature', geometry: z.geometry, properties: {} } as GeoJSON.Feature).getBounds()
    if (base) b.extend(L.geoJSON(base as unknown as GeoJSON.GeoJsonObject).getBounds())
    else if (bbox?.length === 4) b.extend([[bbox[1], bbox[0]], [bbox[3], bbox[2]]])
    if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [40, 80], paddingBottomRight: [300, 40], maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando se escolhe uma zona
  }, [alvo?.n, map])
  return null
}

function FlyTo({ el, centrar }: { el: Elemento | undefined; centrar?: boolean }) {
  const map = useMap()
  // só quando muda o elemento selecionado — não a cada render nem quando o técnico o arrasta
  useEffect(() => {
    if (!el) return
    // mapa pequeno (fila): centra no elemento com zoom de rua
    if (centrar) map.setView([el.lat, el.lon], 19, { animate: false })
    else if (!map.getBounds().pad(-0.25).contains([el.lat, el.lon])) map.panTo([el.lat, el.lon])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- de propósito: só o id
  }, [el?.id, map, centrar])
  return null
}

function webglDisponivel() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Mapa base: vetorial (OpenFreeMap, cores ao estilo Google Maps, lib/estilo-mapa.ts).
 * Sem WebGL ou sem resposta do servidor de mapas, cai para os mosaicos do OpenStreetMap.
 * `onPronto` é chamado quando o mapa base acabou de desenhar.
 */
function MapaBase({ escuro, onPronto }: { escuro: boolean; onPronto: () => void }) {
  const map = useMap()
  const [recurso, setRecurso] = useState(() => !webglDisponivel())

  useEffect(() => {
    if (recurso) return
    let camada: L.MaplibreGL | null = null
    let cancelado = false
    // se o mapa vetorial não desenhar nada em 10 s (sem WebGL, servidor em baixo), usa o OSM
    const limite = window.setTimeout(() => !cancelado && setRecurso(true), 10_000)
    estiloMapa(escuro)
      .then((style) => {
        if (cancelado) return
        camada = maplibreGL({ style, attributionControl: false })
        camada.getAttribution = () => ATRIBUICAO_MAPA
        camada.addTo(map)
        const gl = camada.getMaplibreMap()
        gl.once('idle', () => {
          window.clearTimeout(limite)
          onPronto()
        })
        gl.on('error', (ev) => {
          // erro do estilo ou do WebGL (os mosaicos que falham um a um não contam)
          if (!('tile' in ev) && !cancelado) setRecurso(true)
        })
      })
      .catch(() => !cancelado && setRecurso(true))
    return () => {
      cancelado = true
      window.clearTimeout(limite)
      if (camada) map.removeLayer(camada)
    }
  }, [map, escuro, recurso, onPronto])

  if (!recurso) return null
  return (
    <TileLayer
      attribution='&copy; contribuidores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      className="ctrlf-recurso"
      maxNativeZoom={19}
      maxZoom={21}
      eventHandlers={{ load: onPronto }}
    />
  )
}

// ------------------------------------------------------------------ marcadores

/**
 * Marcador em gota, ao estilo do Google Maps, com:
 *  - o ícone do tipo;
 *  - um ponto de cor com a confiança (azul-tinta / azul-petróleo / vermelho-escuro / cinzento-azulado);
 *  - um badge "+N" quando junta duplicados.
 */
const escaparAttr = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

type PinOpts = { selecionado?: boolean; arrastar?: boolean; limiar?: number; corPor?: CorPor; marcado?: boolean }

function pin(e: Elemento, opts: PinOpts) {
  const Icon = iconeDe(e.tipo, e.subtipo)
  const porEstado = opts.corPor === 'estado'
  const cor = porEstado ? ESTADO_COR_VAR[e.estado] : TIPO_COR[e.tipo]
  // por estado, a cor já diz "pendente": o marcador fica cheio
  const porConfirmar = e.estado === 'pendente' && !porEstado
  const rejeitado = e.estado === 'rejeitado'
  const w = opts.selecionado || opts.marcado ? 36 : 27
  const h = Math.round(w * 1.36)
  const glifo = porConfirmar ? cor : 'white'
  const contorno = porConfirmar ? cor : 'white'
  const larguraContorno = porConfirmar ? 2 : 1.4
  // sinais (#4B533C, escuros): no tema escuro a borda branca passa a 2 px (--borda-sinal), senão desaparecem no mapa escuro
  const estiloContorno = !porEstado && e.tipo === 'sinal' && !porConfirmar ? 'style="stroke-width:var(--borda-sinal)"' : ''
  const corPonto = corConfianca(e.confianca, opts.limiar)
  const bordaPonto = 'white'
  const icone = renderToStaticMarkup(<Icon size={w * 0.48} strokeWidth={2.4} color={glifo} aria-hidden="true" />)
  const ponto = Math.round(w * 0.36)
  const extra = e.fundidos?.length ?? 0
  const html = `
    <div class="ctrlf-pin" role="img" aria-label="${escaparAttr(`${descricaoElemento(e)}${opts.selecionado ? ' (selecionado)' : ''}`)}" style="position:relative;width:${w}px;height:${h}px;opacity:${rejeitado ? 0.45 : 1};${opts.arrastar ? 'cursor:grab' : ''};filter:drop-shadow(0 1px 2px rgb(0 0 0 / .35))">
      <svg width="${w}" height="${h}" viewBox="0 0 24 33" style="position:absolute;inset:0;overflow:visible">
        <path d="M12 32.2C12 32.2 1 19.6 1 11.6A11 11 0 0 1 23 11.6C23 19.6 12 32.2 12 32.2Z"
          fill="${porConfirmar ? 'white' : cor}" stroke="${contorno}" stroke-width="${larguraContorno}" ${estiloContorno}
          ${porConfirmar ? 'stroke-dasharray="3 2"' : ''}/>
      </svg>
      <div style="position:absolute;left:0;top:0;width:${w}px;height:${w * 0.96}px;display:flex;align-items:center;justify-content:center">${icone}</div>
      <span style="position:absolute;right:-${ponto * 0.25}px;top:-${ponto * 0.2}px;width:${ponto}px;height:${ponto}px;border-radius:50%;
        background:${corPonto};border:2px solid ${bordaPonto};box-sizing:border-box"></span>
      ${extra ? `<span style="position:absolute;left:-${w * 0.32}px;top:-${w * 0.22}px;min-width:${w * 0.62}px;height:${w * 0.52}px;padding:0 3px;border-radius:999px;
        background:var(--foreground);color:var(--background);font:600 ${Math.round(w * 0.36)}px/1 var(--font-sans);display:flex;align-items:center;justify-content:center;
        border:1.5px solid white;box-sizing:border-box">+${extra}</span>` : ''}
      ${opts.marcado ? `<span style="position:absolute;left:-${w * 0.2}px;bottom:${w * 0.25}px;width:${w * 0.55}px;height:${w * 0.55}px;border-radius:50%;
        background:var(--primary);color:var(--primary-foreground);border:2px solid white;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
        font:700 ${Math.round(w * 0.36)}px/1 var(--font-sans)">✓</span>` : ''}
    </div>`
  return L.divIcon({ className: 'ctrlf-marcador', html, iconSize: [w, h], iconAnchor: [w / 2, h - 1], tooltipAnchor: [0, -h + 4] })
}

/**
 * Ícones em cache: o react-leaflet compara o ícone por referência e, se for outro objeto, troca-o
 * (setIcon). Criar um ícone novo a cada render (a fila re-renderiza com o relógio) partia o
 * arrastar a meio e voltava a desenhar todos os marcadores.
 */
const ICONES = new Map<string, L.DivIcon>()
function pinCache(e: Elemento, opts: PinOpts) {
  const k = [e.id, e.tipo, e.subtipo, e.estado, e.confianca, e.fundidos?.length ?? 0, descricaoElemento(e), opts.selecionado, opts.arrastar, opts.limiar, opts.corPor, opts.marcado].join('|')
  let i = ICONES.get(k)
  if (!i) {
    if (ICONES.size > 2000) ICONES.clear()
    i = pin(e, opts)
    ICONES.set(k, i)
  }
  return i
}

/** Grupo de marcadores (modo lite): círculo azul com o número de elementos. */
function iconeGrupo(cluster: { getChildCount(): number }) {
  const n = cluster.getChildCount()
  const s = n < 10 ? 34 : n < 50 ? 40 : 46
  return L.divIcon({
    className: 'ctrlf-marcador',
    iconSize: [s, s],
    html: `<div role="img" aria-label="${n} elementos agrupados; amplie para ver" style="width:${s}px;height:${s}px;border-radius:50%;background:var(--primary);color:var(--primary-foreground);
      display:flex;align-items:center;justify-content:center;font:600 13px/1 var(--font-sans);border:3px solid var(--realce);
      box-shadow:0 1px 2px rgb(0 0 0 / .2)">${n}</div>`,
  })
}

/** Lê um token de cor do tema (os atributos SVG do Leaflet não aceitam var()). */
function corTema(nome: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#2f4a6d'
}

function Rotulo({ e }: { e: Elemento }) {
  return (
    <>
      <strong>{e.tipo === 'sinal' && e.subtipo ? subtipoLabel(e.subtipo) : TIPO_LABEL[e.tipo]}</strong>
      <span style={{ opacity: 0.7 }}> · {ESTADO_LABEL[e.estado]} · {textoConfianca(e.confianca)}</span>
      {!!e.fundidos?.length && (
        <span style={{ display: 'block', opacity: 0.8 }}>
          +{e.fundidos.length}: junta {e.fundidos.length + 1} deteções do mesmo objeto (duplicados fundidos)
        </span>
      )}
    </>
  )
}

export function MapView({ elementos, vias, zona, bbox, selecionado, onSelect, onMover, escuro = false, compacto, limiar = 0.9, agrupar, corPor = 'categoria', marcados, zonasNovas, enquadrar }: Props) {
  const marc = useMemo(() => new Set(marcados ?? []), [marcados])
  const sel = useMemo(() => elementos.find((e) => e.id === selecionado), [elementos, selecionado])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcula quando o tema muda
  const primaria = useMemo(() => corTema('--primary'), [escuro])
  const [pronto, setPronto] = useState(false)
  const marcarPronto = useMemo(() => () => setPronto(true), [])
  const center: [number, number] = bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : [40.6386, -8.6578]
  // os confirmados ficam por cima dos que estão por confirmar
  const ordenados = useMemo(
    () => [...elementos].sort((a, b) => Number(a.estado !== 'pendente') - Number(b.estado !== 'pendente')),
    [elementos],
  )

  const marcadores = ordenados.map((e) =>
    e.id === selecionado ? null : (
      <Marker
        key={e.id}
        position={[e.lat, e.lon]}
        icon={pinCache(e, { limiar, corPor, marcado: marc.has(e.id) })}
        // o Leaflet torna o marcador focável (role=button, Enter abre); o nome vem do role=img dentro do ícone
        eventHandlers={{ click: () => onSelect(e.id) }}
      >
        {!compacto && (
          <Tooltip direction="top">
            <Rotulo e={e} />
          </Tooltip>
        )}
      </Marker>
    ),
  )

  // marcador selecionado: posição e handlers estáveis, senão um re-render a meio do arrasto devolvia-o ao sítio
  // eslint-disable-next-line react-hooks/exhaustive-deps -- de propósito: só as coordenadas
  const selPos = useMemo<[number, number] | null>(() => (sel ? [sel.lat, sel.lon] : null), [sel?.lat, sel?.lon])
  const moverRef = useRef(onMover)
  useEffect(() => {
    moverRef.current = onMover
  }, [onMover])
  const selId = sel?.id
  const selHandlers = useMemo(
    () => ({
      dragend: (ev: L.LeafletEvent) => {
        const p = (ev.target as L.Marker).getLatLng()
        if (selId) moverRef.current?.(selId, Math.round(p.lat * 1e7) / 1e7, Math.round(p.lng * 1e7) / 1e7)
      },
    }),
    [selId],
  )

  // teclado: Enter ou Espaço num marcador focado abre a ficha (o Leaflet só os torna focáveis)
  const onKeyDown = (ev: React.KeyboardEvent) => {
    const m = (ev.target as HTMLElement).closest<HTMLElement>('.ctrlf-marcador')
    if (m && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault()
      m.click()
    }
  }

  return (
    <div className="relative size-full" onKeyDown={onKeyDown}>
      <MapContainer center={center} zoom={18} maxZoom={21} zoomSnap={0.25} className="ctrlf-mapa size-full" zoomControl={false} attributionControl={!compacto}>
        <MapaBase escuro={escuro} onPronto={marcarPronto} />
        {!compacto && <ZoomControl position="bottomright" zoomInTitle="Aproximar" zoomOutTitle="Afastar" />}
        {!(compacto && sel) && <FitBounds bbox={bbox} />}
        <FlyTo el={sel} centrar={compacto} />
        {zona && (
          <GeoJSON
            key={`zona-${primaria}`}
            data={zona as unknown as GeoJSON.GeoJsonObject}
            style={{ color: primaria, weight: 1.5, dashArray: '6 5', fillColor: primaria, fillOpacity: 0.05 }}
            interactive={false}
          />
        )}
        {zonasNovas?.map((z) => (
          <GeoJSON
            key={`nova-${z.id}`}
            data={{ type: 'Feature', geometry: z.geometry, properties: {} } as unknown as GeoJSON.GeoJsonObject}
            style={{ color: '#7a5c48', weight: 4, dashArray: '8 6', opacity: 0.95 }}
            interactive={false}
          >
            <Tooltip permanent direction="top" className="ctrlf-zona-nova">
              {z.nome} · Zona por processar
            </Tooltip>
          </GeoJSON>
        ))}
        {zonasNovas && <EnquadrarNova alvo={enquadrar} zonas={zonasNovas} base={zona ?? vias} bbox={bbox} />}
        {vias && <GeoJSON key={`vias-${primaria}`} data={vias as unknown as GeoJSON.GeoJsonObject} style={{ color: primaria, weight: 2, opacity: 0.2 }} interactive={false} />}
        {agrupar ? (
          <MarkerClusterGroup
            key={elementos.length}
            chunkedLoading
            maxClusterRadius={45}
            disableClusteringAtZoom={20}
            showCoverageOnHover={false}
            spiderfyOnMaxZoom
            iconCreateFunction={iconeGrupo}
          >
            {marcadores}
          </MarkerClusterGroup>
        ) : (
          marcadores
        )}
        {sel && selPos && (
          <Marker
            key={`sel-${sel.id}-${onMover ? 'm' : ''}`}
            position={selPos}
            zIndexOffset={1000}
            draggable={!!onMover}
            icon={pinCache(sel, { selecionado: true, arrastar: !!onMover, limiar, corPor })}
            eventHandlers={selHandlers}
          >
            {onMover && (
              <Tooltip permanent direction="top">
                Arraste para corrigir a posição
              </Tooltip>
            )}
          </Marker>
        )}
      </MapContainer>

      {!compacto && !pronto && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />A carregar o mapa…
          </div>
        </div>
      )}
    </div>
  )
}
