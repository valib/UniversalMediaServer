import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'audio.spec.ts',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: '../../../test-results/videojs10-audio',
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  projects: [
    { name: 'web interface', use: { baseURL: 'http://127.0.0.1:9001' } },
    { name: 'standalone player', use: { baseURL: 'http://127.0.0.1:9002' } },
  ],
})
