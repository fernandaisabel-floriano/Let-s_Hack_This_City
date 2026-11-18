import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { iconeDe } from '@/components/tipo-icon'
import type { FeatureCollection } from '@/lib/geo'
import { subtipoLabel } from '@/lib/format'
import { ESTADO_LABEL, TIPO_COR, TIPO_LABEL, type Elemento } from '@/lib/types'

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
  /** mapa pequeno (fila de validação): sem zoom nem atribuição repetida */
  compacto?: boolean
}

function FitBounds({ bbox }: { bbox: number[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (bbox?.length === 4) map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [16, 16] })
  }, [bbox, map])
  return null
}

function FlyTo({ el }: { el: Elemento | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (el && !map.getBounds().pad(-0.25).contains([el.lat, el.lon])) map.panTo([el.lat, el.lon])
  }, [el, map])
  return null
}

/** Ícone em forma de marcador: quadrado arredondado com o ícone do tipo e uma ponta. */
function pin(e: Elemento, opts: { selecionado?: boolean; arrastar?: boolean }) {
  const Icon = iconeDe(e.tipo, e.subtipo)
  const cor = TIPO_COR[e.tipo]
  const porConfirmar = e.estado === 'pendente'
  const rejeitado = e.estado === 'rejeitado'
  const s = opts.selecionado ? 34 : 26
  const svg = renderToStaticMarkup(<Icon size={s * 0.55} strokeWidth={2.25} color={porConfirmar ? cor : 'white'} />)
  const fundo = porConfirmar ? 'var(--card)' : cor
  const anel = opts.selecionado ? `0 0 0 3px var(--card), 0 0 0 5px ${cor},` : ''
  const html = `
    <div class="ctrlf-pin" style="position:relative;width:${s}px;height:${s + 6}px;opacity:${rejeitado ? 0.45 : 1};${opts.arrastar ? 'cursor:grab' : ''}">
      <div style="width:${s}px;height:${s}px;border-radius:${s * 0.3}px;background:${fundo};
        border:2px ${porConfirmar ? 'dashed' : 'solid'} ${porConfirmar ? cor : 'white'};
        box-shadow:${anel} 0 1px 4px rgb(0 0 0 / .35);display:flex;align-items:center;justify-content:center;box-sizing:border-box">${svg}</div>
      <div style="position:absolute;left:50%;bottom:0;width:8px;height:8px;background:${porConfirmar ? cor : cor};
        transform:translate(-50%,-2px) rotate(45deg);border-radius:1px;z-index:-1"></div>
    </div>`
  return L.divIcon({ className: '', html, iconSize: [s, s + 6], iconAnchor: [s / 2, s + 4], tooltipAnchor: [0, -s] })
}

/** Lê um token de cor do tema (os atributos SVG do Leaflet não aceitam var()). */
function corTema(nome: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#1e3a5f'
}

/** Mosaicos do OpenStreetMap; o tom sóbrio vem de um filtro CSS (index.css, .ctrlf-mapa). */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export function MapView({ elementos, vias, zona, bbox, selecionado, onSelect, onMover, escuro, compacto }: Props) {
  const sel = useMemo(() => elementos.find((e) => e.id === selecionado), [elementos, selecionado])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcula quando o tema muda
  const primaria = useMemo(() => corTema('--primary'), [escuro])
  const center: [number, number] = bbox ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2] : [40.6386, -8.6578]
  // ordena para os selecionados/confirmados ficarem por cima
  const ordenados = useMemo(
    () => [...elementos].sort((a, b) => Number(a.estado !== 'pendente') - Number(b.estado !== 'pendente')),
    [elementos],
  )

  return (
    <MapContainer center={center} zoom={18} maxZoom={21} zoomSnap={0.25} className="ctrlf-mapa size-full" zoomControl={false} attributionControl={!compacto}>
      <TileLayer
        attribution='&copy; contribuidores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={TILES}
        maxNativeZoom={19}
        maxZoom={21}
      />
      {!compacto && <ZoomControl position="bottomright" />}
      <FitBounds bbox={bbox} />
      <FlyTo el={sel} />
      {zona && (
        <GeoJSON
          key={`zona-${primaria}`}
          data={zona as unknown as GeoJSON.GeoJsonObject}
          style={{ color: primaria, weight: 1.25, dashArray: '5 5', fillColor: primaria, fillOpacity: 0.04 }}
          interactive={false}
        />
      )}
      {vias && (
        <GeoJSON key={`vias-${primaria}`} data={vias as unknown as GeoJSON.GeoJsonObject} style={{ color: primaria, weight: 2, opacity: 0.25 }} interactive={false} />
      )}
      {ordenados.map((e) => {
        const isSel = e.id === selecionado
        if (isSel) return null
        return (
          <Marker key={e.id} position={[e.lat, e.lon]} icon={pin(e, {})} eventHandlers={{ click: () => onSelect(e.id) }}>
            {!compacto && (
              <Tooltip direction="top">
                <strong>{e.tipo === 'sinal' && e.subtipo ? subtipoLabel(e.subtipo) : TIPO_LABEL[e.tipo]}</strong>
                <span style={{ opacity: 0.7 }}> · {ESTADO_LABEL[e.estado]}</span>
              </Tooltip>
            )}
          </Marker>
        )
      })}
      {sel && (
        <Marker
          key={`sel-${sel.id}-${onMover ? 'm' : ''}`}
          position={[sel.lat, sel.lon]}
          zIndexOffset={1000}
          draggable={!!onMover}
          icon={pin(sel, { selecionado: true, arrastar: !!onMover })}
          eventHandlers={{
            dragend: (ev) => {
              const p = (ev.target as L.Marker).getLatLng()
              onMover?.(sel.id, Math.round(p.lat * 1e7) / 1e7, Math.round(p.lng * 1e7) / 1e7)
            },
          }}
        >
          {onMover && (
            <Tooltip permanent direction="top">
              Arraste para corrigir a posição
            </Tooltip>
          )}
        </Marker>
      )}
    </MapContainer>
  )
}
