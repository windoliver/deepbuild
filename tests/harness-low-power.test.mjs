// #1831 lets a Mac17,10 count in the agent harness, and on macOS 26 its `pmset -g` prints `powermode`, never the
// `lowpowermode` line (scripts/benchmark.mjs, fingerprint). So the harness reads Low Power Mode as fingerprint()
// does, or a Mac17,10 in Low Power Mode would count. Run as #607's and #1831's tests run the budgets lane: against
// #48's fake agents, with a fake `sysctl`, `pmset` and `osascript` first on PATH.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BASE, entry, fakeAgents, onlyLane, startHarness } from './acceptance/48/helpers.mjs';

const root = realpathSync(new URL('../', import.meta.url).pathname);
const covered = (facts) => JSON.parse(readFileSync(join(root, 'adapters', facts), 'utf8')).versions[0];

// A Mac17,10 (M5 Max, 18 cores, 64 GB) on mains power with a nominal thermal state, as macOS 26 describes it:
// `pmset -g` has no lowpowermode line, and NSProcessInfo answers `lowPower`.
function mac1710(bin, lowPower) {
  const scripts = {
    sysctl: `[ "$1" = "-n" ] && shift
for key in "$@"; do
  case "$key" in
    hw.model) echo 'Mac17,10' ;;
    hw.memsize) echo '${64 * 2 ** 30}' ;;
    machdep.cpu.brand_string) echo 'Apple M5 Max' ;;
    hw.ncpu) echo 18 ;;
    *) exit 1 ;;
  esac
done`,
    pmset: `case "$*" in
  '-g ps') echo "Now drawing from 'AC Power'" ;;
  '-g') printf 'Currently in use:\\n sleep                1\\n powermode            ${lowPower ? 1 : 0}\\n' ;;
  '-g therm') echo 'Note: No thermal warning level has been recorded' ;;
  *) exit 1 ;;
esac`,
    osascript: `case "$*" in
  *isLowPowerModeEnabled*) echo ${lowPower} ;;
  *thermalState*) echo 0 ;;
  *) exit 1 ;;
esac`,
  };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
}

async function machineOn(t, lowPower) {
  const fake = fakeAgents(t, { obey: true, versions: { claude: covered('claude-code.facts.json'), codex: covered('codex.facts.json') } });
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'deep-harness-low-power-')));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  mac1710(bin, lowPower);
  const result = await startHarness(['budgets', '--base', BASE, '--changed', entry, '--claude', fake.claude, '--codex', fake.codex, '--out', join(bin, 'out')], { env: { ...fake.env, PATH: `${bin}:${fake.env.PATH}` } }).closed;
  return onlyLane(result).machine;
}

test('a Mac17,10 in Low Power Mode, which its pmset prints no lowpowermode line for, is not counted as a reference Mac', { timeout: 600_000, skip: process.platform !== 'darwin' && 'INCONCLUSIVE (platform): off macOS the harness reads no Mac' }, async (t) => {
  assert.deepEqual(await machineOn(t, false), { model: 'Mac17,10', reference: true }, 'with Low Power Mode off the Mac17,10 counts');
  const low = await machineOn(t, true);
  assert.equal(low.reference, false, `in Low Power Mode the Mac17,10 doesn't count: ${JSON.stringify(low)}`);
  assert.match(low.why, /Low Power Mode/, `the lane says Low Power Mode is why: ${JSON.stringify(low)}`);
});
