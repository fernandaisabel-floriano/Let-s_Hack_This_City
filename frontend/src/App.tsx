import { FlaskConical, LogIn, Menu, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AppSidebar, VISTAS, type Vista } from '@/components/app-sidebar'
import { LoginDialog } from '@/components/login'
import { TabExportar } from '@/components/tab-exportar'
import { TabFila } from '@/components/tab-fila'
import { TabMapa } from '@/components/tab-mapa'
import { TabPainel } from '@/components/tab-painel'
import { TabRegisto } from '@/components/tab-registo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
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

function lerVista(): Vista {
  const h = window.location.hash.slice(1)
  return VISTAS.some((v) => v.id === h) ? (h as Vista) : 'mapa'
}

/** Botão do menu com texto, para se perceber que há uma barra lateral. */
function BotaoMenu() {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar()
  const aberto = isMobile ? openMobile : open
  return (
    <Button variant="ghost" size="sm" onClick={toggleSidebar} aria-expanded={aberto} className="-ml-1 gap-2">
      <Menu />
      <span className="hidden sm:inline">Menu</span>
    </Button>
  )
}

export default function App() {
  const sessao = useSessao()
  const tecnico = sessao.estado.tipo === 'autenticado' ? sessao.estado.tecnico : null
  const cat = useCatalogo(tecnico, sessao.expirou)
  const [escuro, alternarTema] = useTema()
  const [vista, setVistaState] = useState<Vista>(lerVista)
  const [login, setLogin] = useState<{ aberto: boolean; destino?: Vista; motivo?: string }>({ aberto: false })

  useEffect(() => {
    const onHash = () => setVistaState(lerVista())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const irPara = useCallback((v: Vista) => {
    if (window.location.hash.slice(1) !== v) window.location.hash = v
    setVistaState(v)
  }, [])

  const info = VISTAS.find((v) => v.id === vista)!
  const restritoSemSessao = !!info.restrito && !tecnico && sessao.estado.tipo !== 'a-carregar'

  // vista de técnico sem sessão (link direto ou sessão expirada): volta ao mapa e pede login
  useEffect(() => {
    if (restritoSemSessao) {
      setLogin({ aberto: true, destino: vista, motivo: `${info.titulo} é reservada a técnicos da Câmara.` })
      irPara('mapa')
    }
  }, [restritoSemSessao, vista, info.titulo, irPara])

  const escolherVista = (v: Vista) => {
    const alvo = VISTAS.find((x) => x.id === v)!
    if (alvo.restrito && !tecnico) setLogin({ aberto: true, destino: v, motivo: `${alvo.titulo} é reservada a técnicos da Câmara.` })
    else irPara(v)
  }

  const depoisDoLogin = async (fn: () => Promise<void>) => {
    await fn()
    const destino = login.destino
    setLogin({ aberto: false })
    if (destino) irPara(destino)
  }

  const sair = async () => {
    await sessao.sair()
    if (info.restrito) irPara('mapa')
  }

  if (sessao.estado.tipo === 'a-carregar' || !cat.base) {
    return (
      <div className="flex h-svh gap-3 p-3">
        <Skeleton className="hidden h-full w-12 md:block" />
        <Skeleton className="h-full flex-1" />
      </div>
    )
  }

  const mostrar: Vista = info.restrito && !tecnico ? 'mapa' : vista

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar
        cat={cat}
        vista={mostrar}
        onVista={escolherVista}
        escuro={escuro}
        onTema={alternarTema}
        onEntrar={() => setLogin({ aberto: true })}
        onSair={sair}
      />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3">
          <BotaoMenu />
          <div className="h-5 w-px bg-border" />
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-base font-semibold">{VISTAS.find((v) => v.id === mostrar)!.titulo}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{VISTAS.find((v) => v.id === mostrar)!.descricao}</p>
          </div>
          {cat.origem !== 'pipeline' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <FlaskConical /> {cat.origem === 'demo' ? 'Demonstração' : cat.nomeFicheiro}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {cat.origem === 'demo' ? 'Dados gerados para demonstração: não são deteções reais.' : 'Ficheiro carregado neste browser.'}
              </TooltipContent>
            </Tooltip>
          )}
          {!tecnico && (
            <>
              <Button variant="ghost" size="icon-sm" onClick={alternarTema} aria-label={escuro ? 'Tema claro' : 'Tema escuro'}>
                {escuro ? <Sun /> : <Moon />}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLogin({ aberto: true })}>
                <LogIn /> <span className="hidden sm:inline">Área do técnico</span>
              </Button>
            </>
          )}
        </header>

        {cat.erro && <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{cat.erro}</div>}

        <main className={mostrar === 'mapa' ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto'}>
          {mostrar === 'mapa' && <TabMapa key={tecnico ? 't' : 'p'} cat={cat} escuro={escuro} onPedirLogin={() => setLogin({ aberto: true })} />}
          {mostrar === 'fila' && <div className="h-full p-4"><TabFila cat={cat} escuro={escuro} /></div>}
          {mostrar === 'painel' && <div className="mx-auto max-w-6xl p-4 sm:p-6"><TabPainel cat={cat} /></div>}
          {mostrar === 'exportar' && <div className="mx-auto max-w-6xl p-4 sm:p-6"><TabExportar cat={cat} /></div>}
          {mostrar === 'registo' && <div className="mx-auto max-w-6xl p-4 sm:p-6"><TabRegisto cat={cat} /></div>}
        </main>
      </SidebarInset>

      <LoginDialog
        open={login.aberto}
        onOpenChange={(v) => setLogin((l) => ({ ...l, aberto: v }))}
        motivo={login.motivo}
        primeiraConta={sessao.estado.tipo === 'anonimo' && sessao.estado.primeiraConta}
        semServidor={sessao.estado.tipo === 'sem-servidor'}
        onEntrar={(u, p) => depoisDoLogin(() => sessao.entrar(u, p))}
        onCriar={(u, n, p) => depoisDoLogin(() => sessao.criarPrimeira(u, n, p))}
      />
    </SidebarProvider>
  )
}
