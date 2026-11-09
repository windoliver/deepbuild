// AC8 #308: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a document with no
// controls gains no work per frame, and looking up a control's value on a track of 100,000 entries takes under twice
// the time it takes on one of 10,000, as an O(log N) lookup does; a planted lookup that scans the track takes ten
// times as long and fails"
//
// asserts: through `deep-canvas input`. No work per frame is a count (so it runs everywhere): advancing a document
// with no controls over 10 s at 60 and 120 fps leaves the answer's `input_work` at 0, while a document with a keyed
// tour does show work (the counter counts). The lookup is a timing: each answer's `lookup` result gives the values
// (checked against what the filled track holds, so a stub can't pass) and the total ns; on a fit reference Mac
// (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, load within the core count) five ratios of the
// per-lookup time on 100,000 entries to that on 10,000 are judged by the design's rule against 2 (PASS all within,
// FAIL all over by more than the margin, else INCONCLUSIVE), and the planted scan must judge FAIL. Elsewhere, and on
// an INCONCLUSIVE reading, the test skips as INCONCLUSIVE after its structural checks; none passes by skipping.
// The "merge base" comparison is not run: the merge base has no input module, so its per-frame input work is none
// by construction (README: Not tested).
import { describe, expect, it } from 'vitest';
import { GAIN, KNOB, advance, doc, environmentProblem, inputRun, judgeRuns, none, seeded, useCanvas, type InputLine, type TestContext } from './helpers.ts';

const canvas = useCanvas();

describe('AC8 #308 budgets', () => {
  it('AC8 a document with no controls gains no work per frame', () => {
    const bin = canvas.bin();
    for (const fps of [[60, 1], [120, 1]] as [number, number][]) {
      const plain = inputRun(bin, { doc: doc('plain', [KNOB], {}), viewport: [640, 360], fps, ops: [advance(10)] });
      expect(plain.results[0]!.raw['input_work'], `a document with no controls at ${fps[0]} fps: the input module's work over 10 s`).toBe(0);
    }
    const tour = inputRun(bin, {
      doc: doc('tour', [KNOB], { gain: GAIN }, { tour: { keys: { gain: [[0, 0.2, 'hold'], [0.5, 0.8, 'hold']] }, idle_after: 1.4, resume_after: 3.6, loop: true } }),
      viewport: [640, 360], ops: [advance(10)],
    });
    expect(tour.results[0]!.raw['input_work'], 'the counter counts: a document whose tour writes entries shows work').toBeGreaterThan(0);
  }, 1_800_000);

  const SIZES = [10_000, 100_000];
  const TIMES = 2_000;
  const lookupLine = (count: number, runs: number, times: number, planted?: string): { line: InputLine; at: number[] } => {
    const rand = seeded(308_000 + count);
    const at = Array.from({ length: times }, () => 1000 + Math.floor(rand() * (count * 1000 - 1000)));
    return {
      line: { doc: doc('budget', [KNOB], { gain: GAIN }), viewport: [640, 360], fill: { control: 'gain', count }, summary: true, ...(planted ? { planted } : {}), ops: [{ op: 'lookup', control: 'gain', times: at, runs }] },
      at,
    };
  };
  /** Entry i (from 0) is at flick (i + 1) × 1000 with the value (i mod 1000) ÷ 1000: README: `fill`. */
  const expected = (t: number): number => ((Math.floor(t / 1000) - 1) % 1000) / 1000;
  /** Per-lookup ns on a track of `count` entries, with the values checked. */
  function perLookup(bin: string, count: number, runs: number, times: number, planted?: string): number {
    const { line, at } = lookupLine(count, runs, times, planted);
    const r = inputRun(bin, line);
    expect(r.entries, `the filled track holds ${count} entries`).toBe(count);
    const res = r.results[0]!.raw;
    const values = res['values'] as number[];
    const wrong = at.flatMap((t, i) => (values[i] === expected(t) ? [] : [`at ${t} flicks: ${String(values[i])}, not ${expected(t)}`]));
    none(wrong.slice(0, 5), `the lookups on ${count} entries read the track's values`);
    expect(typeof res['ns'], 'the lookup result gives its total ns').toBe('number');
    return (res['ns'] as number) / (runs * times);
  }
  const ratios = (bin: string, runs: number, times: number, planted?: string): number[] => {
    perLookup(bin, SIZES[0]!, 1, 50, planted); // warm-up
    return [0, 1, 2, 3, 4].map(() => perLookup(bin, SIZES[1]!, runs, times, planted) / perLookup(bin, SIZES[0]!, runs, times, planted));
  };
  function settle(ctx: TestContext, what: string, runs: number[], limit: number, want: 'PASS' | 'FAIL'): void {
    const j = judgeRuns(what, runs, limit);
    console.log(`${j.status} ${j.shown}`);
    if (j.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${j.shown}`);
    expect(j.status, `${what} is judged ${want}: ${j.shown}`).toBe(want);
  }

  it('AC8 looking up a control\'s value on 100,000 entries takes under twice the time it takes on 10,000; a planted lookup that scans the track takes ten times as long and fails', (ctx) => {
    const bin = canvas.bin();
    // Structural, anywhere: both sizes answer with the track's values (perLookup asserts them), the scan too.
    perLookup(bin, SIZES[1]!, 1, 100);
    perLookup(bin, SIZES[1]!, 1, 20, 'scanning_lookup');
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    settle(ctx, 'AC8 per-lookup time on 100,000 entries over that on 10,000 (O(log N), limit 2)', ratios(bin, 200, TIMES), 2, 'PASS');
    settle(ctx, 'AC8 the planted scanning lookup, the same ratio (it must exceed 2)', ratios(bin, 1, 200, 'scanning_lookup'), 2, 'FAIL');
  }, 7_200_000);
});
