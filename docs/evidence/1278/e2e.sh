#!/bin/bash
# #1278's e2e hand run, as recorded in e2e.txt and e2e-run.png (run at acb717f0d with this e2e.ts, then
# uncommitted and byte-identical to the committed one). Run from the repo root after
# `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu`, under Node 24.
# The output folder's path is shown as <out>.
O=${1:-$(mktemp -d)}
echo "#1278 e2e hand run, branch head $(git rev-parse --short HEAD) (no source change; renderer = its merge base with main, $(git merge-base HEAD origin/main | cut -c1-9)), $(sysctl -n hw.model), $(date '+%Y-%m-%d %H:%M')"
node --no-warnings --experimental-transform-types docs/evidence/1278/e2e.ts target/debug/deep-gpu "$O" 2>&1 | sed "s#$O#<out>#g"
echo "e2e exit ${PIPESTATUS[0]}"
