/* global console, process, setTimeout, clearTimeout, Buffer */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dismissSafariTip, simulatorScreenshot, tapMarker } from './simulator-tap.mjs'
import { cropVideo, greenPixels, systemCuePixels } from './cue-frame.mjs'

const origin = 'http://127.0.0.1:5287'
const token = randomBytes(16).toString('hex')
const run = promisify(execFile)
const udid = process.env.IOS_SIMULATOR_UDID
const directory = process.env.SAFARI_RESULTS
const mode = process.argv[2] || 'native'
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
        if (result.missedTap) await dismissSafariTip(udid)
        await tapMarker(udid, directory, result.width)
      }
      else if (result.action === 'capture') {
        if (!['default', 'green'].includes(result.appearance)) throw Error('Unknown cue appearance')
        const file = join(directory, result.appearance === 'default' ? 'system-fullscreen.png' : 'system-fullscreen-green.png')
        const png = await simulatorScreenshot(udid, file)
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(systemCuePixels(png)))
        return
      }
      else if (result.action === 'inline') {
        if (!['default', 'green', 'restored'].includes(result.appearance)) throw Error('Unknown inline cue appearance')
        const { width, height, display } = result.bounds
        if (![width, height, display].every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw Error('Invalid video bounds')
        const file = join(directory, 'inline-' + result.appearance + '.png')
        const png = await simulatorScreenshot(udid, file)
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
      res.writeHead(500).end([error.message, error.signal, error.stderr].filter(Boolean).join(' '))
    }
    return
  }
  res.writeHead(204).end()
  if (result.status === 'in progress') {
    lastProgress = result
    console.log('Mobile Safari', result.stage)
  }
  else finish(result)
})
await new Promise((resolve, reject) => server.once('error', reject).listen(Number(process.env.UMS_SIMULATOR_REPORT_PORT || 5289), '127.0.0.1', resolve))
const timeout = setTimeout(() => finish({ status: 'failed', error: 'Mobile Safari did not return a final result', lastProgress }), 480000)
try {
  const url = origin + '/safari/simulator.html?engine=' + mode + '#mode=' + mode + '&token=' + token
  const navigate = () => run('xcrun', ['simctl', 'openurl', udid, url], { timeout: 90000 })
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
  console.log('Simulator playback', JSON.stringify(result))
  await writeFile(join(process.env.SAFARI_RESULTS, 'simulator-playback.json'), JSON.stringify(result, null, 2) + '\n')
  if (result.status !== 'passed') {
    const tree = await run('axe', ['describe-ui', '--udid', udid], { timeout: 15000 }).catch(() => null)
    if (tree) await writeFile(join(directory, 'simulator-ui.json'), tree.stdout)
    process.exitCode = 1
  }
}
catch (error) {
  await writeFile(join(process.env.SAFARI_RESULTS, 'simulator-playback.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2) + '\n')
  throw error
}
finally {
  clearTimeout(timeout)
  server.close()
}
