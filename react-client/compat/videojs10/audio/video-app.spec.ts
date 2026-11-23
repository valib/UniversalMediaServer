import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { Renderer } from '../../../src/services/home-service'
import type { BaseBrowse } from '../../../src/services/player-service'

async function findSample(page: Page, request: APIRequestContext, source: string) {
  const root = page.waitForResponse(response => response.url().endsWith('/v1/api/player/browse') && response.request().postDataJSON()?.id === '0')
  await page.goto('/player/browse/0')
  const rootResponse = await root
  const { uuid } = rootResponse.request().postDataJSON()
  const folder = ((await rootResponse.json()) as BaseBrowse).folders.find(item => item.name === 'Media')!
  const browse = await request.post('/v1/api/player/browse', { headers: { Player: uuid }, data: { uuid, id: folder.id, lang: 'en' } })
  expect(browse.ok()).toBe(true)
  const sample = ((await browse.json()) as BaseBrowse).medias.find(item => item.name.startsWith('UMS ' + source + ' sample'))!
  return { uuid, sample }
}

const renderersUrl = 'http://127.0.0.1:9001/v1/api/renderers/'

test('HLS advertises the AVC codec carried by each video rendition', async ({ page, request }) => {
  const { uuid, sample } = await findSample(page, request, 'HLS')
  const play = await request.post('/v1/api/player/play', { headers: { Player: uuid }, data: { uuid, id: sample.id, lang: 'en' } })
  expect(play.ok()).toBe(true)
  const master = await request.get('/v1/api/player/media/' + uuid + '/' + sample.id + '/master.m3u8')
  expect(master.ok()).toBe(true)
  const variants = [...(await master.text()).matchAll(/^#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^\r\n]+)/gm)]
  expect(variants.length).toBeGreaterThan(1)
  for (const [, attributes, uri] of variants) {
    const codec = attributes.match(/CODECS="(avc1\.[0-9a-f]{6})(?:,|")/i)?.[1].toLowerCase()
    const playlist = await request.get(new URL(uri, master.url()).href)
    expect(playlist.ok()).toBe(true)
    const segmentUri = (await playlist.text()).split(/\r?\n/).find(line => line && !line.startsWith('#'))
    expect(segmentUri).toBeTruthy()
    const segment = await request.get(new URL(segmentUri!, playlist.url()).href)
    expect(segment.ok()).toBe(true)
    // Extract the H.264 sequence parameter set without decoding or re-encoding.
    const sps = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-map', '0:v:0', '-frames:v', '1',
      '-c:v', 'copy', '-bsf:v', 'filter_units=pass_types=7', '-f', 'h264', 'pipe:1'], { input: await segment.body() })
    const startCode = sps.indexOf(Buffer.from([0, 0, 1]))
    expect(startCode).toBeGreaterThanOrEqual(0)
    const header = startCode + 3
    expect(sps[header] & 31).toBe(7)
    expect(codec, uri).toBe('avc1.' + sps.subarray(header + 1, header + 4).toString('hex'))
  }
})

async function getRenderer(request: APIRequestContext, uuid: string) {
  const response = await request.get(renderersUrl)
  expect(response.ok()).toBe(true)
  return ((await response.json()).renderers as Renderer[]).find(renderer => renderer.uuid === uuid)
}

async function playingRendererId(request: APIRequestContext, uuid: string) {
  await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(1)
  return (await getRenderer(request, uuid))!.id
}

async function control(request: APIRequestContext, id: number, action: string, value?: number) {
  expect((await request.post(renderersUrl + 'control', { data: { id, action, value } })).ok()).toBe(true)
}

for (const source of ['HLS', 'direct']) {
  test(source + ' video plays, seeks and handles remote controls on the UMS server', async ({ page, request }) => {
    const { uuid, sample } = await findSample(page, request, source)
    if (source === 'direct') {
      await page.route('**/v1/api/player/play', async (route) => {
        const response = await route.fetch()
        const data = await response.json()
        data.medias[0].resumePosition = 14
        await route.fulfill({ response, json: data })
      })
    }
    await page.goto('/player/play/' + sample.id)

    const skin = page.locator('.ums-video-skin')
    const video = skin.locator('video')
    await skin.getByRole('button', { name: 'Play', exact: true }).click()
    await expect.poll(() => video.evaluate(v => v.currentTime > 1 && v.videoWidth > 0), { timeout: 25000 }).toBe(true)
    if (source === 'direct') {
      // The sample starts at zero. Reaching 14 seconds here requires a resume seek.
      await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 5000 }).toBeGreaterThan(14.2)
    }
    await expect(page.locator('style.vjs-styles-defaults')).toHaveCount(0)
    const rendererId = await playingRendererId(request, uuid)
    await control(request, rendererId, 'pause')
    await expect(video).toHaveJSProperty('paused', true)
    await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(2)
    await skin.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Second chapter' })
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(12, 0)
    await expect.poll(async () => (await getRenderer(request, uuid))?.state.position).toBe('00:00:12')
    if (source === 'direct') {
      const captions = skin.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Off', exact: true }) })
      const activeCues = () => video.evaluate(v => Array.from(v.textTracks)
        .filter(track => track.kind === 'subtitles' && track.mode === 'showing')
        .flatMap(track => Array.from(track.activeCues || [], cue => (cue as VTTCue).text)))
      await captions.selectOption({ label: 'Czech' })
      await expect.poll(activeCues).toEqual(['První česká stopa'])
      await captions.selectOption({ label: 'English' })
      await expect.poll(activeCues).toEqual(['English MP4 subtitle'])
      await captions.selectOption({ label: 'Off' })
      await expect.poll(activeCues).toEqual([])
    }
    await control(request, rendererId, 'play')
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(13)
    await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/v1/api/player/download/' + uuid + '/' + sample.id)
    if (source === 'direct') {
      const url = '/v1/api/player/media/' + uuid + '/' + sample.id
      expect(await video.evaluate(v => new URL(v.currentSrc).pathname)).toBe(url)
      const full = await request.get(url)
      expect(full.status()).toBe(200)
      expect(full.headers()['content-type']).toMatch(/^video\/mp4/)
      expect(full.headers()['accept-ranges']).toBe('bytes')
      const bytes = await full.body()
      expect(full.headers()['content-length']).toBe(String(bytes.length))
      for (const [range, first, last] of [['0-1', 0, 1], ['20-20', 20, 20], ['-2', bytes.length - 2, bytes.length - 1]] as const) {
        const part = await request.get(url, { headers: { Range: 'bytes=' + range } })
        expect(part.status()).toBe(206)
        expect(part.headers()['content-range']).toBe(`bytes ${first}-${last}/${bytes.length}`)
        expect(part.headers()['content-length']).toBe(String(last - first + 1))
        expect(await part.body()).toEqual(bytes.subarray(first, last + 1))
      }
      const beyondEnd = await request.get(url, { headers: { Range: 'bytes=' + bytes.length + '-' } })
      expect(beyondEnd.status()).toBe(416)
      expect(beyondEnd.headers()['content-range']).toBe('bytes */' + bytes.length)
    }
  })
}

test('the legacy player loads on demand and accepts UMS remote controls', async ({ page, request }) => {
  const { uuid, sample } = await findSample(page, request, 'HLS')
  const legacyStyles = page.locator('style.vjs-styles-defaults')
  await expect(legacyStyles).toHaveCount(0)
  // VHS accepts this HLS MIME alias even on browsers that do not advertise native playback for it.
  await page.route('**/v1/api/player/play', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    data.medias[0].mime = 'video/vnd.apple.mpegurl'
    await route.fulfill({ response, json: data })
  })
  await page.goto('/player/play/' + sample.id)
  const legacy = page.locator('.video-js')
  const video = legacy.locator('video')
  await expect(legacyStyles).toHaveCount(1)
  await legacy.getByRole('button', { name: 'Play Video', exact: true }).click()
  await expect.poll(() => video.evaluate(v => v.videoWidth > 0 && v.currentTime > 1), { timeout: 25000 }).toBe(true)
  const id = await playingRendererId(request, uuid)
  await control(request, id, 'volume', 37)
  await expect.poll(() => video.evaluate(v => v.volume)).toBeCloseTo(0.37)
  await control(request, id, 'pause')
  await expect(video).toHaveJSProperty('paused', true)
  await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(2)
  await control(request, id, 'play')
  await expect(video).toHaveJSProperty('paused', false)
})
