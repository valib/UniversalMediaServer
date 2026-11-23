/* global console, process, setTimeout, clearTimeout, Buffer */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dismissSafariTip, findButton, simulatorScreenshot, tapMarker } from './simulator-tap.mjs'
import { cropVideo, greenPixels, systemCuePixels } from './cue-frame.mjs'

const origin = process.env.UMS_SIMULATOR_ORIGIN || 'http://127.0.0.1:5287'
const token = randomBytes(16).toString('hex')
const run = promisify(execFile)
const udid = process.env.IOS_SIMULATOR_UDID
const directory = process.env.SAFARI_RESULTS
const mode = process.argv[2] || 'native'
const desktop = process.argv[3] === 'macos'
const browser = desktop ? 'Safari on macOS' : 'Mobile Safari'
const reportFile = join(directory, desktop ? 'result.json' : 'simulator-playback.json')
async function screenshot(file) {
  if (!desktop) return simulatorScreenshot(udid, file)
  await run('/usr/sbin/screencapture', ['-x', '-D', '1', '-t', 'png', file], { timeout: 15000 })
  return readFile(file)
}
let lastProgress
let finish
const received = new Promise((resolve) => {
  finish = resolve
})
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/__simulator-report/' + token || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(404).end()
    return
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 16384) {
      res.writeHead(413).end()
      return
    }
    chunks.push(chunk)
  }
  let result
  try {
    result = JSON.parse(Buffer.concat(chunks).toString())
  }
  catch {
    res.writeHead(400).end()
    return
  }
  if (result.action) {
    try {
      if (result.action === 'tap') {
        if (desktop) {
          const file = join(directory, 'tap-target.png')
          await screenshot(file)
          const point = await findButton(file, result.width)
          // Safari reports fullscreen before its transition finishes painting the controls.
          if (!point) {
            res.writeHead(409).end('The marked button is not visible on the desktop yet')
            return
          }
          await run('cliclick', ['c:' + point.x + ',' + point.y], { timeout: 10000 })
        }
        else {
          if (result.checkSafariTip) await dismissSafariTip(udid)
          await tapMarker(udid, directory, result.width)
        }
      }
      else if (result.action === 'capture') {
        if (desktop && result.appearance === 'desktop') {
          await screenshot(join(directory, 'fullscreen.png'))
          res.writeHead(204).end()
          return
        }
        if (!['default', 'green'].includes(result.appearance)) throw Error('Unknown cue appearance')
        const file = join(directory, result.appearance === 'default' ? 'system-fullscreen.png' : 'system-fullscreen-green.png')
        const png = await screenshot(file)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(systemCuePixels(png)))
        return
      }
      else if (result.action === 'inline') {
        if (!['default', 'green', 'restored'].includes(result.appearance)) throw Error('Unknown inline cue appearance')
        const { width, height, display } = result.bounds
        if (![width, height, display].every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw Error('Invalid video bounds')
        const file = join(directory, 'inline-' + result.appearance + '.png')
        const png = await screenshot(file)
        const video = cropVideo(png, { width, height }, display)
        if (!video) throw Error('Cannot locate the marked video in the simulator screenshot')
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ green: greenPixels(video) }))
        return
      }
      else {
        res.writeHead(400).end()
        return
      }
      res.writeHead(204).end()
    }
    catch (error) {
      const message = [error.message, error.signal, error.stderr].filter(Boolean).join(' ')
      const retryTap = result.action === 'tap' && (error.killed || message.includes('No translation object returned'))
      res.writeHead(retryTap ? 409 : 500).end(message)
    }
    return
  }
  res.writeHead(204).end()
  if (result.status === 'in progress') {
    lastProgress = result
    console.log(browser, result.stage)
  }
  else finish(result)
})
await new Promise((resolve, reject) => server.once('error', reject).listen(Number(process.env.UMS_SIMULATOR_REPORT_PORT || 5289), '127.0.0.1', resolve))
const timeout = setTimeout(() => finish({ status: 'failed', error: browser + ' did not return a final result', lastProgress }), 480000)
const startTimeout = desktop && setTimeout(() => {
  if (!lastProgress) finish({ status: 'failed', error: 'The macOS Safari test page did not open' })
}, 90000)
try {
  const url = origin + '/safari/simulator.html?engine=' + mode + '#mode=' + mode + '&platform=' + (desktop ? 'macos' : 'ios') + '&token=' + token
  const navigate = () => desktop
    ? run('/usr/bin/open', ['-a', 'Safari', url], { timeout: 30000 })
    : run('xcrun', ['simctl', 'openurl', udid, url], { timeout: 90000 })
  try {
    await navigate()
  }
  catch (error) {
    if (!error.killed) throw error
    // A cold simulator may open Safari before simctl acknowledges the request.
    // Retry only when the page has not reported any progress.
    if (!lastProgress) await navigate()
  }
  const result = await received
  console.log(browser, 'playback', JSON.stringify(result))
  await writeFile(reportFile, JSON.stringify(result, null, 2) + '\n')
  if (result.status !== 'passed') {
    if (desktop) await screenshot(join(directory, 'failure.png')).catch(() => {})
    else {
      const tree = await run('axe', ['describe-ui', '--udid', udid], { timeout: 15000 }).catch(() => null)
      if (tree) await writeFile(join(directory, 'simulator-ui.json'), tree.stdout)
    }
    process.exitCode = 1
  }
}
catch (error) {
  await writeFile(reportFile, JSON.stringify({ status: 'failed', error: String(error) }, null, 2) + '\n')
  throw error
}
finally {
  clearTimeout(timeout)
  if (startTimeout) clearTimeout(startTimeout)
  server.close()
}
