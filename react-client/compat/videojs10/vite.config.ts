import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../node_modules/.cache/ums-videojs10',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/v1': { target: process.env.UMS_PLAYER_ORIGIN || 'http://127.0.0.1:9002', ws: true } },
  },
})
