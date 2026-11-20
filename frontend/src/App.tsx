import { CircleHelp, FlaskConical, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { VISTAS, VISTA_ALIAS, type Vista } from '@/components/app-sidebar'
import { AtualizarDados } from '@/components/atualizar-dados'
import { EcraEntrada } from '@/components/ecra-entrada'
import { BarraSuperior, botaoBarra } from '@/components/barra-superior'
import { PaginaLogin } from '@/components/pagina-login'
import { TabCatalogo } from '@/components/tab-catalogo'
import { TabDashboard } from '@/components/tab-dashboard'
import { TabDeteccoes } from '@/components/tab-deteccoes'
import { TabExportar } from '@/components/tab-exportar'
import { TabImportacao } from '@/components/tab-importacao'
import { TabMapa } from '@/components/tab-mapa'
import { TabRegisto } from '@/components/tab-registo'
import { PASSOS_PUBLICO, PASSOS_TECNICO, Tour, useTourVisto } from '@/components/tour'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCatalogo } from '@/hooks/use-catalogo'
import { useSessao } from '@/hooks/use-sessao'

function temaInicial() {
  let escuro = false
  try {
    const v = localStorage.getItem('ctrlf:tema')
    escuro = v ? v === 'escuro' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  } catch {
    /* ignore */
  }
  document.documentElement.classList.toggle('dark', escuro)
  return escuro
}

function useTema() {
  const [escuro, setEscuro] = useState(temaInicial)
  const alternar = useCallback(() => {
    setEscuro((e) => {
      const novo = !e
      // aplica já, para o mapa ler as cores certas no mesmo render
      document.documentElement.classList.toggle('dark', novo)
      try {
        localStorage.setItem('ctrlf:tema', novo ? 'escuro' : 'claro')
      } catch {
        /* ignore */
      }
      return novo
    })
  }, [])
  return [escuro, alternar] as const
}

type Rota = Vista | 'login'

function lerRota(): Rota {
  const h = window.location.hash.slice(1)
  if (h === 'login') return 'login'
  if (VISTA_ALIAS[h]) return VISTA_ALIAS[h]
  return VISTAS.some((v) => v.id === h) ? (h as Vista) : 'mapa'
}

export default function App() {
  const sessao = useSessao()
  const tecnico = sessao.estado.tipo === 'autenticado' ? sessao.estado.tecnico : null
  const cat = useCatalogo(tecnico, sessao.expirou)
  const [escuro, alternarTema] = useTema()
  const [rota, setRota] = useState<Rota>(lerRota)
  /** para onde ir depois de entrar, e porquê se pediu o login */
  const [login, setLogin] = useState<{ destino?: Vista; motivo?: string }>({})
  const [tour, setTour] = useState(false)
  /** ecrã de entrada: setup do município, sempre que a app abre (protótipo: não grava nada) */
  const [entrou, setEntrou] = useState(false)
  const tourChave = tecnico ? 'tecnico' : 'publico'
  const tourVisto = useTourVisto(tourChave)
  const pronto = entrou && sessao.estado.tipo !== 'a-carregar' && !!cat.base

  useEffect(() => {
    const onHash = () => setRota(lerRota())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const irPara = useCallback((r: Rota) => {
    if (window.location.hash.slice(1) !== r) window.location.hash = r
    setRota(r)
  }, [])

  const pedirLogin = useCallback(
    (destino?: Vista) => {
      const v = destino && VISTAS.find((x) => x.id === destino)
      setLogin({ destino, motivo: v ? `«${v.titulo}» é reservada a técnicos.` : undefined })
      irPara('login')
    },
    [irPara],
  )

  const info = rota === 'login' ? null : VISTAS.find((v) => v.id === rota)!
  const restritoSemSessao = !!info?.restrito && !tecnico && sessao.estado.tipo !== 'a-carregar'

  // vista de técnico sem sessão (ligação direta ou sessão expirada): pede login e volta depois
  useEffect(() => {
    if (restritoSemSessao && info) pedirLogin(info.id)
  }, [restritoSemSessao, info, pedirLogin])

  // já autenticado e na página de login (ex.: botão "voltar" do browser): segue para o destino
  useEffect(() => {
    if (rota === 'login' && tecnico) irPara(login.destino ?? 'dashboard')
  }, [rota, tecnico, login.destino, irPara])

  // primeira visita (público) ou primeiro login (técnico): mostra a visita guiada uma vez
  useEffect(() => {
    if (!pronto || rota !== 'mapa' || tourVisto.visto()) return
    const t = window.setTimeout(() => setTour(true), 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando muda o tipo de utilizador
  }, [pronto, tourChave])
  const fecharTour = useCallback(() => {
    setTour(false)
    tourVisto.marcar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourChave])

  const escolherVista = (v: Vista) => {
    const alvo = VISTAS.find((x) => x.id === v)!
    if (alvo.restrito && !tecnico) pedirLogin(v)
    else irPara(v)
  }

  const depoisDoLogin = async (fn: () => Promise<void>) => {
    await fn()
    const destino = login.destino ?? 'dashboard'
    setLogin({})
    irPara(destino)
  }

  const sair = async () => {
    await sessao.sair()
    if (info?.restrito) irPara('mapa')
  }

  if (!entrou) {
    return (
      <EcraEntrada
        onConcluir={() => {
          // protótipo: os dados do município não vão para o servidor; abre a app com o config real
          setEntrou(true)
        }}
      />
    )
  }

  if (!pronto) {
    return (
      <div className="flex h-svh flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-destaque bg-card px-4">
          <span className="font-marca text-2xl leading-none font-semibold text-titulo">
            Mape<span className="text-marca">ya</span>
          </span>
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="relative flex-1 bg-muted">
          <div className="absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
            <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />A carregar a plataforma…
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (rota === 'login' && !tecnico) {
    return (
      <PaginaLogin
        motivo={login.motivo}
        primeiraConta={sessao.estado.tipo === 'anonimo' && sessao.estado.primeiraConta}
        semServidor={sessao.estado.tipo === 'sem-servidor'}
        onEntrar={(u, p) => depoisDoLogin(() => sessao.entrar(u, p))}
        onCriar={(u, n, p) => depoisDoLogin(() => sessao.criarPrimeira(u, n, p))}
        onVoltar={() => {
          setLogin({})
          irPara('mapa')
        }}
      />
    )
  }

  const mostrar: Vista = !info || (info.restrito && !tecnico) ? 'mapa' : info.id
  const v = VISTAS.find((x) => x.id === mostrar)!
  const ecraInteiro = mostrar === 'mapa'
  const contentor = 'mx-auto w-full max-w-[1400px] p-4 sm:p-6'

  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden">
      <BarraSuperior cat={cat} vista={mostrar} onVista={escolherVista} escuro={escuro} onTema={alternarTema} onEntrar={() => pedirLogin()} onSair={sair}>
        {cat.origem !== 'pipeline' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="h-8 gap-1 font-normal">
                <FlaskConical aria-hidden="true" /> {cat.origem === 'demo' ? 'Dados fictícios de demonstração' : cat.nomeFicheiro}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {cat.origem === 'demo' ? 'Não foi encontrado o catálogo do pipeline: estes dados são gerados e não são deteções reais.' : 'Ficheiro carregado neste browser.'}
            </TooltipContent>
          </Tooltip>
        )}
        <AtualizarDados cat={cat} onEntrar={() => pedirLogin()} />
        {mostrar === 'mapa' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={botaoBarra} onClick={() => setTour(true)} aria-label="Ajuda: visita guiada">
                <CircleHelp aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Visita guiada</TooltipContent>
          </Tooltip>
        )}
      </BarraSuperior>
      <h1 className="sr-only">{v.titulo}: {v.descricao}</h1>

        {cat.erro && (
          <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {cat.erro}
          </div>
        )}

        <main className={ecraInteiro ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto bg-background'}>
          {mostrar === 'mapa' && <TabMapa key={tecnico ? 't' : 'p'} cat={cat} escuro={escuro} onPedirLogin={() => pedirLogin('deteccoes')} />}
          {mostrar === 'dashboard' && <div className={contentor}><TabDashboard cat={cat} onIr={escolherVista} /></div>}
          {mostrar === 'catalogo' && <div className={`${contentor} h-full`}><TabCatalogo cat={cat} onPedirLogin={() => pedirLogin('deteccoes')} /></div>}
          {mostrar === 'exportar' && <div className={contentor}><TabExportar cat={cat} /></div>}
          {mostrar === 'deteccoes' && <div className={`${contentor} h-full`}><TabDeteccoes cat={cat} escuro={escuro} /></div>}
          {mostrar === 'importacao' && <div className={contentor}><TabImportacao cat={cat} /></div>}
          {mostrar === 'registo' && <div className={contentor}><TabRegisto cat={cat} /></div>}
        </main>

      <Tour aberto={tour && mostrar === 'mapa'} passos={tecnico ? PASSOS_TECNICO : PASSOS_PUBLICO} onFechar={fecharTour} />
    </div>
  )
}
