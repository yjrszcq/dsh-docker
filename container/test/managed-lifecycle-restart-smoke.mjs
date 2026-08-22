import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { spawn } from 'node:child_process'

const MANAGEMENT_SOCKET = '/run/dsh-platform/management.sock'
const DSH_EXECUTABLE = '/run/dsh-platform/views/runtime/bin/dsh'
const oldPid = Number.parseInt(process.env.CURRENT_DSH_PID ?? '', 10)

assert.ok(Number.isInteger(oldPid) && oldPid > 1, 'CURRENT_DSH_PID must identify the running DSH')

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function status() {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath: MANAGEMENT_SOCKET,
      method: 'GET',
      path: '/_dsh_platform/api/v1/status',
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Management status returned HTTP ${String(response.statusCode)}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(2_000, () => req.destroy(new Error('Management status timed out')))
    req.once('error', reject)
    req.end()
  })
}

async function dshPids() {
  const entries = await readdir('/proc', { withFileTypes: true })
  const matches = []
  await Promise.all(entries.filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(async entry => {
    try {
      const command = await readFile(`/proc/${entry.name}/cmdline`)
      const args = command.toString('utf8').split('\0').filter(Boolean)
      if (args[1] === DSH_EXECUTABLE && args[2] === 'web') matches.push(Number.parseInt(entry.name, 10))
    } catch {}
  }))
  return matches.sort((left, right) => left - right)
}

function runUnauthorizedHelper() {
  return new Promise((resolve, reject) => {
    const child = spawn(DSH_EXECUTABLE, ['web', '--no-open'], {
      detached: true,
      env: { ...process.env, DSH_PLATFORM_LAUNCH_TOKEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = []
    child.stdout.on('data', chunk => output.push(chunk))
    child.stderr.on('data', chunk => output.push(chunk))
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('unauthorized detached DSH helper did not exit'))
    }, 10_000)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      resolve({ code, output: Buffer.concat(output).toString('utf8') })
    })
  })
}

const before = await status()
assert.equal(before.dshLifecycle?.state, 'running')
assert.deepEqual(await dshPids(), [oldPid])

const helper = await runUnauthorizedHelper()
assert.equal(helper.code, 0)
assert.match(helper.output, /managed DSH is running; no second Web instance was started/)
assert.deepEqual(await dshPids(), [oldPid])

process.kill(oldPid, 'SIGTERM')

let taskId = null
let sawRestarting = false
let finalStatus = null
let newPids = []
const deadline = Date.now() + 25_000
while (Date.now() < deadline) {
  const current = await status()
  if (current.dshLifecycle?.taskId && current.dshLifecycle.taskId !== before.dshLifecycle?.taskId) {
    taskId = current.dshLifecycle.taskId
  }
  if (current.dshLifecycle?.state === 'restarting') sawRestarting = true
  newPids = await dshPids()
  if (taskId !== null && current.dshLifecycle?.state === 'running'
    && newPids.length === 1 && newPids[0] !== oldPid) {
    finalStatus = current
    break
  }
  await delay(100)
}

assert.ok(taskId, 'unregistered SIGTERM did not create a managed restart task')
assert.equal(sawRestarting, true, 'managed restart state was not observed')
assert.equal(finalStatus?.dshLifecycle?.state, 'running')
assert.equal(finalStatus?.recoveryMode, null)
assert.equal(newPids.length, 1)
assert.notEqual(newPids[0], oldPid)

process.stdout.write(`${JSON.stringify({
  helperExitCode: helper.code,
  oldPid,
  newPid: newPids[0],
  taskId,
  sawRestarting,
  dshCount: newPids.length,
})}\n`)
