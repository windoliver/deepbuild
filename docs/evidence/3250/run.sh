#!/bin/bash
# #3250 hand run: a real hub records two Claude Code stops, one transcript split and one total-only, then prints the
# record's turn.usage and deep numbers (drive.ts). The whole run, as shown, is also written to e2e.log.
R=$(cd "$(dirname "$0")/../../.." && pwd)
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/local/bin:$HOME/.cargo/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd "$R" || exit 1
rm -f docs/evidence/3250/drive.out
{
  echo "#3250 e2e by hand · HEAD $(/usr/bin/git rev-parse --short HEAD) · last code commit $(/usr/bin/git log -1 --format=%h -- packages crates) · $(date -u +%FT%TZ) · node $(node --version)"
  echo
  NO_COLOR=1 npx vitest run --config docs/evidence/3250/vitest.config.ts --reporter=dot > docs/evidence/3250/vitest.out 2>&1
  code=$?
  cat docs/evidence/3250/drive.out 2>/dev/null || echo "the driver wrote no output"
  echo
  echo "driver: $(grep -E 'Tests +[0-9]' docs/evidence/3250/vitest.out | sed 's/^ *//') · run exit $code"
} 2>&1 | tee docs/evidence/3250/e2e.log
