import { Check, Flag } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MOTIVOS_TICKET, MOTIVO_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { Catalogo } from '@/hooks/use-catalogo'

/** Já avisados nesta sessão do browser (para não repetir o aviso no mesmo elemento). */
const enviados = new Set<string>()

/**
 * Vista da Câmara (sem sessão): avisar o técnico de um problema num elemento. O aviso fica no registo
 * (acao "ticket") e o elemento volta à fila do técnico até à decisão seguinte.
 */
export function ReportarProblema({ cat, id }: { cat: Catalogo; id: string }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [aEnviar, setAEnviar] = useState(false)
  const [, setVersao] = useState(0)

  if (enviados.has(id))
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3.5 text-success" aria-hidden="true" /> Aviso enviado. Um técnico vai rever este elemento.
      </p>
    )

  if (!aberto)
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setAberto(true)}>
        <Flag aria-hidden="true" /> Reportar um problema
      </Button>
    )

  const enviar = async () => {
    if (!motivo) return
    setAEnviar(true)
    try {
      await cat.reportar(id, motivo, texto)
      enviados.add(id)
      setVersao((v) => v + 1)
      toast.success('Aviso enviado ao técnico')
    } catch (e) {
      toast.error(`O aviso não foi enviado: ${e instanceof Error ? e.message : e}`)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" role="group" aria-label="Reportar um problema">
      <p className="text-sm font-medium">O que está errado?</p>
      <div className="flex flex-wrap gap-1.5">
        {MOTIVOS_TICKET.map((m) => (
          <button
            key={m}
            onClick={() => setMotivo(m)}
            aria-pressed={motivo === m}
            className={cn('rounded-full border px-2.5 py-1 text-xs hover:bg-accent', motivo === m && 'border-primary bg-primary/10 text-primary')}
          >
            {MOTIVO_LABEL[m]}
          </button>
        ))}
      </div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, 500))}
        rows={2}
        aria-label="Descrição do problema"
        placeholder={motivo === 'outro' ? 'Descreva o problema' : 'Detalhes (opcional)'}
        className="w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>Cancelar</Button>
        <Button size="sm" onClick={enviar} disabled={!motivo || (motivo === 'outro' && !texto.trim()) || aEnviar}>
          {aEnviar ? 'A enviar…' : 'Enviar ao técnico'}
        </Button>
      </div>
    </div>
  )
}
