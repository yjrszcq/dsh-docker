import { createServer } from 'node:http'
import { chmod, chown, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const ACTION_ROUTE = '/v1/action'
const MAX_BODY_BYTES = 4096

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      const error = new Error('User Skill request body is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

function actionBody(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'action,entryId,revision') {
    const error = new Error('User Skill request is invalid')
    error.statusCode = 400
    throw error
  }
  return value
}

export function createUserSkillServer({ manager, report = async () => {} }) {
  if (manager === undefined || typeof manager.configure !== 'function') throw new Error('User Skill manager is required')
  return createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://user-skills.internal').pathname
      if (request.method !== 'POST' || pathname !== ACTION_ROUTE) return send(response, 404, { error: 'not found' })
      send(response, 200, await manager.configure(actionBody(await jsonBody(request))))
    })().catch(async error => {
      await report('user-skill.privileged-action.failed', {
        error,
        method: request.method ?? null,
        pathname: request.url ?? null,
      })
      send(response, Number.isInteger(error?.statusCode) ? error.statusCode : 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })
}

export async function listenUserSkills(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  if (process.getuid?.() === 0) await chown(socketPath, 0, 1000)
  await chmod(socketPath, process.getuid?.() === 0 ? 0o660 : 0o600)
}
