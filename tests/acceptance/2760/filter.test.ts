// #2760.f7241c9f: "With `on` filtered to the kind `lap`, a list that also holds `step` occurrences starts rings at the laps
// only"
//
// The fixture (helpers.ts `pondDoc`, 480 × 270): the still pond, and the logic item `deer` (60 Hz), which declares two
// kinds, `lap {point: vec3}` and `step {point: vec3}`, and emits a lap at 1 s and at 1.6 s where the animal drinks and
// a step at 1.25 s and at 1.85 s where its feet stand in the water, four places on the plate. Its list
// `deer.occurrences` holds them in step order: lap, step, lap, step (occurrences 0 to 3). The pond's material carries
// `rings: {on: {list: "deer.occurrences", kinds: ["lap"]}}`.
//
// At 2.25 s (frame 45 at 20 fps), when a ring of each of the four would be alive, the frame's `rings` rows list exactly
// the two laps' rings (occurrences 0 and 2), each centred within 1 mm of its lap's point with radius speed × age, and
// none at a step. Not vacuous: the same pond with `kinds: ["step"]` lists exactly the two steps' rings (occurrences 1
// and 3) at the steps' points, so the steps carry points on the plate and start rings when they are asked for, and the
// two ponds draw different frames. Wrong programs: a filter that isn't read (four rings), a filter by position in the
// list, a list that keeps one kind's rows only.
import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, STILL, type Emitter, type Kind, type V3, alive, emitter, frameAt, framesOf, logicItem, look3d, none, pondDoc, putAsset, requireGpu, ringFailures, ringsOf, runGpu,
  useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('filter-2760');
const FPS = 20;
const AT = 45; // 2.25 s
const T = AT / FPS;
const LIST = 'deer.occurrences';
const KINDS: Kind[] = [{ kind: 'lap', fields: [['point', 'vec3']] }, { kind: 'step', fields: [['point', 'vec3']] }];
const from = (dx: number, dz: number): V3 => [CENTRE[0] + dx, 0, CENTRE[2] + dz];
/** The deer: laps at steps 60 and 96 (1 s, 1.6 s), steps at 75 and 111 (1.25 s, 1.85 s), each at its own place. */
const deer = (): Emitter => emitter('deer', KINDS, [
  { step: 60, kind: 'lap', a: 1, fields: { point: from(-0.5, 0.4) } },
  { step: 75, kind: 'step', a: 1, fields: { point: from(0.6, -0.3) } },
  { step: 96, kind: 'lap', a: 2, fields: { point: from(-0.4, 0.5) } },
  { step: 111, kind: 'step', a: 2, fields: { point: from(0.9, 0.2) } },
]);

describe(`${AC[4]} \`on\` filters the list by kind`, () => {
  it(`${AC[4]} with on filtered to the kind lap, a list that also holds step occurrences starts rings at the laps only`, () => {
    requireGpu();
    const dir = out();
    const d = deer();
    const assets = putAsset(dir, d.program);
    const pond = (kind: string) => view3d({
      doc: writeJson(dir, kind, pondDoc(`deer-${kind}`, SIZE, { ...STILL, rings: { on: { list: LIST, kinds: [kind] } } }, { deer: logicItem(d) })),
      look: LOOK, size: SIZE, from: AT, frames: 1, fps: FPS, capture: [AT], rings: true, assets,
    });
    const [laps, steps] = runGpu(bin(), dir, [pond('lap'), pond('step')]);
    const lapFrame = frameAt(framesOf(laps!, 'the pond filtered to lap'), AT, 'the pond filtered to lap');
    const stepFrame = frameAt(framesOf(steps!, 'the pond filtered to step'), AT, 'the pond filtered to step');
    const lapRings = ringsOf(lapFrame, 'the pond filtered to lap'); const stepRings = ringsOf(stepFrame, 'the pond filtered to step');
    console.log(`${AC[4]}: filtered to lap, occurrences ${lapRings.map((r) => r.occurrence).join(', ') || 'none'}; filtered to step, occurrences ${stepRings.map((r) => r.occurrence).join(', ') || 'none'}`);
    none(ringFailures(lapRings, alive(d.rows, T, (r) => r.kind === 'lap'), T, LIST), 'filtered to lap, rings start at the laps only');
    expect(lapRings.map((r) => r.occurrence).sort((x, y) => x - y), 'the two laps\' rings and no step\'s').toEqual([0, 2]);
    none(ringFailures(stepRings, alive(d.rows, T, (r) => r.kind === 'step'), T, LIST), 'filtered to step, the steps start rings: they carry points on the plate');
    expect(stepRings.map((r) => r.occurrence).sort((x, y) => x - y), 'the two steps\' rings and no lap\'s').toEqual([1, 3]);
    expect(stepFrame.pixel_hash, 'the two filters draw different rings: frame 45 differs').not.toBe(lapFrame.pixel_hash);
  });
});
