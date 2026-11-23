import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const simulator = process.env.UMS_SIMULATOR_REPORT === '1'
const playerProxy: ProxyOptions = { target: process.env.UMS_PLAYER_ORIGIN || 'http://127.0.0.1:9002', ws: true }
if (simulator) {
  playerProxy.configure = (proxy) => {
    proxy.on('proxyReq', (_outgoing, req, res) => {
      const segment = req.url?.match(/\/hls\/(\w[\w-]*\/\d+\.ts)$/)?.[1]
      if (!segment) return
      const start = Date.now()
      res.once('close', () => {
        console.info('HLS segment', segment, req.headers.range || 'full', res.statusCode,
          res.writableFinished ? 'sent' : 'interrupted', Date.now() - start, 'ms')
      })
    })
  }
}
const proxy = {
  '/v1': playerProxy,
  ...(simulator && { '/__simulator-report': 'http://127.0.0.1:' + (process.env.UMS_SIMULATOR_REPORT_PORT || '5289') }),
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
