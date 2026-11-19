import { ExternalLink, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { InfoImagem } from '@/lib/api'
import { urlZona } from '@/lib/data'
import { data, fonteLabel } from '@/lib/format'
import type { Elemento } from '@/lib/types'

/**
 * Imagem de onde veio a deteção (já desfocada: o pipeline nunca grava a versão original),
 * com a caixa do objeto marcada quando é conhecida, a proveniência e a atribuição.
 */
export function ImagemOriginal({ el, info, bbox, children }: { el: Elemento; info?: InfoImagem; bbox?: number[] | null; children: React.ReactNode }) {
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null)
  const src = urlZona(el.imagem)
  if (!src) return null
  const url = info?.url_origem?.startsWith('http') ? info.url_origem : null

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Imagem original</DialogTitle>
          <DialogDescription>
            {fonteLabel(info?.fonte ?? el.fonte.split('+')[0])}
            {info?.captured_at && <> · {data(info.captured_at)}</>}
            {bbox ? ' · a caixa marca o objeto detetado' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-lg bg-muted">
          <img
            src={src}
            alt={`Imagem de origem de ${el.id}`}
            className="block h-auto w-full"
            onLoad={(e) => setTam({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {bbox && tam && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-sm border-2 border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
              style={{
                left: `${(bbox[0] / tam.w) * 100}%`,
                top: `${(bbox[1] / tam.h) * 100}%`,
                width: `${((bbox[2] - bbox[0]) / tam.w) * 100}%`,
                height: `${((bbox[3] - bbox[1]) / tam.h) * 100}%`,
              }}
            />
          )}
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Atribuição</dt>
            <dd>{info?.atribuicao || el.atribuicao || (info?.autor ? `© ${info.autor}` : '—')}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Licença</dt>
            <dd>{info?.licenca || (info?.fonte === 'video_proprio' || info?.fonte === 'fotos' ? 'Câmara Municipal de Aveiro (recolha própria)' : '—')}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Privacidade</dt>
            <dd className="flex items-start gap-1.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>
                Rostos e matrículas desfocados antes de gravar
                {info && info.rostos !== null && (
                  <span className="block text-xs text-muted-foreground">
                    nesta imagem: {info.rostos} rostos, {info.matriculas ?? 0} matrículas, {info.cabecas ?? 0} pessoas
                  </span>
                )}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Origem</dt>
            <dd>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Abrir na plataforma de origem <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="text-muted-foreground">{info?.url_origem ? 'recolha própria' : '—'}</span>
              )}
              {info?.coord_fonte && <span className="block text-xs text-muted-foreground">posição da câmara: {info.coord_fonte}{info.heading_fonte ? ` · direção: ${info.heading_fonte}` : ''}</span>}
            </dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  )
}
