// AC4 #161.f2821130: Every operator's measured cost is within 25% of its declaration on the reference Mac, and a group
// naming five of them stays within the figure class's operator budget or is refused naming the top three.
//
// The criterion's measured half; `ac4-cost.test.ts` holds what reads no clock. This file is timed: it runs only on a
// reference Mac at rest (scripts/lanes.mjs: `timed`).
//
// #429's `calibrate` call is the calibration run: it times each graph in its own pass at 1920 × 1080, five runs after
// a warm-up, in ns a pixel (1 ns a pixel is 1 ms a megapixel, the issue's unit "at 1080p"). It must list each of the
// pack's 70 as a row `{name, origin: "pack", declared_ns, p95_ns: [5 runs], own_pass: true, warmup: true}`, where
// `declared_ns` is the operator's `cost.ns_per_px`. An operator's measured cost is the largest of its five 95th
// percentiles (#429's reading), and it is within 25% of the declaration: |measured − declared| ≤ 0.25 × declared.
//
// The machine is read by the perf lane's own judge before the run and again after it: off a reference Mac, on
// battery, in Low Power Mode, not thermally nominal, or with the one-minute load above the core count, the test
// fails `INCONCLUSIVE:`, before anything is timed when the machine is unfit then, and with every reading when it
// became so during the run. It never passes there.
//
// Wrong programs: the base (17 operators, and a calibration run that times no pack graph); a declaration copied from
// another operator; a run that times the pack's graphs fused into one pass.
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, TIMEOUT, buildLine, declared, inconclusive, isObject, listProblems, loadNow, packOperators, refusal, requireGpu, runGpu, shown, timingProblem, useBin, useDir,
} from './helpers.ts';

const ID = AC[4];
const gpu = useBin('deep-gpu');
const dir = useDir();

describe(`${ID} each operator's measured cost against its declaration`, () => {
  it(`${ID} on a reference Mac at rest, the calibration run times each of the 70 in its own pass, five runs after a warm-up, and each measured cost is within 25% of its declaration`, () => {
    const operators = packOperators();
    expect(listProblems(operators), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const before = timingProblem();
    if (before) inconclusive(`a measured cost counts only on a reference Mac at rest: ${before}`);
    const start = loadNow();
    const ran = runGpu(gpu().bin, dir(), [{ call: 'calibrate' }]);
    const end = loadNow();
    expect(ran.problem, 'deep-gpu runs calibrate').toBe('');
    expect(refusal(ran.replies[0], 'calibrate'), 'calibrate answers').toBe('');
    const rows = (Array.isArray(ran.replies[0]!['graphs']) ? ran.replies[0]!['graphs'] : []).filter(isObject).filter((g) => g['origin'] === 'pack');
    const byName = new Map(rows.map((g) => [String(g['name']), g]));
    expect(ALL.filter((id) => !byName.has(id)), 'the calibration run lists a row of origin pack for each of the 70').toEqual([]);

    const shape: string[] = []; const outside: string[] = []; const readings: string[] = [];
    for (const id of ALL) {
      const g = byName.get(id)!;
      const runs = Array.isArray(g['p95_ns']) ? g['p95_ns'].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0) : [];
      if (g['own_pass'] !== true || g['warmup'] !== true || runs.length !== 5) { shape.push(`${id}: own_pass ${shown(g['own_pass'])}, warmup ${shown(g['warmup'])}, ${runs.length} timed runs`); continue; }
      if (g['declared_ns'] !== declared(operators[id])) shape.push(`${id}: declared_ns ${shown(g['declared_ns'])} isn't the pack's cost.ns_per_px ${declared(operators[id])}`);
      const measured = Math.max(...runs); const want = declared(operators[id]);
      readings.push(`${id} ${measured.toFixed(4)}/${want}`);
      if (Math.abs(measured - want) > 0.25 * want) outside.push(`${id}: measured ${measured.toFixed(4)} ns a pixel, declared ${want} (${(((measured - want) / want) * 100).toFixed(0)}%)`);
    }
    expect(shape, 'each operator is timed in its own pass, five runs after a warm-up, against its own declaration').toEqual([]);
    console.log(`${ID}: measured/declared ns a pixel, load ${start.toFixed(2)} to ${end.toFixed(2)}: ${readings.join('; ')}`);
    const after = timingProblem();
    if (after) inconclusive(`the machine was not at rest by the run's end (${after}), so these are readings: ${outside.length ? outside.join('; ') : 'every operator within 25%'}`);
    expect(outside, 'operators whose measured cost is more than 25% from their declaration').toEqual([]);
  }, TIMEOUT);
});
