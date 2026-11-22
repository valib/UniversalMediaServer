/* global document, innerWidth, screen */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { markerCenter } from './simulator-tap.mjs'

export function markVideo() {
  const video = document.querySelector('video')
  const player = video.closest('.ums-hls-skin')
  player.style.position = 'relative'
  const bounds = video.getBoundingClientRect()
  const parent = player.getBoundingClientRect()
  const marker = document.createElement('span')
  marker.id = 'capture-origin'
  marker.setAttribute('aria-hidden', 'true')
  marker.style.cssText = 'position:absolute;width:10px;height:10px;background:#f0f;outline:4px solid #0f0;pointer-events:none;z-index:1'
  marker.style.left = bounds.left - parent.left + 10 + 'px'
  marker.style.top = bounds.top - parent.top + 10 + 'px'
  player.append(marker)
  return { viewport: innerWidth, display: screen.width, player: Math.round(parent.width), width: Math.floor(bounds.width), height: Math.floor(bounds.height) }
}

function frame(png, options) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', ...options, 'pipe:1'], { input: png, maxBuffer: 48 * 1024 * 1024 })
}

async function displayScreenshot() {
  const temporary = await mkdtemp(join(tmpdir(), 'ums-safari-cue-'))
  const path = join(temporary, 'screen.png')
  try {
    execFileSync('/usr/sbin/screencapture', ['-x', '-D', '1', '-t', 'png', path], { timeout: 12000 })
    return await readFile(path)
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

// SafariDriver can omit the HTML and subtitle layers from its screenshot. An
// on-page marker identifies the same video on either capture surface. Only the
// lower half of that video can contribute pixels to the subtitle comparison.
export function macCueCapture(bounds, webdriverScreenshot, playerScreenshot) {
  const captures = { viewport: webdriverScreenshot, player: playerScreenshot, display: displayScreenshot }
  let source
  return async () => {
    const failures = []
    for (const candidate of source ? [source] : Object.keys(captures)) {
      if (candidate === 'display' && !source) {
        execFileSync('/usr/bin/open', ['-a', 'Safari'], { timeout: 10000 })
        await delay(600)
      }
      let png
      try {
        png = await captures[candidate]()
      }
      catch (error) {
        failures.push(candidate + ': ' + error.message)
        continue
      }
      const width = bounds[candidate]
      const scale = 'scale=' + width + ':-1:flags=neighbor'
      const rgb = frame(png, ['-vf', scale, '-f', 'rawvideo', '-pix_fmt', 'rgb24'])
      const point = markerCenter(rgb, width)
      if (!point) {
        failures.push(candidate + ': no marker')
        continue
      }
      const x = Math.max(0, point.x - 15)
      const y = point.y - 15 + Math.floor(bounds.height / 2)
      const w = Math.min(bounds.width, width - x)
      const h = Math.min(Math.floor(bounds.height / 2), rgb.length / (width * 3) - y)
      if (w < 1 || h < 1 || y < 0) continue
      source = candidate
      const crop = `${scale},crop=${w}:${h}:${x}:${y}`
      return { source, png: frame(png, ['-vf', crop, '-f', 'image2pipe', '-c:v', 'png']) }
    }
    throw Error('The captured Safari video could not be located (' + failures.join(', ') + ')')
  }
}

export function greenPixels(png) {
  const rgb = frame(png, ['-f', 'rawvideo', '-pix_fmt', 'rgb24'])
  let count = 0
  for (let i = 0; i < rgb.length; i += 3) {
    if (rgb[i + 1] > 50 && rgb[i] < rgb[i + 1] / 2 && rgb[i + 2] < rgb[i + 1] / 2) count++
  }
  return count
}

// The iPhone displays the black 16:9 fixture centered on its portrait screen.
// Inspect the subtitle band inside the picture, excluding system controls.
export function systemCuePixels(png) {
  const rgb = frame(png, ['-vf', 'crop=iw*0.8:iw*0.18:iw*0.1:ih/2+iw*0.1', '-f', 'rawvideo', '-pix_fmt', 'rgb24'])
  let green = 0
  let light = 0
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = rgb.subarray(i, i + 3)
    if (g > 50 && r < g / 2 && b < g / 2) green++
    if (Math.min(r, g, b) > 100 && Math.max(r, g, b) - Math.min(r, g, b) < 25) light++
  }
  return { green, light }
}
