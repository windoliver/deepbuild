// Criterion 12 (no upstream test): "Ten logic items at 60 Hz run 1,000 steps with the process's thread count
// unchanged from step 1 to step 1,000"
//
// Through a long-lived `deep-logic` process (README: deep-logic, Sessions): `open` a piece of ten logic items at
// 60 Hz, `step` to step 1, read the process's thread count (macOS `ps -M`), then `step` to step 1,000 while reading it
// again and again, and once more after. Each item's step runs a 50,000-iteration loop (programs.ts `work`), so the
// calls into the engine take most of the run and a thread a step started (a deadline's watchdog, as
// `Runner::call` spawns at check time) would be alive in most readings. The count at step 1 is the baseline; a
// reading that differs fails, naming when it was taken. Fewer than 20 readings during the run can't judge it:
// INCONCLUSIVE (the test skips, never passes).
import { describe, expect, it, type TestContext } from 'vitest';
import { AC, TIMEOUT, live, logicBin, piece, prebuild, show, str, threadsOf } from './helpers.ts';
import { work } from './programs.ts';

prebuild(() => { logicBin(); });

const ITEMS = Array.from({ length: 10 }, (_, i) => `w${i}`);
const tenItems = () => piece({ seed: 531_12, items: Object.fromEntries(ITEMS.map((id) => [id, { program: work(), step_rate: 60, writes: { x: { type: 'i32' as const } } }])) });

describe(`${AC[12]} a step at run time starts no thread`, () => {
  it(`${AC[12]} ten logic items at 60 Hz run 1,000 steps with the process's thread count unchanged from step 1 to step 1,000`, async (ctx: TestContext) => {
    const p = live();
    try {
      const opened = await p.call({ call: 'open', piece: tenItems() });
      expect(opened['ok'], `open takes the piece of ten items: ${show(opened)}`).toBe(true);
      const session = str(opened['session'], 'open: session');
      const first = await p.call({ call: 'step', session, to: 1 });
      expect([first['ok'], first['step'], first['failed']], `step to 1: ${show(first)}`).toEqual([true, 1, []]);
      const baseline = threadsOf(p.pid);
      expect(Number.isInteger(baseline) && baseline > 0, `the process's thread count at step 1 is read (${baseline})`).toBe(true);
      const readings: { when: string; n: number }[] = [];
      const started = Date.now();
      const last = await p.call({ call: 'step', session, to: 1000 }, () => { readings.push({ when: `${Date.now() - started} ms into the run to step 1,000`, n: threadsOf(p.pid) }); });
      expect([last['ok'], last['step'], last['failed']], `step to 1,000: every item ran every step (${show(last)})`).toEqual([true, 1000, []]);
      const after = threadsOf(p.pid);
      const off = [...readings, { when: 'at step 1,000', n: after }].filter((r) => r.n !== baseline);
      expect(off.map((r) => `${r.when}: ${r.n} threads`), `the thread count stays ${baseline} (step 1's) through step 1,000 (${readings.length} readings)`).toEqual([]);
      if (readings.length < 20) ctx.skip(`INCONCLUSIVE: only ${readings.length} thread readings during the run to step 1,000 (it took ${Date.now() - started} ms); 20 are needed to judge`);
    } finally {
      p.stop();
    }
  }, TIMEOUT);
});
