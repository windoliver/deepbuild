// Criterion 14: a `place` at step 600 of the body walking up the 30° ramp leaves it at the placed pose within 1e-6 m
// with vertical speed 0 and writes contact_end naming the ramp, sorted with the rest; one at a step where it falls at
// 5 m/s also leaves its vertical speed 0, and a planted place that keeps it fails, naming the step and that field; and
// a seek from the checkpoint before step 600 to step 700 gives the same step hashes as a straight run.
//
// The ramp rises 10 m at 30° from 1 m before the body, so at step 600 it is still walking up it. The place is stamped
// 600 and applies in the step that ends in state 601, which holds it at the pose and writes the row (#522's step
// convention). The fall drops the body from 20 m; its place is stamped at the state whose speed is nearest 5 m/s down.
// The seek is #522's `seek` to 599, which restores the checkpoint at 540, then plays on to 700. The wrong program is
// `--planted place_keeps_vertical`.
import { describe, expect, test } from 'vitest';
import {
  AC, HERO, TIMEOUT, bake, between, caught, characterStates, characterWorld, entry, flatWorld, hashesOf, heroBody, named,
  none, num, physics, prebuild, ramp, rowsOf, run, show, slab, standing, statesOf, unsorted, useTemp, walk,
  type JsonObject, type Runner, type Vec3,
} from './helpers.ts';

prebuild(['shipped']);
const temp = useTemp();
const AT = 600;
const PLACED: Vec3 = [-2, 3, 0.5];
const STEPS = 720;

const rampWorld = (): JsonObject => characterWorld({
  statics: { floor: slab(-6, 1, -1, 0), ramp: ramp(1, 0, 1 + run(10, 30), 10), top: slab(1 + run(10, 30), 30, -1, 10) },
  movers: { [HERO]: heroBody([0, standing(0), 0], { slope: 45, step: 0.35 }) },
});
const rampTrack = (): JsonObject[] => [walk(0, [2, 0, 0]), entry(AT, 'place', { pose: { pos: PLACED } })];
const fallWorld = (): JsonObject => flatWorld({ movers: { [HERO]: heroBody([0, standing(20), 0]) } });

/** The fall placed at `at` (back where it started), and what's wrong with the state after the place's step. */
function fallFailures(at: number, r: Runner): string[] {
  const [reply] = physics([bake(fallWorld(), at + 10, { track: [entry(at, 'place', { pose: { pos: [0, standing(20), 0] } })], read: [HERO] })], r);
  const c = characterStates(statesOf(reply!, HERO, 'the placed fall'), 'the placed fall')[at + 1]!;
  return c.vertical === 0 ? [] : [`the place stamped ${at}: after its step, step ${at + 1}, the field vertical is ${c.vertical} m/s, not 0`];
}
/** The state nearest falling at 5 m/s, from a fall with no place. */
function fiveMetres(): number {
  const [reply] = physics([bake(fallWorld(), 100, { read: [HERO] })]);
  const chars = characterStates(statesOf(reply!, HERO, 'the fall'), 'the fall');
  let best = 1;
  chars.forEach((c, k) => { if (k >= 1 && Math.abs(c.vertical + 5) < Math.abs(chars[best]!.vertical + 5)) best = k; });
  expect(Math.abs(chars[best]!.vertical + 5), `the fall reaches 5 m/s down (at step ${best}: ${chars[best]!.vertical} m/s)`).toBeLessThan(0.1);
  return best;
}

describe(`${AC[14]} a place moves the body to its pose, stops its vertical speed and ends its contacts`, () => {
  test(`${AC[14]} a place at step 600 on the 30° ramp leaves it at the pose within 1e-6 m, vertical 0, with contact_end naming the ramp in the sorted list; a seek from the checkpoint before 600 to 700 matches the straight run`, () => {
    const store = temp();
    const [reply] = physics([bake(rampWorld(), STEPS, { track: rampTrack(), store, checkpoints: true, read: [HERO] })]);
    const states = statesOf(reply!, HERO, 'the ramp walk');
    const chars = characterStates(states, 'the ramp walk');
    const out: string[] = [];
    const before = states[AT]!;
    if (!(before.pos[0] > 1.3 && before.pos[1] - 0.9 > 0.5 && chars[AT]!.grounded)) out.push(`at step ${AT} the body isn't walking up the ramp: ${show(before.pos)}, grounded ${chars[AT]!.grounded}`);
    const after = states[AT + 1]!;
    const off = Math.max(...after.pos.map((x, i) => Math.abs(x - PLACED[i]!)));
    if (off > 1e-6) out.push(`after the place's step the body is at ${show(after.pos)}, ${off} m from the placed ${show(PLACED)}`);
    if (chars[AT + 1]!.vertical !== 0) out.push(`after the place's step its vertical speed is ${chars[AT + 1]!.vertical}, not 0`);
    const rows = rowsOf(reply!, 'the ramp walk');
    if (!between(rows, 'contact_end', HERO, 'ramp').some((r) => r.step === AT + 1)) out.push(`no contact_end naming ${HERO} and the ramp at step ${AT + 1}; rows there: ${show(rows.filter((r) => r.step === AT + 1).map((r) => r.raw))}`);
    out.push(...unsorted(rows));
    const [seek] = physics([{ call: 'seek', world: rampWorld(), track: rampTrack(), steps: STEPS, store, to: AT - 1, play: 700 - (AT - 1), read: [HERO] }]);
    expect(seek!['ok'], `the seek answers: ${show(seek)}`).toBe(true);
    const from = num(seek!['from'], 'the seek\'s checkpoint');
    if (!(from < AT && from % 60 === 0)) out.push(`the seek restored ${from}, not the checkpoint before step ${AT}`);
    const want = hashesOf(reply!, 'the ramp walk').slice(from, 701);
    const got = hashesOf(seek!, 'the seek');
    const k = want.findIndex((h, i) => h !== got[i]);
    if (got.length !== want.length || k >= 0) out.push(`the seek from ${from} to 700 first differs from the straight run at step ${from + k}`);
    none(out, 'rapier3d');
  }, TIMEOUT);

  test(`${AC[14]} a place while falling at 5 m/s leaves its vertical speed 0; a place that keeps it (--planted place_keeps_vertical) fails, naming the step and that field`, () => {
    const at = fiveMetres();
    none(fallFailures(at, {}), 'rapier3d');
    const failures = fallFailures(at, { planted: 'place_keeps_vertical' });
    caught(failures, 'the place that keeps the vertical speed');
    named(failures, [`step ${at + 1}`, 'vertical'], 'its failure');
  }, TIMEOUT);
});
