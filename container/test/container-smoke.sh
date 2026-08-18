#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [image]" >&2
  exit 64
fi

image="${1:-dsh-docker:smoke}"
container="dsh-gateway-smoke-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ "$#" -eq 0 ]; then
  docker build --tag "$image" .
fi

docker run --detach --name "$container" \
  --env DSH_PROXY_USERNAME=smoke-user \
  --env DSH_PROXY_PASSWORD=smoke-password \
  --env DSH_TRUSTED_HOSTS=smoke.example \
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

docker exec "$container" sh -c 'command -v python3' >/dev/null

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

docker exec "$container" rg --fixed-strings --count-matches 'isLoopback: true,' \
  /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js \
  | rg '^1$' >/dev/null

docker exec "$container" sh -c '
  gateway_pid="$(pgrep -f "^/usr/local/bin/node /opt/dsh-gateway/index.mjs$")"
  ps --ppid "$gateway_pid" -o args= \
    | rg --fixed-strings "/usr/local/bin/dsh web --host 127.0.0.1 --port 3079" >/dev/null
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
trap - EXIT INT TERM

set +e
timeout 15s docker run --rm --env DSH_DEFAULT_WORKSPACE=/missing-dsh-workspace \
  "$image" >/dev/null 2>&1
status=$?
set -e
[ "$status" -eq 64 ]

echo "Container smoke checks passed"
