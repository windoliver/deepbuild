// AC9 #424.d0c14cb2: A half-section cutaway through a closed box under a sun at 45° lights the inner floor where the
// cut plane's projection along the sun says, within 2 shadow-map texels; moving the plane changes the shadow map's
// key; the cap shades as a matte surface facing along the plane's normal; a planted cutaway that clips only the color
// pass leaves the floor in the removed wall's shadow and fails, naming the pass.
//
// A closed box of six white Lambertian slabs (cavity 5 × 4 × 1.2 m, walls 0.3 m) under a key sun of 100 lx at 45°
// elevation from azimuth 45° (toward-sun (0.5, 0.707, 0.5)), the only light (black sky, no ambient), one cascade out
// to 12 m. A view-input cutaway@1 with one plane, normal +z, removes the box's front half (offset 0), then the plane
// moves 0.4 m back (offset −0.4). Light enters through the cut; the roof's cut edge (y = 1.2, z = offset) projected
// along the sun puts the floor's shadow line at z = offset − 0.849. Each floor pixel (by #378's pinhole and a CPU ray
// cast through the cut box, 2 px clear of other surfaces, away from the side wall's shadow) more than 2 texels of the
// reported map (`texel_m`) from that line, measured across the light in the map's plane, reads sunlit (E·(n·l)/π =
// 22.51 within 5%) on the opening's side and dark (under 5% of it) beyond; the ID target names the floor there. The
// cap reads a matte surface of the cap role's grey (#bcbcbc, linear 0.5029) facing +z: E × 0.5029 × 0.5 ÷ π = 8.004
// within 2%. The same plane gives the same map key twice; the moved plane gives another.
// `--planted cut_color_only` (planes clip the geometry pass, not the shadow pass): the floor shows in the ID target
// but stays dark where it should be sunlit, so the check fails naming `scene3d.shadow`, and not `scene3d.geometry`.
// Wrong programs: the base (no cutaway: the front wall hides the floor, named as scene3d.geometry; no `maps`); shadows
// not cut; shadows cut by a plane in the wrong place or by the stale plane; a cap left unlit (flat), shaded with the
// slab's top or the view's normal, glossy, or missing; a map key without the planes, or one that changes on every call.
import { describe, it } from 'vitest';
import {
  AC9, CAP_LIT, FLOOR_LIT, MIN_CAP, MIN_DARK, MIN_LIT, OFFSETS, PLAIN_LOOK, SIZE, boxDoc, cutaway, failsNaming, frame0, judged, none,
  passWriting, readIds, readLinear, requireMetal, runGpu, shadowLine, useDir, useGpu, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const fx = (v: number): string => v.toFixed(3);

function calls(doc: string, offsets: readonly number[], targets: ('linear' | 'ids')[]): JsonObject[] {
  return offsets.map((offset) => view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, frames: 1, capture: [0], targets, cascades: true, cutaway: cutaway(offset) }));
}

/** Failures collected per kind: a count and the first three pixels. */
class Tally {
  private readonly seen = new Map<string, { n: number; first: string[] }>();
  add(kind: string, pixel: string): void {
    const t = this.seen.get(kind) ?? { n: 0, first: [] };
    t.n++; if (t.first.length < 3) t.first.push(pixel);
    this.seen.set(kind, t);
  }
  lines(of: number): string[] { return [...this.seen].map(([kind, t]) => `${kind}: ${t.n} of ${of} px, first ${t.first.join('; ')}`); }
}

/** The floor and cap at each plane position, as the criterion reads them. */
function sectionProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'box', boxDoc());
  const replies = runGpu(bin(), out, calls(doc, OFFSETS, ['linear', 'ids']), planted);
  const problems: string[] = [];
  for (const [i, offset] of OFFSETS.entries()) {
    const what = `the plane at offset ${offset} m`;
    const reply = replies[i]!;
    const f = frame0(reply, what);
    const shadowPass = passWriting(reply, 'shadow', what);
    const geometryPass = passWriting(reply, 'ids', what);
    if (shadowPass !== 'scene3d.shadow') problems.push(`${what}: the pass that writes shadow is ${shadowPass ?? 'missing'}, not scene3d.shadow`);
    if (geometryPass !== 'scene3d.geometry') problems.push(`${what}: the pass that writes ids is ${geometryPass ?? 'missing'}, not scene3d.geometry`);
    if (!f.maps || f.maps.length === 0) { problems.push(`${what}: frame 0 reports no shadow map in cascades.maps, so no texel to judge by`); continue; }
    const texel = Math.max(...f.maps.map((m) => m.texel_m));
    if (!(texel > 0)) { problems.push(`${what}: the shadow map's texel_m is ${texel}, not a size`); continue; }
    const band = 2 * texel;
    const j = judged(offset, band);
    const counts: [string, number, number][] = [['sunlit floor', j.lit.length, MIN_LIT], ['shadowed floor', j.dark.length, MIN_DARK], ['cap', j.cap.length, MIN_CAP]];
    for (const [name, n, min] of counts) {
      if (n < min) problems.push(`${what}: only ${n} ${name} px lie outside 2 texels (${fx(band)} m) of the shadow line, under the ${min} the criterion is judged on: the map's texel of ${texel} m is too coarse for this box`);
    }
    const linear = readLinear(out, f.linear, `${what}: linear`);
    const ids = readIds(out, f, `${what}: ids`);
    const floor = new Tally();
    const sh = shadowPass ?? 'the shadow pass';
    for (const [x, y, p] of j.lit) {
      const id = ids(x, y); const v = lum(linear.at(x, y)); const at = `(${x}, ${y}) at z ${fx(p[2])} reads ${fx(v)}`;
      if (id !== 'floor') floor.add(`${geometryPass ?? 'the geometry pass'} draws ${id ?? 'nothing'} where the cut opens the inner floor to view`, `(${x}, ${y}) at z ${fx(p[2])}`);
      else if (v < 0.5 * FLOOR_LIT) floor.add(`the inner floor lies in shadow on the sunlit side of the cut edge's projection (z ${fx(shadowLine(offset))}), so the removed geometry still casts in ${sh}`, at);
      else if (Math.abs(v - FLOOR_LIT) > 0.05 * FLOOR_LIT) floor.add(`the inner floor's sunlit side is not the sun's ${fx(FLOOR_LIT)} within 5%`, at);
    }
    for (const [x, y, p] of j.dark) {
      const id = ids(x, y); const v = lum(linear.at(x, y)); const at = `(${x}, ${y}) at z ${fx(p[2])} reads ${fx(v)}`;
      if (id !== 'floor') floor.add(`${geometryPass ?? 'the geometry pass'} draws ${id ?? 'nothing'} where the cut opens the inner floor to view`, `(${x}, ${y}) at z ${fx(p[2])}`);
      else if (v > 0.05 * FLOOR_LIT) floor.add(`the inner floor is lit beyond the cut edge's projection (z ${fx(shadowLine(offset))}), where the kept roof shadows it in ${sh}`, at);
    }
    problems.push(...floor.lines(j.lit.length + j.dark.length).map((l) => `${what}: ${l}`));
    const cap = new Tally();
    for (const [x, y, id] of j.cap) {
      const v = lum(linear.at(x, y));
      if (Math.abs(v - CAP_LIT) > 0.02 * CAP_LIT) cap.add(`the cap is not a matte surface of its role facing along the plane's normal (${fx(CAP_LIT)} within 2%)`, `(${x}, ${y}) on ${id}'s cut reads ${fx(v)}`);
    }
    problems.push(...cap.lines(j.cap.length).map((l) => `${what}: ${l}`));
  }
  return problems;
}

describe(`${AC9} a half-section cutaway lights the inner floor and caps the cut`, () => {
  it(`${AC9} the inner floor is sunlit where the cut edge's projection along the sun says, within 2 shadow-map texels, at both plane positions; the cap shades as a matte surface facing along the plane's normal; the planted cut_color_only leaves the floor in shadow and fails, naming scene3d.shadow`, () => {
    requireMetal();
    none(sectionProblems(), 'the cut box');
    const planted = sectionProblems('cut_color_only').filter((p) => p.includes('the inner floor'));
    failsNaming(planted, ['scene3d.shadow'], 'the planted cut_color_only');
    none(planted.filter((p) => p.includes('scene3d.geometry')), 'the planted cut_color_only clips the geometry pass, so no floor failure names scene3d.geometry');
  }, 3_600_000);

  it(`${AC9} moving the plane changes the shadow map's key, and the same plane keeps it`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'box', boxDoc());
    const offsets = [OFFSETS[0], OFFSETS[0], OFFSETS[1]];
    const replies = runGpu(bin(), out, calls(doc, offsets, ['linear']));
    const keys = replies.map((r, i) => {
      const what = `the plane at offset ${offsets[i]} m (call ${i})`;
      const f = frame0(r, what);
      const maps = f.maps ?? [];
      // The key sun draws one cascade, so one shadow map.
      return maps.length === 1 ? maps[0]!.key : `${what}: ${maps.length} shadow maps reported, not the one cascade`;
    });
    const problems: string[] = [];
    for (const k of keys) if (k.includes('shadow maps reported')) problems.push(k);
    if (problems.length === 0) {
      if (keys[0] !== keys[1]) problems.push(`the same plane gives two keys (${keys[0]}, ${keys[1]}): the key is not a cache key of what the map reads`);
      if (keys[2] === keys[0]) problems.push(`moving the plane from ${OFFSETS[0]} m to ${OFFSETS[1]} m keeps the shadow map's key ${keys[0]}: the key leaves out the planes that reach its casters`);
    }
    none(problems, 'the shadow map keys');
  }, 3_600_000);
});
