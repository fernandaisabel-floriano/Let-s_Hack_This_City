import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Visita guiada: destaca, um a um, os elementos marcados com data-tour="…".
 * Passos cujo alvo não está no ecrã são saltados.
 */
export interface Passo {
  alvo: string
  titulo: string
  texto: string
}

export const PASSOS_PUBLICO: Passo[] = [
  { alvo: 'menu', titulo: 'Navegação', texto: 'Na barra de cima: Mapa, Dashboard com os números do inventário, Catálogo, Exportação e a área do técnico.' },
  { alvo: 'pesquisa', titulo: 'Procurar', texto: 'Escreva um tipo de sinal (ex.: "stop") ou o identificador de um elemento.' },
  { alvo: 'filtros', titulo: 'Filtros e legenda', texto: 'Escolha o que ver: sinais, candeeiros, contentores, e se quer incluir os que ainda estão por confirmar. A legenda explica as cores dos marcadores.' },
  { alvo: 'exportar', titulo: 'Transferir', texto: 'Descarregue em GeoJSON ou CSV o que está no mapa, ou o catálogo completo, sem mudar de vista.' },
  { alvo: 'mapa', titulo: 'Os marcadores', texto: 'Cada ícone é um elemento. O ponto colorido indica a confiança da deteção (azul-tinta alta, azul-petróleo média, vermelho-escuro baixa) e "+N" diz que vários duplicados foram juntados num só. Clique para abrir a ficha com a fotografia.' },
  { alvo: 'tecnico', titulo: 'Área do técnico', texto: 'Os técnicos da Câmara entram aqui para validar as deteções duvidosas, corrigir posições e ver o registo.' },
]

export const PASSOS_TECNICO: Passo[] = [
  { alvo: 'nav-deteccoes', titulo: 'Deteções e validação', texto: 'A fila com as deteções duvidosas, as posições a rever e os possíveis duplicados; ou todas em grelha. Atalhos na fila: V confirmar, X rejeitar, 1/2/3 mudar o tipo, Z desfazer.' },
  { alvo: 'nav-importacao', titulo: 'Importação', texto: 'Importe fotografias ou vídeos gravados na rua, ou recolha do Mapillary. O processamento corre no servidor e os resultados entram na fila.' },
  { alvo: 'nav-registo', titulo: 'Registo', texto: 'Quem validou o quê, e quando. Cada decisão fica com o seu nome.' },
  { alvo: 'mapa', titulo: 'Corrigir no mapa', texto: 'Abra a ficha de um elemento para o confirmar, rejeitar ou mudar de tipo. Em "Corrigir posição", arraste o marcador para o sítio certo.' },
  { alvo: 'filtros', titulo: 'Filtros de técnico', texto: 'Como técnico pode filtrar por estado (incluindo rejeitados) e por confiança mínima.' },
]

/** o primeiro elemento visível com esse alvo (a navegação existe em menu e em barra, conforme a largura) */
function alvoVisivel(alvo: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${alvo}"]`)].find((el) => el.getClientRects().length > 0) ?? null
}

interface Props {
  aberto: boolean
  passos: Passo[]
  onFechar: () => void
}

export function Tour({ aberto, passos, onFechar }: Props) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cartao = useRef<HTMLDivElement>(null)
  const visiveis = passos.filter((p) => !aberto || alvoVisivel(p.alvo))
  const passo = visiveis[i]

  const medir = useCallback(() => {
    const el = passo && alvoVisivel(passo.alvo)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [passo])

  useLayoutEffect(() => {
    if (!aberto) return
    medir()
    cartao.current?.focus()
  }, [aberto, medir, i])

  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, visiveis.length - 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('resize', medir)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('keydown', onKey)
    }
  }, [aberto, medir, onFechar, visiveis.length])

  useEffect(() => {
    if (aberto) setI(0)
  }, [aberto])

  if (!aberto || !passo || !rect) return null

  // destaque: o retângulo do alvo (limitado ao ecrã, para alvos grandes como o mapa)
  const m = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  const grande = rect.height > vh * 0.5
  const box = {
    left: Math.max(rect.left - m, 4),
    top: Math.max(rect.top - m, 4),
    width: Math.min(rect.width + 2 * m, vw - 8),
    height: Math.min(rect.height + 2 * m, vh - 8),
  }
  // cartão: por baixo do alvo; se não couber, por cima; alvos grandes: centrado
  const W = Math.min(340, vw - 24)
  const left = grande ? (vw - W) / 2 : Math.min(Math.max(rect.left, 12), vw - W - 12)
  const abaixo = rect.bottom + 12
  const top = grande ? vh / 2 - 90 : abaixo + 180 < vh ? abaixo : Math.max(rect.top - 192, 12)
  const ultimo = i === visiveis.length - 1

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      <div className="absolute inset-0" onClick={onFechar} />
      <div
        className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
        style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
      />
      <div
        ref={cartao}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-titulo"
        aria-describedby="tour-texto"
        className="absolute flex flex-col gap-3 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none"
        style={{ left, top, width: W }}
      >
        <p className="text-xs text-muted-foreground">
          {i + 1} de {visiveis.length}
        </p>
        <h2 id="tour-titulo" className="text-base font-semibold">{passo.titulo}</h2>
        <p id="tour-texto" className="text-sm text-muted-foreground">{passo.texto}</p>
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={onFechar}>Saltar</Button>
          <div className="flex gap-2">
            {i > 0 && <Button variant="outline" size="sm" onClick={() => setI(i - 1)}>Anterior</Button>}
            <Button size="sm" onClick={() => (ultimo ? onFechar() : setI(i + 1))}>{ultimo ? 'Concluir' : 'Seguinte'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mostra a visita uma vez por tipo de utilizador (guarda no browser). */
export function useTourVisto(chave: string) {
  const ler = () => {
    try {
      return localStorage.getItem(`ctrlf:tour:${chave}`) === '1'
    } catch {
      return true
    }
  }
  const marcar = () => {
    try {
      localStorage.setItem(`ctrlf:tour:${chave}`, '1')
    } catch {
      /* sem armazenamento: volta a aparecer, sem problema */
    }
  }
  return { visto: ler, marcar }
}
