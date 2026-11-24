import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['audio.spec.ts', 'hls-app.spec.ts'],
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: '../../../test-results/videojs10-audio',
  use: { trace: 'retain-on-failure' },
  projects: (['chromium', 'firefox', 'webkit'] as const).flatMap(browserName => [
    { name: browserName + ' web interface', use: { browserName, baseURL: 'http://127.0.0.1:9001' } },
    { name: browserName + ' standalone player', use: { browserName, baseURL: 'http://127.0.0.1:9002' } },
  ]),
})
