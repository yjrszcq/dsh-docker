#!/bin/sh
set -eu

run_root="${DSH_PLATFORM_RUN:-/run/dsh-platform}"
managed_cli="$run_root/views/bootstrap/control-plane/services/management/dsh-platform.mjs"
image_cli="/opt/dsh-platform/runtime/control-plane/services/management/dsh-platform.mjs"

if [ -f "$managed_cli" ]; then
  exec /usr/local/bin/node "$managed_cli" "$@"
fi

exec /usr/local/bin/node "$image_cli" "$@"
