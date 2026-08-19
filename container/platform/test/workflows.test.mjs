import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../../../.github/workflows/dsh-upstream-update.yml', import.meta.url)
const validationUrl = new URL('../../../.github/workflows/dsh-candidate-validation.yml', import.meta.url)

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

test('candidate validation is secret-free and exercises the complete current Environment', async () => {
  const workflow = await readFile(validationUrl, 'utf8')
  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /permissions:\n  contents: read/)
  assert.match(workflow, /supported-target\.mjs validate/)
  assert.match(workflow, /dist\.integrity/)
  assert.match(workflow, /npm test --prefix container\/gateway/)
  assert.match(workflow, /npm test --prefix container\/platform/)
  assert.match(workflow, /container-smoke\.sh/)
  assert.match(workflow, /devtools-smoke\.sh/)
  assert.doesNotMatch(workflow, /secrets\.|DSH_RELEASE_PRIVATE_KEY|DSH_RECOVERY|DOCKER_TOKEN/)
})

test('discovery run reports candidate status and distinct validation notifications', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /uses: \.\/\.github\/workflows\/dsh-candidate-validation\.yml/)
  assert.match(workflow, /statuses: write/)
  assert.match(workflow, /DSH candidate Runtime/)
  assert.match(workflow, /notify-validation-passed:/)
  assert.match(workflow, /notify-validation-failed:/)
})
