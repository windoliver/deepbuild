// AC3 #223.9d800d51: "`linear {matrix: [[0, −1], [1, 0]]}` at mix 0.5 maps (1, 0) to (0.5, 0.5) within 1e-9, while the
// same turn as an `at.rot` key reads (0.7071, 0.7071); `[[2, 1], [1, 1]]` at mix 0.5 maps (1, 0) to (1.5, 0.5)"
//
// Group `g` on the plane of origin (400, 300) u, unit 100 u, y up, warps by `linear {matrix}` at `mix: 0.5`; its child
// `p` is the path M 500 300 L 550 300, whose first point is the plane's (1, 0). Through `deep-canvas-render path`, the
// warped first point read back in the plane is (0.5, 0.5) within 1e-9 for the quarter turn [[0, −1], [1, 0]] (rows:
// x' = 0·x − 1·y, y' = 1·x + 0·y), and (1.5, 0.5) within 1e-9 for [[2, 1], [1, 1]]: (1 − u)I + uM at u = 0.5.
// The same turn as a key: `turn`, the path M 0 0 L 100 0 at (400, 300), its `at/rot/2` keyed linearly from 0 to 90 over
// 1 s; at 0.5 s its end, less its start, over 100 u, reads (±0.7071, ±0.7071) within 1e-4 and has length 1 within
// 1e-4: the key turns rigidly, where the matrix's mix passes through the half-size 45° matrix. (Which way `at.rot`
// turns on screen isn't this criterion's; the signs are left to it, the size is not.)
// Wrong programs: the base (the warp isn't read: (1, 0) stays); a matrix read by columns ((0.5, −0.5)); a mix that
// interpolates the turn's angle (a rotation by 45°, (0.7071, 0.7071)); a mix applied to the points' images some other
// way that moves (1, 0) off the straight path from (1, 0) to M(1, 0).
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, PLANE, TIMEOUT, dist, expectClean, figure, keyed, firstFrames, pathItem, planeJson, short, toPlane, useBins, vertices, warpGroup, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);

const linear = (name: string, matrix: number[][]) => figure(`warp-linear-${name}`, [800, 600], [
  warpGroup('g', { linear: { matrix }, mix: 0.5, plane: planeJson(PLANE) }),
  pathItem('p', 'a1', 'M 500 300 L 550 300', 2, {}, { parent: 'g' }),
]);
const QUARTER = linear('quarter', [[0, -1], [1, 0]]);
const SKEW = linear('skew', [[2, 1], [1, 1]]);
const KEYED = figure('warp-turn-key', [800, 600], [pathItem('turn', 'a0', 'M 0 0 L 100 0', 2, {}, { at: { pos: [400, 300, 0] } })], {
  transport: { span: '1s' }, channels: { turn: keyed('items/turn/at/rot/2', [[0, 0], [1, 90]]) },
});

describe(`${AC[3]} a linear warp mixes the matrix itself; an at.rot key turns rigidly`, () => {
  it(`${AC[3]} [[0, −1], [1, 0]] at mix 0.5 maps (1, 0) to (0.5, 0.5) within 1e-9; [[2, 1], [1, 1]] at mix 0.5 maps it to (1.5, 0.5); the same turn as an at.rot key reads (0.7071, 0.7071)`, () => {
    for (const [doc, what] of [[QUARTER, 'the quarter turn'], [SKEW, '[[2, 1], [1, 1]]'], [KEYED, 'the at.rot key']] as const) expectClean(bin('render'), doc, what);
    const half = Math.round(FLICKS / 2);
    const [q, s, k] = firstFrames(bin('render'), [{ doc: QUARTER, item: 'p' }, { doc: SKEW, item: 'p' }, { doc: KEYED, item: 'turn', times: [half] }], 'the linear warps and the key');
    const firstIn = (f: typeof q, what: string): Pt => { const v = vertices(f!.subpaths[0] ?? { closed: false, verbs: [], points: [] }); expect(v.length, `${what}: the path draws`).toBeGreaterThan(1); return toPlane(PLANE, v[0]!); };
    const a = firstIn(q, 'the quarter turn');
    expect(dist(a, [0.5, 0.5]), `[[0, −1], [1, 0]] at mix 0.5 maps (1, 0) to (0.5, 0.5) within 1e-9; it gives (${a.map(short).join(', ')})`).toBeLessThanOrEqual(1e-9);
    const b = firstIn(s, '[[2, 1], [1, 1]]');
    expect(dist(b, [1.5, 0.5]), `[[2, 1], [1, 1]] at mix 0.5 maps (1, 0) to (1.5, 0.5); it gives (${b.map(short).join(', ')})`).toBeLessThanOrEqual(1e-9);
    const kv = vertices(k!.subpaths[0] ?? { closed: false, verbs: [], points: [] });
    expect(kv.length, 'the keyed path draws').toBeGreaterThan(1);
    const r: Pt = [(kv[1]![0] - kv[0]![0]) / 100, (kv[1]![1] - kv[0]![1]) / 100];
    expect(Math.abs(Math.abs(r[0]) - Math.SQRT1_2), `the at.rot key at its midpoint reads (0.7071, 0.7071) in size; x reads ${short(r[0])}`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(Math.abs(r[1]) - Math.SQRT1_2), `the at.rot key at its midpoint reads (0.7071, 0.7071) in size; y reads ${short(r[1])}`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(Math.hypot(r[0], r[1]) - 1), 'the at.rot key turns rigidly: (1, 0) keeps length 1').toBeLessThanOrEqual(1e-4);
  }, TIMEOUT);
});
