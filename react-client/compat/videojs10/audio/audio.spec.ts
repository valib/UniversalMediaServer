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
  await page.route('**/v1/api/player/browse', async (route) => {
    const previousListing = await route.fetch()
    await playResponse
    await route.fulfill({ response: previousListing })
  })
  await page.goto('/player/play/' + tracks[0].id)
  await playResponse
  const audio = page.locator('audio')
  const cover = page.locator('img').filter({ visible: true }).and(page.locator('[src$="/thumbnail/' + uuid + '/' + tracks[0].id + '"]'))
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => audio.evaluate(el => el.currentTime)).toBeGreaterThan(1)
  await expect(cover).toBeVisible()
  const originalAudio = await audio.elementHandle()

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
  await control('volume', 37)
  await expect.poll(() => audio.evaluate(el => el.volume)).toBeCloseTo(0.37)
  await expect.poll(async () => (await getRenderer())?.state.volume).toBe(37)
  await control('mute')
  await expect.poll(async () => (await getRenderer())?.state.mute).toBe(true)
  await control('pause')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(2)
  const position = await audio.evaluate(el => el.currentTime.toFixed(0))
  await expect.poll(async () => (await getRenderer())?.state.position).toBe('00:00:' + position.padStart(2, '0'))
  const previousConnection = connections[connections.length - 1]
  await previousConnection.disconnect()
  await expect.poll(() => {
    const current = connections[connections.length - 1]
    return current !== previousConnection && current.reports.some(report => report.uuid === uuid && report.id === tracks[0].id
      && report.playback === 'PAUSED' && report.position === position && report.volume === '37' && report.mute === '1')
  }).toBe(true)
  expect(await originalAudio!.evaluate(el => el.isConnected)).toBe(true)
  await control('play')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(1)
  await control('stop')
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(0)
  await expect.poll(() => audio.evaluate(el => el.paused)).toBe(true)

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
})
