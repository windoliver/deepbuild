// Criterion 7: "A sweep across the declared range of drag, a value a test writer's entries on the core's input track
// carry, bounds a driver that reads table(drag, speed) from the table's interval form; a planted form that samples
// 8 points between knots misses the knot at the table's peak, understates the bound and fails the sweep fixture,
// naming the driver"
//
// Through `deep-motion eval`. `drag` is a slider control with the declared range [0, 40], its value carried by a test
// writer's input-track entries (the eval line's `input`); the driver `coef` reads `table(dpack.drag, speed)` with
// `speed` bound to `controls/drag/value`, over the pack table dpack.drag, whose peak knot 1.4 sits at 13, between
// every entry's value. The sweep fixture: the answer's `bounds.drivers.coef` (README: `bounds`), over the control's
// whole declared range, holds the table's least and greatest knot values in that range, 0.2 and 1.4, within 1e-9; and
// the driver under a hard range of [0, 1.3], which every entry's value respects, is refused naming the driver and
// the bound 1.4. The planted form (`planted: "table_form_samples_8"`) fails it, the failures naming `coef`.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, entry, evalAll, failsNaming, fl, film, mentions, none, numbersIn, rect, show, slider, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();

const DRAG = { x: [0, 10, 13, 20, 40], y: [0.2, 0.5, 1.4, 0.6, 0.3], mode: 'linear' };
const PACKS: JsonObject[] = [{ name: 'dpack', tables: { drag: DRAG } }];
/** The entries' values: 5, 9, 25 and 33, none at the peak's 13; the table reads at most 0.525 at any of them. */
const INPUT = [entry(0, 1, 'drag', 5), entry(fl(0.5), 2, 'drag', 9), entry(fl(1), 3, 'drag', 25), entry(fl(1.5), 4, 'drag', 33)];
const doc = (id: string, range?: [number, number]): JsonObject => film(id, [rect('kite')], {
  controls: { drag: slider('Drag', [0, 40], 5) },
  drivers: { coef: { target: 'items/kite/at/scale/0', expr: 'table(dpack.drag, speed)', vars: { speed: 'controls/drag/value' }, ...(range ? { range } : {}) } },
}, { span: '2s' });
const TIMES = [0, fl(0.5), fl(1), fl(1.5)];

/** The sweep fixture: the driver's bound over drag's declared range is the table's knots' [0.2, 1.4], and the hard range [0, 1.3] is refused. Failures name the driver. */
function sweepFailures(bounded: JsonObject, narrow: JsonObject): string[] {
  const failures: string[] = [];
  const b = (bounded['bounds'] as JsonObject | undefined)?.['drivers'] as JsonObject | undefined;
  const coef = b?.['coef'] as JsonObject | undefined;
  if (bounded['ok'] !== true || !coef) failures.push(`driver coef: no bound over drag's declared range: ${show(bounded)}`);
  else {
    const lo = coef['lo']; const hi = coef['hi'];
    if (typeof hi !== 'number' || hi < 1.4) failures.push(`driver coef: the bound's upper end ${String(hi)} misses the table's peak knot 1.4 at drag 13`);
    else if (hi - 1.4 > 1e-9) failures.push(`driver coef: the bound's upper end ${hi} isn't the peak knot 1.4 within 1e-9`);
    if (typeof lo !== 'number' || lo > 0.2) failures.push(`driver coef: the bound's lower end ${String(lo)} misses the table's least knot 0.2`);
    else if (0.2 - lo > 1e-9) failures.push(`driver coef: the bound's lower end ${lo} isn't the least knot 0.2 within 1e-9`);
  }
  if (narrow['ok'] !== false) failures.push(`driver coef: the hard range [0, 1.3] is accepted, though the table reaches 1.4 at drag 13: ${show(narrow)}`);
  else if (!mentions(narrow, 'coef') || !numbersIn(narrow).some((n) => Math.abs(n - 1.4) <= 1e-6)) failures.push(`driver coef: the refusal doesn't name the driver and the bound 1.4: ${show(narrow)}`);
  return failures;
}
const run = (planted?: string): [JsonObject, JsonObject] => evalAll(motion.bin(), [
  { doc: doc('drag-swept'), times: TIMES, input: INPUT, packs: PACKS, bounds: true, ...(planted ? { planted } : {}) },
  { doc: doc('drag-narrow', [0, 1.3]), times: TIMES, input: INPUT, packs: PACKS, ...(planted ? { planted } : {}) },
]) as [JsonObject, JsonObject];

describe('criterion 7: a sweep across a control\'s declared range bounds a driver that reads a table from its interval form', () => {
  it('criterion 7: the driver reading table(dpack.drag, speed) is bounded by the table\'s knots over drag\'s declared range, not by the entries\' values', () => {
    none(sweepFailures(...run()), 'the sweep fixture');
  }, TIMEOUT);

  it('criterion 7: a planted form that samples 8 points between knots misses the peak knot, understates the bound and fails the sweep fixture, naming the driver', () => {
    const [bounded, narrow] = run('table_form_samples_8');
    const failures = sweepFailures(bounded, narrow);
    failsNaming(failures, ['driver coef'], 'the sweep fixture on the planted form');
    expect(failures.some((f) => /misses the table's peak|is accepted/.test(f)), `the planted form understates the bound: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
