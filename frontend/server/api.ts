/**
 * API local do front-end (corre dentro do servidor Vite, em dev e em preview).
 *
 *   GET  /api/config            campos de config/municipio.yaml
 *   GET  /api/sessao            técnico autenticado (401 se não houver sessão)
 *   POST /api/login             {utilizador, password}
 *   POST /api/logout
 *   POST /api/tecnicos          cria a PRIMEIRA conta (só quando ainda não há nenhuma)
 *   GET  /api/decisoes          estado atual das validações + registo completo
 *   POST /api/decisoes          {acao: decisao|desfazer|limpar, ...} — exige sessão
 *   /zona/<caminho>             ficheiros de <saida>/<municipio>/<zona>/
 *   /config/<caminho>           ficheiros de config/
 *
 *   GET  /api/estado            público: estado atual de cada elemento e pares decididos, sem nomes
 *   GET  /api/duplicados        público: pares de elementos duplicados (server/duplicados.ts)
 *   GET  /api/sugestoes         público: tipo de contentor sugerido pelo CLIP (server/sugestoes.ts)
 *   GET  /api/imagens           público: proveniência, licença e desfocagem de cada imagem (server/imagens.ts)
 *   GET  /api/motor, /api/importacoes…   técnicos: importação e processamento (server/importacoes.ts)
 *   POST /api/decisoes {acao: "par", a, b, mesmo}   o técnico decide um possível duplicado
 *   POST /api/metrica          técnicos: corre pipeline/evaluate.py (M10) e devolve a saída
 *   /zona/ público só para o catálogo e as imagens (ZONA_PUBLICA); o resto exige sessão
 *
 * Ficheiros gravados (em data/; ver .gitignore — tecnicos.json não deve ir para o git):
 *   data/tecnicos.json                               contas (password com scrypt + sal)
 *   <zona>/catalogo/registo_validacoes.jsonl         registo de auditoria, só acrescenta
 *   <zona>/catalogo/validacoes.json                  última decisão por elemento,
 *                                                    no formato de confianca.py recalibrar
 *
 * O técnico que fica no registo é o da sessão, nunca um campo enviado pelo browser.
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { duplicadosDaZona } from './duplicados.ts'
import { imagensDaZona } from './imagens.ts'
import { estadoMotor, rotasImportacoes } from './importacoes.ts'
import { sugestoesDaZona } from './sugestoes.ts'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')

// ------------------------------------------------------------------ config

/** "8" → 8; "{sinal: 8, candeeiro: 6}" → {sinal: 8, candeeiro: 6} (YAML em linha) */
function lerNumeroOuMapa(v: string | null, omissao: number): number | Record<string, number> {
  if (!v) return omissao
  const m = v.match(/^\{(.*)\}$/)
  if (!m) return Number.isFinite(Number(v)) ? Number(v) : omissao
  const out: Record<string, number> = {}
  for (const par of m[1].split(',')) {
    const [k, n] = par.split(':').map((s) => s.trim().replace(/^["']|["']$/g, ''))
    if (k && Number.isFinite(Number(n))) out[k] = Number(n)
  }
  return out
}

export function readMunicipio() {
  const txt = fs.readFileSync(path.join(ROOT, 'config/municipio.yaml'), 'utf-8')
  const top = (key: string) => {
    const m = txt.match(new RegExp(`^${key}:\\s*([^#\\n]+)`, 'm'))
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  }
  const nested = (section: string, key: string) => {
    const block = txt.match(new RegExp(`^${section}:\\s*\\n((?:[ \\t]+.*\\n?)*)`, 'm'))
    if (!block) return null
    const m = block[1].match(new RegExp(`^[ \\t]+${key}:\\s*([^#\\n]+)`, 'm'))
    return m ? m[1].trim() : null
  }
  const bbox = top('bbox')
  return {
    municipio: top('municipio') ?? 'aveiro',
    zona: top('zona') ?? 'santos-martires',
    saida: top('saida') ?? 'data/clean',
    bbox: bbox ? (JSON.parse(bbox) as number[]) : null,
    rua_geojson: top('rua_geojson'),
    zona_avaliacao_geojson: top('zona_avaliacao_geojson'),
    crs_local: top('crs_local') ?? 'EPSG:3763',
    limiar_auto: Number(nested('m8', 'limiar_auto') ?? 0.9),
    min_vistas: Number(nested('m8', 'min_vistas') ?? 2),
    raio_fusao_m: lerNumeroOuMapa(nested('m6', 'raio_fusao_m'), 8),
    so_dentro_da_zona: (nested('m9', 'so_dentro_da_zona') ?? 'true') === 'true',
  }
}

const zonaDir = () => {
  const c = readMunicipio()
  return path.join(ROOT, c.saida, c.municipio, c.zona)
}

// ------------------------------------------------------------------ contas

interface Conta {
  utilizador: string
  nome: string
  /** email institucional (opcional nas contas antigas); também serve para entrar */
  email?: string
  salt: string
  hash: string
  criado_em: string
}

const CONTAS = path.join(ROOT, 'data', 'tecnicos.json')

export function lerContas(): Conta[] {
  try {
    return JSON.parse(fs.readFileSync(CONTAS, 'utf-8')) as Conta[]
  } catch {
    return []
  }
}

export function criarConta(utilizador: string, nome: string, password: string, email?: string): Conta {
  const contas = lerContas()
  if (contas.some((c) => c.utilizador === utilizador)) throw new Error('utilizador já existe')
  if (email && contas.some((c) => c.email === email)) throw new Error('email já registado')
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  const conta: Conta = { utilizador, nome, ...(email ? { email } : {}), salt, hash, criado_em: new Date().toISOString() }
  fs.mkdirSync(path.dirname(CONTAS), { recursive: true })
  fs.writeFileSync(CONTAS, JSON.stringify([...contas, conta], null, 1), 'utf-8')
  return conta
}

function verificar(c: Conta, password: string) {
  const h = crypto.scryptSync(password, c.salt, 64)
  return crypto.timingSafeEqual(h, Buffer.from(c.hash, 'hex'))
}

export function validarNovaConta(utilizador: unknown, nome: unknown, password: unknown, email?: unknown) {
  if (typeof utilizador !== 'string' || !/^[a-z0-9._-]{3,32}$/.test(utilizador))
    return 'utilizador: 3–32 caracteres (minúsculas, números, . _ -)'
  if (email !== undefined && email !== '' && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    return 'email inválido'
  if (typeof nome !== 'string' || nome.trim().length < 2) return 'indique o nome completo'
  if (typeof password !== 'string' || password.length < 8) return 'a password tem de ter pelo menos 8 caracteres'
  return null
}

// ------------------------------------------------------------------ sessões (em memória: reiniciar o servidor termina-as)

const SESSAO_MS = 12 * 60 * 60 * 1000
const sessoes = new Map<string, { utilizador: string; nome: string; expira: number }>()
const falhas = new Map<string, { n: number; desde: number }>()

function cookie(req: IncomingMessage, nome: string) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

function sessaoDe(req: IncomingMessage) {
  const tok = cookie(req, 'ctrlf_sessao')
  if (!tok) return null
  const s = sessoes.get(tok)
  if (!s || s.expira < Date.now()) {
    if (s) sessoes.delete(tok)
    return null
  }
  return { ...s, token: tok }
}

function abrirSessao(res: ServerResponse, c: { utilizador: string; nome: string }) {
  const tok = crypto.randomBytes(32).toString('hex')
  sessoes.set(tok, { utilizador: c.utilizador, nome: c.nome, expira: Date.now() + SESSAO_MS })
  res.setHeader('Set-Cookie', `ctrlf_sessao=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}`)
}

// ------------------------------------------------------------------ validações

interface Validacao {
  id: string
  classe: string
  confiancas_vistas: number[]
  estado: 'validado' | 'corrigido' | 'rejeitado'
  classe_corrigida?: string
  subtipo_corrigido?: string | null
  lat?: number
  lon?: number
  tempo_s?: number
  /** rejeitado por ser o mesmo objeto que outro elemento (M10) */
  duplicado_de?: string
  validado_em: string
  validado_por: { utilizador: string; nome: string }
}

interface Evento {
  seq: number
  quando: string
  tecnico: { utilizador: string; nome: string }
  acao: 'decisao' | 'desfazer' | 'limpar' | 'par'
  id?: string
  validacao?: Omit<Validacao, 'validado_em' | 'validado_por'>
  /** acao "par": a e b são (mesmo = true) ou não são (false) o mesmo objeto */
  a?: string
  b?: string
  mesmo?: boolean
}

/** Última decisão do técnico sobre cada par de possíveis duplicados. "limpar" apaga também estas. */
function paresDecididos(reg: Evento[]) {
  const m = new Map<string, { a: string; b: string; mesmo: boolean }>()
  for (const e of reg) {
    if (e.acao === 'limpar') m.clear()
    else if (e.acao === 'par' && e.a && e.b) m.set([e.a, e.b].sort().join('|'), { a: e.a, b: e.b, mesmo: !!e.mesmo })
  }
  return [...m.values()]
}

const registoPath = () => path.join(zonaDir(), 'catalogo', 'registo_validacoes.jsonl')

function lerRegisto(): Evento[] {
  try {
    return fs
      .readFileSync(registoPath(), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Evento)
  } catch {
    return []
  }
}

function estadoAtual(reg: Evento[]) {
  const atual: Record<string, Validacao> = {}
  for (const e of reg) {
    if (e.acao === 'limpar') for (const k of Object.keys(atual)) delete atual[k]
    else if (e.acao === 'desfazer' && e.id) delete atual[e.id]
    else if (e.acao === 'decisao' && e.validacao)
      atual[e.validacao.id] = { ...e.validacao, validado_em: e.quando, validado_por: e.tecnico }
  }
  return atual
}

function normalizar(v: Record<string, unknown>): Evento['validacao'] | null {
  const estados = ['validado', 'corrigido', 'rejeitado']
  if (typeof v.id !== 'string' || typeof v.classe !== 'string' || !estados.includes(v.estado as string)) return null
  if (!Array.isArray(v.confiancas_vistas) || !v.confiancas_vistas.every((c) => typeof c === 'number')) return null
  const out: Evento['validacao'] = {
    id: v.id,
    classe: v.classe,
    confiancas_vistas: v.confiancas_vistas as number[],
    estado: v.estado as Validacao['estado'],
  }
  if (typeof v.classe_corrigida === 'string') out.classe_corrigida = v.classe_corrigida
  if (typeof v.subtipo_corrigido === 'string' || v.subtipo_corrigido === null) out.subtipo_corrigido = v.subtipo_corrigido as string | null
  if (typeof v.lat === 'number' && typeof v.lon === 'number') Object.assign(out, { lat: v.lat, lon: v.lon })
  if (typeof v.tempo_s === 'number') out.tempo_s = v.tempo_s
  if (typeof v.duplicado_de === 'string' && v.duplicado_de && v.duplicado_de !== v.id && out.estado === 'rejeitado')
    out.duplicado_de = v.duplicado_de
  return out
}

function acrescentar(ev: Omit<Evento, 'seq' | 'quando'>) {
  const reg = lerRegisto()
  const novo: Evento = { seq: (reg.at(-1)?.seq ?? 0) + 1, quando: new Date().toISOString(), ...ev }
  fs.mkdirSync(path.dirname(registoPath()), { recursive: true })
  fs.appendFileSync(registoPath(), JSON.stringify(novo) + '\n', 'utf-8')
  reg.push(novo)
  const atual = estadoAtual(reg)
  fs.writeFileSync(
    path.join(path.dirname(registoPath()), 'validacoes.json'),
    JSON.stringify(Object.values(atual), null, 1),
    'utf-8',
  )
  return { validacoes: atual, registo: reg }
}

// ------------------------------------------------------------------ http

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function serveFile(base: string, rel: string, res: ServerResponse) {
  const file = path.resolve(base, decodeURIComponent(rel))
  if (!file.startsWith(path.resolve(base) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return json(res, 404, { erro: 'não encontrado' })
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  fs.createReadStream(file).pipe(res)
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1_000_000) reject(new Error('pedido demasiado grande'))
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * O que o público pode ler da pasta da zona: o catálogo e as imagens (já desfocadas
 * na recolha). Deteções brutas, referência, cobertura e registo ficam só para técnicos.
 */
const ZONA_PUBLICA = /^(catalogo\/(elementos\.json|resumo\.json|catalogo\.geojson|catalogo\.csv)|deteccoes\/recortes\/[^/]+\.jpe?g|(mapillary|video|fotos)\/.+\.(jpe?g|png))$/i

export function apiHandler() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? '').split('?')[0]
    const metodo = req.method ?? 'GET'
    try {
      if (url === '/api/config') return json(res, 200, readMunicipio())

      if (url === '/api/sessao') {
        const s = sessaoDe(req)
        if (!s) return json(res, 401, { primeira_conta: lerContas().length === 0 })
        return json(res, 200, { utilizador: s.utilizador, nome: s.nome })
      }

      if (url === '/api/login' && metodo === 'POST') {
        const ip = req.socket.remoteAddress ?? '?'
        const f = falhas.get(ip)
        if (f && f.n >= 5 && Date.now() - f.desde < 5 * 60_000)
          return json(res, 429, { erro: 'Demasiadas tentativas. Tente de novo dentro de 5 minutos.' })
        const { utilizador, password } = await lerCorpo(req)
        // entra-se com o email institucional ou com o nome de utilizador
        const id = String(utilizador ?? '').trim().toLowerCase()
        const conta = lerContas().find((c) => c.utilizador === id || (!!c.email && c.email === id))
        if (!conta || typeof password !== 'string' || !verificar(conta, password)) {
          const g = f && Date.now() - f.desde < 5 * 60_000 ? f : { n: 0, desde: Date.now() }
          falhas.set(ip, { ...g, n: g.n + 1 })
          return json(res, 401, { erro: 'Utilizador ou palavra-passe incorretos.' })
        }
        falhas.delete(ip)
        abrirSessao(res, conta)
        return json(res, 200, { utilizador: conta.utilizador, nome: conta.nome })
      }

      if (url === '/api/logout' && metodo === 'POST') {
        const s = sessaoDe(req)
        if (s) sessoes.delete(s.token)
        res.setHeader('Set-Cookie', 'ctrlf_sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        return json(res, 200, { ok: true })
      }

      if (url === '/api/tecnicos' && metodo === 'POST') {
        if (lerContas().length > 0)
          return json(res, 403, { erro: 'Já existem contas. Novas contas: node scripts/tecnico.ts adicionar' })
        const { utilizador, nome, password, email } = await lerCorpo(req)
        const em = String(email ?? '').trim().toLowerCase()
        // sem utilizador explícito, usa a parte do email antes do @
        const u = String(utilizador || em.split('@')[0] || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
        const erro = validarNovaConta(u, nome, password, em)
        if (erro) return json(res, 400, { erro })
        const conta = criarConta(u, String(nome).trim(), password as string, em || undefined)
        abrirSessao(res, conta)
        return json(res, 200, { utilizador: conta.utilizador, nome: conta.nome })
      }

      // ---- público (cidadãos): estado atual de cada elemento, sem nomes nem tempos
      if (url === '/api/estado' && metodo === 'GET') {
        const publico: Record<string, Partial<Validacao>> = {}
        for (const [id, v] of Object.entries(estadoAtual(lerRegisto()))) {
          publico[id] = { estado: v.estado, classe: v.classe, classe_corrigida: v.classe_corrigida, subtipo_corrigido: v.subtipo_corrigido, lat: v.lat, lon: v.lon }
        }
        return json(res, 200, { elementos: publico, pares: paresDecididos(lerRegisto()) })
      }
      // proveniência e desfocagem de cada imagem (atribuição CC BY-SA, privacidade): público
      if (url === '/api/imagens' && metodo === 'GET') return json(res, 200, imagensDaZona(zonaDir()))
      // tipo de contentor sugerido pelo CLIP (por confirmar pelo técnico): público
      if (url === '/api/sugestoes' && metodo === 'GET') return json(res, 200, sugestoesDaZona(zonaDir()))
      // pares de elementos duplicados (só ids e distâncias: público)
      if (url === '/api/duplicados' && metodo === 'GET') {
        const cfg = readMunicipio()
        const r = cfg.raio_fusao_m
        const raio = (t: string) => (typeof r === 'number' ? r : (r[t] ?? 8))
        return json(res, 200, duplicadosDaZona(zonaDir(), raio))
      }
      if (url.startsWith('/zona/') && ZONA_PUBLICA.test(decodeURIComponent(url.slice('/zona/'.length))))
        return serveFile(zonaDir(), url.slice('/zona/'.length), res)

      // ---- daqui para baixo, só com sessão
      const precisaSessao = url.startsWith('/api/') || url.startsWith('/zona/')
      const s = precisaSessao ? sessaoDe(req) : null
      if (precisaSessao && !s) return json(res, 401, { erro: 'sessão necessária' })

      // importação e processamento (pipeline Python): só técnicos
      if (url === '/api/motor' || url.startsWith('/api/importacoes')) {
        if (await rotasImportacoes(req, res, url, metodo, { root: ROOT, zonaDir: zonaDir(), tecnico: { utilizador: s!.utilizador, nome: s!.nome } })) return
      }

      if (url === '/api/decisoes' && metodo === 'GET') {
        const reg = lerRegisto()
        return json(res, 200, { validacoes: estadoAtual(reg), registo: reg })
      }

      if (url === '/api/decisoes' && metodo === 'POST') {
        const b = await lerCorpo(req)
        const tecnico = { utilizador: s!.utilizador, nome: s!.nome }
        if (b.acao === 'decisao') {
          const v = normalizar((b.validacao ?? {}) as Record<string, unknown>)
          if (!v) return json(res, 400, { erro: 'validação inválida' })
          return json(res, 200, acrescentar({ tecnico, acao: 'decisao', id: v.id, validacao: v }))
        }
        if (b.acao === 'desfazer' && typeof b.id === 'string')
          return json(res, 200, acrescentar({ tecnico, acao: 'desfazer', id: b.id }))
        if (b.acao === 'limpar') return json(res, 200, acrescentar({ tecnico, acao: 'limpar' }))
        // decisão sobre um par de possíveis duplicados: mesmo objeto ou não
        if (b.acao === 'par' && typeof b.a === 'string' && typeof b.b === 'string' && b.a !== b.b && typeof b.mesmo === 'boolean')
          return json(res, 200, acrescentar({ tecnico, acao: 'par', a: b.a, b: b.b, mesmo: b.mesmo }))
        return json(res, 400, { erro: 'ação desconhecida' })
      }

      // M10: recalcula catalogo/metrica.json a partir do registo e de contagem.json
      if (url === '/api/metrica' && metodo === 'POST') {
        const py = estadoMotor(ROOT).python
        if (!py) return json(res, 503, { erro: 'Python não encontrado (ver CTRLF_PYTHON ou .venv)' })
        const r = spawnSync(py, ['pipeline/evaluate.py'], {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 120_000,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        })
        const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
        if (r.status !== 0) return json(res, 500, { erro: saida.split('\n').pop() || 'evaluate.py falhou', saida })
        return json(res, 200, { ok: true, saida })
      }

      if (url.startsWith('/zona/')) return serveFile(zonaDir(), url.slice('/zona/'.length), res)
      if (url.startsWith('/config/')) return serveFile(path.join(ROOT, 'config'), url.slice('/config/'.length), res)
    } catch (e) {
      return json(res, 500, { erro: String(e instanceof Error ? e.message : e) })
    }
    next()
  }
}
