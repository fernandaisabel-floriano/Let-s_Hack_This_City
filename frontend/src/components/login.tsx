import { Loader2, LogIn, ShieldCheck, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** porque se pediu o login (ex.: "A validação é reservada a técnicos.") */
  motivo?: string | null
  primeiraConta: boolean
  semServidor?: boolean
  onEntrar: (utilizador: string, password: string) => Promise<void>
  onCriar: (utilizador: string, nome: string, password: string) => Promise<void>
}

export function LoginDialog({ open, onOpenChange, motivo, primeiraConta, semServidor, onEntrar, onCriar }: Props) {
  const [utilizador, setUtilizador] = useState('')
  const [nome, setNome] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aEnviar, setAEnviar] = useState(false)

  const submeter = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setErro(null)
    if (primeiraConta && password !== password2) return setErro('As passwords não coincidem.')
    setAEnviar(true)
    try {
      if (primeiraConta) await onCriar(utilizador, nome, password)
      else await onEntrar(utilizador, password)
      setPassword('')
      setPassword2('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submeter} className="flex flex-col gap-5">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              {primeiraConta ? <UserPlus className="size-5" /> : <ShieldCheck className="size-5" />}
            </div>
            <DialogTitle className="font-heading text-xl">{primeiraConta ? 'Criar a primeira conta de técnico' : 'Área do técnico'}</DialogTitle>
            <DialogDescription>
              {motivo ? `${motivo} ` : ''}
              {primeiraConta
                ? 'Ainda não há técnicos registados. O seu nome fica associado a cada validação.'
                : 'Cada validação fica registada com o seu nome.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {semServidor && (
              <Alert variant="destructive">
                <AlertDescription>Sem ligação ao servidor. Arranque a app com <code>npm run dev</code>.</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="utilizador">Utilizador</Label>
              <Input id="utilizador" autoComplete="username" autoFocus required value={utilizador} onChange={(e) => setUtilizador(e.target.value)} />
            </div>
            {primeiraConta && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="nome">Nome completo</Label>
                <Input id="nome" autoComplete="name" required value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
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
                <Label htmlFor="password2">Repetir password</Label>
                <Input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </div>
            )}
            {erro && (
              <Alert variant="destructive">
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-col">
            <Button type="submit" className="w-full" disabled={aEnviar || semServidor}>
              {aEnviar ? <Loader2 className="animate-spin" /> : primeiraConta ? <UserPlus /> : <LogIn />}
              {primeiraConta ? 'Criar conta e entrar' : 'Entrar'}
            </Button>
            {!primeiraConta && (
              <p className="text-center text-xs text-muted-foreground">Sem conta? Peça acesso ao administrador do sistema.</p>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
