import { expect, test } from '@playwright/test'
import type { Renderer } from '../../../src/services/home-service'

test('audio cover, controls and playback status on the UMS server', async ({ page, request }) => {
  const connections: { disconnect: () => Promise<void>, reports: Record<string, string>[] }[] = []
  await page.routeWebSocket('**/v1/api/ws', (socket) => {
    const server = socket.connectToServer()
    const reports: Record<string, string>[] = []
    socket.onMessage((message) => {
      server.send(message)
      if (typeof message !== 'string' || !message.startsWith('{')) return
      const frame = JSON.parse(message)
      if (frame.action === 'player_status') reports.push(frame.data)
    })
    connections.push({
      reports,
      disconnect: async () => {
        await server.close()
        await socket.close()
      },
    })
  })
  const root = page.waitForResponse(response => response.url().endsWith('/v1/api/player/browse') && response.request().postDataJSON()?.id === '0')
  await page.goto('/player/browse/0')
  const response = await root
  expect(response.ok()).toBeTruthy()
  const uuid = response.request().postDataJSON().uuid as string
  const folder = (await response.json()).folders.find((entry: { name: string }) => entry.name === 'Media')
  const listing = await request.post('/v1/api/player/browse', { headers: { Player: uuid }, data: { uuid, id: folder.id, lang: 'en' } })
  const tracks = (await listing.json()).medias.filter((entry: { name: string }) => entry.name.startsWith('UMS audio'))
  expect(tracks).toHaveLength(2)
  // A direct play link may start the initial root browse before the route takes effect.
  // Deliver that real browse response last, after UMS has answered the play request.
  const playResponse = page.waitForResponse(response => response.url().endsWith('/v1/api/player/play'))
  const mediaPath = '/v1/api/player/media/' + uuid + '/' + tracks[0].id
  let mediaResponses = 0
  let seekable = false
  page.on('response', (response) => {
    if (new URL(response.url()).pathname !== mediaPath || response.status() < 200 || response.status() >= 300) return
    mediaResponses++
    if (response.headers()['accept-ranges'] === 'bytes') seekable = true
  })
  await page.route('**/v1/api/player/browse', async (route) => {
    const previousListing = await route.fetch()
    await playResponse
    await route.fulfill({ response: previousListing })
  }, { times: 1 })
  await page.goto('/player/play/' + tracks[0].id)
  const { medias } = await (await playResponse).json()
  // Direct navigation can skip the browse request. Release its route before streaming in either case.
  await page.unroute('**/v1/api/player/browse')
  const audio = page.locator('audio')
  const cover = page.locator('img').filter({ visible: true }).and(page.locator('[src$="/thumbnail/' + uuid + '/' + tracks[0].id + '"]'))
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(audio).toHaveAttribute('preload', medias[0].isTranscoded ? 'none' : 'metadata')
  const originalAudio = await audio.elementHandle()
  if (medias[0].isTranscoded) expect(mediaResponses).toBe(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(async () => {
    const state = await audio.evaluate((el: HTMLAudioElement) => {
      if (el.error) throw Error(el.error.message || 'Media error ' + el.error.code)
      return { time: el.currentTime, duration: el.duration, ready: el.readyState, paused: el.paused, ended: el.ended }
    })
    expect(state).toMatchObject({ paused: false, ended: false })
    expect(state.time).toBeGreaterThan(1)
    if (seekable) expect(state.duration).toBeCloseTo(30, 0)
  }).toPass({ timeout: 25000 })
  const renderers = 'http://127.0.0.1:9001/v1/api/renderers/'
  const getRenderer = async () => {
    const response = await request.get(renderers)
    expect(response.ok()).toBeTruthy()
    return ((await response.json()).renderers as Renderer[]).find(renderer => renderer.uuid === uuid)
  }
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(1)
  const id = (await getRenderer())!.id
  const control = async (action: string, value?: number) => {
    const response = await request.post(renderers + 'control', { data: { id, action, value } })
    expect(response.ok()).toBeTruthy()
  }
  // Keep the same track and position while checking remote controls and reconnecting.
  await control('pause')
  await expect(audio).toHaveJSProperty('paused', true)
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(2)
  await expect(cover).toBeVisible()
  await control('volume', 37)
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.volume)).toBeCloseTo(0.37)
  await expect.poll(async () => (await getRenderer())?.state.volume).toBe(37)
  await control('mute')
  await expect.poll(async () => (await getRenderer())?.state.mute).toBe(true)
  const position = await audio.evaluate((el: HTMLAudioElement) => el.currentTime.toFixed(0))
  await expect.poll(async () => (await getRenderer())?.state.position).toBe('00:00:' + position.padStart(2, '0'))
  const previousConnection = connections[connections.length - 1]
  await previousConnection.disconnect()
  await expect.poll(() => {
    const current = connections[connections.length - 1]
    return current === previousConnection ? [] : current.reports
  }).toContainEqual(expect.objectContaining({
    uuid, id: tracks[0].id, playback: 'PAUSED', position, volume: '37', mute: '1',
  }))
  expect(await originalAudio!.evaluate(el => el.isConnected)).toBe(true)
  await control('play')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(1)
  await control('stop')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(0)
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)

  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/v1/api/player/download/' + uuid + '/' + tracks[0].id)
  await control('play')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(1)
  const frames = connections[connections.length - 1].reports
  const beforeSwitch = frames.length
  await page.getByRole('button', { name: tracks[1].name, exact: true }).click()
  await expect(audio.locator('source')).toHaveAttribute('src', '/v1/api/player/media/' + uuid + '/' + tracks[1].id)
  await expect(page.getByRole('button', { name: tracks[0].name, exact: true })).toBeVisible()
  await expect.poll(() => frames.slice(beforeSwitch).some(frame => frame.id === tracks[1].id)).toBe(true)
  const switchFrames = frames.slice(beforeSwitch)
  const firstNew = switchFrames.findIndex(frame => frame.id === tracks[1].id)
  expect(switchFrames.slice(0, firstNew).filter(frame => frame.id === tracks[0].id && frame.playback === 'STOPPED')).toHaveLength(1)
  expect(switchFrames.slice(firstNew).every(frame => frame.id === tracks[1].id)).toBe(true)

  if (medias[0].isTranscoded && medias[0].mime === 'audio/mpeg') {
    const stream = await request.get(mediaPath)
    expect(stream.ok()).toBe(true)
    const bytes = await stream.body()
    expect(bytes.readUInt16BE(0) & 0xffe0).toBe(0xffe0)
    const headers = stream.headers()
    // FFmpeg may still be encoding when UMS sends the headers for the first request.
    if (headers['accept-ranges'] === 'none') {
      expect(headers['transfer-encoding']).toBe('chunked')
      expect(headers['content-length']).toBeUndefined()
    }
    else {
      expect(headers['accept-ranges']).toBe('bytes')
      expect(headers['content-length']).toBe(String(bytes.length))
    }
    const tail = await request.get(mediaPath, { headers: { Range: 'bytes=45-' } })
    expect(tail.status()).toBe(206)
    expect(tail.headers()['content-range']).toBe('bytes 45-' + (bytes.length - 1) + '/' + bytes.length)
    expect(tail.headers()['content-length']).toBe(String(bytes.length - 45))
    expect(await tail.body()).toEqual(bytes.subarray(45))
  }
})
