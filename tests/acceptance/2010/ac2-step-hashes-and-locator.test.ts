// #2010.fa073c97: a world run twice, run with its bodies created in reverse order, and replayed from a checkpoint gives
// identical step hashes, and the golden comparator, given a one-ulp change to one body's x velocity at step 300 in the
// second run, names step 300 and that body and field at the next checkpoint with an ulp distance of 1; a planted hash
// that rounds floats to 1e-6 misses it and fails.
//
// The world (helpers: pileAndFlyer) piles twelve boxes, so the bodies interact, and flies `ball` at 1.5 m/s with nothing
// acting on its x velocity, so a one-ulp change there stays one ulp. Twin: `--planted hash_rounds_1e6`, caught by the
// judge that passes the real comparator.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, FLYER_VX, OTHER, TIMEOUT, answered, arr, ask, bake, caught, f32Bits, goldenOf, isF32, isObject, none, num, obj, pileAndFlyer,
  prebuild, recordGolden, restore, reversedBodies, scratch, shift, show, stepHashes, verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const N = 360;
const EVERY = 60;
const AT = 300;

/**
 * The comparator's report on the shifted run names step 300 and, at the next checkpoint (the first at or after step
 * 300: Golden), the ball's x velocity, its recorded value and the shifted run's, one ulp apart.
 */
function locatorFailures(reply: JsonObject, recorded: number): string[] {
  if (reply['ok'] !== true) return [`golden_verify doesn't answer: ${show(reply)}`];
  const f: string[] = [];
  if (reply['verdict'] !== 'FAIL') f.push(`the verdict is ${show(reply['verdict'])}: the one-ulp change at step ${AT} isn't found`);
  const r = reply['report'];
  if (!isObject(r)) return [...f, `no report: ${show(reply)}`];
  if (r['first_step'] !== AT) f.push(`first_step is ${show(r['first_step'])}, not ${AT}`);
  if (r['checkpoint'] !== AT) f.push(`the checkpoint compared is ${show(r['checkpoint'])}, not ${AT} (the first at or after step ${AT}, every ${EVERY})`);
  const field = r['field'];
  if (!isObject(field)) return [...f, `the report names no field: ${show(r)}`];
  if (field['id'] !== 'ball') f.push(`the body named is ${show(field['id'])}, not ball`);
  if (field['field'] !== 'linear.x') f.push(`the field named is ${show(field['field'])}, not linear.x`);
  const values = field['values'];
  if (!Array.isArray(values) || values.length !== 2 || values.some((v) => typeof v !== 'number')) f.push(`values isn't [a, b]: ${show(values)}`);
  else {
    const [a, b] = values as [number, number];
    if (a !== recorded) f.push(`values[0] is ${a}, the recorded x velocity at step ${AT} is ${recorded}`);
    if (!isF32(a) || !isF32(b) || f32Bits(b) - f32Bits(a) !== 1) f.push(`values ${a} and ${b} aren't one f32 ulp apart, the second above`);
  }
  if (field['ulp_distance'] !== 1) f.push(`ulp_distance is ${show(field['ulp_distance'])}, not 1`);
  return f;
}

describe(`${ID} step hashes repeat and the golden comparator names the first step and field that differ`, () => {
  it(`${ID} run twice, run with its bodies written in reverse order, and replayed from each checkpoint, the world gives identical step hashes`, () => {
    const w = pileAndFlyer();
    const [first] = ask([bake(w, N, { checkpoints: true })], { where: 'first run' });
    const a = stepHashes(first!, N + 1, 'the first run');
    expect(new Set(a).size, 'the step hashes follow the state (not one value for every step)').toBeGreaterThan(N / 2);
    const [second, reversed] = ask([bake(w, N), bake(reversedBodies(w), N)], { where: 'second run' });
    expect(stepHashes(second!, N + 1, 'the second run'), 'run twice: identical step hashes').toEqual(a);
    expect(stepHashes(reversed!, N + 1, 'the reversed run'), 'its bodies in reverse order: identical step hashes').toEqual(a);
    const cps = arr(first!['checkpoints'], 'checkpoints').map((c, i) => obj(c, `checkpoints[${i}]`));
    const steps = cps.map((c) => num(c['step'], 'checkpoint step'));
    expect(steps, `a checkpoint every ${EVERY} steps`).toEqual([60, 120, 180, 240, 300, 360]);
    const replays = ask(cps.filter((c) => (c['step'] as number) < N).map((c) => restore(w, c, N - (c['step'] as number))), { where: 'replays' });
    const off: string[] = [];
    replays.forEach((r, i) => {
      const c = steps[i]!;
      const got = stepHashes(r, N - c + 1, `the replay from step ${c}`);
      const k = got.findIndex((h, j) => h !== a[c + j]);
      if (k >= 0) off.push(`replayed from step ${c}: step ${c + k} hashes ${got[k]}, the straight run ${a[c + k]}`);
    });
    none(off, 'replayed from each checkpoint, the step hashes equal the straight run\'s');
  }, TIMEOUT);

  it(`${ID} given a one-ulp change to the ball's x velocity at step ${AT} in the second run, the comparator names step ${AT}, the ball and linear.x at the next checkpoint with an ulp distance of 1; the twin hash_rounds_1e6 misses it`, () => {
    const w = pileAndFlyer();
    const store = scratch('ac2-store');
    const [straight, recorded] = ask([bake(w, N, { read: ['ball'] }), recordGolden(w, N, store, [OTHER])], { where: 'recording' });
    const golden = goldenOf(recorded!, 'golden');
    const ball = arr(obj(answered(straight, 'the straight bake')['bodies'], 'bodies')['ball'], 'bodies.ball');
    const vx = num(arr(obj(ball[AT], `ball at step ${AT}`)['linear'], 'linear')[0], `ball's x velocity at step ${AT}`);
    expect(vx, 'nothing acts on the ball\'s x velocity').toBe(FLYER_VX);
    const [clean, shifted] = ask([verifyGolden(golden, w, N, { store }), verifyGolden(golden, w, N, { store, shift: shift(AT, 'ball', 'linear.x') })], { where: 'second runs' });
    expect(answered(clean, 'the unchanged second run')['verdict'], `the unchanged second run matches the golden: ${show(clean)}`).toBe('PASS');
    none(locatorFailures(shifted!, vx), `the comparator locates the one-ulp change: ${show(shifted)}`);

    const twinStore = scratch('ac2-twin');
    const [twinRecorded] = ask([recordGolden(w, N, twinStore, [OTHER])], { planted: 'hash_rounds_1e6' });
    const [twinShifted] = ask([verifyGolden(goldenOf(twinRecorded!, 'the twin\'s golden'), w, N, { store: twinStore, shift: shift(AT, 'ball', 'linear.x') })], { planted: 'hash_rounds_1e6' });
    answered(twinShifted, 'the twin\'s second run');
    caught(locatorFailures(twinShifted!, vx), 'hash_rounds_1e6 (a step hash that rounds floats to 1e-6)');
  }, TIMEOUT);
});
