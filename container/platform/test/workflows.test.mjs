import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../../../.github/workflows/dsh-upstream-update.yml', import.meta.url)
const validationUrl = new URL('../../../.github/workflows/dsh-candidate-validation.yml', import.meta.url)
const productionUrl = new URL('../../../.github/workflows/production-publish.yml', import.meta.url)
const dockerUrl = new URL('../../../.github/workflows/docker.yaml', import.meta.url)

test('upstream workflow discovers candidates without production credentials', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /pull-requests: write/)
  assert.match(workflow, /supported-target\.mjs" advance/)
  assert.match(workflow, /trusted-platform/)
  assert.match(workflow, /node "\$trusted_platform\/tools\/supported-target\.mjs"/)
  assert.match(workflow, /git merge --no-edit/)
  assert.match(workflow, /replace_closed=true/)
  assert.match(workflow, /git push --force-with-lease/)
  assert.match(workflow, /git push origin/)
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
  assert.match(workflow, /npm test --prefix container\/control-plane\/services\/gateway/)
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

test('production publication is protected, monotonic, and exclusively owns Release signing', async () => {
  const workflow = await readFile(productionUrl, 'utf8')
  assert.match(workflow, /branches:\n      - main/)
  assert.match(workflow, /release\/supported-target\.json/)
  assert.match(workflow, /release\/official-dsh-policy\.json/)
  assert.match(workflow, /environment: production-release/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /DSH_RELEASE_PRIVATE_KEY/)
  assert.match(workflow, /prepare-release\.mjs/)
  assert.match(workflow, /parseStable/)
  assert.match(workflow, /previous\.targetSequence \+ 1/)
  assert.match(workflow, /--draft/)
  assert.match(workflow, /--draft=false/)
  assert.match(workflow, /--latest/)
  assert.match(workflow, /--json isDraft/)
  assert.match(workflow, /diff -u "\$RUNNER_TEMP\/local-assets"/)
  assert.doesNotMatch(workflow, /RECOVERY_PRIVATE|secrets: inherit/)
})

test('Docker publication has no signing key or metadata release authority', async () => {
  const workflow = await readFile(dockerUrl, 'utf8')
  assert.match(workflow, /environment: production-image/)
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /permissions:\n      contents: read/)
  assert.match(workflow, /latestSupportedDsh/)
  assert.doesNotMatch(workflow, /DSH_RELEASE_PRIVATE_KEY|prepare-release\.mjs|gh release/)
})
