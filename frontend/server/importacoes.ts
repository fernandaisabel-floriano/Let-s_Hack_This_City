/**
 * Importação e processamento (página "Importação").
 *
 * Liga a interface ao pipeline Python REAL do repositório:
 *   fotos      python pipeline/ingest_fotos.py  PASTA --nome N --rua R
 *   video      python pipeline/ingest_video.py  VIDEO GPX --nome N --offset-s S
 *   mapillary  python pipeline/fetch_mapillary.py           (precisa de MAPILLARY_TOKEN no .env)
 *   zona       python pipeline/nova_zona.py --id Z --nome N --vias V.geojson   (etapa 5: zona nova a partir das
 *              ruas escolhidas no mapa) e depois fetch_mapillary.py para a área dela
 *
 * Cada processamento corre na sua zona (CTRLF_ZONA); a lista de importações é uma só por município.
 *   e depois   python pipeline/run_all.py   (deteção → classificação → georreferenciação → fusão → exportação)
 *
 * Privacidade: os ficheiros enviados ficam numa pasta temporária do sistema, FORA do
 * repositório, só até o processamento acabar (com ou sem erro); depois são apagados.
 * O pipeline desfoca rostos e matrículas antes de gravar qualquer imagem.
 *
 * Um processamento de cada vez; os outros ficam "a aguardar".
 * "demo" simula os passos para mostrar o fluxo quando o motor não está instalado:
 * fica marcado como demonstração e não lê nem grava ficheiros.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'

export type TipoImportacao = 'fotos' | 'video' | 'mapillary' | 'demo' | 'zona'
export type EstadoImportacao = 'rascunho' | 'a_aguardar' | 'em_processamento' | 'concluido' | 'erro' | 'cancelado'

export interface Importacao {
  id: string
  tipo: TipoImportacao
  /** zona em que corre (CTRLF_ZONA); numa importação "zona", a zona que vai ser criada */
  zona?: string
  /** "zona": nome legível e número de troços de via escolhidos */
  zona_nome?: string
  n_vias?: number
  nome: string
  rua: string
  offset_s?: number
  estado: EstadoImportacao
  criado_em: string
  criado_por: { utilizador: string; nome: string }
  iniciado_em?: string
  terminado_em?: string
  ficheiros: { nome: string; bytes: number }[]
  passo?: string
  passos: string[]
  progresso: number
  log: string[]
  erro?: string
  demo?: boolean
  originais_apagados?: boolean
}

const PASSOS_PIPELINE = ['detect', 'classify_signs', 'contentores_clip', 'qualidade', 'geolocate', 'fuse', 'export']
export const NOME_PASSO: Record<string, string> = {
  zona: 'Criação da zona (vias, polígono, edifícios)',
  ingest: 'Recolha e desfocagem',
  qualidade: 'Qualidade das imagens',
  detect: 'Deteção (YOLO-World)',
  classify_signs: 'Classificação dos sinais',
  contentores_clip: 'Tipo de contentor (CLIP)',
  geolocate: 'Georreferenciação',
  fuse: 'Fusão de duplicados',
  export: 'Atualização do catálogo',
}
const EXT: Record<TipoImportacao, string[]> = {
  fotos: ['.jpg', '.jpeg', '.png', '.heic', '.heif'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.gpx'],
  mapillary: [],
  demo: [],
  zona: [],
}
const MAX_BYTES = 4 * 1024 ** 3 // 4 GB por ficheiro

// ------------------------------------------------------------------ motor (Python)

/** módulos Python de que o pipeline precisa (requirements.txt; pillow-heif é opcional, só para HEIC) */
const MODULOS = ['cv2', 'numpy', 'ultralytics', 'torch', 'clip', 'scipy', 'PIL', 'yaml', 'pyproj', 'shapely', 'gpxpy', 'av', 'requests']

function candidatosPython(root: string) {
  return [
    process.env.CTRLF_PYTHON,
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean) as string[]
}

export interface EstadoMotor {
  python: string | null
  versao: string | null
  modulos: Record<string, boolean>
  disponivel: boolean
  em_falta: string[]
  mapillary_token: boolean
  kartaview: false
  verificado_em: string
}

let motorCache: { t: number; v: EstadoMotor } | null = null

export function estadoMotor(root: string): EstadoMotor {
  if (motorCache && Date.now() - motorCache.t < 60_000) return motorCache.v
  const script = `import importlib.util,json,sys;print(json.dumps({"v":sys.version.split()[0],"m":{m:importlib.util.find_spec(m) is not None for m in ${JSON.stringify(MODULOS)}}}))`
  let v: EstadoMotor = {
    python: null, versao: null, modulos: {}, disponivel: false, em_falta: MODULOS, mapillary_token: false,
    kartaview: false, verificado_em: new Date().toISOString(),
  }
  for (const py of candidatosPython(root)) {
    if (py.includes(path.sep) && !fs.existsSync(py)) continue
    const r = spawnSync(py, ['-c', script], { encoding: 'utf-8', timeout: 20_000 })
    if (r.status !== 0 || !r.stdout) continue
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').pop()!) as { v: string; m: Record<string, boolean> }
      const falta = Object.entries(j.m).filter(([, ok]) => !ok).map(([m]) => m)
      v = { ...v, python: py, versao: j.v, modulos: j.m, em_falta: falta, disponivel: falta.length === 0 }
      break
    } catch {
      /* tenta o próximo */
    }
  }
  // token do Mapillary: só se diz se existe, nunca o valor
  const env = path.join(root, '.env')
  const temToken = !!process.env.MAPILLARY_TOKEN || (fs.existsSync(env) && /^MAPILLARY_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(env, 'utf-8')))
  v.mapillary_token = temToken
  motorCache = { t: Date.now(), v }
  return v
}

// ------------------------------------------------------------------ registo das importações

const TMP = path.join(os.tmpdir(), 'ctrlf-importacoes')
let lista: Importacao[] | null = null
let ficheiroLista = ''
const processos = new Map<string, ChildProcess>()

/** Uma lista por município (<saida>/<municipio>/importacoes/); a antiga, por zona, é lida na primeira vez. */
function carregar(municipioDir: string, zonaDir: string, zona: string) {
  const f = path.join(municipioDir, 'importacoes', 'importacoes.json')
  if (lista && ficheiroLista === f) return lista
  ficheiroLista = f
  const antigo = path.join(zonaDir, 'importacoes', 'importacoes.json')
  try {
    lista = JSON.parse(fs.readFileSync(fs.existsSync(f) ? f : antigo, 'utf-8')) as Importacao[]
    for (const j of lista) j.zona ??= zona
    // processamentos interrompidos por um reinício do servidor
    for (const j of lista)
      if (j.estado === 'em_processamento' || j.estado === 'a_aguardar' || j.estado === 'rascunho') {
        j.estado = 'erro'
        j.erro = 'interrompido: o servidor foi reiniciado'
        apagarOriginais(j)
      }
  } catch {
    lista = []
  }
  return lista
}

function gravar() {
  if (!lista || !ficheiroLista) return
  fs.mkdirSync(path.dirname(ficheiroLista), { recursive: true })
  // metadados apenas (sem imagens); o log fica limitado
  fs.writeFileSync(ficheiroLista, JSON.stringify(lista.map((j) => ({ ...j, log: j.log.slice(-40) })), null, 1), 'utf-8')
}

function pastaTmp(j: Importacao) {
  return path.join(TMP, j.id)
}

function apagarOriginais(j: Importacao) {
  fs.rmSync(pastaTmp(j), { recursive: true, force: true })
  if (j.ficheiros.length) j.originais_apagados = true
}

function registar(j: Importacao, linha: string) {
  const l = linha.replace(/\r/g, '').trimEnd()
  if (!l) return
  j.log.push(l)
  if (j.log.length > 400) j.log.splice(0, j.log.length - 400)
}

// ------------------------------------------------------------------ execução

/** o técnico pode cancelar a meio (outro pedido HTTP muda o estado) */
const foiCancelado = (j: Importacao) => (j.estado as EstadoImportacao) === 'cancelado'

function correr(py: string, args: string[], root: string, j: Importacao, aoLer: (l: string) => void): Promise<number> {
  return new Promise((resolve) => {
    registar(j, `$ ${j.zona ? `CTRLF_ZONA=${j.zona} ` : ''}python ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`)
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...(j.zona ? { CTRLF_ZONA: j.zona } : {}) }
    const p = spawn(py, args, { cwd: root, env })
    processos.set(j.id, p)
    const ler = (b: Buffer) =>
      b
        .toString('utf-8')
        .split('\n')
        .forEach((l) => {
          registar(j, l)
          aoLer(l)
        })
    p.stdout.on('data', ler)
    p.stderr.on('data', ler)
    p.on('close', (code) => {
      processos.delete(j.id)
      resolve(code ?? 1)
    })
    p.on('error', (e) => {
      registar(j, String(e))
      resolve(1)
    })
  })
}

async function processar(j: Importacao, root: string) {
  j.estado = 'em_processamento'
  j.iniciado_em = new Date().toISOString()
  gravar()
  const total = j.passos.length
  const avancar = (passo: string, fracao = 0) => {
    j.passo = passo
    j.progresso = Math.min(99, Math.round(((j.passos.indexOf(passo) + fracao) / total) * 100))
  }
  try {
    const motor = estadoMotor(root)
    if (!motor.disponivel || !motor.python) throw new Error(`motor de processamento indisponível (falta: ${motor.em_falta.join(', ')})`)
    const py = motor.python
    const dir = pastaTmp(j)

    // 0) zona nova: vias, polígono de avaliação, edifícios e config/zonas/<id>.yaml
    if (j.tipo === 'zona') {
      avancar('zona')
      const c0 = await correr(py, ['pipeline/nova_zona.py', '--id', j.zona!, '--nome', j.zona_nome ?? j.zona!, '--vias', path.join(dir, 'vias.geojson'),
        ...(fs.existsSync(path.join(dir, 'poligono.geojson')) ? ['--poligono', path.join(dir, 'poligono.geojson')] : [])], root, j, () => gravarAsync())
      if (foiCancelado(j)) return
      if (c0 !== 0) throw new Error(`a criação da zona terminou com erro (código ${c0})`)
    }

    // 1) recolha + desfocagem
    avancar('ingest')
    let args: string[]
    if (j.tipo === 'fotos') {
      args = ['pipeline/ingest_fotos.py', dir, '--nome', j.nome, '--rua', j.rua]
    } else if (j.tipo === 'video') {
      const video = j.ficheiros.find((f) => !f.nome.toLowerCase().endsWith('.gpx'))
      const gpx = j.ficheiros.find((f) => f.nome.toLowerCase().endsWith('.gpx'))
      if (!video || !gpx) throw new Error('a importação de vídeo precisa de um vídeo e da trilha GPS (.gpx)')
      args = ['pipeline/ingest_video.py', path.join(dir, video.nome), path.join(dir, gpx.nome), '--nome', j.nome, '--offset-s', String(j.offset_s ?? 0)]
    } else {
      if (!motor.mapillary_token) throw new Error('falta MAPILLARY_TOKEN no ficheiro .env (ver README)')
      args = ['pipeline/fetch_mapillary.py']
    }
    const c1 = await correr(py, args, root, j, (l) => {
      const m = l.match(/^\[(\d+)\/(\d+)\]/)
      if (m) avancar('ingest', Number(m[1]) / Number(m[2]))
      gravarAsync()
    })
    if (foiCancelado(j)) return
    if (c1 !== 0) throw new Error(`a recolha terminou com erro (código ${c1})`)
    apagarOriginais(j) // as imagens já estão desfocadas em data/clean; os originais deixam de ser precisos

    // 2) pipeline de deteção → catálogo
    avancar(PASSOS_PIPELINE[0])
    const c2 = await correr(py, ['pipeline/run_all.py'], root, j, (l) => {
      const m = l.match(/^=== (\w+) ===/)
      if (m && j.passos.includes(m[1])) avancar(m[1])
      gravarAsync()
    })
    if (foiCancelado(j)) return
    if (c2 !== 0) throw new Error(`o processamento terminou com erro (código ${c2})`)
    j.estado = 'concluido'
    j.progresso = 100
    j.passo = undefined
  } catch (e) {
    if (!foiCancelado(j)) {
      j.estado = 'erro'
      j.erro = e instanceof Error ? e.message : String(e)
      registar(j, `ERRO: ${j.erro}`)
    }
  } finally {
    apagarOriginais(j)
    j.terminado_em = new Date().toISOString()
    gravar()
  }
}

/** Simulação para demonstração: percorre os passos sem tocar em ficheiros nem no catálogo. */
async function simular(j: Importacao) {
  j.estado = 'em_processamento'
  j.iniciado_em = new Date().toISOString()
  registar(j, 'DEMONSTRAÇÃO: nenhum ficheiro é lido nem processado; o catálogo não muda.')
  for (const [i, p] of j.passos.entries()) {
    if (foiCancelado(j)) return
    j.passo = p
    j.progresso = Math.round((i / j.passos.length) * 100)
    registar(j, `[simulação] ${NOME_PASSO[p] ?? p}…`)
    gravar()
    await new Promise((r) => setTimeout(r, 1600))
  }
  j.estado = 'concluido'
  j.progresso = 100
  j.passo = undefined
  j.terminado_em = new Date().toISOString()
  registar(j, '[simulação] concluída')
  gravar()
}

let aCorrer = false
async function proximo(root: string) {
  if (aCorrer || !lista) return
  const j = lista.find((x) => x.estado === 'a_aguardar')
  if (!j) return
  aCorrer = true
  try {
    await (j.demo ? simular(j) : processar(j, root))
  } finally {
    aCorrer = false
    void proximo(root)
  }
}

let gravarT: NodeJS.Timeout | null = null
function gravarAsync() {
  if (gravarT) return
  gravarT = setTimeout(() => {
    gravarT = null
    gravar()
  }, 1000)
}

// ------------------------------------------------------------------ http

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function lerJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

const publica = (j: Importacao) => ({ ...j, log: j.log.slice(-60) })

/**
 * Rotas /api/motor e /api/importacoes (só técnicos; a sessão é verificada antes).
 * Devolve true se tratou o pedido.
 */
export async function rotasImportacoes(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  metodo: string,
  ctx: { root: string; zonaDir: string; municipioDir: string; zona: string; zonas: string[]; tecnico: { utilizador: string; nome: string } },
): Promise<boolean> {
  if (url === '/api/motor' && metodo === 'GET') {
    json(res, 200, { ...estadoMotor(ctx.root), passos: NOME_PASSO })
    return true
  }
  if (!url.startsWith('/api/importacoes')) return false
  const jobs = carregar(ctx.municipioDir, ctx.zonaDir, ctx.zona)

  if (url === '/api/importacoes' && metodo === 'GET') {
    json(res, 200, [...jobs].reverse().map(publica))
    return true
  }
  if (url === '/api/importacoes' && metodo === 'POST') {
    const b = await lerJson(req)
    const tipo = b.tipo as TipoImportacao
    if (!['fotos', 'video', 'mapillary', 'demo', 'zona'].includes(tipo)) return json(res, 400, { erro: 'tipo inválido' }), true
    // zona nova: nome legível → id; as vias (GeoJSON) vão para a pasta temporária do trabalho
    let zonaNova: { id: string; nome: string; vias: { features: unknown[] }; poligono?: unknown } | null = null
    if (tipo === 'zona') {
      const zn = String(b.zona_nome ?? '').trim().slice(0, 80)
      const id = zn.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
      const vias = b.vias as { type?: string; features?: unknown[] } | undefined
      if (!zn || id.length < 2) return json(res, 400, { erro: 'indique o nome da zona' }), true
      if (ctx.zonas.includes(id)) return json(res, 400, { erro: `já existe uma zona "${id}"` }), true
      if (!vias || vias.type !== 'FeatureCollection' || !Array.isArray(vias.features) || !vias.features.length || vias.features.length > 400)
        return json(res, 400, { erro: 'escolha pelo menos uma rua' }), true
      if (jobs.some((x) => x.tipo === 'zona' && x.zona === id && ['a_aguardar', 'em_processamento'].includes(x.estado)))
        return json(res, 400, { erro: 'essa zona já está a ser criada' }), true
      zonaNova = { id, nome: zn, vias: vias as { features: unknown[] }, poligono: b.poligono }
    }
    const nome = zonaNova ? zonaNova.id : String(b.nome ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 40)
    if (!nome) return json(res, 400, { erro: 'indique um nome para a recolha' }), true
    const j: Importacao = {
      id: crypto.randomBytes(6).toString('hex'),
      tipo,
      nome,
      rua: zonaNova ? zonaNova.nome : String(b.rua ?? '').slice(0, 120),
      zona: zonaNova ? zonaNova.id : ctx.zona,
      ...(zonaNova ? { zona_nome: zonaNova.nome, n_vias: zonaNova.vias.features.length } : {}),
      offset_s: typeof b.offset_s === 'number' ? b.offset_s : undefined,
      estado: tipo === 'mapillary' || tipo === 'demo' || tipo === 'zona' ? 'a_aguardar' : 'rascunho',
      criado_em: new Date().toISOString(),
      criado_por: ctx.tecnico,
      ficheiros: [],
      passos: [...(zonaNova ? ['zona'] : []), 'ingest', ...PASSOS_PIPELINE],
      progresso: 0,
      log: [],
      demo: tipo === 'demo',
    }
    if (zonaNova) {
      fs.mkdirSync(pastaTmp(j), { recursive: true })
      fs.writeFileSync(path.join(pastaTmp(j), 'vias.geojson'), JSON.stringify(zonaNova.vias))
      if (zonaNova.poligono) fs.writeFileSync(path.join(pastaTmp(j), 'poligono.geojson'), JSON.stringify(zonaNova.poligono))
    }
    jobs.push(j)
    gravar()
    void proximo(ctx.root)
    json(res, 200, publica(j))
    return true
  }

  const m = url.match(/^\/api\/importacoes\/([0-9a-f]{12})(\/[a-z]+)?$/)
  const j = m && jobs.find((x) => x.id === m[1])
  if (!m || !j) return json(res, 404, { erro: 'importação não encontrada' }), true
  const acao = m[2]

  // envio de um ficheiro: corpo binário; nome no parâmetro ?nome=
  if (acao === '/ficheiros' && metodo === 'PUT') {
    if (j.estado !== 'rascunho') return json(res, 409, { erro: 'a importação já foi iniciada' }), true
    const nome = path.basename(new URL(req.url ?? '', 'http://x').searchParams.get('nome') ?? '').replace(/[^\w.\- ]+/g, '_')
    const ext = path.extname(nome).toLowerCase()
    if (!nome || !EXT[j.tipo].includes(ext)) return json(res, 400, { erro: `tipo de ficheiro não aceite (${ext || 'sem extensão'})` }), true
    fs.mkdirSync(pastaTmp(j), { recursive: true })
    const destino = path.join(pastaTmp(j), nome)
    let bytes = 0
    let excedeu = false
    const out = fs.createWriteStream(destino)
    req.on('data', (c: Buffer) => {
      bytes += c.length
      if (bytes > MAX_BYTES && !excedeu) {
        excedeu = true
        req.unpipe(out)
        out.destroy()
        fs.rmSync(destino, { force: true })
        json(res, 413, { erro: 'ficheiro demasiado grande (máx. 4 GB)' })
      }
    })
    req.pipe(out)
    out.on('finish', () => {
      if (excedeu) return
      j.ficheiros = [...j.ficheiros.filter((f) => f.nome !== nome), { nome, bytes }]
      gravar()
      json(res, 200, publica(j))
    })
    return true
  }
  if (acao === '/iniciar' && metodo === 'POST') {
    if (j.estado !== 'rascunho') return json(res, 409, { erro: 'a importação já foi iniciada' }), true
    if (!j.ficheiros.length) return json(res, 400, { erro: 'envie pelo menos um ficheiro' }), true
    if (j.tipo === 'video' && !(j.ficheiros.some((f) => f.nome.toLowerCase().endsWith('.gpx')) && j.ficheiros.some((f) => !f.nome.toLowerCase().endsWith('.gpx'))))
      return json(res, 400, { erro: 'o vídeo precisa da trilha GPS (.gpx) gravada ao mesmo tempo' }), true
    j.estado = 'a_aguardar'
    gravar()
    void proximo(ctx.root)
    json(res, 200, publica(j))
    return true
  }
  if (acao === '/cancelar' && metodo === 'POST') {
    if (['concluido', 'erro', 'cancelado'].includes(j.estado)) return json(res, 409, { erro: 'já terminou' }), true
    j.estado = 'cancelado'
    j.terminado_em = new Date().toISOString()
    processos.get(j.id)?.kill()
    apagarOriginais(j)
    registar(j, 'cancelado pelo técnico')
    gravar()
    json(res, 200, publica(j))
    return true
  }
  json(res, 405, { erro: 'método não suportado' })
  return true
}
