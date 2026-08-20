#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 image" >&2
  exit 64
fi

image="$1"

docker run --rm --entrypoint sh "$image" -c '
  set -eu
  for package in \
    bash-completion build-essential dnsutils file htop iproute2 iputils-ping less lsof \
    nano netcat-openbsd openssl pkg-config python3 python3-venv rsync tmux tree unzip \
    vim wget xz-utils zip; do
    dpkg-query --show "$package" >/dev/null
  done

  for command in \
    bash curl dig file g++ git htop ip jq less lsof make nano nc openssl ping \
    pkg-config ps python3 rg rsync ssh tmux tree unzip uv uvx vim wget xz zip; do
    command -v "$command" >/dev/null
  done

  [ "$(command -v python3)" = /usr/bin/python3 ]
  ! command -v pip >/dev/null
  ! command -v pip3 >/dev/null
  [ ! -e /opt/dsh-python ]
  uv --version | grep "^uv 0\.11\.32 (x86_64-unknown-linux-gnu)$" >/dev/null
  uvx --version | grep "^uvx 0\.11\.32 (x86_64-unknown-linux-gnu)$" >/dev/null
  grep '\''^python-downloads = "manual"$'\'' /etc/uv/uv.toml >/dev/null
  uv run --isolated --no-python-downloads -- python -c \
    "import sys; assert sys.prefix != sys.base_prefix"

  venv="$(mktemp -d)/venv"
  python3 -m venv "$venv"
  "$venv/bin/python" --version >/dev/null
'

echo "Devtools smoke checks passed"
