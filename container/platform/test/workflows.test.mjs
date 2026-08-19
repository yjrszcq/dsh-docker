import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../../../.github/workflows/dsh-upstream-update.yml', import.meta.url)

test('upstream workflow discovers candidates without production credentials', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /supported-target\.mjs advance/)
  assert.match(workflow, /git push --force-with-lease/)
  assert.match(workflow, /chore\(dsh\): validate/)
  assert.doesNotMatch(workflow, /DSH_RELEASE_PRIVATE_KEY|DSH_RECOVERY|DOCKER_TOKEN/)
})

test('upstream workflow calls only the pinned reusable Gotify interface', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /yjrszcq\/github-workflows\/\.github\/workflows\/gotify-notify\.yml@v1/)
  assert.match(workflow, /gotify_url: \$\{\{ secrets\.GOTIFY_URL \}\}/)
  assert.match(workflow, /gotify_token: \$\{\{ secrets\.GOTIFY_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /secrets: inherit/)
})
