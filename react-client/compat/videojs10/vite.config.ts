import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const proxy = {
  '/v1': { target: process.env.UMS_PLAYER_ORIGIN || 'http://127.0.0.1:9002', ws: true },
  ...(process.env.UMS_SIMULATOR_REPORT === '1' && { '/__simulator-report': 'http://127.0.0.1:' + (process.env.UMS_SIMULATOR_REPORT_PORT || '5289') }),
}

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../node_modules/.cache/ums-videojs10',
    emptyOutDir: true,
    rollupOptions: { input: { index: root + 'index.html', simulator: root + 'safari/simulator.html' } },
  },
  server: { proxy },
  preview: { proxy },
})
