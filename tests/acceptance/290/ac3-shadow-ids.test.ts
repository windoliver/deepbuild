// AC3 #290.a677630a: Shadow maps and the object-ID pass are byte for byte as at opacity 0, and a pick on the hidden
// sphere's pixels returns the wall; a planted pass that writes object IDs returns the sphere and fails
//
// The fixture is helpers.ts's sphere behind a wall with its lights casting: the sun's shadow in two cascades and a
// shadowed spot above the camera's left shoulder, so the frame reads three shadow maps of two kinds. One process
// draws four frames with `view3d`: the sphere at `hidden_view: {opacity: 0.4}` and at `{opacity: 0}`, each asked for
// its final, object-ID and `shadow` targets and five clicks; and the same two with the sphere's `cast_shadow` false,
// asked for the `shadow` target alone.
//
// What is read (README: The surface under test):
// - The object-ID pass: the frame's `ids` target, a PNG named by its SHA-256, and its `picks` table. Byte for byte is
//   the same name and the same table at 0.4 as at 0; and the target shows the wall at every pixel where the wall
//   covers the sphere (helpers.ts, `sphereRegions`: 10,178 pixels, by rays).
// - A pick: `view3d`'s `clicks` at five pixel centres at least 4 px inside that region, so the pick's whole window
//   lies where the wall hides the sphere. Each must answer `wall`.
// - Shadow maps: this suite's `shadow` target, the depth texels of every shadow map the frame reads in one file named
//   by its SHA-256. Byte for byte is the same name at 0.4 as at 0. The file must hold more than one depth (the maps
//   are drawn), and the maps with the sphere casting must differ from those where it doesn't (the sphere stands where
//   the maps reach), so a hidden view that wrote the sphere into a map would show at `cast_shadow: false`, where the
//   same comparison is made again.
// The comparisons aren't vacuous: the hidden view is drawn at 0.4 and not at 0, so the two final targets differ on
// the pixels where the wall covers the sphere.
//
// Wrong programs it fails: the merge base (`view3d` refuses the `shadow` target and draws no hidden view); a hidden
// view that draws into a cascade or a local map; `--planted hidden_view_writes_ids` (the blended draw also writes the
// item's object ID where it draws), under which each pick returns the sphere.
import { describe, expect, it } from 'vitest';
import { SHA, requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import {
  AC, HIDDEN_CLICKS, OPACITY, SIZE, TIMEOUT, changed, count, erode, finalOf, gpu, idsOf, refusals, shadowOf, shotsOf, sphereDoc, sphereRegions, strays, view3d,
  type JsonObject, type Shot,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const CLICKS = HIDDEN_CLICKS.map(([x, y]) => ({ frame: 0, at: [x + 0.5, y + 0.5] as [number, number] }));
const seen = (out: string, name: string, opacity: number): JsonObject =>
  view3d({ doc: writeJson(out, name, sphereDoc(name, { shadows: true, hidden: { opacity } })), size: SIZE, targets: ['final', 'ids', 'shadow'], clicks: CLICKS });
const maps = (out: string, name: string, opacity: number): JsonObject =>
  view3d({ doc: writeJson(out, name, sphereDoc(name, { shadows: true, casts: false, hidden: { opacity } })), size: SIZE, targets: ['shadow'] });

/** Each click's pick held to the wall; each failure names its pixel. */
function pickFailures(s: Shot): string[] {
  if (s.view.clicks.length !== HIDDEN_CLICKS.length) return [`the frame answers ${s.view.clicks.length} of the ${HIDDEN_CLICKS.length} clicks`];
  return HIDDEN_CLICKS.flatMap(([x, y], i) => {
    const pick = s.view.clicks[i]!.pick;
    return pick === 'wall' ? [] : [`pixel (${x}, ${y}), where the wall hides the sphere: the pick returns ${pick ?? 'nothing'}, not the wall`];
  });
}
const picksOf = (s: Shot): string => JSON.stringify([...(s.view.picks ?? new Map<number, string>())].sort((a, b) => a[0] - b[0]));

describe(`${AC[3]} the hidden view writes no shadow, no object ID and takes no pick`, () => {
  it(`${AC[3]} shadow maps and the object-ID pass are byte for byte as at opacity 0, and a pick on the hidden sphere's pixels returns the wall`, () => {
    requireMetal();
    const out = dir();
    const labels = ['the sphere at opacity 0.4', 'the sphere at opacity 0', 'the non-casting sphere at opacity 0.4', 'the non-casting sphere at opacity 0'];
    const run = gpu(bin(), out, [seen(out, 'casts-hidden', OPACITY), seen(out, 'casts-zero', 0), maps(out, 'still-hidden', OPACITY), maps(out, 'still-zero', 0)]);
    expect(refusals(run, labels), 'view3d draws the four frames with their `shadow` target (README: The surface under test)').toEqual([]);
    const [a, z, na, nz] = run.replies.map((r, i) => shotsOf(r, labels[i]!)[0]!);

    // The comparisons can fail: the hidden view is drawn at 0.4 and not at 0.
    const regions = sphereRegions();
    const moved = changed(finalOf(out, a!, labels[0]!), finalOf(out, z!, labels[1]!), regions.hidden);
    expect(moved, `the hidden view is drawn at 0.4 and not at 0: ${moved} of ${count(regions.hidden)} pixels where the wall covers the sphere differ by more than 2 codes, at least 99% must`).toBeGreaterThanOrEqual(0.99 * count(regions.hidden));

    // The object-ID pass.
    const ids = idsOf(out, a!, labels[0]!);
    expect([(ids.count.get('wall') ?? 0) >= 10_000, (ids.count.get('sphere') ?? 0) >= 5_000], `the fixture: the object-ID target shows the wall (${ids.count.get('wall') ?? 0} pixels) and the sphere beside it (${ids.count.get('sphere') ?? 0})`).toEqual([true, true]);
    expect(strays(regions.hidden, ids, 'wall', 'at opacity 0.4'), 'the object-ID target shows the wall wherever the wall covers the sphere').toEqual([]);
    expect({ ids: a!.view.ids, picks: picksOf(a!) }, 'the object-ID target and its table are byte for byte as at opacity 0').toEqual({ ids: z!.view.ids, picks: picksOf(z!) });

    // A pick through the occluder.
    const deep = erode(regions.hidden, SIZE, 4);
    expect(HIDDEN_CLICKS.filter(([x, y]) => !deep[y * SIZE[0] + x]), 'the fixture: each click lies at least 4 px inside the pixels where the wall covers the sphere').toEqual([]);
    expect(pickFailures(a!), 'a pick on the hidden sphere\'s pixels returns the wall').toEqual([]);

    // The shadow maps.
    const named = [a!, z!, na!, nz!].map((s) => s.shadow);
    expect(named.map((s) => typeof s === 'string' && SHA.test(s)), 'each frame names its `shadow` target by a SHA-256').toEqual([true, true, true, true]);
    const texels = shadowOf(out, a!, labels[0]!);
    expect([texels.bytes > 0, texels.bytes % 4, texels.flat], `the shadow target holds the maps the frame drew: ${texels.bytes} bytes of f32 depths, more than one value among them`).toEqual([true, 0, false]);
    expect(named[0], 'the fixture: the sphere stands where the shadow maps reach, so the maps differ when it casts and when it doesn\'t').not.toBe(named[2]);
    expect(named[0], 'the shadow maps are byte for byte as at opacity 0').toBe(named[1]);
    expect(named[2], 'with the sphere\'s cast_shadow false, the shadow maps are byte for byte as at opacity 0').toBe(named[3]);
  }, TIMEOUT);

  it(`${AC[3]} a planted pass that writes object IDs returns the sphere and fails`, () => {
    requireMetal();
    const out = dir();
    const run = gpu(bin(), out, [seen(out, 'casts-hidden', OPACITY)], 'hidden_view_writes_ids');
    expect(refusals(run, ['the sphere at opacity 0.4']), '--planted hidden_view_writes_ids draws the frame').toEqual([]);
    const failures = pickFailures(shotsOf(run.replies[0]!, 'the sphere at opacity 0.4')[0]!);
    expect(failures.length, 'the planted pass fails the pick check').toBeGreaterThan(0);
    expect(failures.filter((f) => !/^pixel \(\d+, \d+\).*the pick returns sphere\b/.test(f)), 'every failure names its pixel and the sphere the pick returned').toEqual([]);
  }, TIMEOUT);
});
