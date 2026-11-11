// #1921.a5fff896: a box body bound to an item scaled (2, 1, 1) is refused at check, naming the item and the scale; with
// the shape's half extents doubled instead and the item at scale 1, the box rests on the floor at 1 m, its drawn mesh
// matching its collider within 1 mm; and an output that drives an item drawn at scale 0.5 keeps the drawn scale while it
// writes the body's position and rotation, where a planted output that writes the body's whole transform resets the
// scale to 1 and fails, naming the item.
//
// The crate lab (helpers.ts: crateScene): `box`, bound to the item `crate` (`item: "crate"`, README: The world
// document), built at the item's pose 1.5 m up and written back to it by an output; and `die`, a 0.5 m box with its own
// pose, spun at 90°/s about +Y and dropped 1.75 m, whose output drives `token`, a 1 m box drawn at scale 0.5. The
// scaled variant draws the crate 1 × 2 × 1 at scale (2, 1, 1) over a 1 × 2 × 1 m collider; the sized one draws it
// 2 × 2 × 1 at scale 1 over a collider of half extents (1, 1, 0.5), so resting on the plane its centre is 1 m up.
//
// `deep-physics` checks and bakes the world in its scene; `deep-show run` presents the scene and reads, at 60 fps frame
// f (step 2f exactly, so no interpolation is involved), each item's evaluated transform. The drawn crate is a
// `mark.box@1`: a box of its `size`, centred on its origin, through its transform; its corners are held to the
// collider's, the body's pose after step 240 with half extents (1, 1, 0.5), within 1 mm. The planted twin is the
// scenario's `planted: "output_writes_whole_transform"`: the same run, judged the same way.
import { describe, expect, it } from 'vitest';
import {
  CRATE_AT, CRATE_FRAMES, CRATE_HALF, CRATE_SCALE, CRATE_STEPS, CRATE_WORLD, CRITERIA, DOC, TIMEOUT, TOKEN_SCALE, corners,
  crateScene, errorsOf, evalCall, matrixGap, names, none, physics, prebuild, prebuildShow, presented, quatMatrix, rotMatrix,
  runShow, scale3, scenario, sceneBake, sceneCheck, show, showBin, showCall, speed, statesOf, useTemp, valuesOf, vec,
  withPlanted, type JsonObject, type ShowPlanted, type State,
} from './helpers.ts';

prebuild();
prebuildShow(['full']);

const ID = CRITERIA[1];
const temp = useTemp();
/** The item against its body: the same f32 pose, read through the output (as #1918's suite reads one). */
const POS_TOL = 1e-6;
const ROT_TOL = 1e-5;
/** The issue's: the drawn mesh matches its collider within 1 mm; "rests at 1 m" is held to the same millimetre. */
const MM = 1e-3;
const crate = (f: string): string => `items/crate/${f}`;
const token = (f: string): string => `items/token/${f}`;

function bakeOf(scene: JsonObject, body: string): State[] {
  const [baked] = physics([sceneBake(scene, CRATE_WORLD, CRATE_STEPS)]);
  return statesOf(baked!, body, CRATE_STEPS + 1, `the ${scene['title'] as string} lab's bake`);
}

/** The token played at every frame 0 … 120: its drawn scale, position and rotation against the die's after step 2f. */
function tokenProblems(planted?: ShowPlanted): { problems: string[]; scales: number[][] } {
  const scene = crateScene('sized');
  const die = bakeOf(scene, 'die');
  const doc = DOC(12);
  const frames = Array.from({ length: CRATE_FRAMES + 1 }, (_, f) => f);
  const paths = [token('at/pos'), token('at/rot'), token('at/scale')];
  const sc = withPlanted(scenario(temp(), [doc], [showCall(doc, scene), ...frames.map((f) => evalCall(doc, f, paths))]), planted);
  const replies = runShow(showBin('full'), sc, `the token, played${planted ? ` (planted ${planted})` : ''}`);
  presented(replies[0], 'the sized crate lab');
  const problems: string[] = [];
  const scales: number[][] = [];
  for (const f of frames) {
    const v = valuesOf(replies[1 + f], `the lab at frame ${f}`);
    const s = scale3(v[token('at/scale')], `${token('at/scale')} at frame ${f}`);
    scales.push(s);
    if (s.some((x, i) => x !== TOKEN_SCALE[i])) problems.push(`items/token at frame ${f}: its drawn scale is ${show(s)}, the item's own is ${show(TOKEN_SCALE)}`);
    const want = die[2 * f]!;
    const pos = vec(v[token('at/pos')], 3, `${token('at/pos')} at frame ${f}`);
    if (pos.some((x, i) => Math.abs(x - want.pos[i]!) > POS_TOL)) problems.push(`items/token at frame ${f}: its position is ${show(pos)}, the die's after step ${2 * f} is ${show(want.pos)}`);
    const gap = matrixGap(rotMatrix(v[token('at/rot')], `${token('at/rot')} at frame ${f}`), quatMatrix(want.rot));
    if (gap > ROT_TOL) problems.push(`items/token at frame ${f}: its rotation ${show(v[token('at/rot')])} is ${gap.toExponential(2)} from the die's after step ${2 * f}, ${show(want.rot)}`);
  }
  return { problems, scales };
}

describe(`${ID} scale stays out of physics: a scaled item bound to a body is refused, sizes are in metres, and outputs write position and rotation only`, () => {
  it(`${ID} (refused) a box body bound to an item scaled (2, 1, 1) is refused at check, naming the item and the scale; with the shape's half extents doubled instead and the item at scale 1, the world checks`, () => {
    const [scaled, sized] = physics([sceneCheck(crateScene('scaled'), CRATE_WORLD), sceneCheck(crateScene('sized'), CRATE_WORLD)]);
    const errors = errorsOf(scaled, 'the scaled crate lab');
    const naming = errors.filter((e) => names(e, 'crate') && JSON.stringify(e['actual']) === JSON.stringify(CRATE_SCALE));
    expect(naming.length, `an error issue names the item crate and holds its scale ${show(CRATE_SCALE)} as actual; the errors: ${show(errors)}`).toBeGreaterThan(0);
    expect(errors.filter((e) => names(e, 'token')).map((e) => show(e)), 'token, drawn at scale 0.5 and only driven by an output, is no error').toEqual([]);
    none(errorsOf(sized, 'the sized crate lab').map((e) => show(e)), 'with the half extents doubled along x and the item at scale 1, the world checks with no error');
  }, TIMEOUT);

  it(`${ID} (rests) with the half extents doubled and the item at scale 1, the box rests on the floor at 1 m, its drawn mesh matching its collider within 1 mm`, () => {
    const scene = crateScene('sized');
    const box = bakeOf(scene, 'box');
    expect(box[0]!.pos, `the box is built at its item's position ${show(CRATE_AT)}`).toEqual(CRATE_AT);
    expect(matrixGap(quatMatrix(box[0]!.rot), quatMatrix([0, 0, 0, 1])), `and its rotation (none): ${show(box[0]!.rot)}`).toBeLessThanOrEqual(ROT_TOL);
    const end = box[CRATE_STEPS]!;
    expect(Math.abs(end.pos[1] - 1), `the box rests with its centre 1 m up after 2 s: ${show(end.pos)}`).toBeLessThanOrEqual(MM);
    expect(speed(end.linear), `and at rest: ${show(end.linear)} m/s`).toBeLessThanOrEqual(MM);

    const doc = DOC(11);
    const paths = [crate('at/pos'), crate('at/rot'), crate('at/scale'), crate('params/size')];
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scene), evalCall(doc, CRATE_FRAMES, paths)]), 'the sized crate lab at 2 s');
    presented(replies[0], 'the sized crate lab');
    const v = valuesOf(replies[1], 'the lab at 2 s');
    const drawnHalf = vec(v[crate('params/size')], 3, crate('params/size')).map((x, i) => (x * scale3(v[crate('at/scale')], crate('at/scale'))[i]!) / 2);
    const drawn = corners(vec(v[crate('at/pos')], 3, crate('at/pos')), rotMatrix(v[crate('at/rot')], crate('at/rot')), drawnHalf);
    const collider = corners(end.pos, quatMatrix(end.rot), CRATE_HALF);
    const gap = Math.max(...drawn.map((c, k) => Math.hypot(c[0] - collider[k]![0], c[1] - collider[k]![1], c[2] - collider[k]![2])));
    expect(gap, `the drawn crate's corners (its size ${show(v[crate('params/size')])} at scale ${show(v[crate('at/scale')])}, at ${show(v[crate('at/pos')])} turned ${show(v[crate('at/rot')])}) against its collider's after step ${CRATE_STEPS} (half ${show(CRATE_HALF)} at ${show(end.pos)}): the farthest pair, m`).toBeLessThanOrEqual(MM);
  }, TIMEOUT);

  it(`${ID} (kept) an output that drives an item drawn at scale 0.5 keeps the drawn scale while it writes the body's position and rotation`, () => {
    const { problems } = tokenProblems();
    none(problems, 'the token at every frame from 0 to 2 s');
  }, TIMEOUT);

  it(`${ID} (twin) a planted output that writes the body's whole transform resets the scale to 1 and fails, naming the item`, () => {
    const { problems, scales } = tokenProblems('output_writes_whole_transform');
    expect(problems.length, 'output_writes_whole_transform fails the judge that passes the real output').toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith('items/token ')), `a failure names the item token: ${problems.slice(0, 5).join('; ')}`).toBe(true);
    expect(scales.some((s) => s.every((x) => x === 1)), `and the token's drawn scale reads 1: ${show(scales.slice(0, 3))}`).toBe(true);
  }, TIMEOUT);
});
