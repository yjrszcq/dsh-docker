#!/bin/sh
set -eu

case "${DSH_TELEMETRY_DISABLED:-true}" in
  true)
    export DSH_TELEMETRY_DISABLED=1
    ;;
  false)
    unset DSH_TELEMETRY_DISABLED
    ;;
  *)
    echo "DSH_TELEMETRY_DISABLED must be true or false" >&2
    exit 64
    ;;
esac

exec "$@"
