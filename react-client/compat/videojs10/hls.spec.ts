import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

async function openSample(page: Page, version: '8' | '10') {
  await page.goto('/')
  await page.getByLabel('Player version').selectOption(version)
  if (version === '10') await page.getByLabel('Prefer native HLS').uncheck()
  await page.getByRole('button', { name: process.env.UMS_FIXTURE_FOLDER || 'Media', exact: true }).click()
  await page.getByRole('button', { name: /^UMS HLS sample/ }).first().click()
  const video = page.locator('video')
  await expect(video).toBeAttached()
  return video
}

test('existing UMS player decodes the HLS sample', async ({ page }) => {
  const segments: string[] = []
  page.on('response', (r) => {
    if (r.ok() && r.url().endsWith('.ts')) segments.push(r.url())
  })
  const video = await openSample(page, '8')
  await page.locator('.vjs-big-play-button').click()
  await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1)
  expect(segments.length).toBeGreaterThan(0)
  await expect(page.locator('.vjs-quality-selector')).toBeAttached()
})

test('candidate plays UMS MPEG-TS and switches decoded video, audio and WebVTT tracks', async ({ page }) => {
  const segments: string[] = []
  page.on('response', (r) => {
    if (r.ok() && r.url().endsWith('.ts')) segments.push(r.url())
  })
  const video = await openSample(page, '10')
  await page.getByRole('button', { name: /^play$/i }).click()
  await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5)
  const choices = page.locator('.ums-hls-controls select')
  const quality = choices.filter({ has: page.locator('option', { hasText: 'kb/s' }) })
  const audio = choices.filter({ has: page.locator('option', { hasText: 'English' }) })
  const captions = choices.filter({ has: page.locator('option', { hasText: /^off$/i }) })
  const activeText = () => video.evaluate(v => Array.from(v.textTracks)
    .filter(t => t.kind === 'subtitles' && t.mode === 'showing')
    .flatMap(t => Array.from(t.activeCues || [], c => (c as VTTCue).text)))
  const first = 'První česká stopa'
  const second = 'Druhá česká stopa'
  await expect.poll(activeText).toEqual([expect.stringMatching(/česká stopa/)])
  const initial = await activeText()
  const alternate = await captions.locator('option').evaluateAll((options, current) =>
    (options as HTMLOptionElement[]).find(o => o.value.startsWith('ums-sub-') && o.value !== current)?.value,
  await captions.inputValue())
  expect(alternate).toBeTruthy()
  await captions.selectOption(alternate!)
  await expect.poll(activeText).toEqual([initial[0] === first ? second : first])
  const low = quality.locator('option').filter({ hasText: /240p/ })
  await quality.selectOption(await low.getAttribute('value') as string)
  // Buffered segments may belong to the previous rendition. Seek into the next segment.
  await video.evaluate((v) => {
    v.currentTime = 15
  })
  await expect.poll(() => video.evaluate(v => v.videoHeight), { timeout: 18000 }).toBe(240)
  await expect.poll(() => segments.some(url => /\/ULD_[^/]+\/\d+\.ts/.test(url))).toBe(true)
  await quality.selectOption({ index: 0 })
  await expect(quality).toHaveValue('auto')
  await audio.selectOption({ label: 'Czech' })
  await video.evaluate((v) => {
    v.currentTime = 7
  })
  await expect.poll(() => segments.some(url => /\/NONE_[^/]+_1\/\d+\.ts/.test(url)), { timeout: 18000 }).toBe(true)
  await expect.poll(activeText).toEqual([initial[0] === first ? second : first])
  await captions.selectOption({ label: 'Off' })
  await expect.poll(activeText).toEqual([])
  const chapter = page.getByRole('combobox', { name: 'Chapter' })
  await chapter.selectOption({ label: 'Second chapter' })
  await expect.poll(() => video.evaluate(v => Math.abs(v.currentTime - 12))).toBeLessThan(1.5)
})

// Measure the audio in the successful HTTP responses so this also works on
// test hosts without an audio output device.
function toneFrequency(segment: Buffer): number {
  const pcm = execFileSync('ffmpeg', [
    '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-t', '1',
    '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1',
  ], { input: segment })
  let crossings = 0
  for (let i = 2; i < pcm.length; i += 2) {
    if (pcm.readInt16LE(i - 2) <= 0 && pcm.readInt16LE(i) > 0) crossings++
  }
  return crossings * 16000 / pcm.length
}

for (const version of ['8', '10'] as const) {
  test('video.js ' + version + ' switches between the two encoded audio tones', async ({ page, browserName }) => {
    const first = page.waitForResponse(r => r.ok() && /\/hls\/(?!NONE_)[^/]+\/\d+\.ts$/.test(r.url()))
    const video = await openSample(page, version)
    if (version === '8') await page.locator('.vjs-big-play-button').click()
    else await page.getByRole('button', { name: /^play$/i }).click()
    await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1)
    const firstSegment = await first
    expect(Math.abs(toneFrequency(await firstSegment.body()) - 440)).toBeLessThan(25)
    const legacyMenu = page.locator('div.vjs-audio-button')
    if (version === '8' && browserName === 'webkit' && await legacyMenu.locator('li').allTextContents().then(labels => labels.length === 1 && labels[0].includes('Unknown'))) {
      test.fail(await legacyMenu.evaluate(el => el.classList.contains('vjs-hidden')), 'Video.js 8 on WebKit exposes only an Unknown audio track for this UMS master.')
    }
    if (version === '8') await expect(legacyMenu).toBeVisible()
    const alternate = page.waitForResponse(r => r.ok() && /\/hls\/NONE_[^/]+_1\/\d+\.ts$/.test(r.url()))
    if (version === '8') {
      await legacyMenu.getByRole('button').press('Enter')
      await legacyMenu.getByRole('menuitemradio', { name: /Czech/i }).press('Enter')
      await video.evaluate((v) => {
        v.currentTime = 0.25
        return v.play()
      })
    }
    else {
      await page.locator('select').filter({ has: page.locator('option', { hasText: 'English' }) }).selectOption({ label: 'Czech' })
    }
    const alternateSegment = await alternate
    expect(Math.abs(toneFrequency(await alternateSegment.body()) - 880)).toBeLessThan(30)
  })
}

test('native cues change color and size in the rendered frame', async ({ page }) => {
  const video = await openSample(page, '10')
  await page.getByRole('button', { name: /^play$/i }).click()
  await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 20000 }).toBeGreaterThan(1)
  await video.evaluate(v => v.pause())
  const skin = page.locator('.ums-hls-skin')
  await skin.evaluate((el) => {
    el.style.height = '330px'
  })
  const appearance = page.getByRole('button', { name: 'Subtitle appearance' })
  await appearance.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Text color').fill('#00ff00')
  await dialog.getByLabel('Font height (%)').fill('8')
  await dialog.getByRole('button', { name: 'Close' }).click()
  const greenPixels = async () => {
    const png = await video.screenshot()
    return page.evaluate(async (encoded) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + encoded
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const context = canvas.getContext('2d')!
      context.drawImage(img, 0, 0)
      const { data } = context.getImageData(0, 0, img.width, img.height)
      let green = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 1] > 50 && data[i] < data[i + 1] / 2 && data[i + 2] < data[i + 1] / 2) green++
      }
      return green
    }, png.toString('base64'))
  }
  await expect.poll(greenPixels).toBeGreaterThan(30)
  const small = await greenPixels()
  await skin.evaluate((el) => {
    el.style.height = '560px'
  })
  await expect.poll(greenPixels).toBeGreaterThan(small * 1.15)
  await appearance.click()
  await dialog.getByRole('button', { name: 'Use server defaults' }).click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  // The fixture uses white server defaults and has a black video background.
  await expect.poll(greenPixels).toBe(0)
})

test('preferred HLS plays through the available engine', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'webkit')
  await page.goto('/')
  await page.getByLabel('Prefer native HLS').check()
  await page.getByRole('button', { name: process.env.UMS_FIXTURE_FOLDER || 'Media', exact: true }).click()
  await page.getByRole('button', { name: /^UMS HLS sample/ }).first().click()
  const video = page.locator('video')
  const native = await video.evaluate(v => Boolean(v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegurl')))
  await page.getByRole('button', { name: /^play$/i }).click()
  await expect(page.getByLabel('Playback engine')).toHaveText(native ? 'Browser HLS' : 'hls.js (MSE)')
  await expect.poll(() => video.evaluate(v => v.videoWidth)).toBeGreaterThan(0)
  await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 20000 }).toBeGreaterThan(1)
  const url = await video.evaluate(v => v.currentSrc)
  if (native) expect(new URL(url).pathname).toMatch(/^\/v1\/api\/player\/media\/[^/]+\/[^/]+\/master\.m3u8$/)
  else expect(url).toMatch(/^blob:/)
  testInfo.annotations.push({ type: 'engine', description: native ? 'Native WebKit HLS' : 'hls.js (MSE)' })
})
