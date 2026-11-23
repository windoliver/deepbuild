// AC1 #2288.392506fb: a 100-element instancer at (5, 0, 0) turned 90° about +Y, with `each:` and a `<body>#*` output,
// builds each body at the instancer's world transform × its row, and its columns played for 2 s read back each body's
// pose in the instancer's own frame within 1e-6 m.
//
// The turned lab (helpers.ts: turnedScene): `tiles`, an instance@1 item at (5, 0, 0) turned [0, 90, 0] degrees, whose
// 100 rows hold elements 0 … 99 out of row order (row i holds (37 × i) mod 100), each row at its own place 0.5 m to
// 4.4 m up and turned −30° to 30° about +X; `tile`, a 0.3 m box body with `each: "tiles"`, dropped on the plane y = 0,
// and the output `{from: "tile#*", read: "pose", to: "items/tiles"}`.
//
// (built) `deep-physics` checks the world in its scene: no error, and `built` holds `tile#0` … `tile#99`, each once.
// Its bake's built state of `tile#<e>` is the instancer's world transform × e's row, computed here from the issue's
// numbers (pos T + R·p, rot q_T · q_row, R the turn of 90° about +Y): every corner of the 0.3 m box within 1e-6 m. A
// program that builds at the bare row is 0.8 m or more off at a corner; one that multiplies the turns the other way
// round is off by up to 0.19 m.
//
// (played) `deep-show run` presents the scene and evaluates it at every 60 fps frame from 0 to 120 (2 s) in order,
// reading `items/tiles/params/pos` and `params/rot` (the columns the frame draws, rows in the instancer's row order)
// and `items/tiles/at/pos`, `at/rot`. Frame f is step 2f exactly, so no output interpolates. The instancer stays at
// (5, 0, 0) turned 90° about +Y, and each row's (pos, rot) is its element body's pose after step 2f from the same
// world's bake, taken into the instancer's own frame (the inverse of its world transform), within 1e-6 m at every
// corner. So the element drawn there, the instancer's transform × its row, is where its body is. A program that
// writes world poses into the columns is 0.8 m or more off from frame 0; one whose columns don't follow the bodies is
// off once they fall (every body falls more than 0.1 m by step 240, checked on the bake).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC2288, METRE_TOL, TILE, TILES, TILES_AT, TILES_TURN, TILE_COUNT, TILE_FRAMES, TILE_HALF, TILE_ROWS, TILE_STEPS,
  TURNED_WORLD, TIMEOUT, arr, errorsOf, eulerMatrix, evalCall, inTilesFrame, matrixGap, none, physics, poseGap, posesOf,
  prebuild, prebuildShow, presented, rotMatrix, rowsOf, runShow, scenario, sceneBake, sceneCheck, show, showBin, showCall,
  tileAddress, tileId, tileWorld, turnedScene, useTemp, valuesOf, vec, type Pose,
} from './helpers.ts';

prebuild();
prebuildShow(['full']);

const ID = AC[1];
const temp = useTemp();
const ADDRESSES = Array.from({ length: TILE_COUNT }, (_, e) => tileAddress(e));

/** The world's bake in its scene, every 2 steps to step 240: each element body's poses, index f after step 2f. */
function bakeTiles(): Map<number, Pose[]> {
  const [baked] = physics([sceneBake(turnedScene(), TURNED_WORLD, TILE_STEPS, { every: 2 })]);
  expect(baked!['ok'], `the turned lab's world is baked in its scene: ${show(baked).slice(0, 1500)}`).toBe(true);
  const fails: string[] = [];
  const poses = new Map<number, Pose[]>();
  for (let e = 0; e < TILE_COUNT; e++) poses.set(e, posesOf(baked!, tileAddress(e), TILE_FRAMES + 1, fails));
  none(fails.slice(0, 20), 'the bake names each element body by its address, tile#<element id>, with a pose after every second step');
  return poses;
}

describe(`AC1 ${ID} each: over a moved and turned instancer`, () => {
  it(`AC1 ${ID} (built) a 100-element instancer at (5, 0, 0) turned 90° about +Y, with each: and a <body>#* output, builds each body at the instancer's world transform × its row`, () => {
    const [checked] = physics([sceneCheck(turnedScene(), TURNED_WORLD)]);
    none(errorsOf(checked, 'the turned lab').map((e) => show(e)), 'the world, each: over an instancer at (5, 0, 0) turned 90° about +Y, checks with no error');
    const built = arr(checked!['built'], 'the check\'s built (the bodies in the order the backend built them)').map(String);
    expect(built.filter((b) => b.startsWith(`${TILE}#`)), 'the backend built tile#0 … tile#99, one body per element, in element-ID order').toEqual(ADDRESSES);
    expect(built.length, `the world builds the ground and the 100 element bodies and nothing else: ${show(built)}`).toBe(TILE_COUNT + 1);

    const poses = bakeTiles();
    const fails: string[] = [];
    for (const row of TILE_ROWS) {
      const e = tileId(row);
      const got = poses.get(e)?.[0];
      if (!got) continue;
      const want = tileWorld(row);
      const gap = poseGap(got, want, TILE_HALF);
      if (!(gap <= METRE_TOL)) fails.push(`${tileAddress(e)} is built at ${show(got.pos)} turned ${show(got.rot)}; the instancer's world transform × its row ${row} is ${show(want.pos)} turned ${show(want.rot)} (a corner ${gap.toExponential(3)} m off)`);
    }
    none(fails, 'each element body is built at the instancer\'s world transform × its row, every corner within 1e-6 m');
  }, TIMEOUT);

  it(`AC1 ${ID} (played) its columns played for 2 s read back each body's pose in the instancer's own frame within 1e-6 m`, () => {
    const poses = bakeTiles();
    const fell = TILE_ROWS.filter((row) => {
      const s = poses.get(tileId(row));
      return !s || !(s[0]!.pos[1]! - s[TILE_FRAMES]!.pos[1]! > 0.1);
    });
    expect(fell.map((row) => tileAddress(tileId(row))), 'every body falls more than 0.1 m by step 240, so columns that stay put can\'t pass').toEqual([]);

    const scene = turnedScene();
    const doc = DOC2288(1);
    const paths = [`items/${TILES}/params/pos`, `items/${TILES}/params/rot`, `items/${TILES}/at/pos`, `items/${TILES}/at/rot`];
    const frames = Array.from({ length: TILE_FRAMES + 1 }, (_, f) => f);
    const replies = runShow(showBin('full'), scenario(temp(), [doc], [showCall(doc, scene), ...frames.map((f) => evalCall(doc, f, paths))]), 'the turned lab, played for 2 s');
    presented(replies[0], 'the turned lab');

    const turn = eulerMatrix(TILES_TURN);
    const problems: string[] = [];
    for (const f of frames) {
      const v = valuesOf(replies[1 + f], `the turned lab at frame ${f}`);
      const at = vec(v[paths[2]!], 3, `${paths[2]} at frame ${f}`);
      if (at.some((x, i) => Math.abs(x - TILES_AT[i]!) > METRE_TOL)) problems.push(`frame ${f}: the instancer's at/pos reads ${show(at)}, not its own ${show(TILES_AT)}`);
      const rotGap = matrixGap(rotMatrix(v[paths[3]!], `${paths[3]} at frame ${f}`), turn);
      if (rotGap > METRE_TOL) problems.push(`frame ${f}: the instancer's at/rot reads ${show(v[paths[3]!])}, ${rotGap.toExponential(2)} from 90° about +Y`);
      const fails: string[] = [];
      const pos = rowsOf(v[paths[0]!], TILE_COUNT, 3, `frame ${f}: ${paths[0]}`, fails);
      const rot = rowsOf(v[paths[1]!], TILE_COUNT, 4, `frame ${f}: ${paths[1]}`, fails);
      problems.push(...fails.slice(0, 3));
      if (fails.length) continue;
      for (const row of TILE_ROWS) {
        const e = tileId(row);
        const body = poses.get(e)?.[f];
        if (!body) continue;
        const want = inTilesFrame(body);
        const gap = poseGap({ pos: pos[row]!, rot: rot[row]! }, want, TILE_HALF);
        if (!(gap <= METRE_TOL)) problems.push(`frame ${f}: row ${row} (${tileAddress(e)}) reads ${show(pos[row])} turned ${show(rot[row])}; its body after step ${2 * f}, in the instancer's own frame, is ${show(want.pos)} turned ${show(want.rot)} (a corner ${gap.toExponential(3)} m off)`);
      }
    }
    none(problems, 'at every frame 0 … 120, each row of the instancer\'s pos and rot columns is its body\'s pose in the instancer\'s own frame, within 1e-6 m');
  }, TIMEOUT);
});
