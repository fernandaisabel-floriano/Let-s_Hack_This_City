import { useCallback, useEffect, useState } from 'react'
import type { Tecnico } from '@/lib/types'

type Estado =
  | { tipo: 'a-carregar' }
  | { tipo: 'sem-servidor' }
  | { tipo: 'anonimo'; primeiraConta: boolean }
  | { tipo: 'autenticado'; tecnico: Tecnico }

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro ?? `Erro ${r.status}`)
  return j
}

export function useSessao() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'a-carregar' })

  const verificar = useCallback(async () => {
    try {
      const r = await fetch('/api/sessao')
      const j = await r.json()
      if (r.ok) setEstado({ tipo: 'autenticado', tecnico: j as Tecnico })
      else setEstado({ tipo: 'anonimo', primeiraConta: !!j.primeira_conta })
    } catch {
      setEstado({ tipo: 'sem-servidor' })
    }
  }, [])

  useEffect(() => {
    verificar()
  }, [verificar])

  const entrar = useCallback(async (utilizador: string, password: string) => {
    const t = (await post('/api/login', { utilizador, password })) as Tecnico
    setEstado({ tipo: 'autenticado', tecnico: t })
  }, [])

  /** primeira conta do servidor: nome de utilizador, nome completo e palavra-passe */
  const criarPrimeira = useCallback(async (utilizador: string, nome: string, password: string) => {
    const t = (await post('/api/tecnicos', { utilizador, nome, password })) as Tecnico
    setEstado({ tipo: 'autenticado', tecnico: t })
  }, [])

  const sair = useCallback(async () => {
    await post('/api/logout').catch(() => {})
    setEstado({ tipo: 'anonimo', primeiraConta: false })
  }, [])

  /** um pedido devolveu 401: a sessão expirou ou o servidor reiniciou */
  const expirou = useCallback(() => setEstado({ tipo: 'anonimo', primeiraConta: false }), [])

  return { estado, entrar, criarPrimeira, sair, expirou }
}
