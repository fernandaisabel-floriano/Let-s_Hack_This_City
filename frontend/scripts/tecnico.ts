/**
 * Gestão das contas dos técnicos (data/tecnicos.json, fora do git).
 *
 *   node scripts/tecnico.ts listar
 *   node scripts/tecnico.ts adicionar <utilizador> "<Nome completo>"   (pede a password)
 *
 * A primeira conta também pode ser criada no ecrã de login.
 */
import readline from 'node:readline'
import { criarConta, lerContas, validarNovaConta } from '../server/api.ts'

function perguntarOculto(pergunta: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream }
    let mostrar = true
    out._writeToOutput = (s: string) => {
      if (mostrar) process.stdout.write(s)
      else if (s.includes('\n')) process.stdout.write('\n')
    }
    rl.question(pergunta, (r) => {
      rl.close()
      resolve(r)
    })
    mostrar = false
  })
}

const [cmd, utilizador, nome] = process.argv.slice(2)

if (cmd === 'listar') {
  const contas = lerContas()
  if (!contas.length) console.log('Sem contas.')
  for (const c of contas) console.log(`${c.utilizador.padEnd(20)} ${c.nome}  (criada a ${c.criado_em.slice(0, 10)})`)
} else if (cmd === 'adicionar') {
  const u = (utilizador ?? '').trim().toLowerCase()
  const pw = await perguntarOculto(`Password para ${u}: `)
  const pw2 = await perguntarOculto('Repetir password: ')
  const erro = validarNovaConta(u, nome, pw) ?? (pw !== pw2 ? 'as passwords não coincidem' : null)
  if (erro) {
    console.error(`Erro: ${erro}`)
    process.exit(1)
  }
  criarConta(u, nome.trim(), pw)
  console.log(`Conta ${u} criada.`)
} else {
  console.log('Uso:\n  node scripts/tecnico.ts listar\n  node scripts/tecnico.ts adicionar <utilizador> "<Nome completo>"')
}
