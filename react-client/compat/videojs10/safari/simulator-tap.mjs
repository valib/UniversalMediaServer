import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function simulatorScreenshot(udid, file) {
  await rm(file, { force: true })
  try {
    await exec('xcrun', ['simctl', 'io', udid, 'screenshot', file], { timeout: 45000 })
  }
  catch (error) {
    if (!error.killed) throw error
    // simctl can write the full PNG and then hang before exiting on a busy host.
    const png = await readFile(file).catch(() => null)
    if (png?.subarray(-12).toString('hex') === '0000000049454e44ae426082') return png
    throw error
  }
  return readFile(file)
}

export async function dismissSafariTip(udid) {
  const { stdout } = await exec('axe', ['describe-ui', '--udid', udid], { timeout: 50000 })
  const nodes = Array.from(JSON.parse(stdout))
  for (const node of nodes) nodes.push(...(node.children || []))
  if (!nodes.some(node => node.AXLabel === 'View Bookmarks, Share Menu, and Open Tabs')) return
  const close = nodes.find(node => node.type === 'Button' && node.AXLabel === 'Close')?.frame
  if (!close) throw Error('Cannot locate the Close button on the Safari startup tip')
  await exec('axe', ['tap', '-x', String(close.x + close.width / 2), '-y', String(close.y + close.height / 2), '--udid', udid], { timeout: 60000 })
}

// Find the center of the marker drawn inside the HTML button in a real simulator
// screenshot. Scaling to screen points accounts for Retina and Safari's toolbar.
export function markerCenter(rgb, width) {
  const height = rgb.length / (width * 3)
  const color = (x, y, green) => {
    const i = (y * width + x) * 3
    const [r, g, b] = rgb.subarray(i, i + 3)
    return green ? g > 70 && g > r * 1.7 && g > b * 1.7 : r > 70 && b > 70 && g * 1.7 < Math.min(r, b)
  }
  for (let y = 7; y < height - 7; y++) {
    for (let x = 7; x < width - 7; x++) {
      if (color(x, y, false) && color(x - 3, y, false) && color(x + 3, y, false)
        && color(x - 6, y, true) && color(x + 6, y, true) && color(x, y - 6, true) && color(x, y + 6, true)) return { x, y }
    }
  }
  return null
}

export async function tapMarker(udid, directory, width) {
  if (!Number.isInteger(width) || width < 240 || width > 1500) throw Error('Invalid simulator screen width')
  const file = join(directory, 'tap-target.png')
  await simulatorScreenshot(udid, file)
  const { stdout } = await exec('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', 'scale=' + width + ':-1:flags=neighbor', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 20000 })
  const point = markerCenter(stdout, width)
  if (!point) throw Error('The simulator screenshot did not contain the marked button')
  await exec('axe', ['tap', '-x', String(point.x), '-y', String(point.y), '--udid', udid], { timeout: 60000 })
}
