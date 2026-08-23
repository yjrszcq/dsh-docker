#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo 'usage: bump-environment.sh <new-environment-version>' >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
definition="$repository_root/container/environment/definition.json"
target="$repository_root/release/supported-target.json"
contract="$repository_root/container/platform/tools/supported-target.mjs"
library="$repository_root/container/platform/lib/supported-target.mjs"
new_version=$1

node "$contract" validate "$target" "$definition" >/dev/null
current_version=$(jq -er '.version' "$definition")
comparison=$(node --input-type=module - "$library" "$new_version" "$current_version" <<'EOF'
import { pathToFileURL } from 'node:url'

const [libraryPath, nextVersion, currentVersion] = process.argv.slice(2)
const { compareSemanticVersions } = await import(pathToFileURL(libraryPath).href)
process.stdout.write(String(compareSemanticVersions(
  nextVersion,
  currentVersion,
  'new Environment version',
  'current Environment version',
)))
EOF
)

if [ "$comparison" -lt 0 ]; then
  echo 'new Environment version would roll back the current version' >&2
  exit 1
fi
if [ "$comparison" -eq 0 ]; then
  jq -cn --arg version "$current_version" '{changed:false,version:$version}'
  exit 0
fi

definition_tmp=$(mktemp "${definition}.XXXXXX.tmp")
target_tmp=$(mktemp "${target}.XXXXXX.tmp")
cleanup() {
  rm -f "$definition_tmp" "$target_tmp"
}
trap cleanup EXIT HUP INT TERM

jq --arg version "$new_version" '.version = $version' "$definition" > "$definition_tmp"
jq --arg version "$new_version" '.environment = $version' "$target" > "$target_tmp"
chmod --reference="$definition" "$definition_tmp"
chmod --reference="$target" "$target_tmp"
node "$contract" validate "$target_tmp" "$definition_tmp" >/dev/null

mv "$definition_tmp" "$definition"
mv "$target_tmp" "$target"
sync -f "$definition"
sync -f "$target"
trap - EXIT HUP INT TERM

jq -cn \
  --arg previousVersion "$current_version" \
  --arg version "$new_version" \
  '{changed:true,previousVersion:$previousVersion,version:$version}'
