// #2760.1524f8e9: "A list none of whose kinds carries a point is refused at check, naming the list, and an occurrence 1 m
// off the plate's edge starts no ring"
//
// Clause 1 (helpers.ts `pondDoc`, 480 × 270): the still pond, and the logic item `drips` (60 Hz), which declares one
// kind, `drip {size: f64}`, with no field named `point` (Spawn: a logic occurrence's point is its field named
// `point`), and emits a drip at 1 s and at 1.5 s. The pond's material carries `rings: {on: {list:
// "drips.occurrences"}}`. `view3d` answers with the document check's refusal, `{code: "refused", issues}`, and an error
// issue names the list `drips.occurrences`. Not vacuous: the same pond, item and list with the kind declared as `drip
// {size: f64, point: vec3}` is drawn, so it is the missing point that is refused.
// Clause 2: the logic item `stones` emits two `stone {point: vec3}` rows at 1 s: one at the plate's centre and one at
// (4, 0, −0.5), 1 m beyond the plate's +x edge at x = 3. At 2.25 s (frame 45 at 20 fps), when a ring of each would be
// alive, the frame's `rings` rows list one ring, the first stone's, at the centre with radius speed × age, and none for
// the second. Not vacuous: the listed ring is drawn (the pond with `rings: "none"` has another frame 45). Wrong
// programs: a ring started off the plate or clamped onto its edge, a list with no point read as rings at the origin, a
// check that names no list.
import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, POND_SIZE, STILL, type Emitter, alive, answered, emitter, frameAt, framesOf, hashAt, logicItem, look3d, none, pondDoc, putAsset, refusedIssues,
  requireGpu, ringFailures, ringsOf, runGpu, shown, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('point-2760');
const FPS = 20;
const AT = 45; // 2.25 s
const T = AT / FPS;
const DRIPS = 'drips.occurrences';
const STONES = 'stones.occurrences';
/** Two drips, at steps 60 and 90; with `pointed`, each also carries a point at the plate's centre. */
const drips = (pointed: boolean): Emitter => emitter(pointed ? 'drips-pointed' : 'drips', [{ kind: 'drip', fields: pointed ? [['size', 'f64'], ['point', 'vec3']] : [['size', 'f64']] }],
  [60, 90].map((step, i) => ({ step, kind: 'drip', a: i + 1, fields: { size: 0.01 * (i + 1), ...(pointed ? { point: CENTRE } : {}) } })));
/** Two stones at step 60: one at the plate's centre, one 1 m beyond its +x edge. */
const stones = (): Emitter => emitter('stones', [{ kind: 'stone', fields: [['point', 'vec3']] }], [
  { step: 60, kind: 'stone', a: 1, fields: { point: CENTRE } },
  { step: 60, kind: 'stone', a: 2, fields: { point: [CENTRE[0] + POND_SIZE[0] / 2 + 1, 0, CENTRE[2]] } },
]);

describe(`${AC[6]} a ring starts at an occurrence's point on the plate`, () => {
  it(`${AC[6]} a list none of whose kinds carries a point is refused at check, naming the list`, () => {
    requireGpu();
    const dir = out();
    const bare = drips(false); const pointed = drips(true);
    const assets = { ...putAsset(dir, bare.program), ...putAsset(dir, pointed.program) };
    const pond = (name: string, e: Emitter) => view3d({
      doc: writeJson(dir, name, pondDoc(name, SIZE, { ...STILL, rings: { on: { list: DRIPS } } }, { drips: logicItem(e) })),
      look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, assets,
    });
    const [refused, drawn] = runGpu(bin(), dir, [pond('drips-no-point', bare), pond('drips-pointed', pointed)]);
    answered(drawn!, 'the pond whose list\'s kind carries a point');
    const issues = refusedIssues(refused!, 'the pond whose list carries no point');
    expect(issues.some((i) => JSON.stringify(i).includes(DRIPS)), `an error issue names the list ${DRIPS}: ${shown(issues)}`).toBe(true);
  });

  it(`${AC[6]} an occurrence 1 m off the plate's edge starts no ring`, () => {
    requireGpu();
    const dir = out();
    const s = stones();
    const assets = putAsset(dir, s.program);
    const pond = (name: string, rings: boolean) => view3d({
      doc: writeJson(dir, name, pondDoc(name, SIZE, { ...STILL, rings: rings ? { on: { list: STONES } } : 'none' }, { stones: logicItem(s) })),
      look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, capture: [AT], rings: true, assets,
    });
    const [thrown, bare] = runGpu(bin(), dir, [pond('stones', true), pond('stones-bare', false)]);
    const frame = frameAt(framesOf(thrown!, 'the pond with the two stones'), AT, 'the pond with the two stones');
    const rings = ringsOf(frame, 'the pond with the two stones');
    console.log(`${AC[6]}: at 2.25 s ${rings.map((r) => `occurrence ${r.occurrence} at (${r.x}, ${r.z})`).join('; ') || 'no ring is listed'}`);
    expect(s.rows.map((r) => r.point), 'the list holds the stone at the centre, then the one 1 m off the +x edge').toEqual([CENTRE, [4, 0, -0.5]]);
    none(ringFailures(rings, alive(s.rows, T), T, STONES), 'the stone on the plate starts a ring at its point; the stone 1 m off the plate\'s edge starts none');
    expect(rings.map((r) => r.occurrence), 'one ring is alive at 2.25 s, the first stone\'s').toEqual([0]);
    expect(hashAt(bare!, AT, 'the pond with rings: none'), 'the ring is drawn: the pond with rings: none has another frame 45').not.toBe(frame.pixel_hash);
  });
});
