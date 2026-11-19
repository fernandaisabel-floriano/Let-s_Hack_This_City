import { Copy, Eye, Split, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Recorte, titulo } from '@/components/ficha'
import { Button } from '@/components/ui/button'
import { urlZona } from '@/lib/data'
import { data } from '@/lib/format'
import { semelhancaVisual } from '@/lib/semelhanca'
import type { Elemento } from '@/lib/types'

/** Semelhança visual entre os recortes de dois elementos (indicativa). */
function Semelhanca({ a, b }: { a: Elemento; b: Elemento }) {
  const [v, setV] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    const ua = urlZona(a.recorte)
    const ub = urlZona(b.recorte)
    if (!ua || !ub) return setV(null)
    let vivo = true
    semelhancaVisual(ua, ub).then((x) => vivo && setV(x))
    return () => {
      vivo = false
    }
  }, [a.recorte, b.recorte])
  if (v === undefined || v === null) return null
  const nivel = v >= 0.8 ? 'alta' : v >= 0.6 ? 'média' : 'baixa'
  return (
    <span className="inline-flex items-center gap-1" title="Comparação das cores dos dois recortes; indicativa (ângulos e luz diferentes alteram-na)">
      <Eye className="size-3" aria-hidden="true" /> semelhança visual {nivel} ({Math.round(v * 100)} %)
    </span>
  )
}

const periodo = (e: Elemento) => (e.primeira_vista.slice(0, 10) === e.ultima_vista.slice(0, 10) ? data(e.primeira_vista) : `${data(e.primeira_vista)} a ${data(e.ultima_vista)}`)
import type { Catalogo } from '@/hooks/use-catalogo'

function metros(d: number | null) {
  return d === null ? '' : ` · a ${String(d).replace('.', ',')} m`
}

/**
 * Duplicados de um elemento:
 *  - possíveis (por decidir): mostra só a imagem do OUTRO elemento, para comparar com a
 *    que já está na ficha, e pergunta se é o mesmo objeto;
 *  - fundidos: lista os que foram juntados neste, com a opção de separar (técnicos).
 */
export function Duplicados({ cat, el, compacto }: { cat: Catalogo; el: Elemento; compacto?: boolean }) {
  const tecnico = !!cat.tecnico
  const possiveis = tecnico ? cat.duplicados.paresDe(el.id) : []
  const fundidos = cat.duplicados.fundidosEm(el.id)
  if (!possiveis.length && !fundidos.length) return null

  return (
    <div className="flex flex-col gap-3">
      {possiveis.map((p) => (
        <section key={p.outro.id} className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <header className="flex items-start gap-2">
            <Copy className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">Possível duplicado</p>
              <p className="text-xs text-muted-foreground">
                {titulo(p.outro)} <span className="font-mono">{p.outro.id}</span>
                {metros(p.dist_m)}
                {p.iou !== undefined ? ' · aparecem sobrepostos na mesma foto' : ' · nunca aparecem na mesma foto'}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <Semelhanca a={el} b={p.outro} />
                <span>este: {periodo(el)} · outro: {periodo(p.outro)}</span>
              </p>
            </div>
          </header>
          <Recorte el={p.outro} className={compacto ? 'aspect-video w-full' : 'aspect-[4/3] w-full'} />
          <p className="text-xs text-muted-foreground">É o mesmo objeto que o da imagem de cima?</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => cat.decidirPar(el.id, p.outro.id, true)}>
              <Copy /> É o mesmo
            </Button>
            <Button size="sm" variant="outline" onClick={() => cat.decidirPar(el.id, p.outro.id, false)}>
              <X /> São diferentes
            </Button>
          </div>
        </section>
      ))}

      {fundidos.length > 0 && (
        <section className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Copy className="size-4 text-muted-foreground" />
            {fundidos.length === 1 ? 'Junta 2 deteções do mesmo objeto' : `Junta ${fundidos.length + 1} deteções do mesmo objeto`}
          </p>
          {tecnico && (
            <ul className="flex flex-col gap-1">
              {fundidos.map((f) => (
                <li key={f.el.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">{f.el.id}</span>
                    {metros(f.dist_m)}
                    {f.automatico ? ' · automático' : ' · decidido por técnico'}
                  </span>
                  <Button variant="ghost" size="xs" onClick={() => cat.decidirPar(el.id, f.el.id, false)}>
                    <Split /> Separar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
