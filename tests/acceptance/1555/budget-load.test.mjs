// Acceptance tests for #1555: a budget limit judged above the core count reads INCONCLUSIVE, whichever way it went.
//
// Argument shape (the existing call plus one field):
//   judgeLimit({ limit, runs, fingerprint, loads })
//   loads: an array of five { start, end }, one per run (same order as runs). Each is the one-minute load
//   average read at that run's start and end. A number above os.availableParallelism() makes the result
//   INCONCLUSIVE with the load number in `reason`; a load that is null, NaN or missing does too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { judgeLimit } from '../../../scripts/benchmark.mjs';

const cores = availableParallelism();
const low = Math.max(0.5, cores / 4);
const high = cores + 3.5; // above the cores, and a number that is easy to find in a reason
const machine = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '23H723' };
const within = [90, 92, 95, 91, 99];
const over = [110, 111, 110, 112, 111];
const calm = () => Array.from({ length: 5 }, () => ({ start: low, end: low }));
const judge = (runs, loads) => judgeLimit({ limit: 100, runs, fingerprint: machine, loads });

test('below the cores, within runs still PASS and over runs still FAIL', () => {
  assert.equal(judge(within, calm()).status, 'PASS');
  assert.equal(judge(over, calm()).status, 'FAIL');
  const atCores = Array.from({ length: 5 }, () => ({ start: cores, end: cores }));
  assert.equal(judge(within, atCores).status, 'PASS', 'a load equal to the cores is not above them');
});

test('above the cores, five runs over the limit read INCONCLUSIVE and name the load', () => {
  const loads = Array.from({ length: 5 }, () => ({ start: high, end: high }));
  const result = judge(over, loads);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.match(result.reason, new RegExp(String(high).replace('.', '\\.')));
});

test('above the cores, five runs within the limit read INCONCLUSIVE and name the load', () => {
  const loads = Array.from({ length: 5 }, () => ({ start: high, end: high }));
  const result = judge(within, loads);
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.match(result.reason, new RegExp(String(high).replace('.', '\\.')));
});

for (const [runsName, runs] of [['within', within], ['over', over]]) {
  for (const [place, index] of [['first', 0], ['middle', 2], ['last', 4]]) {
    for (const edge of ['start', 'end']) {
      test(`high load only at the ${edge} of the ${place} run (${runsName} the limit) is INCONCLUSIVE, naming it`, () => {
        const loads = calm();
        loads[index] = { ...loads[index], [edge]: high };
        const result = judge(runs, loads);
        assert.equal(result.status, 'INCONCLUSIVE');
        assert.match(result.reason, new RegExp(String(high).replace('.', '\\.')));
      });
    }
  }
}

test('a load that cannot be read is INCONCLUSIVE, whichever way the runs went', () => {
  for (const runs of [within, over]) {
    for (const bad of [null, NaN, undefined]) {
      for (const edge of ['start', 'end']) {
        const loads = calm();
        loads[3] = { ...loads[3], [edge]: bad };
        assert.equal(judge(runs, loads).status, 'INCONCLUSIVE', `${edge} ${bad}`);
      }
    }
    const short = calm().slice(0, 4); // a missing entry
    assert.equal(judge(runs, short).status, 'INCONCLUSIVE', 'four loads for five runs');
    const hole = calm();
    hole[1] = null;
    assert.equal(judge(runs, hole).status, 'INCONCLUSIVE', 'a null entry');
    assert.equal(judge(runs, undefined).status, 'INCONCLUSIVE', 'no loads at all');
  }
});
