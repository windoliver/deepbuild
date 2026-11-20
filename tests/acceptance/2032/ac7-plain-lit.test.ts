// AC7 #2032.24e13df9: "A lit group with no occluding path and no sun draws a frame byte-identical to the merge base"
//
// The merge base is `git merge-base HEAD origin/main` (else `main`). Its tree is exported and its own `deep-canvas-render`
// and `deep-gpu` built from it (#2031's `useMergeBase`, which keeps both under `<target>/acceptance-2031-base`); the
// checkout's are built as every file here builds them. The fixture is a 320 × 180 document with a 2 s transport: its
// group `lamps` holds ambient 0.2 and three point lights in three roles, none naming a `kind`, the first one's `at`
// keyed over the 2 s; `floor`, a white rect; `rock`, a closed path filled in `accent`, and `fence`, an open stroked
// path, neither naming `occlude`. Both sides draw it with the same inputs at 0 and 1 s. A frame is every picture the
// surfaces draw of it (#2031's `framesOf`): `raster` (Vello CPU, as goldens draw), `window2d` (the app's window) and
// `layers` by GPUI, the GPU layer and Vello CPU, with each layer's draw path. Each must be byte-identical (the same
// SHA-256 of its PNG) to the merge base's, and a refusal the same refusal. A merge base that can't be exported or
// built, or that draws no picture of the fixture, can't be judged: the test then fails INCONCLUSIVE (README: Readings).
// Wrong programs: a shadow pass that moves a pixel of a group with no occluder, a point light's term changed by the
// sun's code path, a closed path that occludes by default, a draw path moved for lit layers.
import { describe, it } from 'vitest';
import {
  AC, boxPoly, doc, framesOf, group, inconclusive, item, keyed, light, LOOK, none, outline, rect, requireMetal, useBin, useDir,
  useMergeBase, WHITE,
} from './helpers.ts';

const ID = AC[7];
const head = { canvas: useBin('deep-canvas-render'), gpu: useBin('deep-gpu') };
const base = useMergeBase();
const dir = useDir();

const fixture = doc('lit-plain', [320, 180], [
  group('lamps', 'a0', { ambient: 0.2, lights: [
    light({ at: [60, 50], energy: 0.8, range: 160 }),
    light({ at: [200, 120], energy: 0.6, range: 140 }, 'accent'),
    light({ at: [280, 40], energy: 0.5, range: 120 }, 'focus'),
  ] }),
  rect('floor', 'a1', [0, 0, 320, 180], 'lamps'),
  outline('rock', 'a2', boxPoly(120, 60, 40, 50), 'lamps', { fill: 'accent' }),
  item('fence', 'path@1', 'a3', { d: 'M 220 30 L 250 70 L 300 60', paint: { stroke: { role: WHITE, width: 3 } } }, { parent: 'lamps' }),
], { transport: { span: '2s' }, channels: { 'lamp-x': keyed('items/lamps/params/light/lights/0/at/0', [[0, 60], [2, 260]]) } });

describe(`${ID} a lit group with no occluding path and no sun draws as at the merge base`, () => {
  it(`${ID} the lit group's frames are byte-identical to the merge base's`, () => {
    requireMetal();
    let built: ReturnType<typeof base>;
    try { built = base(); } catch (e) { inconclusive(`the merge base's binaries can't draw the fixture: ${(e as Error).message.slice(0, 1500)}`); }
    const { rev, canvas, gpu } = built;
    const fixtures = [{ path: 'lit-plain', doc: fixture, inputs: { look: LOOK, states: {}, readings: {} }, store: dir() }];
    const before = framesOf(canvas, gpu, fixtures, `${dir()}/base`);
    const after = framesOf(head.canvas(), head.gpu(), fixtures, `${dir()}/head`);
    const failures = [...new Set([...before.keys(), ...after.keys()])].flatMap((k) => (before.get(k) === after.get(k) ? [] : [`${k}: ${after.get(k) ?? 'missing'} where the merge base has ${before.get(k) ?? 'nothing'}`]));
    const pictures = [...before.values()].filter((v) => v.startsWith('png ')).length;
    console.log(`${ID}: ${before.size} frames and paths compared with the merge base ${rev.slice(0, 12)}, ${pictures} of them pictures; ${failures.length} differ`);
    none(failures, `frames that differ from the merge base ${rev.slice(0, 12)}'s`);
    if (!pictures) inconclusive(`the merge base ${rev.slice(0, 12)} draws no picture of the fixture, so its frame can't be compared`);
  });
});
