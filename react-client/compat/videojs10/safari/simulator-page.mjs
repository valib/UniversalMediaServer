/* global requestAnimationFrame, screen, document, Event, fetch, location, navigator, setTimeout, URL, URLSearchParams */
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
    const value = read()
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
    for (let attempt = 0; attempt < 2 && !trusted; attempt++) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const tap = await send({ action: 'tap', width: screen.width })
      if (!tap.ok) throw Error(await tap.text())
      // A first-launch Safari popover can consume the first physical tap.
      for (let i = 0; i < 10 && !trusted; i++) await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!trusted) throw Error('Safari did not deliver a trusted tap to ' + target.textContent.trim())
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
  if (checkbox.checked !== (mode === 'native')) checkbox.click()
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
  const engine = document.querySelector('[aria-label="Playback engine"]')?.textContent
  if (mode === 'native' && (engine !== 'Browser HLS' || !/^\/v1\/api\/player\/media\/[^/]+\/[^/]+\/master\.m3u8$/.test(new URL(video.currentSrc).pathname))) throw Error('Expected the native UMS playlist')
  if (mode === 'mse' && (engine !== 'hls.js (MSE)' || !video.currentSrc.startsWith('blob:'))) throw Error('Expected hls.js playback')
  result.checks.push(engine + ' decodes in Mobile Safari')
  const cue = () => Array.from(video.textTracks).filter(t => t.kind === 'subtitles' && t.mode === 'showing')
    .flatMap(t => Array.from(t.activeCues || [], c => c.text))[0]
  const first = await waitFor('Czech cue', () => cue()?.match(/^(První|Druhá) česká stopa$/)?.[0])
  const choices = Array.from(document.querySelectorAll('.ums-hls-controls select'))
  const captions = choices.find(select => Array.from(select.options).some(option => option.value.startsWith('ums-sub-')))
  const alternate = Array.from(captions.options).find(option => option.value.startsWith('ums-sub-') && !option.selected)
  captions.value = alternate.value
  captions.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor('alternate cue', () => cue() === (first === 'První česká stopa' ? 'Druhá česká stopa' : 'První česká stopa'))
  result.checks.push('Both external Czech subtitle tracks')
  const chapters = choices.find(select => Array.from(select.options).some(option => option.text === 'Second chapter'))
  chapters.value = Array.from(chapters.options).find(option => option.text === 'Second chapter').value
  chapters.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor('chapter seek', () => video.currentTime >= 12 && video.currentTime < 15 && !video.seeking)
  result.checks.push('Seek to the second chapter')
  video.pause()
  const toggle = button('Fullscreen')
  const fullscreen = () => video.webkitDisplayingFullscreen || video.webkitPresentationMode === 'fullscreen'
  result.fullscreen = { system: false, exited: false, trustedTap: false }
  await tapControl(toggle)
  result.fullscreen.trustedTap = true
  await waitFor('system video fullscreen', fullscreen)
  result.fullscreen.system = true
  result.fullscreen.cue = cue()
  if (!result.fullscreen.trustedTap || !/^(První|Druhá) česká stopa$/.test(result.fullscreen.cue)) throw Error('Missing trusted tap or active fullscreen cue')
  const captured = await send({ action: 'capture' })
  if (!captured.ok) throw Error(await captured.text())
  video.webkitExitFullscreen()
  await waitFor('inline video after fullscreen', () => !fullscreen())
  result.fullscreen.exited = true
  result.checks.push('System fullscreen enters and exits with an active cue')
  result.status = 'passed'
}
catch (error) {
  result.error = String(error)
}
finally {
  if (video) {
    result.media = { time: video.currentTime, width: video.videoWidth, height: video.videoHeight, paused: video.paused, error: video.error?.code }
    video.pause()
  }
  await send(result)
}
