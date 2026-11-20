#!/bin/bash
# #1604 by hand: a fresh GitHub clone of the PR branch, the lint lane's wait-guard command on the real repo files,
# then each planted file the issue names, refused or accepted as it should be. Prints repo-relative paths only.
export PATH=$PATH:/usr/sbin:/sbin  # Node 24 first on PATH
BRANCH=claude/issue-1604-event-waits-e01767
E=${TMPDIR:-/tmp}/deep-1604-e2e; mkdir -p "$E"
rm -rf "$E/clone"
echo "== clone the PR branch from GitHub"
git clone -q --branch $BRANCH https://github.com/windoliver/deepbuild.git "$E/clone" || exit 1
cd "$E/clone" || exit 1
echo "head $(git rev-parse --short HEAD), origin/main $(git rev-parse --short origin/main), node $(node -v), load $(sysctl -n vm.loadavg)"
G=(git -c user.name=E2E -c user.email=e2e@example.invalid -c commit.gpgsign=false)
CMD=$(node --input-type=module -e "import { checks } from './scripts/lanes.mjs'; const c = checks.find((l) => l.name === 'lint').commands.find((c) => c[1] === 'scripts/wait-ratchet.mjs'); console.log(c.slice(1).join(' '))")
echo "the lint lane's command: node $CMD"
guard() { node $CMD > ../out.txt; s=$?; grep -e '^PASS' -e '^FAIL' -e '^INVALID' -e '^BLOCKED' ../out.txt | head -${1:-4}; echo "   exit $s"; return $s; }
expect() { want=$1; shift; echo; echo "== $*"; guard 6; got=$?; if [ $got = $want ]; then echo "   as expected (exit $want)"; else echo "   UNEXPECTED: exit $got, wanted $want"; BAD=1; fi; }
BAD=0
plant() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; }

expect 0 "1. the real repo as cloned: every test file at its ceiling"

echo; echo "== after this lands, its ceilings are at the merge base: point this clone's origin/main at the branch"
BRANCH_HEAD=$(git rev-parse HEAD)
git update-ref refs/remotes/origin/main HEAD
expect 0 "2. the real repo again, now compared with the merge base's ceilings"

P=tests/acceptance/9999/sleeps.test.ts
plant $P "import { expect, it } from 'vitest';
import { sleep, start } from './helpers';

it('serves once started', async () => {
  const server = start();
  await sleep(200);
  expect(server.ready).toBe(true);
});"
expect 1 "3. AC1 + AC5: a planted new suite that sleeps 200 ms before it asserts (await sleep(200), line 6)"
plant $P "import { expect, it } from 'vitest';
import { start } from './helpers';

it('serves once started', async () => {
  const server = start();
  await server.started;
  expect(server.ready).toBe(true);
});"
expect 0 "4. its clean twin, which awaits the event"
rm -rf tests/acceptance/9999

P=tests/acceptance/9999/timer.test.mjs
plant $P "import assert from 'node:assert/strict';
import test from 'node:test';
test('done', async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(true);
});"
expect 1 "5. AC1: the setTimeout(resolve, 200) form, line 4"
rm -rf tests/acceptance/9999

P=packages/hub/test/deadline-e2e.test.ts
plant $P "import { once } from 'node:events';
import { expect, it } from 'vitest';
import { start } from './server';
it('serves once ready, or fails within 30 s', async () => {
  const server = start();
  const deadline = new Promise((_, reject) => {
    // deadline: turns a hang into a failure when the ready event never comes
    setTimeout(() => reject(new Error('no ready event within 30 s')), 30_000);
  });
  await Promise.race([once(server, 'ready'), deadline]);
  expect(server.ready).toBe(true);
});"
expect 0 "6. AC2: a wait bounded by a deadline that rejects, marked with its reason"
sed -i '' '/deadline: turns/d' $P
expect 1 "7. the same deadline without its marker (timer on line 7)"
rm -f $P

P=packages/hub/test/clock-e2e.test.ts
plant $P "import { expect, it } from 'vitest';
import { build } from './build';
it('builds', () => {
  const start = Date.now();
  build();
  expect(Date.now() - start).toBeLessThan(50);
});"
expect 1 "8. AC4: a planted assertion that Date.now() - start is under 50 (line 6)"
plant $P "import { expect, it } from 'vitest';
import { build } from './build';
it('builds', () => {
  expect(build().status).toBe('built');
});"
expect 0 "9. its twin, which asserts the result"
rm -f $P

L=$(node -e "const c = require('./scripts/wait-ceilings.json'); console.log(Object.keys(c).find((p) => p.startsWith('packages/') && c[p] === 2))")
echo; echo "== the listed file used below: $L, ceiling $(node -e "console.log(require('./scripts/wait-ceilings.json')['$L'])")"
cp $L ../listed.bak
echo 'await new Promise((resolve) => setTimeout(resolve, 10));' >> $L
expect 1 "10. AC3: its count rises by one"
node -e "const f = './scripts/wait-ceilings.json', c = require(f); c['$L'] = 3; require('fs').writeFileSync(f, JSON.stringify(c, null, 2) + '\n')"
expect 1 "11. AC3: raising its ceiling to 3 in the same change doesn't help (the merge base says 2)"
git checkout -q -- scripts/wait-ceilings.json; cp ../listed.bak $L
# The guard's own reading of where the file's waits are: with its entry gone, it names each one by line.
node -e "const f = './scripts/wait-ceilings.json', c = require(f); delete c['$L']; require('fs').writeFileSync(f, JSON.stringify(c, null, 2) + '\n')"
LINE=$(git update-ref refs/remotes/origin/main b4a2049e8; node scripts/wait-ratchet.mjs | grep "^FAIL waits: $L:" | head -1 | cut -d: -f3; git update-ref refs/remotes/origin/main $BRANCH_HEAD)
git checkout -q -- scripts/wait-ceilings.json
echo; echo "== dropping one wait: line $LINE of $L is: $(sed -n ${LINE}p $L | sed 's/^ *//' | cut -c1-90)"
sed -i '' "${LINE}d" $L
expect 1 "12. AC3: its count drops to 1 under an unchanged ceiling of 2"
node -e "const f = './scripts/wait-ceilings.json', c = require(f); c['$L'] = 1; require('fs').writeFileSync(f, JSON.stringify(c, null, 2) + '\n')"
expect 0 "13. AC3: its ceiling lowered to 1 in the same change"
git checkout -q -- scripts/wait-ceilings.json $L

P=tests/acceptance/9999/reports.test.ts
plant $P "import { expect, it } from 'vitest';
import { start } from './helpers';
it('reports done', async () => {
  const job = start();
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(job.state).toBe('done');
});"
node -e "const f = './scripts/wait-ceilings.json', c = require(f); c['$P'] = 1; require('fs').writeFileSync(f, JSON.stringify(c, null, 2) + '\n')"
expect 1 "14. AC5: a new acceptance suite with one fixed wait and a ceiling of its own still fails, naming the suite"
rm -rf tests/acceptance/9999; git checkout -q -- scripts/wait-ceilings.json

P=crates/deep-hook/tests/e2e_wait.rs
plant $P "use std::time::Duration;
#[test]
fn settles() {
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(1 + 1, 2);
}"
expect 1 "15. a Rust test that calls thread::sleep (line 4)"
rm -f $P

expect 0 "16. the clone is back as cloned"
echo; echo "git status: $(git status --porcelain | wc -l | tr -d ' ') changed files"
if [ $BAD = 0 ]; then echo "ALL 16 STEPS AS EXPECTED"; else echo "SOME STEP UNEXPECTED"; fi
