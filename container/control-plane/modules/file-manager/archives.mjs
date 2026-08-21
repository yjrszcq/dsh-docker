import { spawn } from 'node:child_process'
import { lstat, mkdir, readdir, readlink, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { FileManagerError } from './index.mjs'

export const ARCHIVE_FORMATS = Object.freeze({
  zip: { extension: '.zip', command: 'zip' },
  '7z': { extension: '.7z', command: '7z' },
  'tar.gz': { extension: '.tar.gz', command: 'tar' },
})

export function normalizeArchiveFormat(value) {
  if (!Object.hasOwn(ARCHIVE_FORMATS, value)) throw new FileManagerError('archive format is invalid')
  return value
}

function run(command, args, { cwd, signal, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, signal, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    let errorOutput = ''
    let output = ''
    if (capture) {
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => { if (output.length < 8 * 1024 * 1024) output += chunk })
    }
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { if (errorOutput.length < 16_384) errorOutput += chunk })
    child.once('error', reject)
    child.once('exit', (code, signalName) => {
      if (code === 0) resolvePromise(output)
      else reject(new FileManagerError(
        `archive tool failed${errorOutput.trim() === '' ? '' : `: ${errorOutput.trim()}`}`,
        400,
        signalName === 'SIGTERM' ? 'FILE_TASK_CANCELLED' : 'ARCHIVE_TOOL_FAILED',
      ))
    })
  })
}

function validateEntryNames(names) {
  for (const original of names) {
    const name = original.replace(/^(\.\/)+/u, '')
    if (name === '') continue
    if (name.includes('\0') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new FileManagerError('archive contains an unsafe path', 400, 'ARCHIVE_UNSAFE')
    }
  }
}

function inside(root, path) {
  const value = relative(root, path)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..')
}

export async function validateExtractedTree(root) {
  const pending = [root]
  let entries = 0
  let bytes = 0
  while (pending.length > 0) {
    const path = pending.pop()
    const details = await lstat(path)
    if (details.isDirectory() && !details.isSymbolicLink()) {
      for (const name of await readdir(path)) pending.push(join(path, name))
    } else if (details.isSymbolicLink()) {
      const target = await readlink(path)
      if (target.startsWith('/') || !inside(root, resolve(dirname(path), target))) {
        throw new FileManagerError('archive contains a symbolic link outside its destination', 400, 'ARCHIVE_UNSAFE')
      }
    } else if (!details.isFile()) {
      throw new FileManagerError('archive contains an unsupported special file', 415, 'ARCHIVE_UNSAFE')
    }
    entries += 1
    if (details.isFile()) bytes += details.size
  }
  return { entries: Math.max(0, entries - 1), bytes }
}

export async function createArchive({ format, sourceRoot, output, entries = ['.'], signal }) {
  normalizeArchiveFormat(format)
  if (!Array.isArray(entries) || entries.length === 0 || entries.some(entry => typeof entry !== 'string' || entry === '' || entry.includes('\0') || entry.includes('/'))) {
    throw new FileManagerError('archive entry names are invalid')
  }
  if (format === 'zip') await run('zip', ['-q', '-r', output, '--', ...entries], { cwd: sourceRoot, signal })
  else if (format === '7z') await run('7z', ['a', '-bd', '-y', '-t7z', output, '--', ...entries], { cwd: sourceRoot, signal })
  else await run('tar', ['-czf', output, '-C', sourceRoot, '--', ...entries], { signal })
}

export async function extractArchive({ format, archive, output, signal }) {
  normalizeArchiveFormat(format)
  await mkdir(output, { recursive: true })
  try {
    if (format === 'zip') {
      validateEntryNames((await run('unzip', ['-Z1', archive], { signal, capture: true })).split('\n'))
      await run('unzip', ['-qq', archive, '-d', output], { signal })
    } else if (format === '7z') {
      const listed = await run('7z', ['l', '-slt', '--', archive], { signal, capture: true })
      validateEntryNames(listed.split('\n').filter(line => line.startsWith('Path = ')).slice(1).map(line => line.slice(7)))
      await run('7z', ['x', '-bd', '-y', `-o${output}`, '--', archive], { signal })
    } else {
      validateEntryNames((await run('tar', ['-tzf', archive], { signal, capture: true })).split('\n'))
      await run('tar', ['--extract', '--gzip', '--file', archive, '--directory', output, '--no-same-owner', '--no-same-permissions'], { signal })
    }
    return await validateExtractedTree(output)
  } catch (error) {
    await rm(output, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export const archiveInternals = Object.freeze({ inside, run, validateEntryNames })
