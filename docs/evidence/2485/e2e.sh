#!/bin/bash
# #2485's e2e hand run, as recorded in e2e.txt and e2e-run.png. Run from the repo root under Node 24 after
# `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show --no-default-features --features full`;
# pass the built deep-show if it isn't target/debug/deep-show. The evidence folder's path is shown as <out>.
BIN=${1:-target/debug/deep-show}
O=$(mktemp -d)
echo "#2485 e2e hand run, branch head $(git rev-parse --short HEAD), $(sysctl -n hw.model), $(date '+%Y-%m-%d %H:%M')"
node --no-warnings --experimental-transform-types docs/evidence/2485/e2e.ts "$BIN" "$O" 2>&1 | sed "s#$O#<out>#g"
code=${PIPESTATUS[0]}
rm -rf "$O"
echo "e2e exit $code"
