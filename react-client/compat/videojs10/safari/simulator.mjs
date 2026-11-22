/* global console, process, setTimeout, clearTimeout, Buffer */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tapMarker } from './simulator-tap.mjs'

const origin = 'http://127.0.0.1:5287'
const token = randomBytes(16).toString('hex')
const run = promisify(execFile)
const udid = process.env.IOS_SIMULATOR_UDID
const directory = process.env.SAFARI_RESULTS
const mode = process.argv[2] || 'native'
let checkedSafariTip = false
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
        if (!checkedSafariTip) {
          const tree = await run('axe', ['describe-ui', '--udid', udid], { timeout: 50000 }).catch(() => null)
          if (tree?.stdout.includes('View Bookmarks, Share Menu, and Open Tabs') && tree.stdout.includes('dismiss popup')) {
            await run('axe', ['tap', '--label', 'Close', '--element-type', 'Button', '--udid', udid], { timeout: 45000 })
          }
          checkedSafariTip = true
        }
        await tapMarker(udid, directory, result.width)
      }
      else if (result.action === 'capture') {
        await run('xcrun', ['simctl', 'io', udid, 'screenshot', join(directory, 'system-fullscreen.png')], { timeout: 20000 })
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
await new Promise((resolve, reject) => server.once('error', reject).listen(5289, '127.0.0.1', resolve))
const timeout = setTimeout(() => finish({ status: 'failed', error: 'Mobile Safari did not return a final result', lastProgress }), 300000)
try {
  const url = origin + '/safari/simulator.html#mode=' + mode + '&token=' + token
  await promisify(execFile)('xcrun', ['simctl', 'openurl', process.env.IOS_SIMULATOR_UDID, url], { timeout: 25000 })
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
