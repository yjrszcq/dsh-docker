#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [image]" >&2
  exit 64
fi

image="${1:-dsh-docker:smoke}"
container="dsh-gateway-smoke-$$"
platform_volume="dsh-platform-smoke-$$"
home_volume="dsh-home-smoke-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$platform_volume" "$home_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ "$#" -eq 0 ]; then
  docker build --tag "$image" .
fi

docker run --detach --name "$container" \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
  --volume "$platform_volume:/data" \
  --volume "$home_volume:/home/node/.dsh" \
  "$image" >/dev/null

attempt=0
until docker exec "$container" curl --fail --silent \
  http://127.0.0.1:3080/_dsh_gateway/health >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container" >&2
    exit 1
  fi
  sleep 1
done

docker exec "$container" sh -c '
  command -v python3 >/dev/null
  venv="$(mktemp -d)/venv"
  python3 -m venv "$venv"
  "$venv/bin/python" -c "import sys; assert sys.prefix != sys.base_prefix"
  "$venv/bin/pip" --version >/dev/null
'

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: evil.example' http://127.0.0.1:3080/)"
[ "$status" = 403 ]

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Accept: text/html' --header 'Host: smoke.example' http://127.0.0.1:3080/)"
[ "$status" = 401 ]

status="$(docker exec "$container" curl --silent --output /dev/null --write-out '%{http_code}' \
  --user 'wrong-user:smoke-password' --header 'Host: smoke.example' \
  http://127.0.0.1:3080/)"
[ "$status" = 401 ]

docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/ >/dev/null

loopback_patch_count="$(docker exec "$container" rg --fixed-strings --count-matches \
  'isLoopback: true,' \
  /data/runtime/current/package/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js)"
[ "$loopback_patch_count" = 1 ]

docker exec "$container" sh -c '
  pgrep -f "^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$" >/dev/null
  pgrep -f "/data/bootstrap/versions/.*/platform/bootstrap/index.mjs" >/dev/null
  ps -eo args= | rg "package/lib/bin.js web --patch /data/system-plugins/current/cordis.patch.yml --host 127.0.0.1 --port 3079" >/dev/null
  pgrep -f "^/usr/local/bin/node /data/bootstrap/current/control-plane/management/index.mjs$" >/dev/null
  pgrep -f "^/usr/local/bin/node /opt/dsh-platform/runtime/control-plane/gateway/index.mjs$" >/dev/null
  dsh-platform trust status | jq -e ".keyringGeneration == 1" >/dev/null
  dsh-platform status | jq -e ".trust.keyringGeneration == 1" >/dev/null
  [ "$(readlink /usr/local/bin/dsh 2>/dev/null || true)" = "" ]
  rg --fixed-strings "exec /data/runtime/current/bin/dsh" /usr/local/bin/dsh >/dev/null
'

docker exec "$container" curl --fail --silent --noproxy '*' \
  http://127.0.0.1:3079/ >/dev/null

container_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")"
if docker exec "$container" curl --fail --silent --max-time 2 --noproxy '*' \
  "http://${container_ip}:3079/" >/dev/null 2>&1; then
  echo "DSH unexpectedly accepts non-loopback connections on port 3079" >&2
  exit 1
fi

cleanup
docker run --detach --name "$container" \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
  --volume "$platform_volume:/data" \
  --volume "$home_volume:/home/node/.dsh" \
  "$image" >/dev/null
docker exec "$container" sh -c 'printf platform > /data/state/smoke && printf home > /home/node/.dsh/smoke'
docker restart "$container" >/dev/null
attempt=0
until docker exec "$container" dsh-platform status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
docker exec "$container" sh -c '[ "$(cat /data/state/smoke)" = platform ] && [ "$(cat /home/node/.dsh/smoke)" = home ]'

docker exec "$container" dsh-platform channel experimental >/dev/null
[ "$(docker exec "$container" dsh-platform channel)" = experimental ]
docker exec --user node "$container" curl --fail --silent --unix-socket /data/run/bootstrap.sock \
  --request POST http://localhost/v1/components/dsh-runtime/suspend >/dev/null
docker exec -i --user node "$container" /usr/local/bin/node --input-type=module <<'NODE'
import { readFile, readlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { LocalApiClient } from '/data/bootstrap/current/control-plane/updater/lib/client.mjs'
import { UpdateJournal } from '/data/bootstrap/current/control-plane/updater/lib/journal.mjs'
import { PersistentStateSnapshots } from '/data/bootstrap/current/control-plane/updater/lib/snapshots.mjs'

const runtime = basename(await readlink('/data/runtime/current'))
const environment = basename(await readlink('/data/environments/current'))
const metadata = JSON.parse(await readFile(`/data/runtime/versions/${runtime}/package/package.json`, 'utf8'))
const trust = new LocalApiClient('/data/run/stage0-trust.sock')
const receiptTokens = (await trust.activeReceipts()).receipts.map(receipt => receipt.token).sort()
const snapshots = new PersistentStateSnapshots({ root: '/data/snapshots', sourceRoot: '/home/node/.dsh' })
await snapshots.create({ id: 'smoke-recovery', runtimeId: runtime, environmentVersion: environment, dshVersion: metadata.version })
const journal = new UpdateJournal('/data/state/update-transaction.json')
await journal.begin({
  transactionId: 'smoke-recovery', mode: 'experimental',
  from: { dsh: metadata.version, environment, runtime, dataSnapshot: null, receiptTokens },
  to: { dsh: metadata.version, environment, runtime },
})
await journal.transition('candidate-ready', { receiptTokens })
await journal.transition('suspended')
await journal.transition('snapshot-created', { snapshotId: 'smoke-recovery' })
await journal.transition('switched')
await journal.transition('probation', { probationUntil: '2099-01-01T00:00:00.000Z' })
NODE
docker exec --user node "$container" sh -c 'printf changed-after-snapshot > /home/node/.dsh/smoke'
docker restart "$container" >/dev/null
attempt=0
until docker exec "$container" dsh-platform status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
docker exec "$container" sh -c '
  [ "$(cat /home/node/.dsh/smoke)" = home ]
  [ "$(jq -r .phase /data/state/update-transaction.json)" = rolled-back ]
  [ "$(dsh-platform channel)" = experimental ]
'
cleanup
trap - EXIT INT TERM

set +e
timeout 15s docker run --rm --env DSH_DEFAULT_WORKSPACE=/missing-dsh-workspace \
  "$image" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ]

echo "Container smoke checks passed"
