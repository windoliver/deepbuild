// #568 acceptance: `judgeLimit({ limit, runs, fingerprint })` from scripts/benchmark.mjs, with
// recorded fingerprints and planted five-run sets. No test here reads the machine it runs on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { api, FIELDS, OFF_REFERENCE, OTHER, REFERENCE } from './helpers.mjs';

const NOT_JUDGED = ['INCONCLUSIVE', 'INVALID', 'BLOCKED'];
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: margin ${actual}, expected ${expected}`);

// Planted sets against a limit of 100 (ms). Spread is (max - min) / limit; margin is max(5%, spread).
const PASSING = [90, 92, 95, 91, 99];
const FAIL_FLOOR = [110, 111, 110, 112, 111]; // spread 2%, margin 5%: all five over 105
const FAIL_SPREAD = [130, 140, 135, 138, 132]; // spread 10%, margin 10%: all five over 110
const MIXED = [95, 99, 101, 98, 97]; // one over, four within
const FLOOR_DECIDES = [103, 104, 103, 104, 104]; // spread 1%, margin 5%: all over 100, none over 105
const SPREAD_DECIDES = [112, 120, 115, 125, 118]; // spread 13%, margin 13%: 112 is not over 113
const ANY_ONE_RUN = [90, 130, 90, 130, 130]; // any one run alone would pass (90) or fail (130)

test('on the reference Mac, five runs all within the limit pass', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: PASSING, fingerprint: REFERENCE });
  assert.equal(result.status, 'PASS', JSON.stringify(result));
});

test('on the reference Mac, five runs all over the limit by more than the 5% floor fail', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: FAIL_FLOOR, fingerprint: REFERENCE });
  assert.equal(result.status, 'FAIL', JSON.stringify(result));
  near(result.margin, 0.05, 'a 2% spread');
});

test('on the reference Mac, five runs all over the limit by more than their spread fail', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: FAIL_SPREAD, fingerprint: REFERENCE });
  assert.equal(result.status, 'FAIL', JSON.stringify(result));
  near(result.margin, 0.10, 'a 10% spread');
});

test('a mixed set is INCONCLUSIVE with all five runs attached', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: MIXED, fingerprint: REFERENCE });
  assert.equal(result.status, 'INCONCLUSIVE', JSON.stringify(result));
  assert.deepEqual(result.runs, MIXED);
});

test('the 5% floor decides: all five over the limit but within 5% is INCONCLUSIVE, not FAIL', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: FLOOR_DECIDES, fingerprint: REFERENCE });
  assert.equal(result.status, 'INCONCLUSIVE', `a margin of the 1% spread alone fails this set: ${JSON.stringify(result)}`);
  assert.deepEqual(result.runs, FLOOR_DECIDES);
  near(result.margin, 0.05, 'a 1% spread');
});

test('the spread decides: all five over the limit and over 5%, but not over the 13% spread, is INCONCLUSIVE, not FAIL', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const result = judgeLimit({ limit: 100, runs: SPREAD_DECIDES, fingerprint: REFERENCE });
  assert.equal(result.status, 'INCONCLUSIVE', `a fixed 5% margin fails this set: ${JSON.stringify(result)}`);
  assert.deepEqual(result.runs, SPREAD_DECIDES);
  near(result.margin, 0.13, 'a 13% spread');
});

test('a set where any one run alone would pass or fail is INCONCLUSIVE: the lane judges all five', async () => {
  const { judgeLimit } = await api('judgeLimit');
  for (let shift = 0; shift < ANY_ONE_RUN.length; shift++) {
    const runs = [...ANY_ONE_RUN.slice(shift), ...ANY_ONE_RUN.slice(0, shift)];
    const result = judgeLimit({ limit: 100, runs, fingerprint: REFERENCE });
    assert.equal(result.status, 'INCONCLUSIVE', `${runs}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.runs, runs);
  }
});

test('fewer than five runs never pass and never fail', async () => {
  const { judgeLimit } = await api('judgeLimit');
  for (const runs of [[], [50], [50, 50], [50, 50, 50, 50], [500, 500, 500, 500]]) {
    const result = judgeLimit({ limit: 100, runs, fingerprint: REFERENCE });
    assert.ok(NOT_JUDGED.includes(result.status), `${runs.length} runs: ${JSON.stringify(result)}`);
  }
});

test('a missing or broken reading among the five never passes', async () => {
  const { judgeLimit } = await api('judgeLimit');
  for (const runs of [[50, 50, 50, 50, undefined], [50, 50, NaN, 50, 50], [50, 50, 50, -1, 50], [50, null, 50, 50, 50], [50, 50, 50, 50, Infinity]]) {
    const result = judgeLimit({ limit: 100, runs, fingerprint: REFERENCE });
    assert.ok(NOT_JUDGED.includes(result.status), `${JSON.stringify(runs)}: ${JSON.stringify(result)}`);
  }
});

for (const [name, change, reason] of OFF_REFERENCE) {
  test(`${name} alone makes a budget INCONCLUSIVE: a passing set and a failing set are readings, with all five attached and the reason named`, async () => {
    const { judgeLimit } = await api('judgeLimit');
    const fingerprint = { ...REFERENCE, ...change };
    for (const runs of [PASSING, FAIL_SPREAD]) {
      const result = judgeLimit({ limit: 100, runs, fingerprint });
      assert.equal(result.status, 'INCONCLUSIVE', `${name}, ${runs}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.runs, runs);
      assert.match(String(result.reason ?? ''), reason, `the reason names what is off: ${JSON.stringify(result)}`);
    }
  });
}

test('the recorded fingerprint of another Mac makes a budget INCONCLUSIVE, while the reference Mac\'s counts', async () => {
  const { judgeLimit } = await api('judgeLimit');
  for (const runs of [PASSING, FAIL_FLOOR]) {
    const result = judgeLimit({ limit: 100, runs, fingerprint: OTHER });
    assert.equal(result.status, 'INCONCLUSIVE', JSON.stringify(result));
    assert.deepEqual(result.runs, runs);
  }
  assert.equal(judgeLimit({ limit: 100, runs: PASSING, fingerprint: REFERENCE }).status, 'PASS');
  assert.equal(judgeLimit({ limit: 100, runs: FAIL_FLOOR, fingerprint: REFERENCE }).status, 'FAIL');
});

test('a fingerprint missing any field, the macOS build included, never passes or fails', async () => {
  const { judgeLimit } = await api('judgeLimit');
  for (const field of FIELDS) {
    const fingerprint = { ...REFERENCE };
    delete fingerprint[field];
    for (const runs of [PASSING, FAIL_SPREAD]) {
      const result = judgeLimit({ limit: 100, runs, fingerprint });
      assert.ok(NOT_JUDGED.includes(result.status), `without ${field}: ${JSON.stringify(result)}`);
    }
  }
  for (const fingerprint of [undefined, null, {}]) {
    const result = judgeLimit({ limit: 100, runs: PASSING, fingerprint });
    assert.ok(NOT_JUDGED.includes(result.status), `fingerprint ${JSON.stringify(fingerprint)}: ${JSON.stringify(result)}`);
  }
});

test('a memory budget counts only on the reference Mac, under the same five-run rule', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const limit = 128_000_000;
  const under = [100e6, 101e6, 99e6, 100.5e6, 102e6];
  const over = [150e6, 151e6, 150.5e6, 152e6, 150e6];
  assert.equal(judgeLimit({ limit, runs: under, fingerprint: REFERENCE }).status, 'PASS');
  assert.equal(judgeLimit({ limit, runs: over, fingerprint: REFERENCE }).status, 'FAIL');
  for (const [name, change] of OFF_REFERENCE) {
    for (const runs of [under, over]) {
      const result = judgeLimit({ limit, runs, fingerprint: { ...REFERENCE, ...change } });
      assert.equal(result.status, 'INCONCLUSIVE', `memory, ${name}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.runs, runs);
    }
  }
});

// mulberry32, seeded, so a failing case replays.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('property (seed 0x568): over 1000 integer five-run sets, the status and margin follow the rule in any order', async () => {
  const { judgeLimit } = await api('judgeLimit');
  const next = random(0x568);
  const limit = 1000;
  for (let index = 0; index < 1000; index++) {
    // Runs between 800 and 1400, redrawn until none sits exactly on the limit or the fail line.
    let runs, threshold;
    do {
      const centre = 800 + Math.floor(next() * 500);
      const width = Math.floor(next() * 200);
      runs = Array.from({ length: 5 }, () => centre + Math.floor(next() * (width + 1)));
      threshold = limit + Math.max(50, Math.max(...runs) - Math.min(...runs));
    } while (runs.some((run) => run === limit || run === threshold));
    const expected = runs.every((run) => run <= limit) ? 'PASS' : runs.every((run) => run > threshold) ? 'FAIL' : 'INCONCLUSIVE';
    const result = judgeLimit({ limit, runs, fingerprint: REFERENCE });
    assert.equal(result.status, expected, `case ${index}, runs ${runs}: ${JSON.stringify(result)}`);
    near(result.margin, (threshold - limit) / limit, `case ${index}, runs ${runs}`);
    if (expected === 'INCONCLUSIVE') assert.deepEqual(result.runs, runs, `case ${index}`);
    const reversed = judgeLimit({ limit, runs: [...runs].reverse(), fingerprint: REFERENCE });
    assert.equal(reversed.status, expected, `case ${index} reversed`);
  }
});
