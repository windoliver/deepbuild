// #1405 acceptance: threaded budgets read the same way. A planted two-thread spin bench (fixtures/handoff.c)
// runs through `measure` on the real counter, 20 rounds a side, and its pairs are judged by
// `judgeInstructions(pairs, uncounted)` with no seed, as judgeTask judges a budget.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { HANDOFFS, WORK, benchmark, buildHandoff, conditions, loadedAboveCores, macOnly, percent, roundPairs, scratch, shown, spreadOf } from './helpers.mjs';

let binary, directory;
before(() => {
  if (process.platform !== 'darwin') return;
  directory = scratch();
  binary = buildHandoff(directory);
});
const bench = (extra = 0) => [binary, String(HANDOFFS), String(WORK), String(extra)];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function run(current, base) {
  const { judgeInstructions, measure } = await benchmark('judgeInstructions', 'measure');
  const before = conditions();
  const [now, then] = measure(current, directory, { command: base, cwd: directory });
  const after = conditions();
  const { pairs, uncounted } = roundPairs(now, then);
  return { result: judgeInstructions(pairs, uncounted), pairs, before, after };
}

test('a planted two-thread spin bench, A/A over 20 pairs at load above the cores, never reads FAIL', { timeout: 1_800_000 }, async (t) => {
  macOnly();
  const { result, pairs, before, after } = await run(bench(), bench());
  t.diagnostic(`A/A pairs spread ${percent(spreadOf(pairs))}; read ${shown(result)}`);
  assert.notEqual(result?.status, 'FAIL', `the same bench on both sides: ${shown(result)}`);
  assert.ok(['PASS', 'INCONCLUSIVE'].includes(result?.status), shown(result));
  loadedAboveCores(t, before, after);
});

// The same bench at +10%: on the current side, after its handoffs, it spins a counter on one thread for 10%
// of the bench's typical count, work no schedule moves, sized here from the bench's own counts (README: How
// the tests plant).
test('the same bench at +10% reads INCONCLUSIVE', { timeout: 1_800_000 }, async (t) => {
  macOnly();
  const { measureOnce } = await benchmark('measureOnce');
  const count = (argv) => {
    const reading = measureOnce(argv, directory);
    assert.equal(reading.status, 0, reading.output);
    assert.ok(Number.isSafeInteger(reading.instructions) && reading.instructions > 0, `BLOCKED: no count for ${argv.join(' ')}: ${JSON.stringify(reading.instructions)}`);
    return reading.instructions;
  };
  const STEP = 100_000_000;
  const perSpin = (median([0, 1, 2].map(() => count([binary, '0', '0', String(STEP)]))) - median([0, 1, 2].map(() => count([binary, '0', '0', '0'])))) / STEP;
  const typical = median(Array.from({ length: 5 }, () => count(bench())));
  const extra = Math.round((0.1 * typical) / perSpin);
  const { result, pairs, before, after } = await run(bench(extra), bench());
  const spread = spreadOf(pairs);
  const rise = (extra * perSpin) / median(pairs.map(({ base }) => base));
  t.diagnostic(`planted ${extra} spins of ${perSpin.toFixed(2)} instructions on a typical ${typical}: ${percent(rise)} of this run's merge-base median; pairs spread ${percent(spread)}; read ${shown(result)}`);
  // The criterion holds at load above the cores, where the issue saw a spin handoff's count move 133%, for a
  // +10% change. A run that saw less, or whose load moved the bench's typical count so far that the plant
  // isn't near 10% of it, is a reading, not proof, and is skipped as INCONCLUSIVE before it is judged.
  const loaded = before.load > before.cores && after.load > after.cores;
  if (!loaded || spread < 1.33 || !(rise > 0.05 && rise < 0.2)) {
    loadedAboveCores(t, before, after);
    if (spread < 1.33) t.skip(`INCONCLUSIVE: the pairs spread ${percent(spread)}, not the 133% the issue saw at load above the cores`);
    if (!(rise > 0.05 && rise < 0.2)) t.skip(`INCONCLUSIVE: the plant came to ${percent(rise)} of this run's merge-base median, not about 10%`);
    return;
  }
  assert.equal(result?.status, 'INCONCLUSIVE', `a +10% change the schedule's noise hides: ${shown(result)}`);
});
