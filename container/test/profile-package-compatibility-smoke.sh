#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <container>" >&2
  exit 64
fi

container="$1"
profile=/data/dsh/profiles/web
legacy_store=/workspace/.pnpm-store
stable_store=/data/dsh/.pnpm-store
fixture=/workspace/profile-package-smoke

docker exec "$container" dsh-platform stop --wait >/dev/null
docker exec --user node "$container" sh -c "
  set -eu
  test -f '$profile/package.json'
  mkdir -p '$legacy_store'
  if [ -d '$stable_store' ]; then cp -a '$stable_store/.' '$legacy_store/'; fi
"
docker exec --user node --env PROFILE="$profile" --env LEGACY_STORE="$legacy_store" \
  "$container" node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs"
    const path = process.env.PROFILE + "/pnpm-workspace.yaml"
    const source = readFileSync(path, "utf8")
    const line = `storeDir: ${JSON.stringify(process.env.LEGACY_STORE)}\n`
    const pattern = /^storeDir:[^\r\n]*(?:\r?\n|$)/m
    writeFileSync(path, pattern.test(source)
      ? source.replace(pattern, line)
      : source.replace(/(?:\r?\n)?$/, `\n\n${line}`))
  '
docker exec --user node "$container" sh -c "
  set -eu
  rm -rf '$profile/node_modules'
  cd '$profile'
  pnpm install --offline --frozen-lockfile --reporter=append-only >/dev/null
"
docker exec --user node --env PROFILE="$profile" --env LEGACY_STORE="$legacy_store" \
  "$container" node -e '
    const value = JSON.parse(require("fs").readFileSync(process.env.PROFILE + "/node_modules/.modules.yaml", "utf8"))
    if (!value.storeDir.startsWith(process.env.LEGACY_STORE + "/")) throw new Error(value.storeDir)
  '

docker exec "$container" dsh-platform start --wait >/dev/null
docker exec --user node --env PROFILE="$profile" --env STABLE_STORE="$stable_store" \
  "$container" node -e '
    const value = JSON.parse(require("fs").readFileSync(process.env.PROFILE + "/node_modules/.modules.yaml", "utf8"))
    if (!value.storeDir.startsWith(process.env.STABLE_STORE + "/")) throw new Error(value.storeDir)
  '

docker exec --user node "$container" sh -c "
  set -eu
  mkdir -p '$fixture'
  printf '%s\n' '{\"name\":\"profile-package-smoke\",\"version\":\"1.0.0\",\"type\":\"module\",\"main\":\"index.mjs\",\"dsh\":{\"bundle\":{\"patch\":\"./cordis.patch.yml\"}}}' > '$fixture/package.json'
  printf '%s\n' 'export default function () {}' > '$fixture/index.mjs'
  printf '%s\n' '- insert:' '    - id: profile-package-smoke' '      name: file://$fixture/index.mjs' > '$fixture/cordis.patch.yml'
"
docker exec \
  --env npm_config_userconfig=/root/.config/npm/npmrc \
  --env npm_config_cache=/root/.npm \
  "$container" dsh plugin --profile web add "$fixture" >/dev/null
docker exec "$container" sh -c "
  set -eu
  test \"\$(stat -c %U '$profile/package.json')\" = node
  test \"\$(stat -c %U '$profile/pnpm-lock.yaml')\" = node
  test \"\$(stat -c %U '$profile/node_modules/profile-package-smoke')\" = node
"
docker exec "$container" dsh plugin --profile web remove profile-package-smoke >/dev/null
docker exec --user node "$container" rm -rf "$fixture"
docker logs "$container" 2>&1 \
  | grep -F "dsh: migrated Profile package storage from $legacy_store/" >/dev/null

