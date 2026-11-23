import { expect, test } from '@playwright/test'
import type { Renderer } from '../../../src/services/home-service'
import type { BaseBrowse } from '../../../src/services/player-service'

for (const source of ['HLS', 'direct']) {
  test(source + ' video plays, seeks and handles remote controls on the UMS server', async ({ page, request }) => {
    const root = page.waitForResponse(response => response.url().endsWith('/v1/api/player/browse') && response.request().postDataJSON()?.id === '0')
    await page.goto('/player/browse/0')
    const rootResponse = await root
    const { uuid } = rootResponse.request().postDataJSON()
    const folder = ((await rootResponse.json()) as BaseBrowse).folders.find(item => item.name === 'Media')!
    const browse = await request.post('/v1/api/player/browse', { headers: { Player: uuid }, data: { uuid, id: folder.id, lang: 'en' } })
    expect(browse.ok()).toBe(true)
    const sample = ((await browse.json()) as BaseBrowse).medias.find(item => item.name.startsWith('UMS ' + source + ' sample'))!
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
    await control('play')
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
