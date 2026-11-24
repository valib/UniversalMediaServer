/* global requestAnimationFrame, screen, document, Event, fetch, getComputedStyle, location, navigator, performance, setTimeout, URL, URLSearchParams */
import { chooseOption, markVideo } from './page-controls.mjs'

const params = new URLSearchParams(location.hash.slice(1))
const token = params.get('token')
if (!/^[a-f0-9]{32}$/.test(token)) throw Error('Missing simulator test session')

const mode = params.get('mode') || 'native'
const result = { mode, status: 'failed', userAgent: navigator.userAgent, checks: [] }
const button = text => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(text))
const send = result => fetch('/__simulator-report/' + token, { method: 'POST', body: JSON.stringify(result) })
async function waitFor(label, read) {
  await send({ status: 'in progress', stage: label, checks: result.checks }).catch(() => {})
  const end = Date.now() + 75000
  while (Date.now() < end) {
    const error = document.querySelector('p[role=alert]')?.textContent
    if (error) throw Error(label + ': ' + error)
    const value = await read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw Error('Timed out waiting for ' + label)
}
async function tapControl(target) {
  target.scrollIntoView({ block: 'center' })
  const marker = document.createElement('span')
  marker.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;background:#f0f;outline:4px solid #0f0;pointer-events:none;z-index:1'
  marker.setAttribute('aria-hidden', 'true')
  const position = target.style.position
  target.style.position = 'relative'
  target.append(marker)
  let trusted = false
  const onClick = (event) => {
    trusted ||= event.isTrusted
  }
  target.addEventListener('click', onClick, true)
  try {
    let lastError
    for (let attempt = 0; attempt < 3 && !trusted; attempt++) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const tap = await send({ action: 'tap', width: screen.width, checkSafariTip: target.textContent.trim() === 'Play' || attempt > 0 })
      if (!tap.ok) {
        lastError = await tap.text()
        if (tap.status !== 409) throw Error(lastError)
      }
      // A first-launch Safari popover can consume the first physical tap.
      for (let i = 0; i < 30 && !trusted; i++) await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!trusted) throw Error(lastError || 'Safari did not deliver a trusted tap to ' + target.textContent.trim())
  }
  finally {
    target.removeEventListener('click', onClick, true)
    marker.remove()
    target.style.position = position
  }
}
let video
try {
  const checkbox = await waitFor('native preference', () => document.querySelector('input[type=checkbox]'))
  if (!checkbox.checked) throw Error('Mobile Safari must default to native HLS')
  if (mode === 'mse') checkbox.click()
  const folder = await waitFor('UMS shared folder', () => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Media'))
  folder.click()
  const sample = await waitFor('sample', () => button('UMS HLS sample'))
  sample.click()
  video = await waitFor('video', () => document.querySelector('video'))
  video.scrollIntoView({ block: 'center' })
  // Check decoding without relying on an audio output device.
  video.muted = true
  await waitFor('playlist metadata', () => video.readyState >= 1)
  const play = button('Play')
  await tapControl(play)
  await waitFor('two seconds of decoded video', () => video.currentTime > 2 && video.videoWidth > 0)
  video.pause()
  if (!(video.duration >= 29 && video.duration < 32)) throw Error('Unexpected HLS duration: ' + video.duration)
  const engine = document.querySelector('[aria-label="Playback engine"]')?.textContent
  if (mode === 'native' && (engine !== 'Browser HLS' || !/^\/v1\/api\/player\/media\/[^/]+\/[^/]+\/master\.m3u8$/.test(new URL(video.currentSrc).pathname))) throw Error('Expected the native UMS playlist')
  if (mode === 'mse' && (engine !== 'hls.js (MSE)' || !video.currentSrc.startsWith('blob:'))) throw Error('Expected hls.js playback')
  result.checks.push(engine + ' decodes in Mobile Safari')
  const cue = () => Array.from(video.textTracks).filter(t => t.kind === 'subtitles' && t.mode === 'showing')
    .flatMap(t => Array.from(t.activeCues || [], c => c.text))[0]
  const first = await waitFor('Czech cue', () => cue()?.match(/^(První|Druhá) česká stopa$/)?.[0])
  if (!chooseOption('subtitle')) throw Error('Missing alternate Czech subtitles')
  await waitFor('alternate cue', () => cue() === (first === 'První česká stopa' ? 'Druhá česká stopa' : 'První česká stopa'))
  if (!chooseOption('off')) throw Error('Missing subtitles Off')
  await waitFor('subtitles off', () => !cue())
  if (!chooseOption('on')) throw Error('Missing Czech subtitle selection')
  await waitFor('restored Czech cue', cue)
  result.checks.push('Both external Czech subtitle tracks and Off')
  if (mode === 'native' && !(video.audioTracks?.length >= 2)) throw Error('Missing alternate native audio track')
  if (!chooseOption('audio')) throw Error('Missing Czech audio choice')
  if (!chooseOption('chapter')) throw Error('Missing second chapter')
  await waitFor('chapter seek', () => video.currentTime >= 11.5 && video.currentTime < 15 && !video.seeking)
  video.pause()
  await waitFor('Czech audio after chapter seek', () => mode === 'native'
    ? Array.from(video.audioTracks).some(t => t.enabled && /^(cs|ces|cze|Czech)(-|$)/i.test(t.language || t.label))
    : performance.getEntriesByType('resource').some(entry => /\/hls\/NONE_[^/]+_1\/\d+\.ts$/.test(entry.name)))
  result.checks.push('Czech audio remains selected after the chapter seek')
  const toggle = button('Fullscreen')
  const fullscreen = () => video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen'
  result.fullscreen = { system: false, exited: false, trustedTap: false }
  async function captureCue(appearance) {
    await tapControl(toggle)
    await waitFor('system video fullscreen', fullscreen)
    const actualCue = cue()
    if (!/^(První|Druhá) česká stopa$/.test(actualCue)) throw Error('Missing Czech fullscreen cue')
    const pixels = await waitFor('rendered ' + appearance + ' fullscreen cue', async () => {
      const response = await send({ action: 'capture', appearance })
      if (!response.ok) throw Error(await response.text())
      const frame = await response.json()
      return frame.letterboxed && (appearance === 'green' ? frame.green > 30 : frame.light > 30) && frame
    })
    video.webkitExitFullscreen()
    await waitFor('inline video after fullscreen', () => !fullscreen())
    return { cue: actualCue, time: video.currentTime, ...pixels }
  }
  async function captureInline(appearance) {
    video.scrollIntoView({ block: 'center' })
    const bounds = markVideo()
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const response = await send({ action: 'inline', appearance, bounds })
      if (!response.ok) throw Error(await response.text())
      return (await response.json()).green
    }
    finally {
      document.querySelector('#capture-origin')?.remove()
    }
  }
  const defaultColor = getComputedStyle(video).getPropertyValue('--ums-cue-color')
  const inlineDefault = await captureInline('default')
  const baseline = await captureCue('default')
  result.fullscreen.cue = baseline.cue
  result.fullscreen.trustedTap = true
  result.fullscreen.system = true
  result.fullscreen.exited = true
  result.checks.push('System fullscreen enters and exits with an active cue')
  button('Subtitle appearance').click()
  const input = document.querySelector('dialog input[type=color]')
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, '#00ff00')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  document.querySelector('dialog button:last-child').click()
  await waitFor('selected subtitle color', () => getComputedStyle(video).getPropertyValue('--ums-cue-color').trim().startsWith('#00ff00'))
  const styled = await captureCue('green')
  if (styled.cue !== baseline.cue || Math.abs(styled.time - baseline.time) > 0.25) throw Error('Fullscreen comparison changed cue or playback time')
  result.fullscreen.appearance = { baseline, styled, appliesSelectedColor: styled.green > baseline.green + 30 }
  if (!result.fullscreen.appearance.appliesSelectedColor) throw Error('Missing green Czech subtitle in system fullscreen')
  const inlineGreen = await captureInline('green')
  if (inlineGreen <= inlineDefault + 30) throw Error('Missing green Czech subtitle in inline playback')
  button('Subtitle appearance').click()
  button('Use server defaults').click()
  button('Close').click()
  await waitFor('server cue color', () => getComputedStyle(video).getPropertyValue('--ums-cue-color') === defaultColor)
  const restored = await captureInline('restored')
  result.inline = { baseline: inlineDefault, styled: inlineGreen, restored }
  if (restored > inlineDefault + 5) throw Error('Inline cue did not restore the server color')
  result.checks.push('Inline and system fullscreen Czech cue colors, including restored inline defaults')
  result.status = 'passed'
}
catch (error) {
  result.error = String(error)
}
finally {
  if (video) {
    const buffered = Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)])
    result.media = { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, paused: video.paused, seeking: video.seeking, readyState: video.readyState, buffered, error: video.error?.code }
    video.pause()
    if (mode === 'native') {
      video.removeAttribute('src')
      video.load()
    }
  }
  await send(result)
}
