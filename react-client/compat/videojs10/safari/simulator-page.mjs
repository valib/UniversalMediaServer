/* global document, Event, fetch, location, navigator, setTimeout, URL, URLSearchParams */
const params = new URLSearchParams(location.hash.slice(1))
const port = Number(params.get('port'))
const token = params.get('token')
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{32}$/.test(token)) throw Error('Missing simulator test session')

const result = { status: 'failed', userAgent: navigator.userAgent, checks: [] }
const button = text => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(text))
async function waitFor(label, read) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    const value = read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw Error('Timed out waiting for ' + label)
}
let video
try {
  const checkbox = await waitFor('native preference', () => document.querySelector('input[type=checkbox]'))
  if (!checkbox.checked) checkbox.click()
  const folder = await waitFor('UMS shared folder', () => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Media'))
  folder.click()
  const sample = await waitFor('sample', () => button('UMS HLS sample'))
  sample.click()
  video = await waitFor('video', () => document.querySelector('video'))
  await waitFor('playlist metadata', () => video.readyState >= 1)
  video.scrollIntoView({ block: 'center' })
  // iOS permits visible muted inline video to play without a physical gesture.
  video.muted = true
  const playback = video.play()
  const ready = waitFor('two seconds of decoded video', () => video.currentTime > 2 && video.videoWidth > 0)
  await Promise.all([playback, ready])
  const engine = document.querySelector('[aria-label="Playback engine"]')?.textContent
  if (engine !== 'Browser HLS' || !/^\/v1\/api\/player\/media\/[^/]+\/[^/]+\/master\.m3u8$/.test(new URL(video.currentSrc).pathname)) throw Error('Expected the native UMS playlist')
  result.checks.push('Native UMS HLS decodes in Mobile Safari')
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
  await fetch('http://127.0.0.1:' + port + '/' + token, { method: 'POST', body: JSON.stringify(result) })
}
