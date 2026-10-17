import { defineConfig } from 'vite'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(18).toString('base64') : undefined
  if (nonce) process.env.PROPRE_DEV_CSP_NONCE = nonce
  return {
    base: './',
    html: { cspNonce: nonce },
    plugins: [
      react(),
      electron({
        main: { entry: 'electron/main.ts' },
        preload: { input: path.join(import.meta.dirname, 'electron/preload.ts') },
      }),
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { chunkSizeWarningLimit: 700 },
  }
})
