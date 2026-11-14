// AC10 #224.01150621: "In the box [−2, 2] m on each axis at tolerance 0.05 m, a `zero` of 0.125 less two falloff terms
// max(0, 1 − |p − c|²)³, each of radius 1 m and weight 1, meshes as one closed shell with V − E + F = 2 while their
// centers are 1.4 m apart, and as two such shells at 1.7 m, since in closed form they join at 2 × √(1 − 0.0625^(1/3)) =
// 1.553 m; with the centers keyed from 1.7 m apart at t = 0 to 1.4 m at t = 1 s, a seek to 1 s gives the same vertex
// hash as playing to it, and a planted build that keeps its t = 0 mesh shows two shells at 1 s and fails"
//
// `blobs`, an implicit `surface@1` in [−2, 2]³ at tolerance 0.05 m, one-sided (README: Readings), its centers at
// (±d ÷ 2, 0, 0): zero = 0.125 − max(0, 1 − ((x − h)² + y² + z²))³ − max(0, 1 − ((x + h)² + y² + z²))³, h = d ÷ 2.
//   - Still: with h written as 0.7 (1.4 m apart), one closed shell with V − E + F = 2; with 0.85 (1.7 m), two closed
//     shells, each with V − E + F = 2.
//   - Keyed: h a var bound to `data/half` (`vars: {h: "data/half"}`, as 2D path@1's fn reads data), whose channel runs
//     linearly from 0.85 at 0 s to 0.7 at 1 s; the document in the export class, whose frame CPU has no cap, so the
//     re-mesh in each evaluated frame isn't refused (README: Readings). The judge at 1 s: `geometry` at 1 s (the seek)
//     and with `play: {fps: 10}` (every frame from 0 played in order: the play) each one closed shell with
//     V − E + F = 2, with one vertex hash (README: The vertex hash); at 0 s two shells, so the key is live.
//   - Under `zero_keeps_first_mesh` (the planted build: the t = 0 mesh kept as h moves), played to 1 s it shows two
//     shells, and the judge fails, naming them.
// Fails: wrong topology at either separation; a build kept from an earlier frame; seek and play apart.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, TIMEOUT, admitted, ask, failsNaming, geometry, meshOf, none, present, sceneDoc, shellFailures, shells, useBins, vertexHash,
  zeroSurface, type JsonObject, type Run,
} from './helpers.ts';

useBins();
const ID = AC[10];
const zero = (h: string): string => `0.125 - max(0, 1 - ((x - ${h})^2 + y^2 + z^2))^3 - max(0, 1 - ((x + ${h})^2 + y^2 + z^2))^3`;
const keyedDoc = (): JsonObject => sceneDoc('Two blobs merging', { blobs: zeroSurface(zero('h'), 2, 0.05, { vars: { h: 'data/half' } }) }, {
  budget: { class: 'export' }, transport: { span: '1s' },
  data: { half: { value: 0.85, source: 'story' } },
  channels: { half: { target: 'data/half', type: 'f32', keys: { k0: { t: '0s', value: 0.85, interp: 'linear' }, k1: { t: '1s', value: 0.7, interp: 'linear' } } } },
});

/** The keyed blobs at 1 s, sought and played, with the judge's failures. */
function keyedAtOne(o: Run = {}): { failures: string[]; playedShells: number } {
  const r = ask([
    present(DOC(1), keyedDoc()), geometry(DOC(1), ['blobs'], 0), geometry(DOC(1), ['blobs'], FLICKS), geometry(DOC(1), ['blobs'], FLICKS, { play: { fps: 10 } }),
  ], o);
  if (!o.planted) admitted(r[0], 'the keyed blobs');
  const [start, seek, play] = [meshOf(r[1], 'blobs', 'the blobs at 0 s'), meshOf(r[2], 'blobs', 'the seek to 1 s'), meshOf(r[3], 'blobs', 'playing to 1 s')];
  const failures = [
    ...shellFailures(start, 2, 2, 'at 0 s, 1.7 m apart'),
    ...shellFailures(seek, 1, 2, 'the seek to 1 s'),
    ...shellFailures(play, 1, 2, 'played to 1 s'),
  ];
  if (vertexHash(seek) !== vertexHash(play)) failures.push(`at 1 s the seek gives vertex hash ${vertexHash(seek)}, playing to it ${vertexHash(play)}`);
  return { failures, playedShells: shells(play).length };
}

describe(`${ID} two blobs that merge as their centers move`, () => {
  it(`${ID} one closed shell with V − E + F = 2 at 1.4 m apart, and two such shells at 1.7 m`, () => {
    const [shownReply, geo] = ask([
      present(DOC(1), sceneDoc('Two blobs at 1.4 m and at 1.7 m', { near: zeroSurface(zero('0.7'), 2, 0.05), far: zeroSurface(zero('0.85'), 2, 0.05) })),
      geometry(DOC(1), ['near', 'far']),
    ]);
    admitted(shownReply, 'the still blobs');
    none(shellFailures(meshOf(geo, 'near', 'the blobs 1.4 m apart'), 1, 2, '1.4 m apart'), 'the blobs 1.4 m apart are one closed shell with V − E + F = 2');
    none(shellFailures(meshOf(geo, 'far', 'the blobs 1.7 m apart'), 2, 2, '1.7 m apart'), 'the blobs 1.7 m apart are two closed shells, each with V − E + F = 2');
  }, TIMEOUT);

  it(`${ID} keyed from 1.7 m at 0 s to 1.4 m at 1 s, a seek to 1 s gives the same vertex hash as playing to it, and a planted build that keeps its t = 0 mesh (planted zero_keeps_first_mesh) shows two shells at 1 s and fails`, () => {
    none(keyedAtOne().failures, 'the keyed blobs at 1 s, sought and played');
    const planted = keyedAtOne({ planted: 'zero_keeps_first_mesh' });
    expect(planted.playedShells, 'the planted build played to 1 s shows two shells').toBe(2);
    failsNaming(planted.failures, ['played to 1 s: 2 shells'], 'zero_keeps_first_mesh');
  }, TIMEOUT);
});
