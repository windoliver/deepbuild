// AC9 #424.d0c14cb2: A half-section cutaway through a closed box under a sun at 45° lights the inner floor where the cut
// plane's projection along the sun says, within 2 shadow-map texels; moving the plane changes the shadow map's key; the
// cap shades as a matte surface facing along the plane's normal; a planted cutaway that clips only the color pass
// leaves the floor in the removed wall's shadow and fails, naming the pass.
//
// The fixture (`sectionDoc`, `sectionCut`, helpers): a closed room, inside 6 × 2 × 4 m with 0.2 m walls, roof and
// floor, under a casting sun at 45° elevation shining from +X; the view cutaway x > offset (shadows: cut) opens its +X
// half, capped in the look's sand role, seen from +X. Light reaches a floor point x0 along (1, 1, 0) ÷ √2, which leaves
// the room through the roof's underside at x0 + 2 m: the remaining roof (x < offset) shades it, so the floor is lit
// for x0 > offset − 2 m and dark short of it. With the linear and ID targets and `cascades` (whose report gives each
// shadow map's `key` and `texel_m`, README: Assumed surfaces), every floor pixel (1 px in, world x from −2.9 m to
// 0.1 m short of the plane) more than τ = 2 × the largest texel_m plus the pixel's own footprint past the boundary is
// lit (linear luminance over 0.3; lit reads 0.6) or dark (under 0.3; dark reads 0), at least 500 of each. The cap: on
// pixels whose rays (and rays ±1 px away) meet the plane inside the roof's and the side walls' cross-sections, the
// linear value is the sand role's linear color × 0.75 within 2% per channel: matte, lit as a surface facing +X
// (unlit would read × 1, a cap facing −X 0). The key: the same plane drawn again gives the same keys; the plane at
// −0.5 m gives different ones. No pixel shows `wall_px`, which the cut removes whole. `--planted cut_color_only`
// fails naming `scene3d.shadow`, the pass that still draws the removed geometry.
import { describe, expect, it } from 'vitest';
import {
  AC, SAND, SECTION, SECTION_SIZE, add, arr, decode8, failsNaming, lum, obj, only, rayAt, readIds, readLinear, runGpu, scale, sectionCut, sectionDoc,
  requireMetal, str, useDir, useGpu, view3dCall, within, writeJson, type GpuPlanted, type JsonObject, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const CAM = SECTION.cam;
const [W, H] = SECTION_SIZE;

/** The name of the reply's pass that writes `target`, as the reply lists its passes. */
function passWriting(reply: JsonObject, target: string, fallback: string): string {
  for (const p of arr(reply['passes'] ?? [], 'passes')) {
    const o = obj(p, 'a pass');
    if (arr(o['writes'] ?? [], 'a pass\'s writes').includes(target)) return str(o['name'], 'a pass\'s name');
  }
  return fallback;
}
function floorAt(sx: number, sy: number): V3 | null {
  const d = rayAt(CAM, sx, sy);
  return d[1] < 0 ? add(CAM.position, scale(d, -CAM.position[1] / d[1])) : null;
}
function planeAt(sx: number, sy: number, offset: number): V3 | null {
  const d = rayAt(CAM, sx, sy);
  return d[0] < 0 ? add(CAM.position, scale(d, (offset - CAM.position[0]) / d[0])) : null;
}
const onCap = (q: V3 | null): boolean => q !== null && (
  (q[1] > 2.03 && q[1] < 2.17 && Math.abs(q[2]) < 2.1) || (Math.abs(q[2]) > 2.03 && Math.abs(q[2]) < 2.17 && q[1] > 0.1 && q[1] < 1.9));

interface Section { problems: string[]; keys: string }
function check(out: string, reply: JsonObject, offset: number, label: string): Section {
  const f = only(reply, label);
  const lin = readLinear(out, f, SECTION_SIZE, label); const ids = readIds(out, f, label);
  const problems: string[] = [];
  const shadow = passWriting(reply, 'shadow', 'scene3d.shadow'); const geometry = passWriting(reply, 'ids', 'scene3d.geometry');
  if (!f.maps || f.maps.length === 0) return { problems: [`${label}: the frame reports no shadow maps (cascades.maps)`], keys: '' };
  const tau = 2 * Math.max(...f.maps.map((m) => m.texel_m));
  const boundary = offset - SECTION.H;
  let lit = 0; let dark = 0; let wrongLit = 0; let wrongDark = 0; let firstLit = ''; let firstDark = ''; let removed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (ids.at(x, y) === 'wall_px') removed++;
    if (!within(ids, x, y, 'floor', 1)) continue;
    const p = floorAt(x + 0.5, y + 0.5); const q = floorAt(x + 1.5, y + 0.5); const r = floorAt(x + 0.5, y + 1.5);
    if (!p || !q || !r || p[0] < -2.9 || p[0] > offset - 0.1 || Math.abs(p[2]) > 1.9) continue;
    const foot = Math.max(Math.hypot(q[0] - p[0], q[2] - p[2]), Math.hypot(r[0] - p[0], r[2] - p[2]));
    const l = lum(lin.at(x, y));
    if (p[0] > boundary + tau + foot) { lit++; if (l < 0.3) { wrongLit++; if (!firstLit) firstLit = `(${x}, ${y}) at x ${p[0].toFixed(3)} m reads ${l.toFixed(4)}`; } }
    else if (p[0] < boundary - tau - foot) { dark++; if (l >= 0.3) { wrongDark++; if (!firstDark) firstDark = `(${x}, ${y}) at x ${p[0].toFixed(3)} m reads ${l.toFixed(4)}`; } }
  }
  if (removed) problems.push(`${label}: the ${geometry} pass draws the removed wall_px on ${removed} pixels`);
  if (lit < 500 || dark < 500) problems.push(`${label}: ${lit} floor pixels to judge lit and ${dark} dark, not 500 of each (the fixture)`);
  if (wrongLit) problems.push(`${label}: ${wrongLit} of ${lit} floor pixels past x ${boundary.toFixed(2)} m + ${tau.toFixed(4)} m are dark where the cut opens the room to the sun: the ${shadow} pass still casts the removed geometry; first ${firstLit}`);
  if (wrongDark) problems.push(`${label}: ${wrongDark} of ${dark} floor pixels short of x ${boundary.toFixed(2)} m − ${tau.toFixed(4)} m are lit where the remaining roof shades them: the ${shadow} pass misses its casters; first ${firstDark}`);
  const cap = SAND.map((c) => 0.75 * decode8(c));
  let caps = 0; let capOff = 0; let firstCap = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => onCap(planeAt(x + 0.5 + dx!, y + 0.5 + dy!, offset)))) continue;
    caps++;
    const v = lin.at(x, y);
    if ([0, 1, 2].some((k) => Math.abs(v[k]! - cap[k]!) > 0.02 * cap[k]!)) { capOff++; if (!firstCap) firstCap = `(${x}, ${y}) reads [${v.map((c) => c.toFixed(4)).join(', ')}]`; }
  }
  if (caps < 50) problems.push(`${label}: only ${caps} cap pixels to judge (the fixture)`);
  if (capOff) problems.push(`${label}: ${capOff} of ${caps} cap pixels don't shade as sand lit facing +X ([${cap.map((c) => c.toFixed(4)).join(', ')}]) within 2%; first ${firstCap}`);
  return { problems, keys: f.maps.map((m) => m.key).join(',') };
}
function draw(out: string, offsets: number[], planted?: GpuPlanted): JsonObject[] {
  const doc = writeJson(out, 'section', sectionDoc());
  return runGpu(bin(), out, offsets.map((o) => view3dCall({ doc, size: SECTION_SIZE, targets: ['linear', 'ids'], cascades: true, cutaway: sectionCut(o) })), planted);
}

describe(`${AC[9]} light falls through a half-section cutaway`, () => {
  it(`${AC[9]} the floor is lit where the cut plane's projection along the sun says, within 2 shadow-map texels; the cap is matte sand facing +X; the shadow key moves with the plane`, () => {
    requireMetal();
    const out = dir();
    const [a, again, moved] = draw(out, [0, 0, -0.5]);
    const at0 = check(out, a!, 0, 'the plane at 0 m');
    const at05 = check(out, moved!, -0.5, 'the plane at −0.5 m');
    const problems = [...at0.problems, ...at05.problems];
    expect(problems, `the half-section:\n  ${problems.join('\n  ')}`).toEqual([]);
    expect(check(out, again!, 0, 'the plane at 0 m again').keys, 'the same plane gives the same shadow-map keys').toBe(at0.keys);
    expect(at05.keys, 'moving the plane changes the shadow map\'s key').not.toBe(at0.keys);
  }, 1_800_000);

  it(`${AC[9]} a planted cutaway that clips only the color pass leaves the floor in the removed wall's shadow and fails, naming the pass`, () => {
    requireMetal();
    const out = dir();
    const [a] = draw(out, [0], 'cut_color_only');
    failsNaming(check(out, a!, 0, 'the plane at 0 m, --planted cut_color_only').problems, ['scene3d.shadow'], '--planted cut_color_only');
  }, 1_800_000);
});
