// AC1 #424.599f5fc2: A shadow catcher composites over a 2D page with alpha equal to the light its shadow removes within
// 1%, and an inner shell with sort_bias draws before its outer shell at every camera angle in a cutaway fixture.
//
// The catcher (Material: shadow catcher, `catch: shadow`): a floor that catches, a 1 m box on it, two suns. The key
// sun, at 45° elevation, casts (shadow: true) with π√2 lx, so it gives the floor π lx; the fill sun, straight down,
// doesn't cast and gives 3π lx. In the key's shadow the box removes π of 4π: a quarter of the light, so the catcher
// writes black with alpha 0.25 there and 0 where both suns reach. The view is drawn over a flat 2D page of sRGB 200
// (`view3d`'s `window`, with no sky, so nothing but the catcher and the box is drawn over the page): in the shadow's
// core (0.15 m in from its edges) the window reads the page × 0.75 in linear light, and on the open floor the page
// itself, each within 2 codes (1% of the light at that level, README: Readings).
//
// The shells (Object: see-through order): `shellsDoc` and `SHELLS_CUT` (helpers): unlit blue outer shell (radius 1)
// and red inner shell (radius 0.5) at alpha 0.5, centred together, the outer cut by the view input x > 0.6, which
// never reaches the inner. The inner carries sort_bias 1 m; their IDs are such that a tie by ID would draw the outer
// first. At 12 orbit poses (every 30° of azimuth, 20° elevation), every pixel whose ray meets the uncut outer front and
// the inner front (and so do rays ±1.5 px away) reads the inner drawn first: 0.5 blue + 0.25 red, within 2 codes, on
// 99.5% of them, at each pose with at least 100 such pixels (seen from +X the cut opens the whole overlap); where the
// outer's front is cut away over the inner, the pixel is not that composite (the cutaway draws), at each pose with
// at least 50 such pixels; every pose has at least 500 pixels of one kind or the other. The same fixture with sort_bias 0 at the first pose must miss on most of those pixels: the check sees order.
// Wrong programs: a catcher that writes its own color, an opaque view background, alpha by luminance rather than the
// removed share; see-through order that ignores sort_bias; a cutaway that doesn't reach the outer shell.
import { describe, expect, it } from 'vitest';
import {
  AC, SHELLS, SHELLS_CUT, SHELLS_SIZE, add, box, camera, code8, codeOff, codes, decode8, hitSphere, material, only, px, rayAt, readPng,
  requireMetal, runGpu, scale, sessionDoc, shellsCam, shellsDoc, sun, useDir, useGpu, view3dCall, writeJson,
  type Image, type Pinhole, type Rgb, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

const SIZE: [number, number] = [400, 300];
const CAM: Pinhole = { position: [0, 6, -6], target: [0, 0, -0.8], fov: 50, size: SIZE };
const PAGE = 200;
const SHARE = 0.25;

function catcherDoc(): ReturnType<typeof sessionDoc> {
  return sessionDoc('catcher', SIZE, {
    cam: camera(CAM.position, CAM.target, CAM.fov),
    catch_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, catch: 'shadow' }),
    caster_mat: material({ base_color: [0.6, 0.2, 0.2, 1], roughness: 0.8 }),
    floor: box([8, 0.1, 8], [0, -0.05, 0], { material: 'catch_mat' }),
    caster: box([1, 1, 1], [0, 0.5, 0], { material: 'caster_mat' }),
    key: sun(Math.PI * Math.SQRT2, [-45, 0, 0], true),
    fill: sun(3 * Math.PI, [-90, 0, 0], false),
  });
}
/** Where pixel (x, y)'s centre ray meets the floor's top (y = 0), or null. */
function onFloor(x: number, y: number): V3 | null {
  const d = rayAt(CAM, x + 0.5, y + 0.5);
  if (d[1] >= 0) return null;
  const p = add(CAM.position, scale(d, -CAM.position[1] / d[1]));
  return Math.abs(p[0]) < 3.9 && Math.abs(p[2]) < 3.9 ? p : null;
}

function shellsProblems(final: Image, cam: Pinhole, label: string): { problems: string[]; judged: number; right: number } {
  const blue = SHELLS.blue; const red = SHELLS.red; const a = SHELLS.alpha;
  const both = codes([0, 1, 2].map((k) => a * blue[k]! + (1 - a) * (a * red[k]!)) as Rgb);
  const kind = (sx: number, sy: number): 'both' | 'cut' | 'other' => {
    const d = rayAt(cam, sx, sy);
    const outer = hitSphere(cam.position, d, [0, 0, 0], 1); const inner = hitSphere(cam.position, d, [0, 0, 0], 0.5);
    if (!outer || !inner) return 'other';
    if (outer[0] < SHELLS.cut - 0.02) return 'both';
    if (outer[0] > SHELLS.cut + 0.02) return 'cut';
    return 'other';
  };
  let judged = 0; let right = 0; let cut = 0; let cutDiffer = 0; let first = '';
  for (let y = 0; y < SHELLS_SIZE[1]; y++) for (let x = 0; x < SHELLS_SIZE[0]; x++) {
    const k = kind(x + 0.5, y + 0.5);
    if (k === 'other' || ![[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([dx, dy]) => kind(x + 0.5 + dx!, y + 0.5 + dy!) === k)) continue;
    const off = codeOff(px(final, x, y), both);
    if (k === 'both') { judged++; if (off <= 2) right++; else if (!first) first = `(${x}, ${y}) reads ${px(final, x, y).join(', ')}, the inner drawn first gives ${both.join(', ')}`; }
    else { cut++; if (off > 10) cutDiffer++; }
  }
  const problems: string[] = [];
  if (judged + cut < 500) problems.push(`${label}: only ${judged + cut} pixels see the inner shell through the outer (the fixture)`);
  if (judged >= 100 && right / judged < 0.995) problems.push(`${label}: ${judged - right} of ${judged} pixels where both shells overlap don't show the inner shell drawn before the outer within 2 codes; first ${first}`);
  if (cut >= 50 && cutDiffer / cut < 0.99) problems.push(`${label}: where the cutaway removes the outer shell over the inner, ${cut - cutDiffer} of ${cut} pixels still read as if the outer front were drawn`);
  return { problems, judged, right };
}

describe(`${AC[1]} a shadow catcher over a 2D page, and nested shells in a cutaway in see-through order`, () => {
  it(`${AC[1]} the catcher composites over the page with alpha 0.25, the share of light the box's shadow removes, and 0 on the open floor`, () => {
    requireMetal();
    const out = dir();
    const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'catcher', catcherDoc()), size: SIZE, targets: ['final'], window: { size: SIZE, view: [0, 0], page: [PAGE, PAGE, PAGE] } })]);
    const win = readPng(out, only(reply!, 'the catcher').window, 'the catcher over the page');
    expect([win.width, win.height], 'the window is the view\'s size').toEqual(SIZE);
    const shadowed = code8(decode8(PAGE) * (1 - SHARE));
    const failures: string[] = []; let core = 0; let open = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const p = onFloor(x, y);
      if (!p) continue;
      const inCore = Math.abs(p[0]) <= 0.35 && p[2] >= -1.35 && p[2] <= -0.65;
      const isOpen = Math.abs(p[0]) >= 0.8 && Math.abs(p[0]) <= 3 && p[2] <= -0.6 && p[2] >= -3;
      if (!inCore && !isOpen) continue;
      const want = inCore ? shadowed : PAGE;
      if (inCore) core++; else open++;
      const got = px(win, x, y);
      if (codeOff(got, [want, want, want]) > 2) failures.push(`(${x}, ${y}) on the ${inCore ? 'shadow\'s core' : 'open floor'} at x ${p[0].toFixed(2)} m, z ${p[2].toFixed(2)} m reads ${got.join(', ')}, the page under alpha ${inCore ? SHARE : 0} gives ${want}`);
    }
    console.log(`${AC[1]}: ${core} pixels in the shadow's core, ${open} on the open floor, ${failures.length} off`);
    expect(core, 'the shadow\'s core covers at least 800 pixels (the fixture)').toBeGreaterThanOrEqual(800);
    expect(open, 'the open floor covers at least 1,000 pixels (the fixture)').toBeGreaterThanOrEqual(1000);
    expect(failures, `the catcher over the page:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
  }, 1_800_000);

  it(`${AC[1]} the inner shell with sort_bias draws before its outer shell at each of 12 orbit poses with the outer cut away; without the bias it doesn't`, () => {
    requireMetal();
    const out = dir();
    const poses = Array.from({ length: 12 }, (_, k) => 30 * k);
    const calls = [...poses.map((az) => shellsDoc(az)), shellsDoc(0, 0)].map((d, i) =>
      view3dCall({ doc: writeJson(out, `shells-${i}`, d), size: SHELLS_SIZE, targets: ['final'], cutaway: SHELLS_CUT }));
    const replies = runGpu(bin(), out, calls);
    const problems: string[] = [];
    poses.forEach((az, i) => problems.push(...shellsProblems(readPng(out, only(replies[i]!, `azimuth ${az}°`).final, `azimuth ${az}°`), shellsCam(az), `azimuth ${az}°`).problems));
    expect(problems, `the shells in see-through order:\n  ${problems.join('\n  ')}`).toEqual([]);
    const control = shellsProblems(readPng(out, only(replies[12]!, 'sort_bias 0').final, 'sort_bias 0'), shellsCam(0), 'sort_bias 0');
    expect(control.right / control.judged, 'with sort_bias 0 the tie by ID draws the outer first, so most overlap pixels miss: the check sees order').toBeLessThan(0.5);
  }, 1_800_000);
});
