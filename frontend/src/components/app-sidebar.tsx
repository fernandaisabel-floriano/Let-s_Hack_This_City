import {
  ChartColumn,
  ChevronsUpDown,
  Database,
  Download,
  FlaskConical,
  FolderOpen,
  History,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Map as MapIcon,
  Moon,
  Sun,
  Upload,
} from 'lucide-react'
import { useRef } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { iniciais, nomeLegivel } from '@/lib/format'
import type { Catalogo } from '@/hooks/use-catalogo'

export type Vista = 'mapa' | 'fila' | 'painel' | 'exportar' | 'registo'

export const VISTAS: { id: Vista; titulo: string; descricao: string; icon: typeof MapIcon; restrito?: boolean }[] = [
  { id: 'mapa', titulo: 'Mapa', descricao: 'Mobiliário urbano identificado na zona', icon: MapIcon },
  { id: 'painel', titulo: 'Painel', descricao: 'O inventário em números', icon: ChartColumn },
  { id: 'exportar', titulo: 'Exportar', descricao: 'Dados abertos em GeoJSON e CSV', icon: Download },
  { id: 'fila', titulo: 'Validação', descricao: 'Confirmar ou corrigir as deteções duvidosas', icon: ListChecks, restrito: true },
  { id: 'registo', titulo: 'Registo', descricao: 'Quem validou o quê, e quando', icon: History, restrito: true },
]

interface Props {
  cat: Catalogo
  vista: Vista
  onVista: (v: Vista) => void
  escuro: boolean
  onTema: () => void
  onEntrar: () => void
  onSair: () => void
}

/** Nome legível do município ou da zona, com os acentos tirados dos nomes das vias. */
export function nomeBonito(z: string, cat?: Catalogo) {
  const vias = (cat?.base?.vias?.features ?? []).map((f) => String(f.properties.via ?? f.properties.name ?? ''))
  return nomeLegivel(z, vias)
}

export function AppSidebar({ cat, vista, onVista, escuro, onTema, onEntrar, onSair }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cfg = cat.base!.config
  const pendentes = cat.elementos.filter((e) => e.estado === 'pendente').length
  const t = cat.tecnico

  const item = (v: (typeof VISTAS)[number]) => (
    <SidebarMenuItem key={v.id}>
      <SidebarMenuButton isActive={vista === v.id} onClick={() => onVista(v.id)} tooltip={v.titulo}>
        <v.icon />
        <span>{v.titulo}</span>
      </SidebarMenuButton>
      {v.restrito && !t && <SidebarMenuBadge><Lock className="size-3 opacity-60" /></SidebarMenuBadge>}
      {v.id === 'fila' && t && pendentes > 0 && <SidebarMenuBadge className="text-sidebar-primary">{pendentes}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary font-mono text-xs font-bold text-sidebar-primary-foreground">⌃F</div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-heading text-base font-semibold">Ctrl+F {nomeBonito(cfg.municipio)}</span>
                <span className="truncate text-xs text-sidebar-foreground/60">Mobiliário urbano · {nomeBonito(cfg.zona, cat)}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">Consultar</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{VISTAS.filter((v) => !v.restrito).map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">Área do técnico</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{VISTAS.filter((v) => v.restrito).map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            {t ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-md">
                      <AvatarFallback className="rounded-md bg-sidebar-primary text-sidebar-primary-foreground">{iniciais(t.nome)}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{t.nome}</span>
                      <span className="truncate text-xs text-sidebar-foreground/60">Técnico</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="end" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block font-medium">{t.nome}</span>
                    <span className="block text-xs text-muted-foreground">{t.utilizador}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {cat.origem === 'pipeline' ? <Database /> : cat.origem === 'ficheiro' ? <FolderOpen /> : <FlaskConical />}
                      Fonte dos dados
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-64">
                      <DropdownMenuItem disabled={!cat.base!.elementos?.length} onSelect={cat.usarPipeline}>
                        <Database /> Pipeline local
                        <span className="ml-auto text-xs text-muted-foreground">{cat.base!.elementos?.length ?? '—'}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                        <Upload /> Carregar ficheiro…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={cat.usarDemo}>
                        <FlaskConical /> Demonstração
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onSelect={onTema}>
                    {escuro ? <Sun /> : <Moon />} {escuro ? 'Tema claro' : 'Tema escuro'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onSair}>
                    <LogOut /> Terminar sessão
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton onClick={onEntrar} tooltip="Entrar como técnico">
                <LogIn />
                <span>Entrar como técnico</span>
              </SidebarMenuButton>
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
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
