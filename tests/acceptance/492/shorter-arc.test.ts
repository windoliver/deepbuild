// AC12 #492.0458de19: A replace placement fading in over a base whose rotation is the negation of the clip's quaternion turns
// the bone by no more than the angle between them at every sampled time and, at influence 0.5, lands within 0.01° of the
// shorter-arc midpoint; quat channel keys q and −q produce no motion; a planted per-component blend or a long-arc slerp
// fails, naming the bone and the time.
//
// Through `deep-motion eval`. The bone is an item whose `params.quat` is keyed (README: Choices, the bone). q and −q are one
// rotation, so with the base exactly −q the angle between them is 0 and the bound says the bone doesn't move. A second
// fixture sets the base to the negation of a rotation 60° from the clip's, where the bound and the midpoint have room to
// fail: the wrong sign blends the long way, 300° round. The fade's shape isn't stated, so only its bound and its ends are
// read; the midpoint reads `influence: 0.5`, which pins its weight. Plants (README: Planted programs) go through the same
// check, whose failures name the bone and the time. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, angleDeg, bone, channel, clipOf, evalOk, evalPlanted, failsNaming, film, fl, neg, none, place, quatOf, quatOr, seededTimes, slerp, useMotion,
  type Accepted, type EvalLine, type JsonObject, type Quat,
} from './helpers.ts';

const motion = useMotion();

const CLIP_Q = quatOf([0, 1, 0], 100);
const NEAR = quatOf([0, 1, 0], 40);
const THETA = 60;
const clip = { hold: clipOf('turn', 'params/quat', [[0, CLIP_Q], [4, CLIP_Q]], 'quat') };
const fading = (id: string, base: Quat): JsonObject => film(id, [bone('arm', base)], { clips: clip, placements: { p: place('hold', 'arm', { start: '0.5s', fade_in: '2s' }) } }, { span: '4s' });
const HALF = film('half-influence', [bone('arm', neg(NEAR))], { clips: clip, placements: { p: place('hold', 'arm', { start: '0s', influence: 0.5 }) } }, { span: '4s' });
const KEYS = film('negated-keys', [bone('arm', quatOf([0, 0, 1], 15))], { channels: { q: channel('items/arm/params/quat', [[0, CLIP_Q], [2, neg(CLIP_Q)], [4, CLIP_Q]], 'quat') } }, { span: '4s' });
const EXACT = fading('exact-negation', neg(CLIP_Q));
const CLOSE = fading('near-negation', neg(NEAR));

const FADE_TIMES = [...seededTimes(492_12, 60, fl(0.5), fl(2.5)), fl(1.5)].sort((a, b) => a - b);
const END_TIMES = [fl(2.6), fl(3.5)];
const HALF_TIMES = [fl(1), fl(2), fl(3)];
const KEY_TIMES = [...seededTimes(492_121, 40, 0, fl(4)), fl(1)].sort((a, b) => a - b);
const LINES: { name: string; line: EvalLine }[] = [
  { name: 'exact', line: { doc: EXACT, times: FADE_TIMES } },
  { name: 'near', line: { doc: CLOSE, times: [...FADE_TIMES, ...END_TIMES] } },
  { name: 'half', line: { doc: HALF, times: HALF_TIMES } },
  { name: 'keys', line: { doc: KEYS, times: KEY_TIMES } },
];
const eps = 1e-6;

/** The check, on any program's four answers. Failures name the bone and the time. */
function arcFailures(a: Record<string, Accepted>): string[] {
  const failures: string[] = [];
  const say = (t: number, text: string): void => { failures.push(`bone arm at ${t} flicks: ${text}`); };
  for (const f of a['exact']!.frames) {
    const moved = angleDeg(quatOr(f, 'arm'), CLIP_Q);
    if (!(moved <= eps)) say(f.t, `over its own negation it turned ${moved}°, no more than 0°`);
  }
  for (const f of a['near']!.frames) {
    const q = quatOr(f, 'arm'); const moved = angleDeg(q, NEAR);
    if (!(moved <= THETA + eps)) say(f.t, `it turned ${moved}°, past the ${THETA}° between base and clip`);
    if (f.t >= fl(2.5) && !(angleDeg(q, CLIP_Q) <= eps)) say(f.t, 'the fade has ended but it isn\'t at the clip');
  }
  const mid = slerp(NEAR, CLIP_Q, 0.5);
  for (const f of a['half']!.frames) {
    const off = angleDeg(quatOr(f, 'arm'), mid);
    if (!(off <= 0.01)) say(f.t, `at influence 0.5 it is ${off}° from the shorter-arc midpoint`);
  }
  for (const f of a['keys']!.frames) {
    const moved = angleDeg(quatOr(f, 'arm'), CLIP_Q);
    if (!(moved <= eps)) say(f.t, `keys q and −q moved it ${moved}°`);
  }
  return failures;
}

describe(`${AC[12]} rotations blend the shorter way`, () => {
  it(`${AC[12]} a fade over a negated base stays inside the angle between them, influence 0.5 lands on the shorter-arc midpoint, and keys q and −q make no motion`, () => {
    const a = Object.fromEntries(LINES.map(({ name, line }) => [name, evalOk(motion.bin(), line, name)]));
    none(arcFailures(a), 'the shorter arc');
    const mid = a['near']!.frames[FADE_TIMES.indexOf(fl(1.5))]!;
    expect(angleDeg(quatOr(mid, 'arm'), NEAR), 'the fade moves the bone: it is under way at 1.5 s').toBeGreaterThan(1);
  }, TIMEOUT);

  for (const planted of ['blend_per_component', 'slerp_long_arc']) {
    it(`${AC[12]} the planted ${planted} fails, naming the bone and the time`, () => {
      const a = Object.fromEntries(LINES.map(({ name, line }) => [name, evalPlanted(motion.bin(), { ...line, planted }, name)]));
      failsNaming(arcFailures(a), ['bone arm', `at ${fl(1)} flicks`], planted);
    }, TIMEOUT);
  }
});
