// #523.b6499735: a balanced flywheel on a hinge, started at 360 deg/s with no motor or damping, reads joint_coordinate
// 1,080° within 0.5° at 3 s and rises at every step; a crossing at level 90° fires once, within one step of 0.25 s, with
// direction +1, none fires with direction −1, and seeking to 2.5 s from a checkpoint equals playing by step hash.
//
// The flywheel fixture (README: The fixtures) is baked for 3 s with its output `spin` (the hinge's joint_coordinate,
// watching level 90°) sampled once a step. The seek is the base's own: the bake's checkpoints (every 70 steps), the one
// at or before step 300 (2.5 s; step 280) restored and stepped to step 300, its step hashes against the played bake's.
// Twins (README: Planted twins): `hinge_coordinate_wraps` reads the angle wrapped at ±180° with no turn count, and
// `checkpoint_drops_turns` keeps no turn count in a checkpoint; each must fail the judge it names.
import { describe, it } from 'vitest';
import {
  CRITERIA, FLICKS, LEVEL, STEP, TIMEOUT, arr, bakeSteps, baked, caught, flywheel, fmt, none, num, obj, physics, prebuild, readingsOf,
  restore, rowText, rowsOf, show, stepAt, stepFailures, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const STEPS = stepAt(3);
const SEEK = stepAt(2.5);
const fixture = (): JsonObject => flywheel(360, true);
const bake = (planted?: Planted): JsonObject => physics([bakeSteps(fixture(), STEPS, { checkpoints: true })], planted, 'the flywheel, 3 s')[0]!;

/** joint_coordinate reads 1,080° within 0.5° at 3 s and rises at every step. */
function coordinateFailures(reply: JsonObject): string[] {
  const s = readingsOf(reply, 'spin', STEPS + 1, 'the flywheel').map((x) => x.value);
  const f: string[] = [];
  if (!(Math.abs(s[STEPS]! - 1080) <= 0.5)) f.push(`joint_coordinate at 3 s (step ${STEPS}) reads ${fmt(s[STEPS]!)}°, not 1,080° within 0.5°`);
  f.push(...stepFailures(1, STEPS, (k) => s[k]! > s[k - 1]!, (k) => `step ${k} reads ${fmt(s[k]!)}° after ${fmt(s[k - 1]!)}°`).map((m) => `joint_coordinate doesn't rise at ${m}`));
  return f;
}

/** One crossing of level 90° with direction +1, at t within one step of 0.25 s; none with direction −1. */
function crossingFailures(reply: JsonObject): string[] {
  const rows = rowsOf(reply, 'the flywheel').filter((r) => r.kind === 'crossing' && r.raw['level'] === LEVEL);
  const up = rows.filter((r) => r.raw['direction'] === 1);
  const down = rows.filter((r) => r.raw['direction'] === -1);
  const all = rows.map(rowText).join('; ') || 'none';
  const f: string[] = [];
  if (up.length !== 1) f.push(`${up.length} crossings of level ${LEVEL}° with direction +1, not one (crossings at that level: ${all})`);
  if (down.length !== 0) f.push(`${down.length} crossings of level ${LEVEL}° with direction −1, not none (crossings at that level: ${all})`);
  const t = up[0]?.raw['t'];
  const want = 0.25 * FLICKS;
  if (up.length === 1 && !(typeof t === 'number' && Math.abs(t - want) <= STEP)) f.push(`the crossing's t is ${show(t)} flicks, not within one step (${STEP}) of 0.25 s (${want}): ${rowText(up[0]!)}`);
  return f;
}

/** Restored from the checkpoint at or before 2.5 s and stepped to it, each step's hash is the played bake's. */
function seekFailures(planted?: Planted): string[] {
  const played = baked(bake(planted), 'the flywheel played to 3 s');
  const hashes = arr(played['step_hashes'], 'the played flywheel: step_hashes');
  const at = arr(played['checkpoints'], 'the played flywheel: checkpoints (checkpoints: true)').map((c, i) => obj(c, `checkpoints[${i}]`))
    .filter((c) => num(c['step'], 'a checkpoint\'s step') <= SEEK).at(-1);
  if (!at) return [`the played bake holds no checkpoint at or before step ${SEEK}: ${show(played['checkpoints']).slice(0, 300)}`];
  const from = at['step'] as number;
  const [sought] = physics([restore(fixture(), at, SEEK - from, { read: [] })], planted, `the flywheel restored at step ${from}`);
  const seek = arr(baked(sought, `the flywheel restored at step ${from}`)['step_hashes'], 'the seek: step_hashes');
  const f: string[] = [];
  if (seek.length !== SEEK - from + 1) f.push(`the seek holds ${seek.length} step hashes for steps ${from} to ${SEEK}, not ${SEEK - from + 1}`);
  for (let k = from; k <= SEEK && k - from < seek.length; k++) {
    if (seek[k - from] !== hashes[k]) f.push(`step ${k}: the seek from the checkpoint at step ${from} hashes ${show(seek[k - from])}, playing hashes ${show(hashes[k])}`);
  }
  if (seek.at(-1) !== hashes[SEEK]) f.push(`at 2.5 s (step ${SEEK}) the seek's hash ${show(seek.at(-1))} isn't playing's ${show(hashes[SEEK])}`);
  return f;
}

describe(`${ID} a flywheel's hinge counts whole turns: its coordinate, its crossings and a seek`, () => {
  it(`${ID} (coordinate) the flywheel started at 360 deg/s reads joint_coordinate 1,080° within 0.5° at 3 s and rises at every step`, () => {
    none(coordinateFailures(bake()), 'the flywheel\'s joint_coordinate counts whole turns');
  }, TIMEOUT);

  it(`${ID} (crossing) a crossing at level 90° fires once, within one step of 0.25 s, with direction +1, and none fires with direction −1`, () => {
    none(crossingFailures(bake()), 'the flywheel crosses 90° once, going up');
  }, TIMEOUT);

  it(`${ID} (seek) seeking to 2.5 s from a checkpoint equals playing by step hash`, () => {
    none(seekFailures(), 'the seek to 2.5 s from a checkpoint equals playing');
  }, TIMEOUT);

  it(`${ID} (twin: hinge_coordinate_wraps) a planted hinge whose joint_coordinate wraps at ±180° with no turn count fails the coordinate and the crossing`, () => {
    const reply = bake('hinge_coordinate_wraps');
    caught(coordinateFailures(reply), 'hinge_coordinate_wraps, judged on joint_coordinate');
    caught(crossingFailures(reply), 'hinge_coordinate_wraps, judged on its crossings');
  }, TIMEOUT);

  it(`${ID} (twin: checkpoint_drops_turns) a planted checkpoint that keeps no turn count makes the seek differ from playing by step hash`, () => {
    caught(seekFailures('checkpoint_drops_turns'), 'checkpoint_drops_turns, judged on the seek');
  }, TIMEOUT);
});
