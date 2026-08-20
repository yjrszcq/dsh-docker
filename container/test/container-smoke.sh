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

wait_platform_ready() {
  started="$(date +%s%3N)"
  while ! docker exec "$container" sh -c '
    curl --fail --silent http://127.0.0.1:3080/_dsh_gateway/health >/dev/null \
      && curl --fail --silent --noproxy "*" http://127.0.0.1:3079/ >/dev/null
  ' >/dev/null 2>&1; do
    now="$(date +%s%3N)"
    if [ $((now - started)) -ge 10000 ]; then
      docker logs "$container" >&2
      echo "platform readiness exceeded 10 seconds" >&2
      exit 1
    fi
    sleep 0.2
  done
  now="$(date +%s%3N)"
  echo "$((now - started))"
}

if [ "$#" -eq 0 ]; then
  docker build --tag "$image" .
fi

docker run --detach --name "$container" \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" >/dev/null

startup_one="$(wait_platform_ready)"
attempt=0
until docker logs "$container" 2>&1 \
  | rg '"source":"bootstrap".*"stream":"platform".*"message":"platform ready"' >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 50 ] || exit 1
  sleep 0.2
done

docker exec "$container" sh -c '
  set -eu
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
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/ui/ \
  | rg --fixed-strings 'DSH Platform Management' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e '.updateChannel == "stable"' >/dev/null

loopback_patch_count="$(docker exec "$container" rg --fixed-strings --count-matches \
  'isLoopback: true,' \
  /run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js)"
[ "$loopback_patch_count" = 1 ]

docker exec "$container" sh -c '
  set -eu
  pgrep -f "^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$" >/dev/null
  pgrep -f "/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs" >/dev/null
  pgrep -f "^node /run/dsh-platform/views/runtime/bin/dsh web --patch /run/dsh-platform/views/system-plugins/cordis.patch.yml --host 127.0.0.1 --port 3079$" >/dev/null
  pgrep -f "^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$" >/dev/null
  pgrep -f "^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$" >/dev/null
  dsh-platform trust status | jq -e ".keyringGeneration == 1" >/dev/null
  dsh-platform status | jq -e ".trust.keyringGeneration == 1 and .platformLayout == 1 and .current.source == \"image\"" >/dev/null
  [ "$(stat -c %a /run/dsh-platform/recovery.sock)" = 600 ]
  [ "$(stat -c %U /run/dsh-platform/recovery.sock)" = root ]
  [ "$(readlink /usr/local/bin/dsh 2>/dev/null || true)" = "" ]
  rg --fixed-strings "exec /run/dsh-platform/views/runtime/bin/dsh" /usr/local/bin/dsh >/dev/null
'

stage0_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$')"
bootstrap_pid="$(docker exec "$container" pgrep -f '/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs')"
management_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$')"
gateway_pid="$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$')"
dsh_pid="$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')"
restart_task="$(docker exec "$container" dsh-platform restart | jq -r .taskId)"
attempt=0
until docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status \
  | jq -e --arg task "$restart_task" '.dshRestart.taskId == $task and .dshRestart.status == "success"' >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container" >&2
    echo "DSH restart did not complete" >&2
    exit 1
  fi
  sleep 0.2
done
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /opt/dsh-platform/runtime/platform/stage0/index.mjs$')" = "$stage0_pid" ]
[ "$(docker exec "$container" pgrep -f '/opt/dsh-platform/seed/bootstrap/.*/platform/bootstrap/index.mjs')" = "$bootstrap_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/management/index.mjs$')" = "$management_pid" ]
[ "$(docker exec "$container" pgrep -f '^/usr/local/bin/node /run/dsh-platform/views/bootstrap/control-plane/services/gateway/index.mjs$')" = "$gateway_pid" ]
[ "$(docker exec "$container" pgrep -o -f '^node /run/dsh-platform/views/runtime/bin/dsh web ')" != "$dsh_pid" ]

if docker exec --user node "$container" curl --silent --unix-socket /run/dsh-platform/recovery.sock \
  http://localhost/v1/status >/dev/null 2>&1; then
  echo "node user unexpectedly accessed the Stage-0 recovery socket" >&2
  exit 1
fi

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
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" >/dev/null
startup_two="$(wait_platform_ready)"
docker exec --user node "$container" sh -c 'printf platform > /data/platform/state/updater/smoke && printf home > /data/dsh/smoke'
docker restart "$container" >/dev/null
startup_three="$(wait_platform_ready)"
docker exec "$container" sh -c '[ "$(cat /data/platform/state/updater/smoke)" = platform ] && [ "$(cat /data/dsh/smoke)" = home ]'
echo "Cold readiness (ms): $startup_one, $startup_two, $startup_three"

docker exec "$container" dsh-platform channel experimental >/dev/null
[ "$(docker exec "$container" dsh-platform channel)" = experimental ]
attempt=0
until docker exec --user node "$container" curl --fail --silent --unix-socket /run/dsh-platform/bootstrap.sock \
  http://localhost/v1/status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
docker exec --user node "$container" curl --fail --silent --unix-socket /run/dsh-platform/bootstrap.sock \
  --request POST http://localhost/v1/components/dsh-runtime/suspend >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/ui/ \
  | rg --fixed-strings 'DSH Platform Management' >/dev/null
docker exec "$container" curl --fail --silent --user 'smoke-user:smoke-password' \
  --header 'Host: smoke.example' http://127.0.0.1:3080/_dsh_platform/api/v1/status >/dev/null
docker exec -i --user node "$container" /usr/local/bin/node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
import { LocalApiClient } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/client.mjs'
import { UpdateJournal } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/journal.mjs'
import { PersistentStateSnapshots } from '/run/dsh-platform/views/bootstrap/control-plane/modules/updater/lib/snapshots.mjs'

const bootstrap = new LocalApiClient('/run/dsh-platform/bootstrap.sock')
const { record } = await bootstrap.request('GET', '/v1/deployments/current')
const metadata = JSON.parse(await readFile('/run/dsh-platform/views/runtime/package/package.json', 'utf8'))
const snapshots = new PersistentStateSnapshots({ root: '/data/platform/store/snapshots', sourceRoot: '/data/dsh' })
await snapshots.create({
  id: 'smoke-recovery', runtimeId: record.id,
  environmentVersion: record.environmentVersion, dshVersion: metadata.version,
})
const journal = new UpdateJournal('/data/platform/state/updater/transaction.json')
await journal.begin({
  transactionId: 'smoke-recovery', mode: 'experimental',
  from: {
    dsh: metadata.version, environment: record.environmentVersion, runtime: record.id,
    dataSnapshot: null, receiptTokens: record.receiptTokens,
  },
  to: { dsh: metadata.version, environment: record.environmentVersion, runtime: record.id },
})
await journal.transition('candidate-ready', { receiptTokens: record.receiptTokens })
await journal.transition('suspended')
await journal.transition('snapshot-created', { snapshotId: 'smoke-recovery' })
await journal.transition('switched')
await journal.transition('probation', { probationUntil: '2099-01-01T00:00:00.000Z' })
NODE
docker exec --user node "$container" sh -c 'printf changed-after-snapshot > /data/dsh/smoke'
docker restart "$container" >/dev/null
attempt=0
until docker exec "$container" dsh-platform status >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || exit 1
  sleep 1
done
docker exec "$container" sh -c '
  set -eu
  [ "$(cat /data/dsh/smoke)" = home ]
  [ "$(jq -r .phase /data/platform/state/updater/transaction.json)" = rolled-back ]
  [ "$(dsh-platform channel)" = experimental ]
'
cleanup
trap - EXIT INT TERM

platform_volume="dsh-platform-legacy-$$"
home_volume="dsh-home-legacy-$$"
trap cleanup EXIT INT TERM
docker run --rm --entrypoint sh \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" -c 'mkdir -p /data/platform/runtime && printf preserved > /data/dsh/sentinel'
set +e
legacy_output="$(timeout 15s docker run --rm \
  --volume "$platform_volume:/data/platform" \
  --volume "$home_volume:/data/dsh" \
  "$image" 2>&1)"
status=$?
set -e
[ "$status" -ne 0 ]
echo "$legacy_output" | rg --fixed-strings 'clear only /data/platform' >/dev/null
echo "$legacy_output" | rg --fixed-strings 'Do not delete /data/dsh' >/dev/null
docker run --rm --entrypoint sh --volume "$home_volume:/data/dsh" "$image" \
  -c '[ "$(cat /data/dsh/sentinel)" = preserved ]'
cleanup
trap - EXIT INT TERM

echo "Container smoke checks passed"
