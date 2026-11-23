import { expect, test } from '@playwright/test'
import type { Renderer } from '../../../src/services/home-service'
import type { BaseBrowse } from '../../../src/services/player-service'

test('HLS video plays, seeks and handles remote controls on the UMS server', async ({ page, request }) => {
  const root = page.waitForResponse(response => response.url().endsWith('/v1/api/player/browse') && response.request().postDataJSON()?.id === '0')
  await page.goto('/player/browse/0')
  const rootResponse = await root
  const { uuid } = rootResponse.request().postDataJSON()
  const folder = ((await rootResponse.json()) as BaseBrowse).folders.find(item => item.name === 'Media')!
  const browse = await request.post('/v1/api/player/browse', { headers: { Player: uuid }, data: { uuid, id: folder.id, lang: 'en' } })
  expect(browse.ok()).toBe(true)
  const sample = ((await browse.json()) as BaseBrowse).medias.find(item => item.name.startsWith('UMS HLS sample'))!
  await page.goto('/player/play/' + sample.id)

  const skin = page.locator('.ums-hls-skin')
  const video = skin.locator('video')
  await skin.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => video.evaluate(v => v.currentTime > 1 && v.videoWidth > 0), { timeout: 25000 }).toBe(true)
  const renderersUrl = 'http://127.0.0.1:9001/v1/api/renderers/'
  const getRenderer = async () => {
    const response = await request.get(renderersUrl)
    expect(response.ok()).toBe(true)
    return ((await response.json()).renderers as Renderer[]).find(renderer => renderer.uuid === uuid)
  }
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(1)
  const id = (await getRenderer())!.id
  const control = async (action: string) => {
    expect((await request.post(renderersUrl + 'control', { data: { id, action } })).ok()).toBe(true)
  }
  await control('pause')
  await expect(video).toHaveJSProperty('paused', true)
  await expect.poll(async () => (await getRenderer())?.state.playback).toBe(2)
  await skin.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Second chapter' })
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeCloseTo(12, 0)
  await expect.poll(async () => (await getRenderer())?.state.position).toBe('00:00:12')
  await control('play')
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(13)
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/v1/api/player/download/' + uuid + '/' + sample.id)
})
