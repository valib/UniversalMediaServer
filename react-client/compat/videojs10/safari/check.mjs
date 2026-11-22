/* global performance, AbortSignal, Buffer, console, document, Event, fetch, process, URL, Image */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const platform = process.argv[2]
assert.ok(['macos', 'ios'].includes(platform), 'Choose macos or ios')
const mode = process.argv[3] || 'native'
assert.ok(['native', 'mse'].includes(mode), 'Choose native or mse')
const directory = join(process.env.SAFARI_RESULTS || 'test-results/safari-' + platform, mode)
await mkdir(directory, { recursive: true })
const report = { platform, mode, checks: [], status: 'failed' }
let session

async function command(method, route, body) {
  const response = await fetch('http://127.0.0.1:4444' + route, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  })
  const { value } = await response.json()
  if (!response.ok) throw Error(method + ' ' + route + ' ' + (value?.message || response.status))
  return value
}
const post = (route, body) => command('POST', '/session/' + session + route, body)
const evaluate = (fn, ...args) => post('/execute/sync', { script: 'return (' + fn + ').apply(null, arguments)', args })
async function until(description, read, timeout = 25000) {
  const end = Date.now() + timeout
  let result
  do {
    result = await read()
    if (result) return result
    await delay(250)
  } while (Date.now() < end)
  throw Error('Timed out waiting for ' + description)
}
async function click(xpath) {
  const [element] = await until(xpath, async () => {
    const elements = await post('/elements', { using: 'xpath', value: xpath })
    return elements.length && elements
  })
  await post('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {})
}
async function screenshot(name) {
  const data = await command('GET', '/session/' + session + '/screenshot')
  await writeFile(join(directory, name + '.png'), Buffer.from(data, 'base64'))
}
async function check(name, run) {
  await run()
  report.checks.push(name)
  console.log('PASS', name)
}
function mediaState() {
  const v = document.querySelector('video')
  if (!v) return null
  return {
    time: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : null,
    width: v.videoWidth, src: v.currentSrc, readyState: v.readyState, networkState: v.networkState,
    error: v.error && { code: v.error.code, message: v.error.message },
    native: v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegurl'),
    engine: document.querySelector('[aria-label="Playback engine"]')?.textContent,
    cues: Array.from(v.textTracks).filter(t => t.kind === 'subtitles' && t.mode === 'showing')
      .flatMap(t => Array.from(t.activeCues || [], c => c.text)),
    audio: Array.from(v.audioTracks || [], t => ({ enabled: t.enabled, language: t.language, label: t.label })),
    fullscreen: v.webkitDisplayingFullscreen || v.webkitPresentationMode === 'fullscreen'
      ? 'system'
      : (document.fullscreenElement || document.webkitFullscreenElement ? 'document' : 'inline'),
    focus: document.activeElement?.textContent?.trim().slice(0, 60),
  }
}
// Use the same change event that the check page handles for both native and React selects.
function chooseOption(kind) {
  for (const select of document.querySelectorAll('.ums-hls-controls select')) {
    const options = Array.from(select.options)
    const target = options.find((option) => {
      if (kind === 'subtitle') return option.value.startsWith('ums-sub-') && !option.selected
      if (kind === 'off') return option.text === 'Off'
      if (kind === 'on') return option.value.startsWith('ums-sub-')
      if (kind === 'chapter') return option.text === 'Second chapter'
      return /^(cs|ces|cze|Czech|čeština)$/i.test(option.text) && !option.value.startsWith('ums-sub-')
    })
    if (target) {
      select.value = target.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
  }
  return false
}
const state = () => evaluate(mediaState)
const button = name => '//button[normalize-space(.)="' + name + '"]'
try {
  const capabilities = { browserName: 'Safari', platformName: platform === 'ios' ? 'iOS' : 'macOS' }
  if (platform === 'ios') {
    assert.ok(process.env.IOS_SIMULATOR_UDID, 'Missing booted iPhone simulator')
    Object.assign(capabilities, { 'safari:useSimulator': true, 'safari:deviceUDID': process.env.IOS_SIMULATOR_UDID })
  }
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: capabilities } })
  session = created.sessionId
  report.capabilities = created.capabilities
  assert.equal(created.capabilities.browserName.toLowerCase(), 'safari')
  assert.equal(created.capabilities.platformName.toLowerCase(), capabilities.platformName.toLowerCase())
  await post('/url', { url: 'http://127.0.0.1:5287/' })
  if (mode === 'native') await click('//label[contains(., "Prefer native HLS")]/input')
  await click(button('Media'))
  await click('//button[starts-with(normalize-space(.), "UMS HLS sample")]')
  await click(button('Play'))
  await check(mode + ' UMS HLS decodes and playback advances', async () => {
    const v = await until('two seconds of ' + mode + ' playback', async () => {
      const v = await state()
      return v?.time > 2 && v.width > 0 && v
    })
    if (mode === 'native') {
      assert.ok(v.native)
      assert.equal(v.engine, 'Browser HLS')
      assert.match(new URL(v.src).pathname, /^\/v1\/api\/player\/media\/[^/]+\/[^/]+\/master\.m3u8$/)
    }
    else {
      assert.equal(v.engine, 'hls.js (MSE)')
      assert.match(v.src, /^blob:/)
    }
    assert.ok(v.duration >= 29 && v.duration < 32)
  })
  await check('Both Czech subtitle tracks and Off', async () => {
    const first = await until('first Czech cue', async () => (await state()).cues[0])
    assert.match(first, /^(První|Druhá) česká stopa$/)
    assert.ok(await evaluate(chooseOption, 'subtitle'))
    const alternate = first === 'První česká stopa' ? 'Druhá česká stopa' : 'První česká stopa'
    await until('alternate Czech cue', async () => (await state()).cues[0] === alternate)
    assert.ok(await evaluate(chooseOption, 'off'))
    await until('no active subtitle', async () => !(await state()).cues.length)
    assert.ok(await evaluate(chooseOption, 'on'))
  })
  await check('Czech audio remains selected after the chapter seek', async () => {
    if (mode === 'native') assert.ok((await state()).audio.length >= 2)
    assert.ok(await evaluate(chooseOption, 'audio'), 'Missing Czech audio choice')
    assert.ok(await evaluate(chooseOption, 'chapter'))
    await until('second chapter with Czech audio', async () => {
      const v = await state()
      if (v.time < 11.5 || v.time >= 15) return false
      if (mode === 'native') return v.audio.some(t => t.enabled && /^(cs|ces|cze|Czech)(-|$)/i.test(t.language || t.label))
      return evaluate(() => performance.getEntriesByType('resource').some(entry => /\/hls\/NONE_[^/]+_1\/\d+\.ts$/.test(entry.name)))
    })
  })
  await click(button('Pause'))
  await check('Rendered inline cue uses the chosen color and restores server defaults', async () => {
    const greenPixels = async () => {
      const png = await command('GET', '/session/' + session + '/screenshot')
      return evaluate(async (encoded) => {
        const image = new Image()
        image.src = 'data:image/png;base64,' + encoded
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let green = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 1] > 50 && data[i] < data[i + 1] / 2 && data[i + 2] < data[i + 1] / 2) green++
        }
        return green
      }, png)
    }
    const baseline = await greenPixels()
    await click(button('Subtitle appearance'))
    await evaluate(() => {
      const input = document.querySelector('dialog input[type=color]')
      const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
      setValue.call(input, '#00ff00')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button('Close'))
    await until('visible green glyphs', async () => await greenPixels() > baseline + 30)
    await screenshot('inline-green')
    await click(button('Subtitle appearance'))
    await click(button('Use server defaults'))
    await click(button('Close'))
    await until('default cue color', async () => await greenPixels() <= baseline + 5)
  })
  await screenshot('inline')
  await check('Fullscreen enters and exits with an active cue', async () => {
    await click(button('Fullscreen'))
    report.fullscreen = await until('fullscreen', async () => {
      const v = await state()
      return v.fullscreen !== 'inline' && v.cues.length && v.fullscreen
    })
    await screenshot('fullscreen')
    if (report.fullscreen === 'document') await click(button('Fullscreen'))
    else await evaluate(() => document.querySelector('video').webkitSetPresentationMode('inline'))
    await until('inline presentation', async () => (await state()).fullscreen === 'inline')
    report.focusAfterExit = (await state()).focus
  })
  report.status = 'passed'
}
catch (error) {
  report.error = String(error)
  if (session) {
    report.media = await state().catch(() => null)
    if (report.media?.src?.startsWith('http://127.0.0.1:5287/')) {
      report.playlist = await evaluate(async (src) => {
        const response = await fetch(src)
        return { status: response.status, type: response.headers.get('content-type'), text: (await response.text()).slice(0, 4000) }
      }, report.media.src).catch(() => null)
    }
    await screenshot('failure').catch(() => {})
  }
  console.error(error)
  process.exitCode = 1
}
finally {
  console.log(JSON.stringify(report))
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  if (session) await command('DELETE', '/session/' + session).catch(() => {})
}
