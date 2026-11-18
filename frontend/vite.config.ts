import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { apiHandler } from './server/api.ts'

/** Serve os dados do pipeline, as contas dos técnicos e o registo de validações. Ver server/api.ts. */
function pipelineApi(): Plugin {
  return {
    name: 'ctrlf-api',
    configureServer: (server) => void server.middlewares.use(apiHandler()),
    configurePreviewServer: (server) => void server.middlewares.use(apiHandler()),
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pipelineApi()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
