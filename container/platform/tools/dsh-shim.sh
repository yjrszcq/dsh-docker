#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  exec /usr/bin/setpriv \
    --reuid=1000 \
    --regid=1000 \
    --keep-groups \
    -- \
    /usr/bin/env \
      -u npm_config_userconfig \
      -u npm_config_cache \
      -u npm_config_store_dir \
      -u PNPM_HOME \
      HOME=/home/node \
      USER=node \
      LOGNAME=node \
      XDG_CACHE_HOME=/home/node/.cache \
      XDG_CONFIG_HOME=/home/node/.config \
      XDG_DATA_HOME=/home/node/.local/share \
      DSH_HOME="${DSH_HOME:-/data/dsh}" \
      DSH_PLATFORM_DATA="${DSH_PLATFORM_DATA:-/data/platform}" \
      DSH_PLATFORM_RUN="${DSH_PLATFORM_RUN:-/run/dsh-platform}" \
      DSH_PLATFORM_MANAGED="${DSH_PLATFORM_MANAGED:-1}" \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      /run/dsh-platform/views/runtime/bin/dsh "$@"
fi

exec /run/dsh-platform/views/runtime/bin/dsh "$@"
