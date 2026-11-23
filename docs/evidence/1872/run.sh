#!/bin/bash
# Fresh GitHub clone of the PR branch, npm ci, then the e2e scenes. Log in e2e.log beside this script.
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.cargo/bin
D="$(cd "$(dirname "$0")" && pwd)/out"; mkdir -p "$D"; cp "$(dirname "$0")/e2e.mjs" "$D/e2e.mjs"
rm -rf "$D/clone"
/usr/bin/git clone -q --branch claude/issue-1872-guard-coverage-600b23 https://github.com/windoliver/deepbuild.git "$D/clone" || exit 1
/usr/bin/git -C "$D/clone" fetch -q origin main
npm ci --prefix "$D/clone" > "$D/npmci.log" 2>&1 || { echo "npm ci failed"; exit 1; }
{ echo "# #1872 e2e, $(date -u +%FT%TZ), node $(node -v), load $(sysctl -n vm.loadavg)"; node "$D/e2e.mjs" "$D/clone"; } > "$D/e2e.log" 2>&1
echo "done exit $?"
