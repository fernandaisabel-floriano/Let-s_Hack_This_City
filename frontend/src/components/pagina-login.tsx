import pin from '@/assets/mapeya-pin.png'
import { ArrowLeft, CircleCheck, Loader2, LogIn, ShieldCheck, TriangleAlert, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  motivo?: string | null
  primeiraConta: boolean
  semServidor?: boolean
  onEntrar: (utilizador: string, password: string) => Promise<void>
  onCriar: (utilizador: string, nome: string, password: string) => Promise<void>
  onVoltar: () => void
}

export function Marca({ claro }: { claro?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={pin} alt="" className="h-10 w-auto" />
      <div className="leading-tight">
        <p className={claro ? 'font-marca text-2xl font-semibold text-white' : 'font-marca text-2xl font-semibold'}>
          Mape<span className="text-marca">ya</span>
        </p>
        <p className={claro ? 'text-xs text-white/80' : 'text-xs text-muted-foreground'}>Câmara Municipal de Aveiro</p>
      </div>
    </div>
  )
}

/** Página de entrada dos técnicos municipais (nome de utilizador + palavra-passe). */
export function PaginaLogin({ motivo, primeiraConta, semServidor, onEntrar, onCriar, onVoltar }: Props) {
  const [utilizador, setUtilizador] = useState('')
  const [nome, setNome] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aEnviar, setAEnviar] = useState(false)

  const submeter = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    if (primeiraConta && password !== password2) return setErro('As palavras-passe não coincidem.')
    setAEnviar(true)
    try {
      if (primeiraConta) await onCriar(utilizador, nome, password)
      else await onEntrar(utilizador, password)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-10 text-white lg:flex">
        <Marca claro />
        <div className="relative flex max-w-md flex-col gap-6">
          <h1 className="text-3xl leading-tight font-semibold text-white">Plataforma de gestão do mobiliário urbano</h1>
          <p className="text-white/85">
            Sinais de trânsito, iluminação pública e contentores identificados a partir de imagens de fontes abertas e de vídeos gravados na rua. A IA deteta; o técnico supervisiona
            e valida.
          </p>
          <ul className="flex flex-col gap-2.5 text-sm text-white/80">
            {['Deteção local, sem APIs comerciais', 'Rostos e matrículas desfocados antes de gravar', 'Cada validação fica registada com o nome do técnico'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CircleCheck className="size-4 text-realce" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/80">Protótipo · zona piloto Santos Mártires · Aveiro Tech City Hackathon 2026</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="lg:hidden"><Marca /></div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-semibold">{primeiraConta ? 'Criar a primeira conta' : 'Entrar'}</h2>
            <p className="text-sm text-muted-foreground">
              {motivo ? `${motivo} ` : ''}
              {primeiraConta ? 'Ainda não há técnicos registados neste servidor.' : 'Acesso reservado a técnicos autorizados da Câmara Municipal.'}
            </p>
          </div>

          <form onSubmit={submeter} className="flex flex-col gap-4">
            {semServidor && (
              <Alert variant="destructive">
                <AlertDescription>Sem ligação ao servidor. Arranque a aplicação com <code>npm run dev</code>.</AlertDescription>
              </Alert>
            )}
            {primeiraConta && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="nome" className="etiqueta">Nome completo</Label>
                <Input id="nome" autoComplete="name" required value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="utilizador" className="etiqueta">Utilizador</Label>
              <Input
                id="utilizador"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={primeiraConta ? 'ex.: maria.silva' : undefined}
                autoFocus
                required
                pattern={primeiraConta ? '[a-zA-Z0-9._\-]{3,32}' : undefined}
                title={primeiraConta ? '3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado' : undefined}
                value={utilizador}
                onChange={(e) => setUtilizador(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="etiqueta">Palavra-passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete={primeiraConta ? 'new-password' : 'current-password'}
                required
                minLength={primeiraConta ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {primeiraConta && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="password2" className="etiqueta">Repetir palavra-passe</Label>
                <Input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </div>
            )}
            {erro && (
              <Alert variant="destructive" role="alert">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={aEnviar || semServidor}>
              {aEnviar ? <Loader2 className="animate-spin" aria-hidden="true" /> : primeiraConta ? <UserPlus aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              {primeiraConta ? 'Criar conta e entrar' : 'Entrar'}
            </Button>
          </form>

          <div className="flex flex-col gap-3 border-t pt-5 text-sm">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {primeiraConta ? 'A palavra-passe é guardada cifrada (scrypt) no servidor.' : 'Sem conta? Peça acesso ao administrador da plataforma.'}
            </p>
            <button onClick={onVoltar} className="inline-flex items-center gap-1.5 self-start text-primary hover:underline">
              <ArrowLeft className="size-4" aria-hidden="true" /> Continuar sem sessão (consulta pública)
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
