// AC3 #223.9d800d51 (Oracle lane): a matrix's mix moves points straight to their images; a turn key turns rigidly.
// Ported from an upstream animation library, pinned at `a6d5cc02b4`: tests/test_graphical_units/test_transform.py,
// lines 120–125, test_ApplyMatrix, and test_movements.py, lines 38–41, test_Rotate, with their control frames
// ApplyMatrix.npz and Rotate.npz (README: Sources). No upstream code is copied.
//
// test_ApplyMatrix plays the matrix [[1, 0.5], [1, 0]] about the point (−10, 5) on a square of side 2 at the origin;
// in its frames each point moves straight from where it starts to its image, p + α(Mp − p) about the point, which is
// our (1 − u)I + uM. Ours: group `g` warped by `linear {matrix: [[1, 0.5], [1, 0]]}` on a plane whose origin is the
// about point, at (100, 300) u, unit 20 u, y up, its mix keyed linearly from 0 to 1 over 1 s; its child, the square
// through the plane's (10 ± 1, −5 ± 1) (the upstream square, offset from the about point). At progress 0, 0.25, 0.5,
// 0.75 and 1, through `deep-canvas-render path`, each corner lies at ((1 − u)I + uM)v on the plane within 1e-6 u.
// test_Rotate plays a half turn on the same square; its frames show it turned rigidly. Ours: `turned`, the square of
// side 40 u about (600, 300), its `at/rot/2` keyed linearly from 0 to 180 over 1 s: at the same progresses each corner
// lies 20√2 u from the centre within 1e-4 u and the square has turned by 180° × progress within 1e-3° (in the sense
// its first frame shows).
// The planted faults: the matrix read by columns ([[1, 1], [0.5, 0]]), which the matrix port fails; and a half turn
// written as the matrix [[−1, 0], [0, −1]] mixed from the identity, which passes through the square's centre at
// progress 0.5 and fails the rigid port. Each fault is first shown live (its film moves as the fault says).
// The frame comparisons themselves need the control frames rendered by the upstream library, outside the repo: BLOCKED.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, angleDiff, angleOf, blocked, dist, figure, fl, keyed, mat, mixed, none, pathAll, pathItem, planeJson, short, sub2, toScreen,
  useBins, vertices, warpGroup, type JsonObject, type PathFrame, type Plane, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const ABOUT: Plane = { origin: [100, 300], unit: 20, y: 'up' };
const M = [[1, 0.5], [1, 0]];
const CORNERS: Pt[] = [[9, -6], [11, -6], [11, -4], [9, -4]];
const closed = (pts: Pt[]): string => `M ${[...pts, pts[0]!].map((p) => p.join(' ')).join(' L ')}`;
const KEYS = { transport: { span: '2s' }, channels: { mix: keyed('items/g/params/warp/mix', [[0, 0], [1, 1]]) } };
const matrixFilm = (m: number[][]): JsonObject => figure('warp-oracle-matrix', [800, 600], [
  warpGroup('g', { linear: { matrix: m }, mix: 0, plane: planeJson(ABOUT) }),
  pathItem('square', 'a1', closed(CORNERS.map((q) => toScreen(ABOUT, q))), 2, {}, { parent: 'g' }),
], KEYS);
const CENTRE: Pt = [600, 300];
const OWN: Pt[] = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const TURN = figure('warp-oracle-rotate', [800, 600], [pathItem('turned', 'a0', closed(OWN), 2, {}, { at: { pos: [...CENTRE, 0] } })], {
  transport: { span: '2s' }, channels: { turn: keyed('items/turned/at/rot/2', [[0, 0], [1, 180]]) },
});
const HALF_PLANE: Plane = { origin: CENTRE, unit: 20, y: 'up' };
const HALF_MATRIX = figure('warp-oracle-half-matrix', [800, 600], [
  warpGroup('g', { linear: { matrix: [[-1, 0], [0, -1]] }, mix: 0, plane: planeJson(HALF_PLANE) }),
  pathItem('square', 'a1', closed(OWN.map((p) => [CENTRE[0] + p[0], CENTRE[1] + p[1]] as Pt)), 2, {}, { parent: 'g' }),
], KEYS);

const cornersAt = (f: PathFrame): Pt[] => (f.subpaths[0] ? vertices(f.subpaths[0]).slice(0, 4) : []);
/** The matrix port's judge: each corner at ((1 − u)I + uM)v, `m` the matrix the expectation reads. */
function judgeMatrix(frames: PathFrame[], m: number[][]): string[] {
  return frames.flatMap((f, k) => {
    const u = PROGRESS[k]!; const got = cornersAt(f);
    return CORNERS.flatMap((v, i) => {
      const want = toScreen(ABOUT, mat(mixed(m, u), v));
      return got[i] && dist(got[i]!, want) <= 1e-6 ? [] : [`at progress ${u}, corner ${i} is at (${got[i] ? got[i]!.map(short).join(', ') : 'nowhere'}), not on its straight path at (${want.map(short).join(', ')})`];
    });
  });
}
/** The rigid port's judge: each corner 20√2 u from the centre, the square turned by 180° × progress. */
function judgeRigid(frames: PathFrame[]): string[] {
  const failures: string[] = [];
  const turnOf = (f: PathFrame): number | null => { const c = cornersAt(f)[0]; return c ? angleDiff(angleOf(sub2(c, CENTRE)), angleOf(OWN[0]!)) : null; };
  const sense = Math.sign(turnOf(frames[1]!) ?? 0) || 1;
  frames.forEach((f, k) => {
    const u = PROGRESS[k]!; const got = cornersAt(f);
    if (got.length < 4) { failures.push(`at progress ${u} the square draws ${got.length} corners`); return; }
    got.forEach((c, i) => { const r = dist(c, CENTRE); if (Math.abs(r - 20 * Math.SQRT2) > 1e-4) failures.push(`at progress ${u}, corner ${i} lies ${short(r)} u from the centre, not ${short(20 * Math.SQRT2)}: not rigid`); });
    const turned = turnOf(f) ?? NaN;
    if (!(Math.abs(angleDiff(turned, sense * 180 * u)) <= 1e-3)) failures.push(`at progress ${u} the square has turned ${short(turned)}°, not ${short(sense * 180 * u)}°`);
  });
  return failures;
}
const play = (doc: JsonObject, id: string, what: string): PathFrame[] => pathAll(bin('render'), [{ doc, item: id, times: PROGRESS.map(fl) }], what)[0]!;

describe(`${AC[3]} (Oracle) a matrix's mix moves points straight; a turn key turns rigidly`, () => {
  it(`${AC[3]} test_ApplyMatrix and test_Rotate: [[1, 0.5], [1, 0]] about (−10, 5) moves each corner straight to its image; a half-turn key turns the square rigidly`, () => {
    none(judgeMatrix(play(matrixFilm(M), 'square', 'the matrix about (−10, 5)'), M), 'the matrix\'s mix moves each corner straight from where it starts to its image');
    none(judgeRigid(play(TURN, 'turned', 'the half-turn key')), 'the at.rot key turns the square rigidly');
  }, TIMEOUT);

  it(`${AC[3]} the ports fail on their planted faults: the matrix read by columns, and a half turn written as a matrix`, () => {
    const T = [[1, 1], [0.5, 0]];
    const columns = play(matrixFilm(T), 'square', 'the matrix read by columns');
    none(judgeMatrix(columns, T), 'the fault is live: the transposed matrix moves the square as its own mix says');
    expect(judgeMatrix(columns, M).length, 'the matrix port fails on the matrix read by columns').toBeGreaterThan(0);
    const half = play(HALF_MATRIX, 'square', 'a half turn as a matrix');
    const mid = cornersAt(half[2]!);
    expect(mid.length === 4 && mid.every((c) => dist(c, CENTRE) <= 1e-6), 'the fault is live: the half-turn matrix at mix 0.5 draws the square at its centre').toBe(true);
    expect(judgeRigid(half).length, 'the rigid port fails on a half turn written as a matrix').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[3]} test_ApplyMatrix's and test_Rotate's frames against their control frames`, () => {
    blocked('the control frames (ApplyMatrix.npz, Rotate.npz) are the upstream library\'s own renders; comparing ours with them needs the pinned tests rendered once outside the repo and their frames stored as goldens beside our fixture\'s',
      'render the pinned graphical tests once outside the repo and store their frames, with our fixture\'s matching frames, as goldens (the issue\'s Proof line).');
  }, TIMEOUT);
});
