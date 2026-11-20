import { Download, History, LayoutDashboard, Library, ListChecks, Map as MapIcon, Upload } from 'lucide-react'
import { nomeLegivel } from '@/lib/format'
import type { Catalogo } from '@/hooks/use-catalogo'

/** Vistas da app (barra superior e ligações #vista). */
export type Vista = 'dashboard' | 'mapa' | 'catalogo' | 'exportar' | 'deteccoes' | 'importacao' | 'registo'

export const VISTAS: { id: Vista; titulo: string; descricao: string; icon: typeof MapIcon; restrito?: boolean }[] = [
  { id: 'dashboard', titulo: 'Dashboard', descricao: 'Visão geral do mobiliário urbano', icon: LayoutDashboard },
  { id: 'mapa', titulo: 'Mapa', descricao: 'Mobiliário urbano no mapa, com filtros', icon: MapIcon },
  { id: 'catalogo', titulo: 'Catálogo', descricao: 'Todos os elementos identificados', icon: Library },
  { id: 'exportar', titulo: 'Exportação', descricao: 'Dados abertos em GeoJSON e CSV', icon: Download },
  { id: 'deteccoes', titulo: 'Deteções e validação', descricao: 'Supervisionar, corrigir e validar os resultados da IA', icon: ListChecks, restrito: true },
  { id: 'importacao', titulo: 'Importação', descricao: 'Fotografias, vídeos e fontes abertas', icon: Upload, restrito: true },
  { id: 'registo', titulo: 'Registo', descricao: 'Quem validou o quê, e quando', icon: History, restrito: true },
]

/** nomes antigos das vistas (ligações guardadas) */
export const VISTA_ALIAS: Record<string, Vista> = { painel: 'dashboard', fila: 'deteccoes' }

/** Nome legível do município ou da zona, com os acentos tirados dos nomes das vias. */
export function nomeBonito(z: string, cat?: Catalogo) {
  const cfg = cat?.base?.config
  if (cfg?.nome_zona && cfg.zona === z) return cfg.nome_zona
  const vias = (cat?.base?.vias?.features ?? []).map((f) => String(f.properties.via ?? f.properties.name ?? ''))
  return nomeLegivel(z, vias)
}
