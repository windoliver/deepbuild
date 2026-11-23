// AC4 #2034.051fac12: "Across that threshold, the 10% to 90% width of one shadow edge on the floor, chosen 8 coarse
// texels wide or more, changes by under 10% (drafted). A planted filter sized in texels doubles the width and fails,
// naming the light"
//
// AC3's threshold walk (helpers: `walkDoc`), at its poses A (frame 2: `edge_lamp` at 512 px) and B (frame 3: 256 px),
// drawn twice in one `deep-gpu run` on macOS's Metal device with the linear target and `shadows: true`: as it is, and
// without the board (`walkDoc(…, {board: false})`, the same lights and tiles). On the floor, along 21 lines
// z = −1.0, −0.9 … 1.0 m, at x = 1.50, 1.51 … 3.70 m, each point is carried to the frame by #378's pinhole and read
// bilinearly from the red channel of both frames; the board's frame over the open one is the edge lamp's visibility
// there (the other lamps' light doesn't reach these points). The 21 lines' mean, dark at x = 1.5 (in the board's
// shadow, which runs from the board out to the edge) and lit at 3.7, is the edge's profile; its width is the distance
// from the first point at or over 0.1 to the first at or over 0.9, each found by linear interpolation. At B the width
// must be 8 coarse texels or more, a coarse texel being the 256 px tile's at the edge, 2 tan(60°) × the distance from
// the lamp to the profile's 0.5 point ÷ 256; and the widths at A and B must differ by under 10% of A's. Each frame's
// tile table must be the rule's (`tileTable`, reference.ts), so the two widths straddle the threshold.
// Wrong programs: the base (no tile table); `--planted tile_filter_in_texels`, whose filter is as wide in texels at
// every size, so halving a tile doubles the edge; a filter whose penumbra clamp binds at the coarse size.
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, TIMEOUT, failsNaming, frameAt, framesOf, none, requireMetal, useDir, useGpu, view3dCall, writeJson, type Frame, type Linear } from '../1634/helpers.ts';
import { len, project, sub } from '../1634/reference.ts';
import { AC, EDGE, POSE_A, POSE_B, WALK, WALK_LAMPS, mapsOf, runGpu, tableProblems, walkCam, walkDoc, type Planted } from './helpers.ts';
import { tileTable, type Pinhole } from './reference.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const XS = Array.from({ length: 221 }, (_, k) => 1.5 + k * 0.01);
const ZS = Array.from({ length: 21 }, (_, k) => -1 + k * 0.1);

/** A linear frame's red channel at frame point (sx, sy), pixel (x, y)'s centre at (x + 0.5, y + 0.5), bilinearly. */
function red(lin: Linear, sx: number, sy: number): number {
  const u = sx - 0.5; const v = sy - 0.5; const x = Math.floor(u); const y = Math.floor(v); const fx = u - x; const fy = v - y;
  const at = (i: number, j: number): number => lin.at(Math.min(Math.max(i, 0), lin.width - 1), Math.min(Math.max(j, 0), lin.height - 1))[0];
  return (at(x, y) * (1 - fx) + at(x + 1, y) * fx) * (1 - fy) + (at(x, y + 1) * (1 - fx) + at(x + 1, y + 1) * fx) * fy;
}
/** The first x at which `profile` rises to `level` or over, by linear interpolation; null when it never does. */
function crossing(profile: number[], level: number): number | null {
  for (let k = 1; k < profile.length; k++) {
    if (profile[k]! >= level) { const [a, b] = [profile[k - 1]!, profile[k]!]; return XS[k - 1]! + ((level - a) / (b - a)) * 0.01; }
  }
  return null;
}
interface Edge { width: number | null; texel: number; ends: [number, number]; open: number }
function edgeAt(board: Frame, open: Frame, cam: Pinhole): Edge {
  expect(board.linear, `frame ${board.frame} with the board has its linear target`).not.toBeNull();
  expect(open.linear, `frame ${open.frame} without the board has its linear target`).not.toBeNull();
  let dimmest = Infinity;
  const profile = XS.map((x) => ZS.reduce((sum, z) => {
    const [sx, sy] = project(cam, [x, 0, z]);
    const lit = red(open.linear!, sx, sy); dimmest = Math.min(dimmest, lit);
    return sum + red(board.linear!, sx, sy) / lit;
  }, 0) / ZS.length);
  const [x90, x10, x50] = [crossing(profile, 0.9), crossing(profile, 0.1), crossing(profile, 0.5)];
  const texel = x50 === null ? NaN : (2 * Math.tan((EDGE.outer! * Math.PI) / 180) * len(sub([x50, 0, 0], EDGE.pos))) / 256;
  return { width: x90 === null || x10 === null ? null : x90 - x10, texel, ends: [profile[0]!, profile.at(-1)!], open: dimmest };
}

function problems(planted?: Planted): string[] {
  const out = dir();
  const common = { look: PLAIN_LOOK, size: WALK.size, fps: WALK.fps, from: POSE_A.out, frames: 2, targets: ['linear' as const] };
  const [withBoard, without] = runGpu(bin(), out, [
    { ...view3dCall({ ...common, doc: writeJson(out, 'walk', walkDoc('walk')) }), shadows: true },
    { ...view3dCall({ ...common, doc: writeJson(out, 'walk-open', walkDoc('walk-open', { board: false })) }), shadows: true },
  ], planted ? { planted } : {});
  const [b, o] = [framesOf(out, withBoard!, WALK.size, 'the walk'), framesOf(out, without!, WALK.size, 'the walk without the board')];
  const failures: string[] = [];
  const edges = [POSE_A, POSE_B].map((pose) => {
    const f = frameAt(b, pose.out, `pose ${pose.name}`);
    failures.push(...tableProblems(`at pose ${pose.name}`, mapsOf(f, `pose ${pose.name}`), tileTable(walkCam(pose.out), WALK_LAMPS)));
    const e = edgeAt(f, frameAt(o, pose.out, `pose ${pose.name} without the board`), walkCam(pose.out));
    if (e.open < 0.01) failures.push(`at pose ${pose.name} the open floor reads ${e.open.toExponential(2)} at its dimmest, too dark to read the edge`);
    if (e.width === null || e.ends[0] > 0.05 || e.ends[1] < 0.95) failures.push(`at pose ${pose.name} ${EDGE.id}'s profile doesn't run from dark to lit across the edge (${e.ends[0].toFixed(3)} at x = 1.5 m, ${e.ends[1].toFixed(3)} at 3.7 m)`);
    return e;
  });
  const [a, bEdge] = edges as [Edge, Edge];
  if (a.width !== null && bEdge.width !== null) {
    if (bEdge.width < 8 * bEdge.texel) failures.push(`at pose ${POSE_B.name} ${EDGE.id}'s edge is ${bEdge.width.toFixed(3)} m wide, under 8 coarse texels (${(8 * bEdge.texel).toFixed(3)} m)`);
    const apart = Math.abs(bEdge.width - a.width) / a.width;
    if (!(apart < 0.1)) failures.push(`${EDGE.id}'s shadow edge is ${a.width.toFixed(3)} m wide at 512 px (pose A) and ${bEdge.width.toFixed(3)} m at 256 px (pose B): ${(100 * apart).toFixed(1)}% apart, 10% or more`);
    console.log(`${ID}${planted ? ` --planted ${planted}` : ''}: ${EDGE.id}'s edge ${a.width.toFixed(3)} m at A, ${bEdge.width.toFixed(3)} m at B (${(bEdge.width / bEdge.texel).toFixed(1)} coarse texels)`);
  }
  return failures;
}

describe(`${ID} a shadow edge across the threshold`, () => {
  it(`${ID} edge_lamp's shadow edge on the floor, 8 coarse texels wide or more, keeps its 10% to 90% width within 10% from 512 px to 256 px`, () => {
    requireMetal();
    none(problems(), `${ID}: the edge's width across the threshold`);
  }, TIMEOUT);

  it(`${ID} a planted filter sized in texels (--planted tile_filter_in_texels) doubles the width and fails, naming the light`, () => {
    requireMetal();
    const failures = problems('tile_filter_in_texels');
    console.log(`${ID} --planted tile_filter_in_texels: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [/^edge_lamp's shadow edge is .* apart, 10% or more$/], '--planted tile_filter_in_texels');
  }, TIMEOUT);
});
