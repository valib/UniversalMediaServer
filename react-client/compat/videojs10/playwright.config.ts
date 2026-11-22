import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'hls.spec.ts',
  workers: 1,
  outputDir: '../../test-results/videojs10',
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:5287', trace: 'retain-on-failure' },
  projects: (['chromium', 'firefox', 'webkit'] as const).map(name => ({ name, use: { browserName: name } })),
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1 --port 5287 --strictPort',
    url: 'http://127.0.0.1:5287',
  },
})
