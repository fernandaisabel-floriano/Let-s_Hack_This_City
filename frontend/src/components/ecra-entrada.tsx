import { ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import pin from '@/assets/mapeya-pin.png'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Ecrã de entrada: setup do município (protótipo, SÓ front-end).
 *
 * O utilizador introduz os dados do município; o ecrã mostra o excerto do municipio.yaml que
 * seria gerado e depois abre a app. NADA é enviado ao servidor nem gravado no config: a app
 * continua a mostrar os dados reais (config/municipio.yaml e a zona piloto). Os valores
 * escritos ficam só no sessionStorage, para voltarem preenchidos ao recarregar a página.
 *
 * As bolhas em degradê são só decoração de fundo.
 */

/**
 * Bolhas decorativas: posição (% do ecrã), diâmetro (px), degradê e atraso da animação (s).
 * Cores da paleta da app (index.css): laranja da marca, azul-tinta, azul-petróleo, verde e oliva.
 */
const BOLHAS: { x: number; y: number; d: number; de: string; para: string; atraso: number }[] = [
  { x: 8, y: 14, d: 180, de: 'var(--destaque)', para: 'var(--marca)', atraso: 0 },
  { x: 84, y: 12, d: 130, de: '#7d93b2', para: '#2f4a6d', atraso: -1.5 },
  { x: 90, y: 64, d: 210, de: 'var(--tipo-candeeiro)', para: '#2f4a6d', atraso: -3 },
  { x: 5, y: 74, d: 150, de: 'var(--tipo-contentor)', para: 'var(--tipo-candeeiro)', atraso: -4.5 },
  { x: 22, y: 42, d: 64, de: '#ffb07a', para: 'var(--destaque)', atraso: -2 },
  { x: 72, y: 34, d: 56, de: 'var(--tipo-contentor)', para: 'var(--tipo-sinal)', atraso: -5 },
  { x: 58, y: 88, d: 100, de: '#90a4ae', para: '#2f4a6d', atraso: -2.5 },
  { x: 32, y: 90, d: 44, de: 'var(--marca)', para: '#f2b33d', atraso: -3.5 },
]

const DISTRITOS = [
  'Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda', 'Leiria',
  'Lisboa', 'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu',
  'Região Autónoma dos Açores', 'Região Autónoma da Madeira',
]

const CRS = [
  { id: 'EPSG:3763', nome: 'PT-TM06 / ETRS89 (Continente)' },
  { id: 'EPSG:5016', nome: 'PTRA08 / UTM 28N (Madeira)' },
  { id: 'EPSG:5014', nome: 'PTRA08 / UTM 25N (Açores Ocidental)' },
  { id: 'EPSG:5015', nome: 'PTRA08 / UTM 26N (Açores Central e Oriental)' },
  { id: 'EPSG:4326', nome: 'WGS84 (graus)' },
]

const FONTES = [
  { id: 'mapillary', nome: 'Mapillary (imagens abertas)' },
  { id: 'fotos', nome: 'Fotografias próprias' },
  { id: 'video', nome: 'Vídeo + trajeto GPX' },
] as const
type Fonte = (typeof FONTES)[number]['id']

export interface DadosMunicipio {
  nome: string
  distrito: string
  dico: string
  servico: string
  crs: string
  fontes: Fonte[]
}

const CHAVE = 'ctrlf:setup-municipio'
const VAZIO: DadosMunicipio = { nome: '', distrito: '', dico: '', servico: '', crs: 'EPSG:3763', fontes: ['mapillary'] }

function lerGuardado(): DadosMunicipio {
  try {
    const v = sessionStorage.getItem(CHAVE)
    return v ? { ...VAZIO, ...(JSON.parse(v) as Partial<DadosMunicipio>) } : VAZIO
  } catch {
    return VAZIO
  }
}

/** identificador para pastas e chaves: minúsculas, sem acentos nem espaços */
const slug = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** excerto do municipio.yaml que o setup preencheria (só para mostrar) */
function paraYaml(d: DadosMunicipio) {
  const linhas = [
    '# Configuração por município (gerada pelo setup)',
    `municipio: ${slug(d.nome)}`,
    `nome_municipio: ${d.nome.trim()}`,
    `distrito: ${d.distrito}`,
  ]
  if (d.dico.trim()) linhas.push(`dico: "${d.dico.trim()}"`)
  if (d.servico.trim()) linhas.push(`servico_responsavel: ${d.servico.trim()}`)
  linhas.push(
    `crs_local: ${d.crs}`,
    'saida: data/clean',
    '',
    '# Zonas: definidas depois, no mapa do município',
    'zona: null',
    '',
    'fontes:',
    ...FONTES.map((f) => `  ${f.id}: ${d.fontes.includes(f.id)}`),
    '',
    'desfoque: {caras: true, matriculas: true}   # obrigatório',
  )
  return linhas.join('\n')
}

function Bolhas() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {BOLHAS.map((b, i) => (
        <span
          key={i}
          className="ctrlf-bolha absolute rounded-full opacity-80 dark:opacity-60"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.d,
            height: b.d,
            marginLeft: -b.d / 2,
            marginTop: -b.d / 2,
            background: `radial-gradient(circle at 30% 25%, rgb(255 255 255 / 0.5), transparent 45%), linear-gradient(135deg, ${b.de}, ${b.para})`,
            boxShadow: `0 18px 40px -16px color-mix(in srgb, ${b.para} 60%, transparent)`,
            animationDelay: `${b.atraso}s`,
          }}
        />
      ))}
    </div>
  )
}

export function EcraEntrada({ onConcluir }: { onConcluir: (dados: DadosMunicipio) => void }) {
  const [dados, setDados] = useState<DadosMunicipio>(lerGuardado)
  const [passo, setPasso] = useState<'dados' | 'resumo'>('dados')
  const mudar = <K extends keyof DadosMunicipio>(k: K, v: DadosMunicipio[K]) => setDados((d) => ({ ...d, [k]: v }))
  const valido = dados.nome.trim().length > 1 && !!dados.distrito && dados.fontes.length > 0

  const avancar = (e: FormEvent) => {
    e.preventDefault()
    if (!valido) return
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(dados))
    } catch {
      /* ignore */
    }
    setPasso('resumo')
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-12">
      <Bolhas />

      <main className="relative z-10 w-full max-w-lg rounded-lg border-t-4 border-t-destaque border bg-card/90 p-6 shadow-xl backdrop-blur-md sm:p-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src={pin} alt="" className="h-9 w-auto" />
            <span className="font-marca text-2xl leading-none font-semibold tracking-tight text-titulo">
              Mape<span className="text-marca">ya</span>
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning">
            <FlaskConical className="size-3" aria-hidden="true" /> Demonstração: nada é gravado
          </span>
        </div>
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Setup · passo {passo === 'dados' ? 1 : 2} de 2
        </p>

        {passo === 'dados' ? (
          <form onSubmit={avancar} className="mt-2">
            <h1 className="text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">Configurar o município</h1>
            <p className="mt-2 text-sm text-muted-foreground">Introduza os dados do município. As ruas e zonas a analisar escolhem-se depois, no mapa.</p>

            <div className="mt-6 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="mun-nome">Município *</Label>
                <Input id="mun-nome" required autoFocus placeholder="ex.: Ílhavo" value={dados.nome} onChange={(e) => mudar('nome', e.target.value)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="mun-distrito">Distrito / região *</Label>
                  <Select value={dados.distrito} onValueChange={(v) => mudar('distrito', v)}>
                    <SelectTrigger id="mun-distrito" className="w-full">
                      <SelectValue placeholder="Escolher…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISTRITOS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mun-dico">Código do município (DICO)</Label>
                  <Input id="mun-dico" inputMode="numeric" maxLength={4} placeholder="ex.: 0110" value={dados.dico} onChange={(e) => mudar('dico', e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="mun-servico">Serviço responsável</Label>
                <Input id="mun-servico" placeholder="ex.: Divisão de Sistemas de Informação Geográfica" value={dados.servico} onChange={(e) => mudar('servico', e.target.value)} />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="mun-crs">Sistema de coordenadas</Label>
                <Select value={dados.crs} onValueChange={(v) => mudar('crs', v)}>
                  <SelectTrigger id="mun-crs" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRS.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} · {c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Fontes de imagem *</legend>
                {FONTES.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={dados.fontes.includes(f.id)}
                      onCheckedChange={(v) => mudar('fontes', v ? [...dados.fontes, f.id] : dados.fontes.filter((x) => x !== f.id))}
                    />
                    {f.nome}
                  </label>
                ))}
              </fieldset>
            </div>

            <Button type="submit" className="mt-6 w-full" disabled={!valido}>
              Continuar <ArrowRight aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <div className="mt-2">
            <h1 className="text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">{dados.nome.trim()}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Configuração que seria criada em <code className="rounded bg-muted px-1 py-0.5 text-xs">config/municipio.yaml</code>. Neste protótipo é só uma pré-visualização: o ficheiro real não muda.
            </p>
            <pre className="mt-4 max-h-72 overflow-auto rounded-md border bg-muted/60 p-4 font-mono text-xs leading-relaxed">{paraYaml(dados)}</pre>
            <div className="mt-6 flex gap-2">
              <Button variant="outline" onClick={() => setPasso('dados')}>
                <ArrowLeft aria-hidden="true" /> Editar
              </Button>
              <Button className="flex-1" onClick={() => onConcluir(dados)}>
                Abrir o mapa do município <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
