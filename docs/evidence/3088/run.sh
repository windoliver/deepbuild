#!/bin/bash
# #3088 e2e hand run: in a checkout of the branch, the platform, HEAD, gate check, the platform packages in each
# case's world, then `deep-conformance gate run` of both cases. Usage: run.sh <repo> <log>
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null && nvm use 24 >/dev/null 2>&1
R=$1
LOG=$2
cd "$R" || exit 1
{
  echo "== #3088 e2e on $(uname -s) $(uname -m), $(date '+%Y-%m-%d %H:%M %Z')"
  echo "== HEAD $(git log --oneline -1 | cut -c1-90)"
  echo "== node $(node -v)"
  echo "== deep-conformance gate check"
  node packages/conformance/dist/bin.js gate check | tail -n 1
  echo "== platform packages each world gets (makeWorld, as gate run builds it)"
  node --experimental-transform-types --no-warnings "$(dirname "$0")/worlds.mjs" "$R"
  echo "== verdicts each case expects (manifest.json); the kit prints PASS when a play gets its expected verdict"
  node -e 'const m=require("./packages/conformance/fixtures/gate/manifest.json");for(const id of process.argv.slice(1)){const c=m.cases.find(x=>x.id===id);console.log(`  ${id}: claim ${[].concat(c.claim.expected).join("|")}, twin ${[].concat(c.twin.expected).join("|")}`)}' reporting-vitest-setup reporting-rewrite-on-import
  echo "== deep-conformance gate run reporting-vitest-setup reporting-rewrite-on-import"
  node packages/conformance/dist/bin.js gate run --case reporting-vitest-setup --case reporting-rewrite-on-import | cut -c1-150
  echo "== exit ${PIPESTATUS[0]}"
} 2>&1 | sed "s#$HOME#~#g" | tee "$LOG"
