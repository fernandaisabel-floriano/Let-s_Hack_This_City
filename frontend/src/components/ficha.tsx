import { Check, ExternalLink, ImageOff, Move, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { ConfiancaBar, EstadoBadge } from '@/components/badges'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { urlZona } from '@/lib/data'
import { coord, data, pct, subtipoLabel } from '@/lib/format'
import { toLocal } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { METODO_LABEL, SUBTIPOS, TIPOS, TIPO_LABEL, type Elemento, type Tipo, type Validacao } from '@/lib/types'
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

export function titulo(el: Elemento) {
  return el.tipo === 'sinal' && el.subtipo ? subtipoLabel(el.subtipo) : TIPO_LABEL[el.tipo]
}

interface DetalhesProps {
  el: Elemento
  crs: string
  limiar: number
  validacao?: Validacao
  /** mostra os campos técnicos (confiança, método de posição, x/y local) */
  tecnico?: boolean
}

export function Detalhes({ el, crs, limiar, validacao, tecnico }: DetalhesProps) {
  const xy = tecnico ? toLocal(el.lon, el.lat, crs) : null
  const imagem = urlZona(el.imagem)
  return (
    <dl className="divide-y divide-border/60">
      {el.tipo === 'sinal' && el.subtipo && <Campo label="Tipo">{TIPO_LABEL.sinal}</Campo>}
      <Campo label="Estado"><EstadoBadge estado={el.estado} /></Campo>
      {tecnico && validacao?.validado_por && (
        <Campo label="Decidido por">
          {validacao.validado_por.nome}
          <span className="block text-xs text-muted-foreground">{new Date(validacao.validado_em).toLocaleString('pt-PT')}</span>
        </Campo>
      )}
      {tecnico && <Campo label="Confiança"><ConfiancaBar valor={el.confianca} limiar={limiar} /></Campo>}
      {tecnico && el.subtipo_incerto && (
        <Campo label="Subtipo">
          incerto{el.subtipo_motivo ? ` — ${el.subtipo_motivo}` : ''}
          {el.confianca_subtipo != null && <span className="text-muted-foreground"> ({pct(el.confianca_subtipo)})</span>}
        </Campo>
      )}
      <Campo label="Visto em">{el.n_vistas} {el.n_vistas === 1 ? 'imagem' : 'imagens'}</Campo>
      <Campo label="Imagens de">{data(el.primeira_vista)}{el.ultima_vista !== el.primeira_vista && <> a {data(el.ultima_vista)}</>}</Campo>
      <Campo label="Coordenadas">
        <span className="font-mono text-xs">{coord(el.lat)}, {coord(el.lon)}</span>
        {xy && <span className="block font-mono text-xs text-muted-foreground">{crs}: {xy[0].toFixed(1)}, {xy[1].toFixed(1)}</span>}
      </Campo>
      {tecnico && el.metodo_posicao && (
        <Campo label="Posição">
          {METODO_LABEL[el.metodo_posicao] ?? el.metodo_posicao}
          {el.residuo_raios_m != null && <span className="block text-xs text-muted-foreground">resíduo dos raios {el.residuo_raios_m} m{el.ajustado_edificio ? ' · ajustado à fachada' : ''}</span>}
        </Campo>
      )}
      <Campo label="Fonte">
        {el.fonte.split('+').map((f) => (f === 'video_proprio' ? 'vídeo da Câmara' : f === 'mapillary' ? 'Mapillary' : f)).join(', ')}
        {el.atribuicao && <span className="block text-xs text-muted-foreground">{el.atribuicao}</span>}
        {imagem && (
          <a href={imagem} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
            Ver imagem completa <ExternalLink className="size-3" />
          </a>
        )}
      </Campo>
    </dl>
  )
}

interface AcoesProps {
  el: Elemento
  validado: boolean
  onDecidir: (estado: 'validado' | 'corrigido' | 'rejeitado', opts?: DecisaoOpts) => void
  onDesfazer: () => void
  editarPosicao?: boolean
  onEditarPosicao?: (v: boolean) => void
  atalhos?: boolean
}

export function Acoes({ el, validado, onDecidir, onDesfazer, editarPosicao, onEditarPosicao, atalhos }: AcoesProps) {
  const mudarTipo = (t: Tipo) => {
    if (t !== el.tipo) onDecidir('corrigido', { tipo: t, subtipo: t === 'sinal' ? 'outro_sinal' : null })
  }
  const subtipos = [...new Set([...(el.subtipo ? [el.subtipo] : []), ...SUBTIPOS[el.tipo]])]
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button className="bg-success text-white hover:bg-success/90" onClick={() => onDecidir('validado')}>
          <Check /> Confirmar {atalhos && <kbd className="border-white/30">V</kbd>}
        </Button>
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDecidir('rejeitado')}>
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
        <Select value={el.subtipo ?? ''} onValueChange={(v) => onDecidir('corrigido', { subtipo: v })} disabled={el.tipo === 'candeeiro'}>
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
