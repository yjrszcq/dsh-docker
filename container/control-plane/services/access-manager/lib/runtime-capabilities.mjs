import { readFile } from 'node:fs/promises'

function groupId(groupFile, name) {
  for (const line of groupFile.split('\n')) {
    const fields = line.split(':')
    if (fields[0] === name && /^\d+$/.test(fields[2] ?? '')) return Number(fields[2])
  }
  return null
}

function supplementaryGroups(status) {
  const line = status.split('\n').find(value => value.startsWith('Groups:'))
  if (line === undefined) return []
  return line.slice('Groups:'.length).trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger)
}

function mountOption(mounts, mountPoint, prefix) {
  for (const line of mounts.split('\n')) {
    const fields = line.split(' ')
    if (fields[1] !== mountPoint) continue
    return fields[3]?.split(',').find(value => value.startsWith(prefix)) ?? null
  }
  return null
}

async function optionalRead(path) {
  try { return await readFile(path, 'utf8') } catch { return '' }
}

export async function detectRuntimeCapabilities({
  groupPath = '/etc/group',
  initStatusPath = '/proc/1/status',
  mountsPath = '/proc/mounts',
  ptraceScopePath = '/proc/sys/kernel/yama/ptrace_scope',
} = {}) {
  const [groupsFile, initStatus, mounts, ptraceScopeValue] = await Promise.all([
    optionalRead(groupPath),
    optionalRead(initStatusPath),
    optionalRead(mountsPath),
    optionalRead(ptraceScopePath),
  ])
  const enabledGroup = groupId(groupsFile, 'dsh-sudo-true')
  const disabledGroup = groupId(groupsFile, 'dsh-sudo-false')
  const initGroups = supplementaryGroups(initStatus)
  const dshRootCapabilityEffective = enabledGroup !== null && initGroups.includes(enabledGroup)
  const sudoSelection = dshRootCapabilityEffective
    ? 'enabled'
    : (disabledGroup !== null && initGroups.includes(disabledGroup) ? 'disabled' : 'unknown')
  const ptraceScope = /^\d+$/.test(ptraceScopeValue.trim()) ? Number(ptraceScopeValue.trim()) : null
  const hidepid = mountOption(mounts, '/proc', 'hidepid=')

  return {
    dshRootCapabilityEffective,
    agentIsolationEffective: false,
    details: {
      sudoSelection,
      ptraceScope,
      procHidepid: hidepid === null ? null : Number(hidepid.slice('hidepid='.length)),
      agentIsolationReason: 'shared-node-process-identity',
    },
  }
}
