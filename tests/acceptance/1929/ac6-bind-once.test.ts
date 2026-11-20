// AC6 #1929.ef5c1f92: "A channel keys that +y move from (0, 0, 0) m at 0 s to (0, 1, 0) m at 4 s. Over 120 frames
// at 30 fps the stack's work counters show the bind computed once, frame 60 has moved that corner 7/48 = 0.145833 m,
// and frame 60 sought equals frame 60 played bit for bit. Moving the +y point's rest place to 2.5 m computes the
// bind once more. A planted stack that binds every frame counts 120 binds, one whose bind key leaves out the control
// mesh keeps the old weights after the rest move, and each fails, naming the item"
//
// One document: `plain`, the subdivided cube alone, and `crate`, the same cube under `mod.mesh_deform@1` with AC5's
// octahedron and six moves of (0, 0, 0); a vec3 channel on `items/crate/modifiers/1/params/moves/2`, the +y point's
// move, keyed (0, 0, 0) at 0 s, linear, to (0, 1, 0) at 4 s. At frame k of 30 a second the move is (0, k/120, 0) m,
// so a vertex moves its +y mean value coordinate × k/120 m along y: the +x, +y, +z corner 7/24 × 60/120 = 7/48 m at
// frame 60.
//   - Played: #420's `geometry` with #224's `play: {fps: 30}` to frame 119 plays the 120 frames 0 … 119 through the
//     session's frame path; the `mod.mesh_deform@1` row of `crate`'s stack then carries `work: {binds}`, how many
//     computations of the bind the frames that call played made or were the first to read (README: The stack's work
//     counters). It must be 1, and frame 119's vertices where the closed form puts them, within 1e-9 m.
//   - The rest move: a second revision differs only in the +y point's place, 2.5 m out from the cube's centre in
//     place of 2 m. Played again to frame 119, the counter must show 1 (the bind computed once more), and the
//     vertices must stand where the new mesh's mean value coordinates put them: the corner's +y weight falls from
//     7/24 to about 0.2395, which no weight kept from the old mesh gives.
//   - Frame 60: one process plays to frame 60, another seeks it (a `geometry` call with no `play` is a clean
//     evaluation at its time). In both the corner has moved 7/48 m along y within 1e-9 m, and the two rows are the
//     same bit for bit: every position, every normal and every index.
// The wrong programs: scenario `planted: mesh_deform_binds_every_frame` computes the bind in every played frame, so
// the counter shows 120; `planted: mesh_deform_key_without_mesh` keys the bind without the control mesh, so after
// the rest move the vertices stand where the old weights put them. The same judge must fail on each, naming `crate`.

import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, DOC, TIMEOUT, admitted, bindProblems, bindsOf, cube, cubeOf, failsNaming, firstDifference, geometry, kindOf, meshDeform, moveProblems, none,
  placeOf, rowOf, runShow, scenario, sceneDoc, show, useBin, useDir, vertexAt, withinAbs, zeros, type Cube, type JsonObject, type Planted, type Row,
} from './helpers.ts';
import { OCTA, cageProblems, fmtV, length, meanValueWeights, octahedron, sub, weightedMove, type Cage, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

const KIND = 'mod.mesh_deform@1';
/** AC5's octahedron, and the same with its +y point's rest place 2.5 m out from the cube's centre. */
const CAGE = octahedron(CENTRE, 2);
const TALL = octahedron(CENTRE, 2, 2.5);
/** The criterion's frames: 120 of them at 30 a second, frames 0 … 119; the channel's key at 4 s is frame 120. */
const FRAMES = 120;
const LAST = FRAMES - 1;
const M = withinAbs(1e-9);
const UP = 7 / 24;
const DOWN = 1 / 24;

/** The +y point's move keyed from (0, 0, 0) m at 0 s to (0, 1, 0) m at 4 s. */
const LIFT: JsonObject = {
  target: `items/crate/modifiers/1/params/moves/${OCTA.py}`, type: 'vec3',
  keys: { k0: { t: '0s', value: [0, 0, 0], interp: 'linear' }, k1: { t: '4s', value: [0, 1, 0] } },
};
const keyed = (cage: Cage): JsonObject => sceneDoc('A cube in an octahedron whose +y point a channel moves', { plain: cube(), crate: cube([meshDeform(cage, zeros(6))]) },
  { transport: { span: '4s' }, channels: { lift: LIFT } });

/** A vertex's +y weight in `cage`: at a corner of the 2 m octahedron the issue's 7/24 or 1/24, else its mean value coordinate. */
function upWeight(p: V3, cage: Cage): number {
  const place = placeOf(p);
  return cage === CAGE && kindOf(place) === 'corner' ? (place[1] === 1 ? UP : DOWN) : meanValueWeights(p, cage)[OCTA.py]!;
}
/** The judge of a frame: every vertex of `crate` moved its +y weight × frame ÷ 120 m along y, nothing along x or z, within 1e-9 m. */
const frameProblems = (c: Cube, crate: Row, cage: Cage, frame: number): string[] => moveProblems(c, crate, (p) => [0, upWeight(p, cage) * (frame / FRAMES), 0], M);
/** The criterion's judge of the bind: computed once over the 120 frames, and once more after the rest move, the frames built from the weights of the mesh they have. */
const playProblems = (c: Cube, first: Row, after: Row): string[] => [
  ...bindProblems(first, KIND, 1, `over the ${FRAMES} frames played`),
  ...frameProblems(c, first, CAGE, LAST),
  ...bindProblems(after, KIND, 1, `over the ${FRAMES} frames played after the +y point's rest place moved to 2.5 m`),
  ...frameProblems(c, after, TALL, LAST),
];
const corner = (c: Cube): number => vertexAt(c, [1, 1, 1]);

/** The fixture and the closed form: the two meshes are closed and wound outward, the weights sum to 1 and reproduce each place, the issue's numbers hold, and the rest move changes the corner's weight. */
function closedFormIsTheIssues(c: Cube): void {
  expect(UP * (60 / FRAMES), 'the issue\'s 7/48 m at frame 60').toBe(7 / 48);
  expect(sub(TALL.points[OCTA.py]!, CENTRE), 'the +y point\'s rest place, 2.5 m out from the cube\'s centre').toEqual([0, 2.5, 0]);
  for (const cage of [CAGE, TALL]) {
    none(cageProblems(cage), 'the control mesh is closed, manifold and wound outward');
    for (const p of c.points) {
      const w = meanValueWeights(p.at, cage);
      const sum = w.reduce((a, b) => a + b, 0);
      const back = weightedMove(w, cage.points);
      expect(Math.abs(sum - 1) <= 1e-12 && length(sub(back, p.at)) <= 1e-12, `the closed form's weights at ${fmtV(p.at)} sum to 1 and reproduce the place, got ${sum} and ${fmtV(back)}`).toBe(true);
      if (cage === CAGE && kindOf(p.place) === 'corner') expect(Math.abs(w[OCTA.py]! - (p.place[1] === 1 ? UP : DOWN)) <= 1e-12, `the closed form's +y weight at the corner ${fmtV(p.at)} is the issue's`).toBe(true);
    }
  }
  const at = c.input[corner(c)]!;
  expect(UP - meanValueWeights(at, TALL)[OCTA.py]!, 'the rest move lowers the corner\'s +y weight by far more than the tolerance, so old weights show').toBeGreaterThan(0.01);
}

/** Both revisions shown, each played to frame 119, under the shipped program or a planted one. */
function played(planted?: Planted): { cube: Cube; first: Row; after: Row } {
  const replies = runShow(bin(), scenario(dir(), [DOC.a], [
    show(DOC.a, keyed(CAGE)), geometry(DOC.a, ['plain', 'crate'], { played: LAST }),
    show(DOC.a, keyed(TALL)), geometry(DOC.a, ['plain', 'crate'], { played: LAST }),
  ], planted));
  admitted(replies[0]!, 'the cube in the keyed octahedron');
  admitted(replies[2]!, 'the same with the +y point\'s rest place at 2.5 m');
  const c = cubeOf(rowOf(replies[1]!, 'plain', 'the cube before the deform'));
  closedFormIsTheIssues(c);
  return { cube: c, first: rowOf(replies[1]!, 'crate', `the cube played to frame ${LAST}`), after: rowOf(replies[3]!, 'crate', `the cube played to frame ${LAST} after the rest move`) };
}

describe(`${AC[6]} a keyed move binds once`, () => {
  it(`${AC[6]} over 120 frames at 30 fps the stack's work counters show the bind computed once, and moving the +y point's rest place to 2.5 m computes it once more`, () => {
    const { cube: c, first, after } = played();
    none(playProblems(c, first, after), 'the bind over 120 played frames, and after the rest move');
  }, TIMEOUT);

  it(`${AC[6]} frame 60 has moved the +x, +y, +z corner 7/48 m, and frame 60 sought equals frame 60 played bit for bit`, () => {
    const at = (how: { sought: number } | { played: number }, what: string): { cube: Cube; crate: Row } => {
      const [shownReply, built] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, keyed(CAGE)), geometry(DOC.a, ['plain', 'crate'], how)]));
      admitted(shownReply!, `the cube in the keyed octahedron, ${what}`);
      return { cube: cubeOf(rowOf(built!, 'plain', 'the cube before the deform')), crate: rowOf(built!, 'crate', `frame 60 ${what}`) };
    };
    const play = at({ played: 60 }, 'played');
    const seek = at({ sought: 60 }, 'sought');
    closedFormIsTheIssues(play.cube);
    none(frameProblems(play.cube, play.crate, CAGE, 60), 'frame 60 played: the corner 7/48 m along y, every vertex its +y weight × 0.5 m');
    none(frameProblems(seek.cube, seek.crate, CAGE, 60), 'frame 60 sought: the corner 7/48 m along y, every vertex its +y weight × 0.5 m');
    expect(firstDifference(seek.crate, play.crate), 'frame 60 sought equals frame 60 played bit for bit: positions, normals and indices').toBe('');
  }, TIMEOUT);

  it(`${AC[6]} planted mesh_deform_binds_every_frame binds every frame: it counts 120 binds over the 120 frames and the judge fails, naming the item`, () => {
    const { cube: c, first, after } = played('mesh_deform_binds_every_frame');
    expect(bindsOf(first, KIND), 'planted mesh_deform_binds_every_frame counts 120 binds over the 120 frames').toBe(FRAMES);
    failsNaming(playProblems(c, first, after), [`crate: over the ${FRAMES} frames played, its ${KIND} step's work counters show the bind computed ${FRAMES} time(s), want 1`], 'planted mesh_deform_binds_every_frame');
  }, TIMEOUT);

  it(`${AC[6]} planted mesh_deform_key_without_mesh keys the bind without the control mesh: it keeps the old weights after the rest move and the judge fails, naming the item`, () => {
    const { cube: c, first, after } = played('mesh_deform_key_without_mesh');
    none(frameProblems(c, after, CAGE, LAST), 'planted mesh_deform_key_without_mesh keeps the old mesh\'s weights after the rest move');
    failsNaming(playProblems(c, first, after), [`crate vertex ${corner(c)} at `], 'planted mesh_deform_key_without_mesh');
  }, TIMEOUT);
});
