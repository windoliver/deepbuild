// #483.d1623c31: "A jump-flood outline: a 512 × 512 mask fixture run through 9 iterations gives each pixel's distance
// to the nearest mask pixel within 1 px of an exact Euclidean distance transform computed in f64 on the CPU, on 99.9%
// of pixels; the check costs it as 9 passes, within 25% of its declaration; and a planted iterate that feeds every
// run the first run's output instead of the last fails at iteration 2, naming a pixel"
//
// The jump flood is `helpers.ts: jumpFlood`, a pass whose `flood` step is `iterate@1` with count 9 over two
// rgba16float ping-pong targets, its body reading only the frame's color (the mask) and `prev`, run through
// check_operator with the mask as `data.color` and `flood.color` read back (README). Its distances after 9 runs are
// held to `helpers.ts: edt` (exact, f64) within 1 px on 99.9% of pixels. "Fails at iteration 2" needs each run's
// output: the same graph runs with counts 1 to 9, and the result of count k + 1 is held to the jump flood the graph
// spells out run on the CPU k + 1 times (`jfaCpu`), within the same 1 px on 99.9%; iterations count from 0, so
// iteration 2 is the third run, the first whose `prev` differs between the last run's output and the first's.
// The cost: the estimates for counts 1, 2 and 9 grow by one body per run ((e9 − e1) ÷ (e2 − e1) = 8 within 1%), and
// declared at nine runs of the one-run operator (9 × e1) the 9-run flood checks with no cost_understated, its
// estimate within 25% of that declaration.
// Oracle (port): SciPy's test_distance_transform_edt01 (scipy e4e854eaa8, ndimage/tests/test_morphology.py:525-555)
// holds its exact transform to the brute-force one on its 9 × 9 array; here `edt` is held to `bruteEdt` on that
// array to 6 decimals, and the jump flood run on our GPU on it (count 4 from step 8) is held to the brute force
// within 0.005 at every pixel, the rgba16float target's precision there. SciPy measures from each nonzero element
// to the nearest zero, so the mask is the array's zeros.
// At the base there is no iterate step, no `data` or `read` on check_operator, and no planted iterate_feeds_first.
import { describe, expect, it } from 'vitest';
import {
  AC, bruteEdt, checkCall, checked, edt, errors, f32File, failsNaming, frameCall, jfaCpu, jumpFlood, maskFixture, maskRgba, ran, readAt, reds,
  requireGpu, run, shown, useBins, useOut, within, writeRgba, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 512;
const MASK = maskFixture();

const SCIPY = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1, 0, 0], [0, 0, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

/** The flood after 1 to 9 runs, each against the CPU's run of the same graph; the 9-run distances. */
function iterations(planted?: Planted): { problems: string[]; final: Float64Array | null } {
  const dir = out();
  const color = writeRgba(dir, 'mask', maskRgba(MASK));
  const calls = Array.from({ length: 9 }, (_, k) => frameCall({ operators: [jumpFlood('flood', { count: k + 1, start: 256, max: N - 1 })], data: { color }, size: [N, N], read: ['flood.color'] }));
  const replies = run(bins.bin(), dir, calls, planted);
  const problems: string[] = [];
  let final: Float64Array | null = null;
  for (let k = 0; k < 9; k++) {
    const what = `the flood with count ${k + 1}`;
    const got = reds(f32File(dir, readAt(ran(replies[k]!, what), 0, 'flood.color', what).file, `${what}: flood.color`));
    expect(got.length, `${what}: ${N} × ${N} pixels`).toBe(N * N);
    const w = within(got, jfaCpu(MASK, N, N, k + 1, 256), N, 1);
    console.log(`${AC[1]}${planted ? ` (planted ${planted})` : ''}: iteration ${k}: ${(w.share * 100).toFixed(3)}% of pixels within 1 px of the CPU's run`);
    if (w.share < 0.999) { problems.push(`iteration ${k}: ${w.off} of ${N * N} pixels are more than 1 px from the CPU's run of the same flood; the first: ${w.first}`); break; }
    final = got;
  }
  return { problems, final };
}

describe(`${AC[1]} a jump-flood outline through iterate`, () => {
  it(`${AC[1]} 9 iterations on the 512 × 512 mask land within 1 px of an exact f64 distance transform on 99.9% of pixels, each run as the CPU's; the check costs it as 9 passes within 25% of its declaration; SciPy's edt01 holds`, () => {
    requireGpu();
    const { problems, final } = iterations();
    expect(problems, 'each run of the flood').toEqual([]);
    const exact = within(final!, edt(MASK, N, N), N, 1);
    console.log(`${AC[1]}: after 9 runs ${(exact.share * 100).toFixed(3)}% of pixels within 1 px of the exact transform; first outside: ${exact.first ?? 'none'}`);
    expect(exact.share, `within 1 px of the exact Euclidean distance transform on 99.9% of pixels; the first outside: ${exact.first ?? 'none'}`).toBeGreaterThanOrEqual(0.999);

    const dir = out();
    const est = run(bins.bin(), dir, [1, 2, 9].map((count) => checkCall(jumpFlood('flood', { count, start: 256, max: N - 1 })))).map((r, i) => {
      const c = checked(r, `the flood with count ${[1, 2, 9][i]!}`);
      expect(c.outcome, `count ${[1, 2, 9][i]!} checks: ${shown(c.issues)}`).toBe('accepted');
      expect(c.estimate, `count ${[1, 2, 9][i]!}: the check's estimate_ns`).not.toBeNull();
      return c.estimate!;
    });
    const [e1, e2, e9] = est as [number, number, number];
    console.log(`${AC[1]}: estimates per pixel, counts 1, 2, 9: ${e1}, ${e2}, ${e9} ns`);
    expect(e2, 'a second run costs more than one').toBeGreaterThan(e1);
    expect(Math.abs((e9 - e1) / (e2 - e1) - 8), `nine runs cost eight bodies more than one: (e9 − e1) ÷ (e2 − e1) = ${((e9 - e1) / (e2 - e1)).toFixed(3)}`).toBeLessThanOrEqual(0.08);
    const declared = 9 * e1;
    const nine = checked(run(bins.bin(), dir, [checkCall(jumpFlood('flood', { count: 9, start: 256, max: N - 1, extra: { cost: { ns_per_px: declared } } }))])[0]!, 'the flood declared at 9 × e1');
    expect(errors(nine, 'cost_understated'), `declared at nine passes, 9 × ${e1} ns: ${shown(nine.issues)}`).toEqual([]);
    expect(nine.outcome).toBe('accepted');
    expect(Math.abs(e9 - declared) / declared, `the 9-run estimate ${e9} is within 25% of its declaration ${declared}`).toBeLessThanOrEqual(0.25);

    // The oracle's port: SciPy's 9 × 9 array, distances from its nonzero elements to its zeros.
    const sm = new Uint8Array(SCIPY.flat().map((v) => (v === 0 ? 1 : 0)));
    const bf = bruteEdt(sm, 9, 9);
    const mine = edt(sm, 9, 9);
    expect(Array.from(mine, (v, i) => Math.abs(v - bf[i]!) < 5e-7), 'the CPU reference equals the brute force to 6 decimals on SciPy\'s array').not.toContain(false);
    const sdir = out();
    const color = writeRgba(sdir, 'scipy', maskRgba(sm));
    const r = ran(run(bins.bin(), sdir, [frameCall({ operators: [jumpFlood('flood', { count: 4, start: 8, max: 8 })], data: { color }, size: [9, 9], read: ['flood.color'] })])[0]!, 'the flood on SciPy\'s array');
    const gpu = reds(f32File(sdir, readAt(r, 0, 'flood.color', 'SciPy\'s array').file, 'SciPy\'s array: flood.color'));
    const port = within(gpu, bf, 9, 0.005);
    expect(port.off, `the GPU flood on SciPy's array matches its brute force at every pixel; the first off: ${port.first ?? 'none'}`).toBe(0);
  }, 3_600_000);

  it(`${AC[1]} a planted iterate that feeds every run the first run's output (--planted iterate_feeds_first) fails at iteration 2, naming a pixel`, () => {
    requireGpu();
    const { problems } = iterations('iterate_feeds_first');
    failsNaming(problems, [/pixel \(\d+, \d+\)/], 'the planted iterate_feeds_first');
    expect(problems[0], 'it fails first at iteration 2').toMatch(/^iteration 2:/);
  }, 3_600_000);
});
