import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  Cpu,
  FlaskConical,
  Globe,
  ImagePlus,
  Loader2,
  MapPinned,
  Play,
  Route,
  ShieldCheck,
  Square,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NovaZona } from '@/components/nova-zona'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  cancelarImportacao,
  criarImportacao,
  enviarFicheiro,
  iniciarImportacao,
  listarImportacoes,
  obterMotor,
  type EstadoImportacao,
  type EstadoMotor,
  type Importacao,
  type TipoImportacao,
} from '@/lib/api'
import { nomesVias } from '@/lib/revisao'
import { cn } from '@/lib/utils'
import type { Catalogo } from '@/hooks/use-catalogo'

const ESTADO_IMP: Record<EstadoImportacao, { label: string; cls: string; icon: typeof CircleCheck }> = {
  rascunho: { label: 'Rascunho', cls: 'text-muted-foreground', icon: CircleDashed },
  a_aguardar: { label: 'A aguardar', cls: 'text-muted-foreground', icon: CircleDashed },
  em_processamento: { label: 'Em processamento', cls: 'text-primary', icon: Loader2 },
  concluido: { label: 'Concluído', cls: 'text-success', icon: CircleCheck },
  erro: { label: 'Com erros', cls: 'text-destructive', icon: CircleAlert },
  cancelado: { label: 'Cancelado', cls: 'text-muted-foreground', icon: Square },
}

const TIPO_IMP: Record<TipoImportacao, string> = {
  fotos: 'Fotografias',
  video: 'Vídeo + GPS',
  mapillary: 'Mapillary',
  demo: 'Demonstração',
  zona: 'Zona nova',
}

const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`)

function EstadoImpBadge({ estado }: { estado: EstadoImportacao }) {
  const e = ESTADO_IMP[estado]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', e.cls)}>
      <e.icon className={cn('size-3.5', estado === 'em_processamento' && 'animate-spin')} aria-hidden="true" />
      {e.label}
    </span>
  )
}

function MotorCard({ motor, aCarregar }: { motor: EstadoMotor | null; aCarregar: boolean }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium"><Cpu className="size-4" aria-hidden="true" /> Motor de processamento</CardTitle>
        <CardDescription>Pipeline Python local (OpenCV, YOLO-World). Nenhuma API comercial.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {aCarregar || !motor ? (
          <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> A verificar…</span>
        ) : (
          <>
            <p className="flex items-center gap-2">
              {motor.disponivel ? <CircleCheck className="size-4 text-success" aria-hidden="true" /> : <CircleAlert className="size-4 text-warning" aria-hidden="true" />}
              {motor.disponivel ? 'Disponível neste servidor' : 'Não instalado neste servidor'}
            </p>
            <p className="text-xs text-muted-foreground">
              {motor.python ? `Python ${motor.versao}` : 'Python não encontrado'}
              {!motor.disponivel && motor.em_falta.length > 0 && <> · falta: {motor.em_falta.join(', ')}</>}
            </p>
            <p className="flex items-center gap-2">
              {motor.mapillary_token ? <CircleCheck className="size-4 text-success" aria-hidden="true" /> : <CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />}
              Mapillary {motor.mapillary_token ? 'configurado' : 'sem token (MAPILLARY_TOKEN no .env)'}
            </p>
            <p className="flex items-center gap-2 text-muted-foreground"><CircleDashed className="size-4" aria-hidden="true" /> KartaView ainda não integrado</p>
            {!motor.disponivel && (
              <p className="mt-1 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                Para ativar: <code>pip install -r requirements.txt</code> na raiz do repositório (ou indique o Python em <code>CTRLF_PYTHON</code>) e reinicie o servidor.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Passos({ j, nomes }: { j: Importacao; nomes: Record<string, string> }) {
  const atual = j.passo ? j.passos.indexOf(j.passo) : j.estado === 'concluido' ? j.passos.length : -1
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      {j.passos.map((p, i) => (
        <li
          key={p}
          className={cn(
            'flex items-center gap-1',
            i < atual ? 'text-success' : i === atual && j.estado === 'em_processamento' ? 'font-medium text-primary' : 'text-muted-foreground',
            i === atual && j.estado === 'erro' && 'text-destructive',
          )}
        >
          {i < atual ? <CircleCheck className="size-3" aria-hidden="true" /> : i === atual && j.estado === 'em_processamento' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <CircleDashed className="size-3" aria-hidden="true" />}
          {nomes[p] ?? p}
        </li>
      ))}
    </ol>
  )
}

function Processamento({ j, nomes, onCancelar }: { j: Importacao; nomes: Record<string, string>; onCancelar: () => void }) {
  const ativo = j.estado === 'a_aguardar' || j.estado === 'em_processamento'
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {j.nome}
            <Badge variant="secondary" className="font-normal">{TIPO_IMP[j.tipo]}</Badge>
            {j.demo && <Badge variant="outline" className="gap-1 border-warning/50 font-normal text-warning"><FlaskConical aria-hidden="true" /> Demonstração: nada é processado</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {j.tipo === 'zona' ? `${j.zona_nome ?? j.rua} · ${j.n_vias ?? '?'} troços de via` : `${j.rua || 'zona piloto'}${j.zona ? ` · zona ${j.zona}` : ''}`} · {j.criado_por.nome} · {new Date(j.criado_em).toLocaleString('pt-PT')}
            {j.ficheiros.length > 0 && <> · {j.ficheiros.length} {j.ficheiros.length === 1 ? 'ficheiro' : 'ficheiros'} ({bytes(j.ficheiros.reduce((a, f) => a + f.bytes, 0))})</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <EstadoImpBadge estado={j.estado} />
          {ativo && (
            <Button variant="ghost" size="sm" onClick={onCancelar}>
              <X aria-hidden="true" /> Cancelar
            </Button>
          )}
        </div>
      </div>
      {(ativo || j.estado === 'concluido' || j.estado === 'erro') && (
        <>
          <Progress value={j.progresso} aria-label={`Progresso de ${j.nome}`} />
          <Passos j={j} nomes={nomes} />
        </>
      )}
      {j.erro && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{j.erro}</p>}
      {j.originais_apagados && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" aria-hidden="true" /> Ficheiros originais apagados do servidor; só ficam as imagens desfocadas.
        </p>
      )}
      {j.log.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Registo técnico ({j.log.length} linhas)</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{j.log.join('\n')}</pre>
        </details>
      )}
    </li>
  )
}

export function TabImportacao({ cat }: { cat: Catalogo }) {
  const ruas = useMemo(() => nomesVias(cat.base!.vias), [cat.base])
  const [motor, setMotor] = useState<EstadoMotor | null>(null)
  const [aVerificar, setAVerificar] = useState(true)
  const [jobs, setJobs] = useState<Importacao[]>([])
  const [tipo, setTipo] = useState<'fotos' | 'video' | 'abertas'>('fotos')
  const [nome, setNome] = useState('')
  const [rua, setRua] = useState<string>(ruas[0] ?? '')
  const [ruaOutra, setRuaOutra] = useState('')
  const [offset, setOffset] = useState('0')
  const [fotos, setFotos] = useState<File[]>([])
  const [video, setVideo] = useState<File | null>(null)
  const [gpx, setGpx] = useState<File | null>(null)
  const [envio, setEnvio] = useState<{ ficheiro: string; fracao: number } | null>(null)
  const anteriores = useRef<Record<string, EstadoImportacao>>({})
  // `cat` muda a cada render: guarda só a função de recarregar, para os efeitos não se repetirem
  const recarregar = useRef(cat.recarregar)
  useEffect(() => {
    recarregar.current = cat.recarregar
  })

  const atualizar = useCallback(async () => {
    try {
      const l = await listarImportacoes()
      // processamento real concluído → o catálogo mudou: volta a lê-lo
      for (const j of l) {
        const antes = anteriores.current[j.id]
        if (antes && antes !== j.estado && j.estado === 'concluido') {
          if (j.demo) toast.info(`Demonstração "${j.nome}" concluída (o catálogo não muda)`)
          else if (j.tipo === 'zona') toast.success(`Zona "${j.zona_nome ?? j.nome}" pronta: escolha-a no seletor de zonas (menu lateral)`, { duration: 10000 })
          else {
            toast.success(`Processamento "${j.nome}" concluído: catálogo atualizado`)
            recarregar.current()
          }
        }
        if (antes && antes !== j.estado && j.estado === 'erro') toast.error(`Processamento "${j.nome}" terminou com erros`)
        anteriores.current[j.id] = j.estado
      }
      setJobs(l)
    } catch {
      /* sem sessão: a página não é mostrada */
    }
  }, [])

  useEffect(() => {
    obterMotor()
      .then(setMotor)
      .catch(() => setMotor(null))
      .finally(() => setAVerificar(false))
    void atualizar()
  }, [atualizar])

  const haAtivos = jobs.some((j) => j.estado === 'a_aguardar' || j.estado === 'em_processamento')
  useEffect(() => {
    if (!haAtivos) return
    const t = window.setInterval(() => void atualizar(), 1500)
    return () => window.clearInterval(t)
  }, [haAtivos, atualizar])

  const ruaFinal = rua === '__outra' ? ruaOutra.trim() : rua
  const disponivel = !!motor?.disponivel
  const pronto =
    nome.trim().length > 1 &&
    (tipo === 'fotos' ? fotos.length > 0 : tipo === 'video' ? !!video && !!gpx : true)

  const iniciar = async (demo = false) => {
    try {
      const t: TipoImportacao = demo ? 'demo' : tipo === 'abertas' ? 'mapillary' : tipo
      const j = await criarImportacao({ tipo: t, nome: nome || 'demonstracao', rua: ruaFinal, offset_s: tipo === 'video' ? Number(offset.replace(',', '.')) || 0 : undefined })
      if (t === 'fotos' || t === 'video') {
        const lista = t === 'fotos' ? fotos : [video!, gpx!]
        for (const f of lista) {
          setEnvio({ ficheiro: f.name, fracao: 0 })
          await enviarFicheiro(j.id, f, (fracao) => setEnvio({ ficheiro: f.name, fracao }))
        }
        setEnvio(null)
        await iniciarImportacao(j.id)
      }
      toast.success(demo ? 'Demonstração iniciada' : 'Processamento iniciado')
      setFotos([])
      setVideo(null)
      setGpx(null)
      setNome('')
      void atualizar()
    } catch (e) {
      setEnvio(null)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const nomes = motor?.passos ?? {}
  const totaisMap = cat.imagens?.totais.mapillary

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div>
        <h2 className="text-xl font-semibold">Importação e processamento</h2>
        <p className="text-sm text-muted-foreground">
          Importe fotografias ou vídeos gravados na rua, ou recolha imagens de fontes abertas autorizadas. A IA deteta, classifica e localiza o mobiliário; os resultados entram na
          fila de validação.
        </p>
      </div>

      {!aVerificar && motor && !motor.disponivel && (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>O motor de IA não está instalado neste servidor</AlertTitle>
          <AlertDescription>
            Os ficheiros não podem ser processados aqui, por isso o envio está desativado (não guardamos fotografias por desfocar à espera). Pode ver o fluxo com uma simulação, marcada como
            demonstração: não lê ficheiros nem altera o catálogo.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Nova recolha</CardTitle>
            <CardDescription>Os rostos e as matrículas são desfocados antes de qualquer imagem ser guardada.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)} className="gap-4">
              <TabsList>
                <TabsTrigger value="fotos"><ImagePlus aria-hidden="true" /> Fotografias</TabsTrigger>
                <TabsTrigger value="video"><Clapperboard aria-hidden="true" /> Vídeo + GPS</TabsTrigger>
                <TabsTrigger value="abertas"><Globe aria-hidden="true" /> Fontes abertas</TabsTrigger>
              </TabsList>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="imp-nome">Nome da recolha</Label>
                  <Input id="imp-nome" placeholder="ex.: santos_martires_nov" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="imp-rua">Rua ou zona de Aveiro</Label>
                  <Select value={rua} onValueChange={setRua}>
                    <SelectTrigger id="imp-rua" className="w-full"><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>
                      {ruas.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      <SelectItem value="__outra">Outra rua ou zona…</SelectItem>
                    </SelectContent>
                  </Select>
                  {rua === '__outra' && <Input aria-label="Outra rua ou zona" placeholder="ex.: Rua de Viana do Castelo" value={ruaOutra} onChange={(e) => setRuaOutra(e.target.value)} />}
                </div>
              </div>

              <TabsContent value="fotos" className="flex flex-col gap-3">
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors hover:border-primary hover:bg-primary/5',
                    !disponivel && 'pointer-events-none opacity-50',
                  )}
                >
                  <Upload className="size-6 text-primary" aria-hidden="true" />
                  <span className="text-sm font-medium">{fotos.length ? `${fotos.length} fotografias escolhidas (${bytes(fotos.reduce((a, f) => a + f.size, 0))})` : 'Escolher fotografias'}</span>
                  <span className="max-w-md text-xs text-muted-foreground">JPEG, PNG ou HEIC com GPS e direção da câmara no EXIF (a maioria dos telemóveis com localização ativa). Sem direção não é possível georreferenciar os objetos: essas fotos ficam assinaladas para revisão.</span>
                  <input type="file" className="sr-only" multiple accept=".jpg,.jpeg,.png,.heic,.heif" disabled={!disponivel} onChange={(e) => setFotos([...(e.target.files ?? [])])} />
                </label>
              </TabsContent>

              <TabsContent value="video" className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="imp-video">Vídeo</Label>
                    <Input id="imp-video" type="file" accept=".mp4,.mov,.avi,.mkv" disabled={!disponivel} onChange={(e) => setVideo(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="imp-gpx">Trilha GPS (.gpx)</Label>
                    <Input id="imp-gpx" type="file" accept=".gpx" disabled={!disponivel} onChange={(e) => setGpx(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="imp-offset">Desfasamento GPS ↔ vídeo (segundos)</Label>
                    <Input id="imp-offset" inputMode="decimal" value={offset} onChange={(e) => setOffset(e.target.value)} disabled={!disponivel} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  É extraído um fotograma a cada ~2 m percorridos, posicionado pela trilha GPS gravada ao mesmo tempo. Grave a rua nos dois sentidos: os sinais só têm a face virada para um lado.
                </p>
              </TabsContent>

              <TabsContent value="abertas" className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-xl border p-4">
                  <p className="flex items-center gap-2 font-medium"><Globe className="size-4 text-primary" aria-hidden="true" /> Mapillary</p>
                  <p className="text-xs text-muted-foreground">
                    Imagens de rua abertas (licença CC BY-SA 4.0, com atribuição obrigatória). A recolha usa a API oficial com token próprio, respeita os limites de pedidos e guarda
                    autor, licença e ligação de cada imagem.
                  </p>
                  {totaisMap && <p className="text-xs">Já recolhidas na zona: <strong>{totaisMap.imagens}</strong> imagens ({totaisMap.com_desfoque} com desfocagem aplicada).</p>}
                  {!motor?.mapillary_token && <p className="text-xs text-warning">Falta o token (MAPILLARY_TOKEN no ficheiro .env do servidor).</p>}
                </div>
                <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4 opacity-80">
                  <p className="flex items-center gap-2 font-medium"><Route className="size-4 text-muted-foreground" aria-hidden="true" /> KartaView</p>
                  <p className="text-xs text-muted-foreground">
                    Ainda não integrado. Será um módulo de recolha com o mesmo formato de saída do Mapillary, se houver cobertura na zona e respeitando as condições de utilização da
                    plataforma.
                  </p>
                  <Badge variant="outline" className="self-start font-normal">Previsto</Badge>
                </div>
              </TabsContent>
            </Tabs>

            {envio && (
              <div className="mt-4 flex flex-col gap-1.5" aria-live="polite">
                <p className="text-xs text-muted-foreground">A enviar {envio.ficheiro}…</p>
                <Progress value={envio.fracao * 100} aria-label="Progresso do envio" />
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-end gap-2">
            {!disponivel && (
              <Button variant="outline" onClick={() => void iniciar(true)} disabled={!!envio}>
                <FlaskConical aria-hidden="true" /> Simular processamento (demonstração)
              </Button>
            )}
            <Button
              onClick={() => void iniciar(false)}
              disabled={!disponivel || !pronto || !!envio || (tipo === 'abertas' && !motor?.mapillary_token)}
              title={!disponivel ? 'O motor de processamento não está instalado neste servidor' : undefined}
            >
              {tipo === 'abertas' ? <Globe aria-hidden="true" /> : <Play aria-hidden="true" />}
              {tipo === 'abertas' ? 'Recolher do Mapillary e processar' : 'Enviar e iniciar processamento'}
            </Button>
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-4">
          <MotorCard motor={motor} aCarregar={aVerificar} />
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-medium"><ShieldCheck className="size-4 text-success" aria-hidden="true" /> Privacidade</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <p>Rostos (YuNet), matrículas (YOLO) e pessoas são desfocados em memória, antes de gravar. A imagem original nunca é guardada.</p>
              <p>Os ficheiros enviados ficam numa pasta temporária fora do repositório e são apagados assim que o processamento termina.</p>
              {cat.imagens && (
                <p className="text-foreground">
                  Na zona: {Object.values(cat.imagens.totais).reduce((a, t) => a + t.rostos, 0)} rostos e {Object.values(cat.imagens.totais).reduce((a, t) => a + t.matriculas, 0)} matrículas
                  desfocados em {Object.values(cat.imagens.totais).reduce((a, t) => a + t.imagens, 0)} imagens.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <NovaZona cat={cat} onCriada={() => void atualizar()} />

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Processamentos</h3>
        {jobs.length ? (
          <ul className="flex flex-col gap-3">
            {jobs.map((j) => (
              <Processamento key={j.id} j={j} nomes={nomes} onCancelar={() => cancelarImportacao(j.id).then(atualizar).catch((e) => toast.error(String(e.message ?? e)))} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Ainda não há processamentos.</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: ShieldCheck, t: '1. Desfocagem', d: 'Rostos e matrículas desfocados antes de gravar. Nada por anonimizar fica em disco.' },
          { icon: Cpu, t: '2. Deteção e classificação', d: 'YOLO-World local deteta sinais, candeeiros e contentores; a classificação dos sinais e do tipo de contentor corre a seguir.' },
          { icon: MapPinned, t: '3. Georreferenciação', d: 'Posição e direção da câmara (GPS/EXIF/Mapillary) + direção do objeto na imagem; triangulação entre várias imagens. Sem dados suficientes, a posição fica marcada "a rever".' },
          { icon: Route, t: '4. Duplicados', d: 'Deteções do mesmo objeto em várias imagens e fontes juntam-se por proximidade, categoria e sobreposição na mesma foto; os casos duvidosos vão para o técnico.' },
        ].map((p) => (
          <Card key={p.t} className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium"><p.icon className="size-4 text-primary" aria-hidden="true" /> {p.t}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{p.d}</CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}
