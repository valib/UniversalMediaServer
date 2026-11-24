import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { markerCenter } from './simulator-tap.mjs'

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
      const cropped = cropVideo(png, bounds, width)
      if (cropped) {
        source = candidate
        return { source, png: cropped }
      }
      failures.push(candidate + ': video marker or crop missing')
    }
    throw Error('The captured Safari video could not be located (' + failures.join(', ') + ')')
  }
}

export function cropVideo(png, bounds, width) {
  const scale = 'scale=' + width + ':-1:flags=neighbor'
  const rgb = frame(png, ['-vf', scale, '-f', 'rawvideo', '-pix_fmt', 'rgb24'])
  const point = markerCenter(rgb, width)
  if (!point) return null
  const x = Math.max(0, point.x - 15)
  const y = point.y - 15 + Math.floor(bounds.height / 2)
  const w = Math.min(bounds.width, width - x)
  const h = Math.min(Math.floor(bounds.height / 2), rgb.length / (width * 3) - y)
  if (w < 1 || h < 1 || y < 0) return null
  const crop = `${scale},crop=${w}:${h}:${x}:${y}`
  return frame(png, ['-vf', crop, '-f', 'image2pipe', '-c:v', 'png'])
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
  // On the portrait iPhone the black fixture is letterboxed. During the native
  // fullscreen transition simctl may still return a frame with Safari's page.
  const preview = frame(png, ['-vf', 'scale=48:48', '-f', 'rawvideo', '-pix_fmt', 'gray'])
  let dark = 0
  for (const top of [8, 35]) {
    for (let y = top; y < top + 5; y++) {
      for (let x = 4; x < 44; x++) {
        if (preview[y * 48 + x] < 25) dark++
      }
    }
  }
  const letterboxed = dark >= 380
  const rgb = frame(png, ['-vf', 'crop=iw*0.8:iw*0.18:iw*0.1:ih/2+iw*0.1', '-f', 'rawvideo', '-pix_fmt', 'rgb24'])
  let green = 0
  let light = 0
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = rgb.subarray(i, i + 3)
    if (g > 50 && r < g / 2 && b < g / 2) green++
    if (Math.min(r, g, b) > 100 && Math.max(r, g, b) - Math.min(r, g, b) < 25) light++
  }
  return { green, light, letterboxed }
}
