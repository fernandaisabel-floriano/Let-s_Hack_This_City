import { Check, ChevronDown, Database, FlaskConical, FolderOpen, Lock, LogIn, LogOut, Menu, Moon, Sun, Upload } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { VISTAS, type Vista } from '@/components/app-sidebar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import pin from '@/assets/mapeya-pin.png'
import { iniciais } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Catalogo } from '@/hooks/use-catalogo'

interface Props {
  cat: Catalogo
  vista: Vista
  onVista: (v: Vista) => void
  escuro: boolean
  onTema: () => void
  onEntrar: () => void
  onSair: () => void
  /** controlos extra à direita (aviso de dados de demonstração, ajuda, atualizar dados) */
  children?: ReactNode
}

/** botão da barra superior (branca): texto #37474F, área de toque de 44 px */
export const botaoBarra = 'h-11 min-w-11 text-foreground hover:bg-muted hover:text-titulo focus-visible:ring-realce aria-expanded:bg-muted'

/**
 * Barra superior (substitui a barra lateral): marca, navegação, controlos e sessão. A zona está no mapa (zona-seletor.tsx).
 * Abaixo de 1280 px a navegação passa para um menu; abaixo de 640 px a barra parte em duas linhas.
 */
export function BarraSuperior({ cat, vista, onVista, escuro, onTema, onEntrar, onSair, children }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const t = cat.tecnico
  const pendentes = cat.elementos.filter((e) => e.estado === 'pendente').length
  const atual = VISTAS.find((v) => v.id === vista)!

  const marcaPendentes = (v: Vista) =>
    v === 'deteccoes' && t && pendentes > 0 ? (
      <span className="rounded-full border px-1.5 text-[11px] leading-5 font-semibold text-titulo tabular-nums">
        {pendentes}
        <span className="sr-only"> por validar</span>
      </span>
    ) : null

  const item = (v: (typeof VISTAS)[number]) => {
    const ativo = vista === v.id
    return (
      <button
        key={v.id}
        type="button"
        data-tour={`nav-${v.id}`}
        aria-current={ativo ? 'page' : undefined}
        onClick={() => onVista(v.id)}
        title={v.restrito && !t ? `${v.titulo} (reservado a técnicos)` : v.descricao}
        className={cn(
          'relative flex h-14 shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-foreground uppercase outline-none hover:text-black focus-visible:ring-2 focus-visible:ring-realce focus-visible:ring-inset dark:hover:text-white',
          ativo && 'text-black dark:text-white',
        )}
      >
        {/* item ativo: texto #000000 e sublinhado de 2 px #F47A3A a 6 px por baixo do texto (no tema escuro, texto claro) */}
        <span className={cn('relative', ativo && 'after:absolute after:inset-x-0 after:top-[calc(100%+6px)] after:h-[2px] after:bg-destaque')}>{v.titulo}</span>
        {v.restrito && !t && (
          <>
            <Lock className="size-3.5 opacity-80" aria-hidden="true" />
            <span className="sr-only">(reservado a técnicos)</span>
          </>
        )}
        {marcaPendentes(v.id)}
      </button>
    )
  }

  return (
    <header className="shrink-0 border-b-2 border-destaque bg-card text-foreground">
      <div className="flex min-h-14 flex-wrap items-center gap-x-1 px-2 sm:gap-x-2 sm:px-4">
        <div className="mr-1 flex min-w-0 items-center gap-2 py-2 sm:mr-3">
          <img src={pin} alt="" className="h-8 w-auto" />
          <span className="font-marca text-2xl leading-none font-semibold tracking-tight text-titulo">
            Mape<span className="text-marca">ya</span>
          </span>
        </div>

        {/* navegação compacta (< 1280 px) */}
        <div className="xl:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-tour="menu" variant="ghost" className={cn(botaoBarra, 'gap-2 px-3')} aria-label={`Menu de navegação; página atual: ${atual.titulo}`}>
                <Menu aria-hidden="true" />
                <span className="max-w-[9rem] truncate">{atual.titulo}</span>
                <ChevronDown className="opacity-80" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Gestão</DropdownMenuLabel>
              {VISTAS.filter((v) => !v.restrito).map((v) => (
                <DropdownMenuItem key={v.id} className="min-h-11" onSelect={() => onVista(v.id)} aria-current={vista === v.id ? 'page' : undefined}>
                  <v.icon aria-hidden="true" /> {v.titulo}
                  {vista === v.id && <Check className="ml-auto" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Área do técnico</DropdownMenuLabel>
              {VISTAS.filter((v) => v.restrito).map((v) => (
                <DropdownMenuItem key={v.id} className="min-h-11" onSelect={() => onVista(v.id)} aria-current={vista === v.id ? 'page' : undefined}>
                  <v.icon aria-hidden="true" /> {v.titulo}
                  {v.restrito && !t && <Lock className="ml-auto size-3.5 opacity-60" aria-label="reservado a técnicos" />}
                  {v.id === 'deteccoes' && t && pendentes > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{pendentes} por validar</span>}
                  {vista === v.id && <Check className={v.id === 'deteccoes' && t && pendentes > 0 ? '' : 'ml-auto'} aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* navegação completa (≥ 1280 px) */}
        <nav aria-label="Navegação principal" className="hidden items-stretch xl:flex" data-tour="menu">
          {VISTAS.filter((v) => !v.restrito).map(item)}
          <span className="mx-1 my-4 w-px bg-border" aria-hidden="true" />
          {VISTAS.filter((v) => v.restrito).map(item)}
        </nav>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1 py-1">
          {children}
          {t ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={cn(botaoBarra, 'gap-2 px-2')} aria-label={`Conta de ${t.nome}`}>
                  <span className="flex size-8 items-center justify-center rounded-full border border-border text-xs font-semibold" aria-hidden="true">
                    {iniciais(t.nome)}
                  </span>
                  <span className="hidden max-w-[10rem] truncate text-sm 2xl:inline">{t.nome}</span>
                  <ChevronDown className="opacity-80" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <span className="block font-medium">{t.nome}</span>
                  <span className="block text-xs text-muted-foreground">{t.utilizador} · técnico</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="min-h-11">
                    {cat.origem === 'pipeline' ? <Database /> : cat.origem === 'ficheiro' ? <FolderOpen /> : <FlaskConical />}
                    Fonte dos dados
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-64">
                    <DropdownMenuItem className="min-h-11" disabled={!cat.base!.elementos?.length} onSelect={cat.usarPipeline}>
                      <Database /> Pipeline local
                      <span className="ml-auto text-xs text-muted-foreground">{cat.base!.elementos?.length ?? '—'}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onSelect={() => fileRef.current?.click()}>
                      <Upload /> Carregar ficheiro…
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" onSelect={cat.usarDemo}>
                      <FlaskConical /> Demonstração
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem className="min-h-11" onSelect={onTema}>
                  {escuro ? <Sun /> : <Moon />} {escuro ? 'Tema claro' : 'Tema escuro'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11" onSelect={onSair}>
                  <LogOut /> Terminar sessão
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="icon" className={botaoBarra} onClick={onTema} aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}>
                {escuro ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </Button>
              <Button data-tour="tecnico" className="h-11 gap-2 bg-primary px-4 text-primary-foreground hover:bg-primary/90" onClick={onEntrar} aria-label="Entrar na área do técnico">
                <LogIn aria-hidden="true" /> <span className="hidden sm:inline">Entrar</span>
              </Button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.geojson,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) cat.carregarFicheiro(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
    </header>
  )
}
