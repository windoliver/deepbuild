// AC2 #223.48c2501c: "With plane unit 100 u and y up, `cmul(vec2(0, 1), z)` (times i) sends the screen point (100, 0) u
// to (0, −100) u, a quarter turn counterclockwise on screen; with `y: down` it lands at (0, 100) u, so the fixture tells
// the two apart; two lines crossing at (1, 1) still cross at 90° ± 0.5° under cexp"
//
// Times i: group `g` warps by `complex {f: "cmul(vec2(0, 1), z)"}` at mix 1 on a plane of unit 100 u, its origin left
// at the default (0, 0), once with `y: up` and once with `y: down`; its child `p` is the path M 100 0 L 150 0. Through
// `deep-canvas-render path`, the warped path's first point (the image of the screen point (100, 0)) lies at (0, −100)
// u with y up and at (0, 100) u with y down, each within 0.01 u, and the two differ by 200 u.
// The crossing: on a plane of origin (400, 300) u, unit 100, y up, `complex {f: "cexp(z)"}`; `h` runs along y = 1 from
// x = 0.8 to 1.2 and `v` along x = 1 from y = 0.8 to 1.2 (plane units). Their warped sub-paths (cubics at 64 steps)
// cross within 0.5 u of the image of (1, 1), e^(1 + i) on screen, and the two drawn directions there make 90° ± 0.5°.
// Wrong programs: the base (the warp isn't read: the point stays at (100, 0)); a plane read y down by default (times i
// lands at (0, 100) with y up); a map that ignores `y` (both fixtures land alike); a cexp read off the plane, or a
// non-conformal approximation of it, that bends the crossing or moves it.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, angleOf, cexp, crossing, dist, expectClean, figure, flatten, onScreen, firstFrames, pathItem, planeJson, short, toScreen, useBins,
  vertices, warpGroup, type Plane, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);

const timesI = (y: 'up' | 'down') => figure(`warp-times-i-${y}`, [800, 600], [
  warpGroup('g', { complex: { f: 'cmul(vec2(0, 1), z)' }, mix: 1, plane: { unit: 100, y } }),
  pathItem('p', 'a1', 'M 100 0 L 150 0', 2, {}, { parent: 'g' }),
]);

const CROSS_PLANE: Plane = { origin: [400, 300], unit: 100, y: 'up' };
const at = (x: number, y: number): Pt => toScreen(CROSS_PLANE, [x, y]);
const d = (a: Pt, b: Pt): string => `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;
const CROSS = figure('warp-cexp-crossing', [800, 600], [
  warpGroup('g', { complex: { f: 'cexp(z)' }, mix: 1, plane: planeJson(CROSS_PLANE) }),
  pathItem('h', 'a1', d(at(0.8, 1), at(1.2, 1)), 2, {}, { parent: 'g' }),
  pathItem('v', 'a2', d(at(1, 0.8), at(1, 1.2)), 2, {}, { parent: 'g' }),
]);

describe(`${AC[2]} the plane turns a complex map the way the formula says`, () => {
  it(`${AC[2]} times i sends (100, 0) u to (0, −100) u with y up and to (0, 100) u with y down`, () => {
    expectClean(bin('render'), timesI('up'), 'times i, y up');
    expectClean(bin('render'), timesI('down'), 'times i, y down');
    const [up, down] = firstFrames(bin('render'), [{ doc: timesI('up'), item: 'p' }, { doc: timesI('down'), item: 'p' }], 'times i');
    const first = (f: typeof up, what: string): Pt => { const v = vertices(f!.subpaths[0] ?? { closed: false, verbs: [], points: [] }); expect(v.length, `${what}: the path draws`).toBeGreaterThan(0); return v[0]!; };
    const u = first(up, 'y up'); const w = first(down, 'y down');
    expect(dist(u, [0, -100]), `with y up, times i sends (100, 0) u to (0, −100) u, a quarter turn counterclockwise on screen; it lands at (${u.map(short).join(', ')})`).toBeLessThanOrEqual(0.01);
    expect(dist(w, [0, 100]), `with y down, times i sends (100, 0) u to (0, 100) u; it lands at (${w.map(short).join(', ')})`).toBeLessThanOrEqual(0.01);
    expect(dist(u, w), 'the fixture tells y up from y down').toBeGreaterThan(199);
  }, TIMEOUT);

  it(`${AC[2]} two lines crossing at (1, 1) still cross at 90° ± 0.5° under cexp`, () => {
    expectClean(bin('render'), CROSS, 'the crossing under cexp');
    const [h, v] = firstFrames(bin('render'), [{ doc: CROSS, item: 'h' }, { doc: CROSS, item: 'v' }], 'the crossing under cexp');
    const c = crossing(flatten(h!.subpaths[0]!, 64), flatten(v!.subpaths[0]!, 64));
    expect(c, 'the two warped lines cross').not.toBeNull();
    const image = onScreen(CROSS_PLANE, cexp)(at(1, 1));
    expect(dist(c!.at, image), `they cross at e^(1 + i), (${image.map(short).join(', ')}) u, not at (${c!.at.map(short).join(', ')})`).toBeLessThanOrEqual(0.5);
    let angle = Math.abs(angleOf(c!.da) - angleOf(c!.db)) % 180;
    if (angle > 90) angle = 180 - angle;
    expect(Math.abs(angle - 90), `the warped lines cross at ${angle.toFixed(3)}°, not 90° ± 0.5°`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);
});
