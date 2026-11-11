// #1405 acceptance: a pair run with one side at lower QoS. The planted two-thread spin bench runs through
// `measure` with its current side started by `taskpolicy -c utility`, below the default QoS a command
// runs at, and its merge-base side as it is (README: Readings, 5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDOFFS, WORK, benchmark, buildHandoff, conditions, macOnly, percent, roundPairs, scratch, shown, spreadOf } from './helpers.mjs';

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('a pair run with one side at lower QoS reads INCONCLUSIVE or FAIL, never PASS', { timeout: 1_800_000 }, async (t) => {
  macOnly();
  const { judgeInstructions, measure } = await benchmark('judgeInstructions', 'measure');
  const directory = scratch();
  const bench = [buildHandoff(directory), String(HANDOFFS), String(WORK)];
  const before = conditions();
  const [now, then] = measure(['/usr/sbin/taskpolicy', '-c', 'utility', ...bench], directory, { command: bench, cwd: directory });
  const after = conditions();
  const { pairs, uncounted } = roundPairs(now, then);
  const result = judgeInstructions(pairs, uncounted);
  const lowered = median(pairs.map(({ current }) => current)), other = median(pairs.map(({ base }) => base));
  t.diagnostic(`load ${before.load.toFixed(1)} then ${after.load.toFixed(1)} on ${before.cores} cores; median count ${lowered} at lower QoS, ${other} at the default; pairs spread ${percent(spreadOf(pairs))}; read ${shown(result)}`);
  // The criterion presumes what the issue says of spin code: a side scheduled worse counts more of its own
  // waiting. A run where the lower-QoS side retired fewer instructions than the other is a reading, not
  // that case (README: Readings, 5), and is skipped as INCONCLUSIVE with what it saw.
  if (!(lowered > other)) return t.skip(`INCONCLUSIVE: the lower-QoS side retired fewer instructions (median ${lowered}) than the default side (${other}), so this run isn't the case the criterion states`);
  assert.notEqual(result?.status, 'PASS', `one side at lower QoS: ${shown(result)}`);
  assert.ok(['INCONCLUSIVE', 'FAIL'].includes(result?.status), shown(result));
});
