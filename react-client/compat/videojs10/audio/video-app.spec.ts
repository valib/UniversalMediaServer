import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test'
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

// UMS persists the shared sample's position between tests.
async function configureVideoSample(page: Page, playback: { resumePosition: number, mime?: string }) {
  await page.route('**/v1/api/player/play', async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    Object.assign(data.medias[0], playback)
    await route.fulfill({ response, json: data })
  }, { times: 1 })
}

test('a second request can replay a transcoded file after the audio buffer wraps', async ({ page, request }) => {
  const { uuid, sample } = await findSample(page, request, 'long audio')
  const play = await request.post('/v1/api/player/play', { headers: { Player: uuid }, data: { uuid, id: sample.id, lang: 'en' } })
  expect(play.ok()).toBe(true)
  const media = (await play.json()).medias[0]
  expect(media.isTranscoded).toBe(true)
  expect(media.mime).toBe('audio/mpeg')
  const url = new URL('/v1/api/player/media/' + uuid + '/' + sample.id, page.url()).href
  const first = await fetch(url)
  expect(first.status).toBe(200)
  expect(first.headers.get('accept-ranges')).toBe('none')
  const reader = first.body!.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let replay: Buffer | undefined
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      length += value.byteLength
      if (!replay && length > 4 * 1024 * 1024) {
        const second = await request.get(url)
        expect(second.status()).toBe(200)
        replay = await second.body()
      }
    }
  }
  finally {
    await reader.cancel()
  }
  expect(replay?.length).toBeGreaterThan(4 * 1024 * 1024)
  expect(Buffer.concat(chunks).equals(replay!)).toBe(true)
})

const renderersUrl = 'http://127.0.0.1:9001/v1/api/renderers/'

function videoPackets(segment: Buffer): { pts: number, duration: number }[] {
  const output = execFileSync('ffprobe', ['-v', 'error', '-f', 'mpegts', '-select_streams', 'v:0',
    '-show_entries', 'packet=pts,duration', '-of', 'json', 'pipe:0'], { input: segment })
  return JSON.parse(output.toString()).packets
}

test('HLS renditions match their advertised AVC codec and video segments join continuously', async ({ page, request }) => {
  const { uuid, sample } = await findSample(page, request, 'HLS')
  const play = await request.post('/v1/api/player/play', { headers: { Player: uuid }, data: { uuid, id: sample.id, lang: 'en' } })
  expect(play.ok()).toBe(true)
  const master = await request.get('/v1/api/player/media/' + uuid + '/' + sample.id + '/master.m3u8')
  expect(master.ok()).toBe(true)
  const variants = [...(await master.text()).matchAll(/^#EXT-X-STREAM-INF:([^\r\n]+)\r?\n([^\r\n]+)/gm)]
  expect(variants.length).toBeGreaterThan(1)
  for (const [index, [, attributes, uri]] of variants.entries()) {
    const codec = attributes.match(/CODECS="(avc1\.[0-9a-f]{6})(?:,|")/i)?.[1].toLowerCase()
    const playlist = await request.get(new URL(uri, master.url()).href)
    expect(playlist.ok()).toBe(true)
    const segments = (await playlist.text()).split(/\r?\n/).filter(line => line && !line.startsWith('#'))
    expect(segments.length).toBeGreaterThan(1)
    const segment = await request.get(new URL(segments[0], playlist.url()).href)
    expect(segment.ok()).toBe(true)
    const firstBytes = await segment.body()
    if (index === 0) {
      const second = await request.get(new URL(segments[1], playlist.url()).href)
      expect(second.ok()).toBe(true)
      const firstEnd = Math.max(...videoPackets(firstBytes).map(packet => packet.pts + packet.duration))
      const secondStart = Math.min(...videoPackets(await second.body()).map(packet => packet.pts))
      expect(firstEnd).toBe(secondStart)
      // The sample ends with AAC padding. Its last video segment must still contain a frame.
      const last = await request.get(new URL(segments[segments.length - 1], playlist.url()).href)
      expect(last.ok()).toBe(true)
      const frame = execFileSync('ffprobe', ['-v', 'error', '-f', 'mpegts', '-select_streams', 'v:0', '-show_entries',
        'packet=flags', '-of', 'csv=p=0', 'pipe:0'], { input: await last.body() }).toString()
      expect(frame).toContain('K')
    }
    // Extract the H.264 sequence parameter set without decoding or re-encoding.
    const sps = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-map', '0:v:0', '-frames:v', '1',
      '-c:v', 'copy', '-bsf:v', 'filter_units=pass_types=7', '-f', 'h264', 'pipe:1'], { input: firstBytes })
    const startCode = sps.indexOf(Buffer.from([0, 0, 1]))
    expect(startCode).toBeGreaterThanOrEqual(0)
    const header = startCode + 3
    expect(sps[header] & 31).toBe(7)
    expect(codec, uri).toBe('avc1.' + sps.subarray(header + 1, header + 4).toString('hex'))
  }
})

async function expectVideoPlayback(video: Locator, resumePosition?: number) {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement, resume) => {
    const played = Array.from({ length: v.played.length }, (_, i) => [v.played.start(i), v.played.end(i)])
    // A played range starting at the saved position distinguishes a resume seek from uninterrupted playback.
    const advanced = played.some(([start, end]) => end - start > 0.2 && (resume === undefined || Math.abs(start - resume) < 0.5))
    if (v.currentTime > 1 && v.videoWidth > 0 && !v.paused && !v.ended && !v.error && advanced) return 'playing'
    return {
      time: v.currentTime, width: v.videoWidth, paused: v.paused, ready: v.readyState, played, error: v.error?.message,
      buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
    }
  }, resumePosition), { timeout: 25000 }).toBe('playing')
}

test('Play stays under a pressed pointer while HLS metadata loads', async ({ page, request }) => {
  const { uuid, sample } = await findSample(page, request, 'HLS')
  await configureVideoSample(page, { resumePosition: 0 })
  const manifestPath = '/v1/api/player/media/' + uuid + '/' + sample.id
  const { promise: pointerDown, resolve: releaseManifest } = Promise.withResolvers<void>()
  await page.route(url => url.pathname === manifestPath || url.pathname === manifestPath + '/master.m3u8', async (route) => {
    await pointerDown
    await route.continue()
  }, { times: 1 })

  const skin = page.locator('.ums-video-skin')
  const play = skin.getByRole('button', { name: 'Play', exact: true })
  const video = skin.locator('video')
  try {
    await page.goto('/player/play/' + sample.id)
    await play.scrollIntoViewIfNeeded()
    const box = (await play.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
  }
  finally {
    releaseManifest()
  }
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1)
  await page.mouse.up()
  await expectVideoPlayback(video)
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
  test(source + ' video plays, seeks and handles remote controls on the UMS server', async ({ page, request }, testInfo) => {
    const { uuid, sample } = await findSample(page, request, source)
    const coldStart = source === 'HLS' && testInfo.project.name === 'chromium web interface'
    let firstSegment: Request | undefined
    if (coldStart) {
      await page.route('**/hls/*/0.ts', async (route) => {
        firstSegment = route.request()
        // Hold the first segment longer than hls.js's default first-byte timeout.
        await new Promise(resolve => setTimeout(resolve, 12_000))
        await route.continue()
      }, { times: 1 })
    }
    await configureVideoSample(page, { resumePosition: source === 'direct' ? 14 : 0 })
    await page.goto('/player/play/' + sample.id)

    const skin = page.locator('.ums-video-skin')
    const video = skin.locator('video')
    await skin.getByRole('button', { name: 'Play', exact: true }).click()
    await expectVideoPlayback(video, source === 'direct' ? 14 : undefined)
    if (coldStart) expect((await firstSegment?.response())?.status()).toBe(200)
    await expect(page.locator('style.vjs-styles-defaults')).toHaveCount(0)
    const rendererId = await playingRendererId(request, uuid)
    await control(request, rendererId, 'pause')
    await expect(video).toHaveJSProperty('paused', true)
    await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(2)
    await skin.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Second chapter' })
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(12, 0)
    await expect.poll(async () => (await getRenderer(request, uuid))?.state.position).toBe('00:00:12')
    if (source === 'direct') {
      const captions = skin.getByRole('combobox').filter({ has: page.getByRole('option', { name: 'Off', exact: true }) })
      const activeCues = () => video.evaluate((v: HTMLVideoElement) => Array.from(v.textTracks)
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
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(13)
    await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/v1/api/player/download/' + uuid + '/' + sample.id)
    if (source === 'direct') {
      const url = '/v1/api/player/media/' + uuid + '/' + sample.id
      expect(await video.evaluate((v: HTMLVideoElement) => new URL(v.currentSrc).pathname)).toBe(url)
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
  const commands: string[] = []
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/v1/api/ws') return
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('{')) return
      const message = JSON.parse(payload)
      if (message.action === 'player') commands.push(message.data.request)
    })
  })
  const legacyStyles = page.locator('style.vjs-styles-defaults')
  await expect(legacyStyles).toHaveCount(0)
  // VHS accepts this HLS MIME alias even on browsers that do not advertise native playback for it.
  await configureVideoSample(page, { resumePosition: 0, mime: 'video/vnd.apple.mpegurl' })
  await page.goto('/player/play/' + sample.id)
  const legacy = page.locator('.video-js')
  const video = legacy.locator('video')
  await expect(legacyStyles).toHaveCount(1)
  await legacy.getByRole('button', { name: 'Play Video', exact: true }).click()
  await expectVideoPlayback(video)
  const id = await playingRendererId(request, uuid)
  await control(request, id, 'volume', 37)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBeCloseTo(0.37)
  await control(request, id, 'pause')
  await expect(video).toHaveJSProperty('paused', true)
  await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(2)
  const beforePlay = commands.length
  await control(request, id, 'play')
  await expect.poll(() => commands.slice(beforePlay), { message: 'Remote Play arrives on the player WebSocket' }).toContain('play')
  await expect(video, 'The legacy player resumes after receiving Play').toHaveJSProperty('paused', false)
  const resumedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { message: 'Video advances after remote Play' }).toBeGreaterThan(resumedAt + 0.2)
  await expect.poll(async () => (await getRenderer(request, uuid))?.state.playback).toBe(1)
})
