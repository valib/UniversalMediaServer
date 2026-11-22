/* global console, process, setTimeout, clearTimeout, Buffer */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

const origin = 'http://127.0.0.1:5287'
const token = randomBytes(16).toString('hex')
let finish
const received = new Promise((resolve) => {
  finish = resolve
})
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/' + token || req.headers.origin !== origin) {
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
  res.writeHead(204, { 'Access-Control-Allow-Origin': origin }).end()
  finish(result)
})
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const timeout = setTimeout(() => finish({ status: 'failed', error: 'Mobile Safari did not return a result' }), 100000)
try {
  const url = origin + '/safari/simulator.html#port=' + server.address().port + '&token=' + token
  await promisify(execFile)('xcrun', ['simctl', 'openurl', process.env.IOS_SIMULATOR_UDID, url], { timeout: 25000 })
  const result = await received
  console.log('Simulator playback', JSON.stringify(result))
  await writeFile(join(process.env.SAFARI_RESULTS, 'simulator-playback.json'), JSON.stringify(result, null, 2) + '\n')
  if (result.status !== 'passed') process.exitCode = 1
}
catch (error) {
  await writeFile(join(process.env.SAFARI_RESULTS, 'simulator-playback.json'), JSON.stringify({ status: 'failed', error: String(error) }, null, 2) + '\n')
  throw error
}
finally {
  clearTimeout(timeout)
  server.close()
}
