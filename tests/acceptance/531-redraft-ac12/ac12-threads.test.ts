// Blind redraft of #531's criterion 12 (README.md here): ten logic items at 60 Hz in one long-lived `deep-logic`
// session (the #531 suite's surface: `open`, then `step`), stepped from step 1 to step 1,000 while this test reads the
// process's thread count from outside, again and again. Every reading equals the one taken at step 1, and every item
// runs every step without a trap. Each step of the program spins long enough (about half its default fuel) that a
// thread living only while a step call runs is on the process for most of the run, so the readings see it.
// Fewer than MIN_READINGS readings while steps ran is INCONCLUSIVE (skipped), never a pass; a changed count fails.

import { expect, test } from 'vitest';
import { AC, TIMEOUT, admitted, arr, assemble, int, live, logicBin, piece, prebuild, show, str, threadsOf, type ItemSpec, type JsonObject } from '../531/helpers.ts';

const ITEMS = 10;
const HZ = 60;
const LAST = 1_000;
/** Steps per `step` call after step 1: ten calls, to 100, 200, ..., 1,000. */
const CHUNK = 100;
/** Readings taken while steps ran that the judgement needs (the 531 suite's README: Gates). */
const MIN_READINGS = 20;
/** Iterations of the spin loop in each step (README: Fuel). */
const SPINS = 100_000;

// The program, built for an item that reads nothing and writes `n: i32`: one memory of one page whose maximum is its
// minimum, no imports, no start function, no table. The read region at 0 holds only the step's seed (8 bytes); the
// write region at 64 holds `n`, which each step sets to k. `step` counts SPINS down to 0 before it writes.
const BUSY = `(module
  (memory (export "memory") 1 1)
  (global $reads_at (export "reads_at") i32 (i32.const 0))
  (global $writes_at (export "writes_at") i32 (i32.const 64))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (local $i i32)
    (local.set $i (i32.const ${SPINS}))
    (loop $spin
      (br_if $spin (local.tee $i (i32.sub (local.get $i) (i32.const 1)))))
    (i32.store (global.get $writes_at) (i32.wrap_i64 (local.get $k)))))
`;

const ids = Array.from({ length: ITEMS }, (_, i) => `busy${i}`);

prebuild(() => { assemble('busy', BUSY); logicBin(); });

test(`${AC[12]} ten logic items at 60 Hz run 1,000 steps with deep-logic's thread count unchanged from step 1 to step 1,000`, async (ctx) => {
  const program = assemble('busy', BUSY);
  const items: Record<string, ItemSpec> = Object.fromEntries(ids.map((id) => [id, { program, step_rate: HZ, writes: { n: { type: 'i32' } } }]));
  const p = piece({ seed: 531, items });
  const proc = live();
  try {
    const opened = await proc.call({ call: 'open', piece: p });
    expect(Object.keys(admitted(opened, 'open')).sort(), 'open admits the ten items').toEqual([...ids].sort());
    const session = str(opened['session'], 'open: session');

    const ran = (reply: JsonObject, to: number): void => {
      expect(reply['ok'], `step to ${to} answers ok: ${show(reply)}`).toBe(true);
      expect(int(reply['step'], `step to ${to}: step`), `step to ${to} ran up to step ${to}`).toBe(to);
      expect(arr(reply['failed'], `step to ${to}: failed`), `no item has trapped by step ${to} (each step stays inside its fuel)`).toEqual([]);
    };

    ran(await proc.call({ call: 'step', session, to: 1 }), 1);
    const baseline = threadsOf(proc.pid);
    expect(Number.isInteger(baseline) && baseline > 0, `deep-logic's thread count at step 1 is read (ps -M -p ${proc.pid}): ${baseline}`).toBe(true);

    const readings: { when: string; threads: number }[] = [];
    let whileStepping = 0;
    for (let to = CHUNK; to <= LAST; to += CHUNK) {
      const reply = await proc.call({ call: 'step', session, to }, () => {
        const threads = threadsOf(proc.pid);
        if (Number.isFinite(threads)) { readings.push({ when: `during the step to ${to}`, threads }); whileStepping++; }
      });
      ran(reply, to);
      readings.push({ when: `after the step to ${to}`, threads: threadsOf(proc.pid) });
    }

    const changed = readings.filter((r) => r.threads !== baseline);
    expect(changed.map((r) => `${r.when}: ${r.threads} threads`), `deep-logic had ${baseline} threads at step 1; every reading up to step ${LAST} is the same (${readings.length} readings)`).toEqual([]);
    if (whileStepping < MIN_READINGS) {
      ctx.skip(`INCONCLUSIVE: only ${whileStepping} thread readings were taken while steps 2 to ${LAST} ran (at least ${MIN_READINGS} are needed); every reading equalled step 1's ${baseline}, and this is not a pass`);
    }
  } finally {
    proc.stop();
  }
}, TIMEOUT);
