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
 * O fundo (ArteFundo) é só decoração.
 */

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

/**
 * Fundo abstrato a partir do logotipo: contornos concêntricos com a silhueta do pin (como curvas de
 * nível de um mapa), uma malha de ruas e pontos ao longo dela (as "sementes" do logotipo e os
 * elementos detetados). Só cores da paleta (index.css), por isso segue o tema claro/escuro.
 */
function pinPath(cx: number, cy: number, r: number, d = 1.75) {
  // pin de raio r com a ponta a d·r abaixo do centro; tangentes da ponta ao círculo
  const k = 1 / d
  const px = r * Math.sqrt(1 - k * k)
  const py = r * k
  const f = (n: number) => n.toFixed(1)
  return `M${f(cx)} ${f(cy + d * r)} L${f(cx + px)} ${f(cy + py)} A${f(r)} ${f(r)} 0 1 0 ${f(cx - px)} ${f(cy + py)} Z`
}

/** anéis em pin: centro que deriva um pouco a cada anel, para não ficarem mecânicos */
function aneis(cx: number, cy: number, r0: number, n: number, passo: number, deriva: [number, number]) {
  return Array.from({ length: n }, (_, i) => ({
    d: pinPath(cx + deriva[0] * i, cy + deriva[1] * i, r0 + passo * i),
    cor: i % 3 === 2 ? 'var(--tipo-contentor)' : 'var(--marca)',
    op: Math.max(0.06, 0.5 - i * 0.045),
  }))
}

const RUAS: [number, number][][] = [
  [[-40, 690], [260, 610], [520, 640], [800, 560], [1120, 600], [1640, 470]],
  [[180, -40], [250, 260], [330, 520], [420, 1040]],
  [[1040, -40], [1000, 220], [1110, 480], [1180, 760], [1240, 1040]],
  [[-40, 250], [300, 210], [640, 280], [980, 230]],
  [[620, 1040], [700, 820], [800, 560]],
  [[1240, 1040], [1400, 860], [1640, 820]],
]

/** pontos ao longo das ruas, a intervalos regulares; um em cada 5 em laranja */
function pontosDasRuas(espaco = 70) {
  const out: { x: number; y: number; laranja: boolean }[] = []
  let k = 0
  for (const rua of RUAS)
    for (let s = 0; s < rua.length - 1; s++) {
      const [a, b] = [rua[s], rua[s + 1]]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (let t = espaco / 2; t < len; t += espaco) {
        const x = a[0] + ((b[0] - a[0]) * t) / len
        const y = a[1] + ((b[1] - a[1]) * t) / len
        // de lado da rua, alternando, como o mobiliário urbano
        const nx = -(b[1] - a[1]) / len
        const ny = (b[0] - a[0]) / len
        const lado = k % 2 ? 9 : -9
        out.push({ x: x + nx * lado, y: y + ny * lado, laranja: k % 5 === 0 })
        k++
      }
    }
  return out
}

const ANEIS = [...aneis(1290, 300, 34, 11, 30, [6, -4]), ...aneis(250, 820, 22, 7, 26, [-5, 3])]
const PONTOS = pontosDasRuas()
const SEMENTES = Array.from({ length: 7 }, (_, i) => {
  const a = (i / 7) * Math.PI * 2
  return { x: 1290 + Math.cos(a) * 14, y: 300 + Math.sin(a) * 14 }
})

function ArteFundo() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 1600 1000"
      // ancorado à direita: em ecrãs estreitos (telemóvel) fica à vista o pin grande
      preserveAspectRatio="xMaxYMid slice"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {RUAS.map((r, i) => (
          <polyline key={i} points={r.map((p) => p.join(',')).join(' ')} stroke="var(--primary)" strokeOpacity={0.12} strokeWidth={14} />
        ))}
        {RUAS.map((r, i) => (
          <polyline key={`e${i}`} points={r.map((p) => p.join(',')).join(' ')} stroke="var(--primary)" strokeOpacity={0.22} strokeWidth={1.2} strokeDasharray="2 10" />
        ))}
        {ANEIS.map((a, i) => (
          <path key={i} d={a.d} stroke={a.cor} strokeOpacity={a.op} strokeWidth={1.4} />
        ))}
      </g>
      {PONTOS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.laranja ? 4.5 : 3} fill={p.laranja ? 'var(--marca)' : 'var(--titulo)'} fillOpacity={p.laranja ? 0.7 : 0.22} />
      ))}
      {/* o centro com as sementes, como no logotipo (igual nos dois temas) */}
      <circle cx={1290} cy={300} r={22} fill="#263238" stroke="var(--marca)" strokeWidth={2} />
      {SEMENTES.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.6} fill="#f6f7f9" />
      ))}
    </svg>
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
      <ArteFundo />

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
