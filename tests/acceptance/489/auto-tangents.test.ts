// Criterion 4: "A clamped auto-tangent channel never overshoots its keys' values at 10,000 random times, and
// changing one key changes only its neighbours' spans"
//
// Through `deep-motion eval`. Keys carry times and values only, each with `interp: {auto: {clamp: true}}` (the
// default smoothness, 0.33). The keys hold near-plateaus (10 then 10.5, 4 then 4) and local extremes, where an
// unclamped Catmull-Rom or a cardinal spline overshoots; a global (natural) spline changes every span when one key
// moves. A key's span is the segment it owns, to the next key; "its neighbours' spans" are the spans that touch
// key k − 1 or key k + 1, whose handles the design recomputes ("Changing one key recomputes only its neighbors'
// handles"): spans from key k − 2 to key k + 2. Every span outside them must read the same, bit for bit. No
// upstream test (oracle page: "we found no test of overshoot or of one key changing only its neighbours' spans").
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, chan, evalOk, film, fl, keyed, none, rect, seeded, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();

const AUTO = { auto: { clamp: true } };
/** Key times 0 … 9 s and their values: plateaus, extremes, a step down and back. */
const VALUES = [0, 10, 10.5, 0, 4, 4, 9, 2, 2.5, 8];
function autoDoc(id: string, values: number[]): JsonObject {
  const keys = Object.fromEntries(values.map((v, i) => [`k${i}`, { t: `${i}s`, value: v, interp: AUTO }]));
  return film(id, [rect('dot', [100, 100])], { channels: { glide: keyed('items/dot/at/pos/1', keys) } }, { span: '9s' });
}
const BASE = autoDoc('auto-base', VALUES);
const MOVED_KEY = 5;
const MOVED = autoDoc('auto-moved', VALUES.map((v, i) => (i === MOVED_KEY ? 7 : v)));

const rand = seeded(489_04);
const TIMES = [...new Set(Array.from({ length: 10_000 }, () => Math.floor(rand() * fl(9))))].sort((a, b) => a - b);
const spanOf = (t: number): number => Math.floor(t / FLICKS);

describe('criterion 4: clamped auto tangents never overshoot, and one key changes only its neighbours\' spans', () => {
  it('criterion 4: at 10,000 random times the clamped auto-tangent channel stays between the values of the two keys of its span', () => {
    const a = evalOk(motion.bin(), { doc: BASE, times: TIMES }, 'the clamped auto channel');
    const failures: string[] = [];
    let moved = 0;
    for (const f of a.frames) {
      const k = spanOf(f.t);
      const lo = Math.min(VALUES[k]!, VALUES[k + 1]!); const hi = Math.max(VALUES[k]!, VALUES[k + 1]!);
      const v = chan(f, 'glide');
      if (v < lo || v > hi) failures.push(`at ${f.t} flicks (span k${k} → k${k + 1}, ${VALUES[k]} → ${VALUES[k + 1]}) it reads ${v}`);
      if (lo !== hi && v > lo + 1e-9 && v < hi - 1e-9) moved++;
    }
    none(failures, 'no span overshoots its end values');
    expect(moved, 'the channel moves between its keys (it isn\'t held)').toBeGreaterThan(TIMES.length / 2);
    // It passes through every key.
    const keys = evalOk(motion.bin(), { doc: BASE, times: VALUES.map((_, i) => fl(i)) }, 'the channel at its keys');
    keys.frames.forEach((f, i) => expect(chan(f, 'glide'), `at key k${i}`).toBe(VALUES[i]));
    // Not a straight line: the curve leaves the chord between keys that aren't extremes (a smooth curve, not linear).
    const mid = evalOk(motion.bin(), { doc: BASE, times: [fl(6.25)] }, 'the channel inside k6 → k7');
    expect(chan(mid.frames[0]!, 'glide'), 'the auto tangents are not linear interpolation').not.toBe(9 + (2 - 9) * 0.25);
  }, TIMEOUT);

  it(`criterion 4: changing key k${MOVED_KEY} changes the spans from k${MOVED_KEY - 2} to k${MOVED_KEY + 2} and leaves every other span bit for bit the same`, () => {
    const before = evalOk(motion.bin(), { doc: BASE, times: TIMES }, 'before the change');
    const after = evalOk(motion.bin(), { doc: MOVED, times: TIMES }, 'after the change');
    const failures: string[] = [];
    let changed = 0;
    TIMES.forEach((t, i) => {
      const k = spanOf(t);
      const near = k >= MOVED_KEY - 2 && k <= MOVED_KEY + 1;
      const b = chan(before.frames[i]!, 'glide'); const c = chan(after.frames[i]!, 'glide');
      if (!near && b !== c) failures.push(`span k${k} → k${k + 1}, outside k${MOVED_KEY}'s neighbours, changed at ${t} flicks: ${b} then ${c}`);
      if ((k === MOVED_KEY - 1 || k === MOVED_KEY) && b !== c) changed++;
    });
    none(failures, `only the neighbours' spans of k${MOVED_KEY} change`);
    expect(changed, `the spans k${MOVED_KEY - 1} → k${MOVED_KEY} and k${MOVED_KEY} → k${MOVED_KEY + 1} do change`).toBeGreaterThan(0);
  }, TIMEOUT);
});
