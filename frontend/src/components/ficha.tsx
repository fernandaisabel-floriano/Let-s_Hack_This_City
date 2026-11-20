import { Check, ImageOff, MapPinned, Move, ShieldCheck, TriangleAlert, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { ConfiancaBar, EstadoBadge } from '@/components/badges'
import { ImagemOriginal } from '@/components/imagem-original'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { InfoImagem } from '@/lib/api'
import { urlZona } from '@/lib/data'
import { motivosPosicao } from '@/lib/revisao'
import { coord, data, fonteLabel, pct, subtipoLabel } from '@/lib/format'
import { toLocal } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { CATEGORIA_LABEL, METODO_LABEL, SUBTIPOS, TIPOS, TIPOS_CONTENTOR, TIPO_LABEL, TIPO_PLURAL, type Elemento, type Tipo, type Validacao } from '@/lib/types'
import type { DecisaoOpts } from '@/hooks/use-catalogo'

export function Recorte({ el, className }: { el: Elemento; className?: string }) {
  const [falhou, setFalhou] = useState(false)
  const src = urlZona(el.recorte) ?? urlZona(el.imagem)
  if (!src || falhou)
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground', className)}>
        <ImageOff className="size-5" />
        <span className="text-xs">Sem imagem</span>
      </div>
    )
  return (
    <div className={cn('overflow-hidden rounded-lg bg-muted', className)}>
      <img src={src} alt={`Recorte de ${el.id}`} onError={() => setFalhou(true)} className="size-full object-contain" />
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-2 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

const TITULO_CONTENTOR: Record<string, string> = {
  subterraneo: 'Contentor subterrâneo',
  ilha_reciclagem: 'Ecoponto (ilha de reciclagem)',
  indiferenciado: 'Contentor indiferenciado',
  papeleira: 'Papeleira',
}

export function titulo(el: Elemento) {
  if (el.tipo === 'sinal' && el.subtipo) return subtipoLabel(el.subtipo)
  if (el.tipo === 'contentor' && el.subtipo) return TITULO_CONTENTOR[el.subtipo] ?? `Contentor (${subtipoLabel(el.subtipo)})`
  return TIPO_LABEL[el.tipo]
}

export type Sugestao = { tipo: string; fracao: number; n: number }

interface DetalhesProps {
  el: Elemento
  crs: string
  limiar: number
  validacao?: Validacao
  /** mostra os campos técnicos (confiança, método de posição, x/y local) */
  tecnico?: boolean
  /** contentores: tipo sugerido pelo CLIP, ainda por confirmar */
  sugestao?: Sugestao
  /** proveniência e desfocagem da imagem (images.csv) */
  imagemInfo?: InfoImagem
  /** caixa da deteção na imagem original, se conhecida (técnicos) */
  bbox?: number[] | null
}

/** Frase com o que foi desfocado na imagem antes de ser gravada. */
export function textoPrivacidade(i?: InfoImagem) {
  if (!i || (i.rostos === null && i.matriculas === null)) return 'desfocagem aplicada na recolha (contagem não registada)'
  const partes = [
    i.rostos ? `${i.rostos} ${i.rostos === 1 ? 'rosto' : 'rostos'}` : null,
    i.matriculas ? `${i.matriculas} ${i.matriculas === 1 ? 'matrícula' : 'matrículas'}` : null,
    i.cabecas ? `${i.cabecas} ${i.cabecas === 1 ? 'pessoa' : 'pessoas'}` : null,
  ].filter(Boolean)
  return partes.length ? `${partes.join(', ')} desfocados antes de gravar` : 'nenhum rosto nem matrícula detetados'
}

export function Detalhes({ el, crs, limiar, validacao, tecnico, sugestao, imagemInfo, bbox }: DetalhesProps) {
  const rever = motivosPosicao(el)
  const xy = tecnico ? toLocal(el.lon, el.lat, crs) : null
  return (
    <dl className="divide-y divide-border/60">
      <Campo label="Categoria">{CATEGORIA_LABEL[el.tipo]}</Campo>
      <Campo label="Tipo">
        {TIPO_LABEL[el.tipo]}
        {el.tipo === 'sinal' && <span className="block text-xs text-muted-foreground">{el.subtipo ? subtipoLabel(el.subtipo) : 'classificação por fazer'}</span>}
        {el.tipo === 'contentor' && (
          <span className="block text-xs text-muted-foreground">
            {el.subtipo
              ? subtipoLabel(el.subtipo)
              : sugestao
                ? `provável: ${subtipoLabel(sugestao.tipo).toLowerCase()} (sugestão automática, ${pct(sugestao.fracao)} das deteções; por confirmar)`
                : 'tipo (subterrâneo, ecoponto ou indiferenciado) por identificar'}
          </span>
        )}
      </Campo>
      <Campo label="Estado"><EstadoBadge estado={el.estado} /></Campo>
      {tecnico && validacao?.validado_por && (
        <Campo label="Decidido por">
          {validacao.validado_por.nome}
          <span className="block text-xs text-muted-foreground">{new Date(validacao.validado_em).toLocaleString('pt-PT')}</span>
        </Campo>
      )}
      <Campo label="Confiança">
        {el.confianca !== null ? (
          <>
            <ConfiancaBar valor={el.confianca} limiar={limiar} />
            {!tecnico && <span className="mt-1 block text-xs text-muted-foreground">Probabilidade de a deteção automática estar certa.</span>}
          </>
        ) : el.confianca_max_vista !== undefined ? (
          // sem calibração para esta classe (ex.: contentores): mostra a confiança do detetor
          <>
            <span className="text-sm tabular-nums">{pct(el.confianca_max_vista)}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              confiança do detetor na melhor imagem; ainda não há calibração para {TIPO_PLURAL[el.tipo].toLowerCase()}, por isso um técnico confirma sempre
            </span>
          </>
        ) : (
          <ConfiancaBar valor={null} />
        )}
      </Campo>
      {!!el.fundidos?.length && <Campo label="Duplicados">+{el.fundidos.length} juntados neste elemento</Campo>}
      {tecnico && el.subtipo_incerto && (
        <Campo label="Subtipo">
          incerto{el.subtipo_motivo ? ` — ${el.subtipo_motivo}` : ''}
          {el.confianca_subtipo != null && <span className="text-muted-foreground"> ({pct(el.confianca_subtipo)})</span>}
        </Campo>
      )}
      <Campo label="Visto em">{el.n_vistas} {el.n_vistas === 1 ? 'imagem' : 'imagens'}</Campo>
      <Campo label="Imagens de">{data(el.primeira_vista)}{el.ultima_vista !== el.primeira_vista && <> a {data(el.ultima_vista)}</>}</Campo>
      <Campo label="Coordenadas GPS">
        <span className="font-mono text-xs">{coord(el.lat)}, {coord(el.lon)}</span>
        {xy && <span className="block font-mono text-xs text-muted-foreground">{crs}: {xy[0].toFixed(1)}, {xy[1].toFixed(1)}</span>}
        {rever.length > 0 && (
          <span className="mt-1 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>Posição a rever: {rever.join('; ')}.</span>
          </span>
        )}
      </Campo>
      {el.rua && <Campo label="Rua">{el.rua}</Campo>}
      {tecnico && el.metodo_posicao && (
        <Campo label="Posição">
          {METODO_LABEL[el.metodo_posicao] ?? el.metodo_posicao}
          {el.residuo_raios_m != null && <span className="block text-xs text-muted-foreground">resíduo dos raios {el.residuo_raios_m} m{el.ajustado_edificio ? ' · ajustado à fachada' : ''}</span>}
        </Campo>
      )}
      <Campo label="Fonte">
        {fonteLabel(el.fonte)}
        {el.atribuicao && <span className="block text-xs text-muted-foreground">{el.atribuicao}</span>}
        {imagemInfo?.licenca && !el.atribuicao.includes(imagemInfo.licenca) && <span className="block text-xs text-muted-foreground">Licença {imagemInfo.licenca}</span>}
        {urlZona(el.imagem) && (
          <ImagemOriginal el={el} info={imagemInfo} bbox={bbox}>
            <button className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
              <MapPinned className="size-3" /> Ver imagem original
            </button>
          </ImagemOriginal>
        )}
      </Campo>
      <Campo label="Privacidade">
        <span className="flex items-start gap-1.5 text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
          {textoPrivacidade(imagemInfo)}
        </span>
      </Campo>
    </dl>
  )
}

interface AcoesProps {
  el: Elemento
  /** contentores: tipo sugerido pelo CLIP */
  sugestao?: Sugestao
  validado: boolean
  onDecidir: (estado: 'validado' | 'corrigido' | 'rejeitado', opts?: DecisaoOpts) => void
  onDesfazer: () => void
  editarPosicao?: boolean
  onEditarPosicao?: (v: boolean) => void
  atalhos?: boolean
}

export function Acoes({ el, validado, onDecidir, onDesfazer, editarPosicao, onEditarPosicao, atalhos, sugestao }: AcoesProps) {
  const mudarTipo = (t: Tipo) => {
    if (t !== el.tipo) onDecidir('corrigido', { tipo: t, subtipo: t === 'sinal' ? 'outro_sinal' : null })
  }
  const subtipos = [...new Set([...(el.subtipo ? [el.subtipo] : []), ...SUBTIPOS[el.tipo]])]
  return (
    <div className="flex flex-col gap-2">
      {el.tipo === 'contentor' && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-2.5" role="group" aria-labelledby={`tipo-cont-${el.id}`}>
          <p id={`tipo-cont-${el.id}`} className="text-xs text-muted-foreground">
            {el.subtipo ? 'Tipo de contentor' : 'Confirmar como:'}
            {sugestao && !el.subtipo && <> (sugestão: {subtipoLabel(sugestao.tipo).toLowerCase()})</>}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {TIPOS_CONTENTOR.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={el.subtipo === t ? 'default' : sugestao?.tipo === t && !el.subtipo ? 'secondary' : 'outline'}
                className="h-auto min-h-8 px-1.5 py-1 text-xs leading-tight whitespace-normal"
                aria-pressed={el.subtipo === t}
                onClick={() => onDecidir('corrigido', { subtipo: t })}
              >
                {t === 'ilha_reciclagem' ? 'Ecoponto' : subtipoLabel(t)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button className="bg-success text-primary-foreground hover:bg-success/90" onClick={() => onDecidir('validado')}>
          <Check /> Confirmar {atalhos && <kbd className="border-white/30">V</kbd>}
        </Button>
        <Button variant="outline" className="border-destructive text-destructive hover:text-destructive dark:border-destructive" onClick={() => onDecidir('rejeitado')}>
          <X /> Rejeitar {atalhos && <kbd>X</kbd>}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={el.tipo} onValueChange={(v) => mudarTipo(v as Tipo)}>
          <SelectTrigger size="sm" className="w-full" aria-label="Mudar tipo"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIPOS.map((t, i) => (
              <SelectItem key={t} value={t}>{TIPO_LABEL[t]}{atalhos && <span className="text-muted-foreground"> ({i + 1})</span>}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={el.subtipo ?? ''} onValueChange={(v) => onDecidir('corrigido', { subtipo: v })}>
          <SelectTrigger size="sm" className="w-full" aria-label="Mudar subtipo"><SelectValue placeholder="Subtipo" /></SelectTrigger>
          <SelectContent>
            {subtipos.map((s) => <SelectItem key={s} value={s}>{subtipoLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {(onEditarPosicao || validado) && (
        <div className="flex flex-wrap gap-1">
          {onEditarPosicao && (
            <Button variant={editarPosicao ? 'secondary' : 'ghost'} size="sm" onClick={() => onEditarPosicao(!editarPosicao)}>
              <Move /> {editarPosicao ? 'A corrigir posição…' : 'Corrigir posição'}
            </Button>
          )}
          {validado && (
            <Button variant="ghost" size="sm" onClick={onDesfazer}>
              <Undo2 /> Desfazer
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Corrigir as coordenadas escrevendo-as (complementa o arrastar no mapa). */
export function CoordenadasEditor({ el, onGuardar }: { el: Elemento; onGuardar: (lat: number, lon: number) => void }) {
  const [lat, setLat] = useState(el.lat.toFixed(7))
  const [lon, setLon] = useState(el.lon.toFixed(7))
  const [chave, setChave] = useState(`${el.id}|${el.lat}|${el.lon}`)
  if (chave !== `${el.id}|${el.lat}|${el.lon}`) {
    setChave(`${el.id}|${el.lat}|${el.lon}`)
    setLat(el.lat.toFixed(7))
    setLon(el.lon.toFixed(7))
  }
  const la = Number(lat.replace(',', '.'))
  const lo = Number(lon.replace(',', '.'))
  const valido = Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180
  const mudou = valido && (Math.abs(la - el.lat) > 1e-7 || Math.abs(lo - el.lon) > 1e-7)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault()
        if (mudou) onGuardar(Math.round(la * 1e7) / 1e7, Math.round(lo * 1e7) / 1e7)
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Latitude
          <Input inputMode="decimal" className="h-8 font-mono text-xs" value={lat} onChange={(e) => setLat(e.target.value)} aria-invalid={!valido} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Longitude
          <Input inputMode="decimal" className="h-8 font-mono text-xs" value={lon} onChange={(e) => setLon(e.target.value)} aria-invalid={!valido} />
        </label>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!mudou}>
        <Move /> Guardar coordenadas corrigidas
      </Button>
    </form>
  )
}
