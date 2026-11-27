#!/bin/bash
# Hand e2e for #1316 (README.md). Builds deep-gpu (cargo build --locked --bin deep-gpu), fetches the two Khronos
# samples by SHA-256 into ~/.cache/deepbuild-acceptance/khronos, and writes e2e.txt and the two PNGs here.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WT=$(cd "$HERE/../../.." && pwd)
cd "$WT" || exit 1
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin
{
  echo "== $(/usr/bin/git rev-parse --short HEAD): $(/usr/bin/git log -1 --format=%s)"
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root "$HERE" --reporter=verbose 2>&1
  echo "exit $?"
} | sed -e "s#$WT#<checkout>#g" -e "s#$HOME#~#g" | tee "$HERE/e2e.txt"
