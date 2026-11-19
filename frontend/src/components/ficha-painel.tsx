import { Lock, X } from 'lucide-react'
import { useState } from 'react'
import { Duplicados } from '@/components/duplicados'
import { Acoes, CoordenadasEditor, Detalhes, Recorte, titulo } from '@/components/ficha'
import { TipoIcon } from '@/components/tipo-icon'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Elemento } from '@/lib/types'
import type { Catalogo } from '@/hooks/use-catalogo'

/** Caixa da deteção que deu o recorte (deteccoes/recortes/<id>.jpg → bbox em deteccoes.json). */
export function bboxDe(cat: Catalogo, el: Elemento) {
  const id = el.recorte?.split('/').pop()?.replace(/\.jpe?g$/i, '')
  return (id && cat.deteccoes?.get(id)?.bbox) || null
}

interface Props {
  cat: Catalogo
  el: Elemento
  onFechar?: () => void
  onPedirLogin?: () => void
  /** mapa: o marcador pode ser arrastado */
  editarPosicao?: boolean
  onEditarPosicao?: (v: boolean) => void
}

/** Ficha completa de um elemento: imagem, ações do técnico, duplicados e detalhes. */
export function FichaPainel({ cat, el, onFechar, onPedirLogin, editarPosicao, onEditarPosicao }: Props) {
  const tecnico = !!cat.tecnico
  const cfg = cat.base!.config
  const [verCoords, setVerCoords] = useState(false)
  const info = cat.imagens?.imagens[el.imagem]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b p-4">
        <TipoIcon tipo={el.tipo} subtipo={el.subtipo} className="size-9" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg leading-tight font-semibold">{titulo(el)}</h2>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{el.id}</span>
            {el.rua && <> · {el.rua}</>}
          </p>
        </div>
        {onFechar && (
          <Button variant="ghost" size="icon-sm" onClick={onFechar} aria-label="Fechar ficha">
            <X aria-hidden="true" />
          </Button>
        )}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <Recorte el={el} className="aspect-[4/3] w-full" />
          {tecnico ? (
            <div data-tour="acoes" className="flex flex-col gap-2">
              <Acoes
                el={el}
                validado={!!cat.validacoes[el.id]}
                onDecidir={(estado, opts) => cat.decidir(el.id, estado, opts)}
                onDesfazer={() => cat.desfazer(el.id)}
                editarPosicao={editarPosicao}
                onEditarPosicao={onEditarPosicao}
                sugestao={cat.sugestoes[el.id]}
              />
              <button className="self-start text-xs text-primary hover:underline" onClick={() => setVerCoords(!verCoords)} aria-expanded={verCoords}>
                {verCoords ? 'Fechar correção de coordenadas' : 'Escrever coordenadas corrigidas'}
              </button>
              {verCoords && <CoordenadasEditor el={el} onGuardar={(lat, lon) => cat.decidir(el.id, 'corrigido', { lat, lon })} />}
            </div>
          ) : (
            el.estado === 'pendente' &&
            onPedirLogin && (
              <button onClick={onPedirLogin} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent">
                <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                Este elemento ainda não foi confirmado por um técnico. É técnico da Câmara? Entre para validar.
              </button>
            )
          )}
          <Duplicados cat={cat} el={el} />
          <Detalhes
            el={el}
            crs={cfg.crs_local}
            limiar={cfg.limiar_auto}
            validacao={cat.validacoes[el.id]}
            tecnico={tecnico}
            sugestao={cat.sugestoes[el.id]}
            imagemInfo={info}
            bbox={tecnico ? bboxDe(cat, el) : null}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
