import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

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
  await exec('xcrun', ['simctl', 'io', udid, 'screenshot', file], { timeout: 30000 })
  const { stdout } = await exec('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', 'scale=' + width + ':-1:flags=neighbor', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 20000 })
  const point = markerCenter(stdout, width)
  if (!point) throw Error('The simulator screenshot did not contain the marked button')
  await exec('axe', ['tap', '-x', String(point.x), '-y', String(point.y), '--udid', udid], { timeout: 60000 })
}
