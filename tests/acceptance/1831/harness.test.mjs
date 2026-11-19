// #1831 AC1, the agent harness: with a planted Mac17,10 fingerprint its run counts as on a reference Mac, and with a
// planted Mac14,2 fingerprint it is off the list.
// The lane runs as `node scripts/agent-harness.mjs budgets` against #48's fake agent, as #607's tests run it, with
// a fake `sysctl`, `pmset` and `osascript` first on its PATH. No real agent starts and nothing is spent. The lane
// line's `machine` says whether the run counts. Its status isn't read: the fake's Codex job no longer passes (the
// launch facts turned Codex's own sandbox off), so the lane is BLOCKED on any machine (README).
// Run: node --test tests/acceptance/1831/harness.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BASE, entry, fakeAgents, onlyLane, show, startHarness } from '../48/helpers.mjs';
import { AC1, M2_AIR, M5_MAX, fakeMachine, root, scratch } from './helpers.mjs';

const FILE = 'scripts/agent-harness.mjs';
// A version each agent's launch facts cover, for the fake agent to report (#48's own search for one now finds
// another file's).
const covered = (facts) => JSON.parse(readFileSync(join(root, 'adapters', facts), 'utf8')).versions[0];

// The lane on a change to the harness, against #48's base (which has no harness, so nothing runs for the base
// side), on the machine `mac` describes.
async function laneOn(t, mac) {
  const fake = fakeAgents(t, { obey: true, versions: { claude: covered('claude-code.facts.json'), codex: covered('codex.facts.json') } });
  const directory = scratch(t, 'deep-1831-harness-');
  const env = { ...fake.env, PATH: `${fakeMachine(directory, mac)}:${fake.env.PATH}` };
  const result = await startHarness(['budgets', '--base', BASE, '--changed', entry, '--claude', fake.claude, '--codex', fake.codex, '--out', join(directory, 'out')], { env }).closed;
  const lane = onlyLane(result);
  t.diagnostic(JSON.stringify({ status: lane.status, machine: lane.machine }));
  assert.equal(lane.machine?.model, mac.model, `${FILE}: the lane judges the machine the planted sysctl describes\n${show(result)}`);
  return lane;
}

test(`${AC1} the agent harness's budgets lane counts a run on a planted Mac17,10 (M5 Max, 18 cores, 64 GB) as on a reference Mac, and a run on a planted Mac14,2 as off the list`, { timeout: 1_200_000 }, async (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: off macOS the harness reads no Mac at all, so no fingerprint can be planted');

  const off = await laneOn(t, M2_AIR);
  assert.equal(off.machine.reference, false, `${FILE}: a Mac14,2 is off the list: ${JSON.stringify(off)}`);
  assert.ok(typeof off.machine.why === 'string' && off.machine.why.length > 0, `${FILE}: the lane says why a Mac14,2 doesn't count: ${JSON.stringify(off)}`);

  const on = await laneOn(t, M5_MAX);
  assert.equal(on.machine.reference, true, `${FILE} keeps a reference list without the Mac17,10: the design's third reference Mac, on mains power with Low Power Mode off and a nominal thermal state, must count: ${JSON.stringify(on)}`);
});
