// AC4 #1401.83ac6241: A moving item probed at t = 2 s and at an earlier `rev` matches the evaluated position at that t
// and `rev`, not the current one.
//
// The fixture: one shared document, stored at revision 0 in test agent alpha's layer, over a black sky: `cam` at
// (0, 0, 24) looking down −z at the origin (fov 30°, 320 × 240 px), and `mover`, an opaque `mark.box@1` of 2 m. A
// channel moves it along the view axis: `items/mover/at/pos/2`, f32, linear from −6 m at 0 s to 6 m at 4 s, so its
// centre is at z = −6 + 3t and at 2 s at z = 0. Alpha's patches move it sideways: its `at/pos/0` is −3 m at revision
// 0, 0 m at revision 1 (the patch on base 0) and 3 m at revision 2 (the patch on base 1), which is current when the
// render-back runs at 1 s on the clock. So at 2 s and revision 1 its front face is the square z = 1, |x|, |y| ≤ 1.
//
// One render-back by alpha at t = 2 s (1,411,200,000 flicks) of revision 1 from the document's camera, with 6 probes:
// 3 on that front face, each at least 0.4 m inside its edges, which must each answer exactly one hit naming `mover`
// within 1e-5 m of where its ray meets z = 1; and 3 just past its edges (0.4 m out), whose rays meet nothing there,
// which must each answer `hits: []`. The mover's pose at the current revision (x = 3), at revision 0 (x = −3), at 0 s
// (z = −6), at the clock's 1 s (z = −3) or at the end key (z = 6) answers at least one probe differently (checked
// here): another item in its place, a point metres off, or a hit where none should be.
import { describe, expect, it } from 'vitest';
import {
  AC4, ALPHA, DARK_SKY, DOC, FLICKS, boxHits, boxItem, cameraItem, dist, hitLists, listFailures, patchAt, pixelOf, probeRay, proof, renderBack,
  requireMetal, runShow, scenario, sceneDoc, slot, ulid, unlit, useDir, useShow, type Box, type JsonObject, type Pinhole, type Pixel, type V3, type Want,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();

const SIZE: [number, number] = [320, 240];
const BOUND = 1e-5;
const CAM: Pinhole = { position: [0, 0, 24], target: [0, 0, 0], fov: 30, size: SIZE };
const T = 2 * FLICKS;
const REV = 1;
const CURRENT = 2;
/** The mover's x at each revision, and its z at t seconds. */
const X_AT_REV = [-3, 0, 3];
const zAt = (seconds: number): number => -6 + 3 * Math.min(Math.max(seconds, 0), 4);
const mover = (rev: number, seconds: number): Box => ({ id: 'mover', centre: [X_AT_REV[rev]!, 0, zAt(seconds)], size: [2, 2, 2] });

const DOCUMENT = sceneDoc('A box the channel moves and the patches shift', 'cam', {
  cam: cameraItem(CAM.position, CAM.target, CAM.fov, 0.5, 200), sky: DARK_SKY, mover_mat: unlit([0.8, 0.35, 0.1]),
  mover: boxItem([X_AT_REV[0]!, 0, 0], [2, 2, 2], 'mover_mat'),
}, {
  requires: { modules: { scene3d: '^1', motion: '^1' } },
  channels: { 'mover-z': { target: 'items/mover/at/pos/2', type: 'f32', keys: { k0: { t: '0s', value: -6, interp: 'linear' }, k1: { t: '4s', value: 6, interp: 'linear' } } } },
});

/** Alpha's patch on base `k − 1`: the mover's x to its value at revision k. */
const shiftPatch = (k: number): JsonObject => ({
  call: 'deep_show', session: ALPHA.id, doc: DOC, at: patchAt(k),
  patch: { patch: ulid('01JB1401P', k), doc: DOC, base: k - 1, reason: 'shift the mover', ops: [{ op: 'set', id: 'mover', path: 'items/mover/at/pos/0', value: X_AT_REV[k]! }] },
});

interface Probe { px: Pixel; label: string; want: Want[] }
const AT = mover(REV, 2);
const ON: [number, number][] = [[0, 0], [-0.6, 0.6], [0.6, -0.6]];
const OFF: [number, number][] = [[1.4, 0], [-1.4, 0], [0, 1.4]];
/** The 6 probes: 3 on the mover's front face at 2 s and revision 1, 3 just past its edges; each with its analytic hits. */
const PROBES: Probe[] = [...ON.map((o) => ['on', o] as const), ...OFF.map((o) => ['just past', o] as const)].map(([kind, [x, y]]) => {
  const px = pixelOf(CAM, [AT.centre[0] + x, AT.centre[1] + y, AT.centre[2] + 1]);
  return { px, label: `${kind} the mover's front face at (${x}, ${y}) from its centre, pixel (${px[0]}, ${px[1]})`, want: boxHits(CAM.position, probeRay(CAM, px), [AT]) };
});
/** What the probes would answer with the mover at revision `rev` and `seconds`. */
const wouldAnswer = (rev: number, seconds: number): Want[][] => PROBES.map((p) => boxHits(CAM.position, probeRay(CAM, p.px), [mover(rev, seconds)]));
/** Whether two answers to the probes differ by a hit or by more than 1 mm. */
const differ = (a: Want[][], b: Want[][]): boolean =>
  a.some((x, i) => x.length !== b[i]!.length || x.some((w, j) => w.item !== b[i]![j]!.item || dist(w.point, b[i]![j]!.point) > 1e-3));

describe(`${AC4} a probe reads the requested revision and time`, () => {
  it(`${AC4} a moving item probed at t = 2 s and at an earlier rev matches the evaluated position at that t and rev, not the current one`, () => {
    requireMetal();
    // The fixture: the 3 face probes meet the mover's front face (z = 1) and the 3 others nothing; and every other pose
    // of the mover answers differently.
    PROBES.slice(0, 3).forEach((p) => {
      expect(p.want.map((w) => w.item), `the fixture: ${p.label} meets the mover`).toEqual(['mover']);
      expect(Math.abs(p.want[0]!.point[2] - 1), `the fixture: ${p.label} meets its front face, z = 1`).toBeLessThan(1e-12);
    });
    PROBES.slice(3).forEach((p) => expect(p.want, `the fixture: ${p.label} meets nothing`).toEqual([]));
    const truth = PROBES.map((p) => p.want);
    const others: [string, number, number][] = [['the current revision at 2 s', CURRENT, 2], ['revision 0 at 2 s', 0, 2], ['revision 1 at 0 s', REV, 0], ['revision 1 at the clock\'s 1 s', REV, 1], ['revision 1 at 4 s', REV, 4]];
    for (const [what, rev, s] of others) expect(differ(wouldAnswer(rev, s), truth), `the fixture: the mover at ${what} answers some probe differently`).toBe(true);

    const calls = [shiftPatch(1), shiftPatch(2), renderBack(slot(0), { t: T, rev: REV, probes: PROBES.map((p) => p.px) })];
    expect(slot(0), 'the fixture: the render-back runs at 1 s on the clock, not at 2 s').toBe(FLICKS);
    const replies = runShow(bin(), scenario(dir(), DOCUMENT, calls), 'the mover at revision 1 and 2 s, revision 2 current');
    const lists = hitLists(replies[2]!, PROBES.length, 'render-back at 2 s of revision 1');
    proof('AC4 hits at t = 2 s, revision 1, revision 2 current', PROBES.map((p, i) => ({ probe: p.px, hits: lists[i] ?? null, analytic: p.want.map((w) => w.point as V3) })));
    const failures = PROBES.flatMap((p, i) => listFailures(p.label, lists[i]!, p.want, BOUND));
    expect(failures, 'each probe answers where the mover is at 2 s and revision 1: its front face at z = 1 under the face probes, nothing past its edges').toEqual([]);
  }, 1_800_000);
});
