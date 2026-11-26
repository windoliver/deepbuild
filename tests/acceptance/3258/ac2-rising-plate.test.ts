// #3258.96b5e231: "On that build, the same rope with every particle pinned, and a kinematic plate 5 mm thick that rises
// through it at 0.1 m/s, so each particle is inside it for six steps and never 1 cm deep: the audit fails, naming a
// particle that never moved. A planted reading that takes the particle's path in the world reads nothing, and one that
// reads a single step reads nothing, and each fails. The plate risen 3 mm into the rope and lowered again reads 0, where a
// planted reading that counts every particle that was inside a shape fails"
//
// The plate rises 5/6 mm a step on a channel of its scene. Its top starts 12.5 of those steps below the rope, so at the
// end of steps 13 to 18 every particle is inside it, 0.42 to 4.58 mm under its top, and at the end of step 19 every one is
// 0.42 mm below its underside: in through the top in step 13, out of the far side in step 19. The plate that turns back
// tops out 3 mm over the rope at step 15: every particle is inside it at the end of steps 12 to 18 and comes out of the
// top it went in by. Both motions are first read back from the same build's bake.
import { describe, expect, it } from 'vitest';
import {
  AC, PLATE, RISEN_STEP, ROPE, ROPE_ADDRESSES, ROPE_Y, THICK, TIMEOUT, audit, bakes, cleanBuilds, failFailures, full, none, num, obj, arr, particleOf,
  pathsOf, readOf, risingPlate, show, swapped, told, turnedPlate, useFailures, zeroFailures, type JsonObject, type Read,
} from './helpers.ts';

cleanBuilds();
const ID = AC[2];
const STEPS = 30;
const RISING = 'the plate that rises through the pinned rope';
const TURNED = 'the plate that turns back';

/** How far under the plate's top the rope is after each step of a bake, m: inside the plate from 0 to its thickness. */
function depths(baked: JsonObject | undefined, what: string): number[] {
  const path = pathsOf(baked, ROPE, STEPS, what);
  const moved = path.flat().filter((p) => p[1] !== path[0]![0]![1]).length;
  expect(moved, `${what}: every particle stays at the one height it was pinned at`).toBe(0);
  const states = arr(obj(baked!['bodies'], `${what}: bodies`)[PLATE], `${what}: bodies.${PLATE}`);
  return states.map((s, k) => num(arr(obj(s, `${what}: state ${k}`)['pos'], `${what}: state ${k}.pos`)[1], `${what}: the plate's height after step ${k}`) + THICK / 2 - ROPE_Y);
}
/** The steps at whose end the rope is inside the plate. */
const insideAt = (d: readonly number[]): number[] => d.flatMap((x, k) => (x >= 0 && x <= THICK ? [k] : []));
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Everything wrong with "the audit fails, naming a particle that never moved", at the step it came out of the plate's far side. */
function risingFailures(r: Read): string[] {
  const out = failFailures(r, STEPS, RISING);
  const first = r.rows.find((f) => particleOf(f) !== null);
  if (!first) return [...out, `${RISING}: no failure names a particle: ${told(r)}`];
  if (!full(ROPE, ROPE_ADDRESSES).includes(particleOf(first)!)) out.push(`${RISING}: the particle named is ${show(particleOf(first))}, not one of the rope's`);
  if (first['step'] !== RISEN_STEP) out.push(`${RISING}: the particle is named at step ${show(first['step'])}, not ${RISEN_STEP}, when it comes out of the far side`);
  return [...out, ...useFailures(first, PLATE, RISING)];
}

describe(`${ID} a plate that passes a rope that never moves fails the audit, and one that turns back doesn't`, () => {
  it(`${ID} a kinematic plate 5 mm thick rising through the pinned rope at 0.1 m/s fails soft.through, naming a particle that never moved`, () => {
    const w = risingPlate();
    const [baked, reply] = swapped([bakes(w, STEPS), audit(w, STEPS)]);
    const d = depths(baked, RISING);
    expect([insideAt(d), Math.max(...insideAt(d).map((k) => d[k]!)) < 0.01, d[RISEN_STEP]! > THICK], 'the fixture: every particle is inside the plate at the end of six steps, 13 to 18, never 1 cm deep, and past its underside from step 19').toEqual([range(13, 18), true, true]);
    const r = readOf(reply, RISING);
    console.log(`${RISING}: ${told(r)}`);
    none(risingFailures(r), 'the audit of the rising plate');
  }, 2 * TIMEOUT);

  it(`${ID} the plate risen 3 mm into the rope and lowered again reads 0`, () => {
    const w = turnedPlate();
    const [baked, reply] = swapped([bakes(w, STEPS), audit(w, STEPS)]);
    const d = depths(baked, TURNED);
    expect([insideAt(d), Math.abs(Math.max(...d) - 0.003) < 1e-5, d[STEPS]! < 0], 'the fixture: every particle is inside the plate from step 12 to step 18, 3 mm at the most, and above its top at the end').toEqual([range(12, 18), true, true]);
    const r = readOf(reply, TURNED);
    console.log(`${TURNED}: ${told(r)}`);
    none(zeroFailures(r, TURNED), 'the audit of the plate that turns back');
  }, 2 * TIMEOUT);

  for (const [planted, wrong] of [['through_in_world_frame', 'takes the particle\'s path in the world'], ['through_reads_one_step', 'reads a single step']] as const) {
    it(`${ID} a planted reading that ${wrong} reads nothing for the rising plate, and fails`, () => {
      const [reply] = swapped([audit(risingPlate(), STEPS)], planted);
      const r = readOf(reply, `${RISING}, planted ${planted}`);
      console.log(`planted ${planted}: ${told(r)}`);
      expect([r.through, r.rows], 'the planted reading reads nothing').toEqual([0, []]);
      const found = risingFailures(r);
      expect(found.some((f) => f.includes('no failure')), `the judge that passes the real reading fails on the planted one, which names nothing: ${found.join('; ')}`).toBe(true);
    }, 2 * TIMEOUT);
  }

  it(`${ID} a planted reading that counts every particle that was inside a shape fails on the plate that turns back`, () => {
    const [reply] = swapped([audit(turnedPlate(), STEPS)], 'through_counts_inside');
    const r = readOf(reply, `${TURNED}, planted through_counts_inside`);
    console.log(`planted through_counts_inside: ${told(r)}`);
    const found = zeroFailures(r, TURNED);
    expect(found.some((f) => f.includes('not 0')), `the judge that passes the real reading fails on the planted one, for a reading above 0: ${found.join('; ')}`).toBe(true);
  }, 2 * TIMEOUT);
});
