// Fast acceptance tests for issue #607: the harness budgets lane counts both reference Macs.
// The lane runs as `node scripts/agent-harness.mjs budgets` against #48's fake agent, with a fake
// `sysctl` and `pmset` first on its PATH, so it judges a machine this Mac is not. No real agent
// starts and nothing is spent.
// Run: node --test tests/acceptance/607/reference-macs.test.mjs
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BASE, entry, fakeAgents, onlyLane, scratch, show, startHarness } from '../48/helpers.mjs';

const LANE = '#607.845595bb';

// The design's two reference Macs ("The reference Macs"), as sysctl names them.
const PRO = { model: 'Mac15,7', memoryGb: 36, cores: 12, chip: 'Apple M3 Pro' };
const AIR = { model: 'Mac15,12', memoryGb: 16, cores: 8, chip: 'Apple M3' };
// A real Mac that is neither: the 15-inch MacBook Air, with the 13-inch Air's chip, cores and memory.
const NEITHER = { model: 'Mac15,13', memoryGb: 16, cores: 8, chip: 'Apple M3' };
const COUNTED = ['PASS', 'INITIAL', 'FAIL'];

// A bin/ holding `sysctl` and `pmset` that describe one machine and nothing else: a key they don't
// know fails as the real sysctl does, so no value of this Mac leaks into the judgement.
function fakeMachine(directory, { model, memoryGb, cores, chip, power = 'AC Power', lowPowerMode = 0 }) {
  const bin = join(directory, 'machine-bin');
  mkdirSync(bin);
  const cpus = ['hw.ncpu', 'hw.physicalcpu', 'hw.physicalcpu_max', 'hw.logicalcpu', 'hw.logicalcpu_max', 'hw.activecpu'];
  const values = { 'hw.model': model, 'hw.memsize': String(memoryGb * 2 ** 30), 'machdep.cpu.brand_string': chip, ...Object.fromEntries(cpus.map((key) => [key, String(cores)])) };
  writeFileSync(join(bin, 'sysctl'), `#!/bin/sh
quiet=0; [ "$1" = "-n" ] && { quiet=1; shift; }
status=0
for key in "$@"; do
  case "$key" in
${Object.entries(values).map(([key, value]) => `    '${key}') value='${value}' ;;`).join('\n')}
    *) echo "sysctl: unknown oid '$key'" >&2; status=1; continue ;;
  esac
  if [ $quiet = 1 ]; then printf '%s\\n' "$value"; else printf '%s: %s\\n' "$key" "$value"; fi
done
exit $status
`);
  writeFileSync(join(bin, 'pmset'), `#!/bin/sh
case "$*" in
  '-g ps'|'-g batt') printf "Now drawing from '${power}'\\n -InternalBattery-0 (id=1)\\t100%%; charged; 0:00 remaining present: true\\n" ;;
  '-g') printf 'System-wide power settings:\\nCurrently in use:\\n standby              1\\n sleep                1\\n displaysleep         10\\n lowpowermode         ${lowPowerMode}\\n' ;;
  '-g therm') printf 'Note: No thermal warning level has been recorded\\nNote: No performance warning level has been recorded\\nNote: No CPU power status has been recorded\\n' ;;
  *) echo "pmset: not faked in #607's tests: $*" >&2; exit 1 ;;
esac
`);
  for (const name of ['sysctl', 'pmset']) chmodSync(join(bin, name), 0o755);
  return bin;
}

// The lane on a change to the harness, against #48's base (which has no harness, so nothing is
// run for the base side), on the machine `spec` describes.
async function laneOn(t, spec) {
  const fake = fakeAgents(t, { obey: true });
  const directory = scratch(t, 'deep-harness-607-');
  const env = { ...fake.env, PATH: `${fakeMachine(directory, spec)}:${fake.env.PATH}` };
  const result = await startHarness(['budgets', '--base', BASE, '--changed', entry, '--claude', fake.claude, '--codex', fake.codex, '--out', join(directory, 'out')], { env }).closed;
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify({ status: lane.status, machine: lane.machine }));
  assert.equal(lane.machine?.model, spec.model, `the lane judges the machine it runs on, read through sysctl\n${show(result)}`);
  return lane;
}

function assertCounts(lane) {
  assert.equal(lane.machine.reference, true, `a reference Mac on mains power, Low Power Mode off and nominal thermal state counts: ${JSON.stringify(lane)}`);
  assert.ok(COUNTED.includes(lane.status), `on a reference Mac the lane is ${COUNTED.join(', ')}, never ${lane.status}: ${JSON.stringify(lane)}`);
}

function assertReading(lane) {
  assert.equal(lane.machine.reference, false, `this machine must not count: ${JSON.stringify(lane)}`);
  assert.ok(typeof lane.machine.why === 'string' && lane.machine.why.length > 0, `the lane says why the machine doesn't count: ${JSON.stringify(lane)}`);
  assert.equal(lane.status, 'INCONCLUSIVE', `off the reference Macs a budget is only a reading: ${JSON.stringify(lane)}`);
}

describe('the budgets lane judges the machine against both reference Macs', { concurrency: true }, () => {
  test(`${LANE} on the 13-inch MacBook Air (Mac15,12, 8 cores, 16 GB, Apple M3) the lane counts: reference true and PASS, INITIAL or FAIL, not INCONCLUSIVE`, async (t) => {
    assertCounts(await laneOn(t, AIR));
  });

  test(`${LANE} on a Mac that is neither reference Mac the lane is a reading, and its why names both Mac15,7 and Mac15,12`, async (t) => {
    const lane = await laneOn(t, NEITHER);
    assertReading(lane);
    assert.match(lane.machine.why, /Mac15,7/, `the why names the 16-inch MacBook Pro: ${lane.machine.why}`);
    assert.match(lane.machine.why, /Mac15,12/, `the why names the 13-inch MacBook Air: ${lane.machine.why}`);
  });

  test(`${LANE} the 16-inch MacBook Pro (Mac15,7, 12 cores, 36 GB, Apple M3 Pro) still counts`, async (t) => {
    assertCounts(await laneOn(t, PRO));
  });

  // Each holds the Air's model with one part or condition off. A part from the other reference
  // Mac doesn't make the Air count.
  for (const [what, change] of [
    ['an M3 Pro chip', { chip: 'Apple M3 Pro' }],
    ['24 GB of memory', { memoryGb: 24 }],
    ['12 cores', { cores: 12 }],
    ['battery power', { power: 'Battery Power' }],
  ]) {
    test(`${LANE} a Mac15,12 with ${what} doesn't count`, async (t) => {
      assertReading(await laneOn(t, { ...AIR, ...change }));
    });
  }
});
