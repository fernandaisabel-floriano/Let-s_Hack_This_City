import { Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { atualizarDados } from '@/lib/api'
import { urlZona } from '@/lib/data'
import type { Catalogo } from '@/hooks/use-catalogo'

type Fase = { f: 'confirmar' } | { f: 'a-correr' } | { f: 'fim'; mensagem: string } | { f: 'erro'; mensagem: string }

function dataHora(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * "Atualizar dados" (barra superior). Objetivo futuro: procurar no Mapillary imagens novas da zona
 * desde a última recolha, correr o pipeline só sobre elas e juntar o resultado ao catálogo, sem
 * mexer nas validações do técnico. Por agora é só a interface: o servidor (POST /api/atualizar)
 * responde que ainda não está implementado e a mensagem final di-lo, sem resultados inventados.
 */
export function AtualizarDados({ cat, onEntrar, className }: { cat: Catalogo; onEntrar: () => void; className?: string }) {
  const [aberto, setAberto] = useState(false)
  const [fase, setFase] = useState<Fase>({ f: 'confirmar' })
  const [gerado, setGerado] = useState<string | null>(null)

  // data do catálogo atual (catalogo/resumo.json, público); sem ficheiro fica "—"
  useEffect(() => {
    if (cat.origem !== 'pipeline') return setGerado(null)
    let vivo = true
    fetch(urlZona('catalogo/resumo.json')!)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { gerado_em?: string } | null) => vivo && setGerado(j?.gerado_em ?? null))
      .catch(() => vivo && setGerado(null))
    return () => {
      vivo = false
    }
  }, [cat.origem, cat.base])

  // imagem mais recente já no catálogo: é a partir daqui que uma atualização procuraria imagens novas
  const imagemMaisRecente = useMemo(() => {
    if (cat.origem !== 'pipeline') return null
    let m: string | null = null
    for (const e of cat.elementos) if (e.ultima_vista && (!m || e.ultima_vista > m)) m = e.ultima_vista
    return m
  }, [cat.elementos, cat.origem])

  const ultima = dataHora(gerado)
  const abrir = () => {
    if (!cat.tecnico) return onEntrar()
    setFase({ f: 'confirmar' })
    setAberto(true)
  }

  const correr = async () => {
    setFase({ f: 'a-correr' })
    const minimo = new Promise((r) => setTimeout(r, 600)) // o indicador não pisca
    try {
      const [r] = await Promise.all([atualizarDados(), minimo])
      setFase({ f: 'fim', mensagem: r.mensagem })
    } catch (e) {
      await minimo
      setFase({ f: 'erro', mensagem: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={abrir}
            className={`h-11 gap-2 bg-destaque px-3 text-destaque-foreground hover:bg-destaque/90 focus-visible:ring-realce ${className ?? ''}`}
            aria-label={`Atualizar dados. Última atualização: ${ultima}`}
          >
            <RefreshCw aria-hidden="true" />
            <span className="hidden sm:inline">Atualizar dados</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Última atualização: {ultima}
          {!cat.tecnico && ' · reservado a técnicos'}
        </TooltipContent>
      </Tooltip>
      <span className="hidden text-xs leading-tight text-muted-foreground 2xl:block">
        Última atualização
        <br />
        <span className="text-foreground">{ultima}</span>
      </span>

      <Dialog open={aberto} onOpenChange={(v) => fase.f !== 'a-correr' && setAberto(v)}>
        <DialogContent className="rounded-md sm:max-w-md" showCloseButton={fase.f !== 'a-correr'}>
          <DialogHeader>
            <DialogTitle>Atualizar dados da zona</DialogTitle>
            <DialogDescription>Última atualização do catálogo: {ultima}</DialogDescription>
          </DialogHeader>

          {fase.f === 'confirmar' && (
            <div className="flex flex-col gap-2 text-sm">
              <p>A plataforma vai:</p>
              <ol className="ml-5 list-decimal space-y-1">
                <li>procurar no Mapillary imagens novas desta zona{imagemMaisRecente ? ` posteriores a ${dataHora(imagemMaisRecente)}` : ''};</li>
                <li>desfocar rostos e matrículas e analisar só essas imagens;</li>
                <li>juntar ao catálogo os elementos novos ou alterados, que vão para a fila de validação.</li>
              </ol>
              <p className="text-muted-foreground">As validações já feitas pelos técnicos mantêm-se: nenhuma decisão é apagada.</p>
            </div>
          )}

          {fase.f === 'a-correr' && (
            <div role="status" aria-live="polite" className="flex flex-col gap-3 py-2">
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /> A contactar o servidor…
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-realce" />
              </div>
            </div>
          )}

          {fase.f === 'fim' && (
            <p role="status" className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> {fase.mensagem}
            </p>
          )}

          {fase.f === 'erro' && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Não foi possível contactar o servidor: {fase.mensagem}. Os dados não foram alterados.
            </p>
          )}

          <DialogFooter className="rounded-b-md">
            {fase.f === 'confirmar' ? (
              <>
                <Button variant="outline" className="h-11" onClick={() => setAberto(false)}>Cancelar</Button>
                <Button className="h-11 gap-2" onClick={correr}>
                  <RefreshCw aria-hidden="true" /> Atualizar agora
                </Button>
              </>
            ) : (
              <Button className="h-11" disabled={fase.f === 'a-correr'} onClick={() => setAberto(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
