// AC9 #492.181f2b27: A nod clip placed with blend: add over a walk clip on the same item gives the rotation walk(t) ·
// nod_ref⁻¹ · nod(τ) within 1e-6 at 200 sampled times, equals the walk bit for bit at every time the nod sits at its first
// key, and with influence 0.5 turns the head by half the nod's angle within 0.01°.
//
// Through `deep-motion eval`. The head is an item whose `params.quat` the clips key, as [x, y, z, w] (README: Choices, the
// bone). The walk swings about Y; the nod starts at 5° about X, stays there for its first 0.5 s, rises to 35° and comes
// back, so its first key isn't the identity and a program that skips nod_ref⁻¹ fails. Placed at 0.5 s: τ = t − 0.5 s. Keys
// slerp along the shorter arc, computed here. No upstream test (oracle page).
import { describe, it } from 'vitest';
import {
  AC, IDENTITY, TIMEOUT, accepted, angleDeg, bone, clipOf, conj, evalAll, evalOk, film, fl, mulQ, none, place, quatDistance, quatKeysAt, quatOf, quatOr, secs, seededTimes, useMotion,
  type JsonObject, type KeyList, type Quat,
} from './helpers.ts';

const motion = useMotion();

const asKeys = (list: [number, Quat][]): KeyList => list.map(([t, q]) => [t, q]);
const WALK: [number, Quat][] = [[0, quatOf([0, 1, 0], -20)], [1, quatOf([0, 1, 0], 20)], [2, quatOf([0, 1, 0], -20)]];
const NOD: [number, Quat][] = [[0, quatOf([1, 0, 0], 5)], [0.5, quatOf([1, 0, 0], 5)], [1, quatOf([1, 0, 0], 35)], [1.5, quatOf([1, 0, 0], 5)]];
const NOD_REF = NOD[0]![1];
const START = 0.5;
const clips = { walk: clipOf('turn', 'params/quat', asKeys(WALK), 'quat'), nod: clipOf('turn', 'params/quat', asKeys(NOD), 'quat'), still: clipOf('turn', 'params/quat', [[0, IDENTITY], [2, IDENTITY]], 'quat') };
const doc = (id: string, under: string, nod: JsonObject | null): JsonObject => film(id, [bone('head', IDENTITY)], {
  clips, placements: { under: place(under, 'head', { start: '0s', order: 'a0' }), ...(nod ? { nod: place('nod', 'head', { start: `${START}s`, blend: 'add', order: 'a1', ...nod }) } : {}) },
}, { span: '2s' });

describe(`${AC[9]} an add placement rides on what is under it`, () => {
  it(`${AC[9]} over a walk it gives walk(t) · nod_ref⁻¹ · nod(τ) within 1e-6 at 200 sampled times`, () => {
    const times = seededTimes(492_90, 200, fl(START), fl(START + 1.5));
    const a = evalOk(motion.bin(), { doc: doc('nod-on-walk', 'walk', {}), times }, 'the nod on the walk');
    const failures = a.frames.flatMap((f) => {
      const s = secs(f.t);
      const want = mulQ(mulQ(quatKeysAt(WALK, s), conj(NOD_REF)), quatKeysAt(NOD, s - START)); const got = quatOr(f, 'head');
      const d = quatDistance(got, want);
      return d <= 1e-6 ? [] : [`at ${f.t} flicks the head reads ${JSON.stringify(got)}, ${d} from ${JSON.stringify(want)}`];
    });
    none(failures, 'the add placement against its closed form');
  }, TIMEOUT);

  it(`${AC[9]} it equals the walk bit for bit at every time the nod sits at its first key`, () => {
    const times = seededTimes(492_91, 60, fl(START), fl(START + 0.5));
    const [nodded, walked] = evalAll(motion.bin(), [{ doc: doc('nod-held', 'walk', {}), times }, { doc: doc('walk-alone', 'walk', null), times }]);
    const a = accepted(nodded!, times, 'the nod at its first key'); const b = accepted(walked!, times, 'the walk alone');
    const failures = a.frames.flatMap((f, i) => {
      const got = JSON.stringify(quatOr(f, 'head')); const want = JSON.stringify(quatOr(b.frames[i]!, 'head'));
      return got === want && got !== 'null' && !got.includes('null') ? [] : [`at ${f.t} flicks the head reads ${got}, the walk ${want}`];
    });
    none(failures, 'a clip at its reference changes nothing');
  }, TIMEOUT);

  it(`${AC[9]} with influence 0.5 it turns the head by half the nod's angle within 0.01°`, () => {
    const taus = [0.6, 0.75, 0.9, 1.0, 1.1, 1.3];
    const times = taus.map((tau) => fl(START + tau));
    const a = evalOk(motion.bin(), { doc: doc('half-nod', 'still', { influence: 0.5 }), times }, 'the nod at influence 0.5');
    const failures = a.frames.flatMap((f, i) => {
      const nod = angleDeg(NOD_REF, quatKeysAt(NOD, taus[i]!)); const got = angleDeg(IDENTITY, quatOr(f, 'head'));
      return Math.abs(got - nod / 2) <= 0.01 ? [] : [`at τ = ${taus[i]} s the head turned ${got}°, not half of ${nod}°`];
    });
    none(failures, 'half the nod\'s angle');
  }, TIMEOUT);
});
