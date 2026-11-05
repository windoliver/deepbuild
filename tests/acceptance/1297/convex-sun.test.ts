// AC1 #1297.d09869dd: A convex smooth-shaded mesh under a casting key sun draws as it does with the sun's shadow off.
// In the repro above (subdivided twice, and four times), every pixel of the final frame is within 4 codes of the same
// frame with `shadow: false`.
//
// The repro: an icosphere of radius 1 (midpoint subdivision renormalized to the unit sphere, 2 and 4 times) as a JSON
// glTF with positions and indices only, so the reader makes smooth normals; a `material@1` of base color
// (0.7, 0.5, 0.35) and roughness 0.6; a camera at (0, 0, 2.04) looking at the origin, fov 40°, 640 × 480; a
// `light.sun@1` of 3 lx at rot (−60, 25, 0), `shadow: true` against `shadow: false`; a filmic look at exposure 0.
// Each final frame is compared with its `shadow: false` twin, every pixel, R, G and B: none may differ by more than 4.
// So the comparison means something, each pair must show the sphere (95% of the frame in the object-ID target), lit
// (a quarter of the frame at code 32 or more), and the casting frame must have run the shadow pass (`scene3d.shadow` in
// the reply's passes and at least one shadow map in `cascades.maps`). A second test proves the comparison sees a
// shadow: with a box between the sun and the sphere's visible sunlit face, the pixels the box shadows (by a CPU ray
// cast, 3 px clear of the shadow's edge) differ from the `shadow: false` frame by more than 4 codes.
// Wrong programs: the base (hatched stripes on the triangles that graze the sun near the terminator); a renderer that
// ignores shadows or skips the shadow pass when a sun casts (the guard and the pass check); one that draws nothing or
// leaves the sphere unlit (the coverage and light checks).
import { describe, it } from 'vitest';
import {
  AC1, DEPTHS, SIZE, diff, frame0, guardShadow, interior, none, passNames, readFinal, readIds, reproDoc, requireMetal, runGpu,
  useDir, useGpu, view3dCall, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const PIXELS = SIZE[0] * SIZE[1];
const pct = (n: number): string => `${((100 * n) / PIXELS).toFixed(1)}%`;

/** The checks that make a pair of frames worth comparing: the sphere drawn and lit, the casting frame's shadow pass
 * run. Returns the problems and the two final frames. */
function pair(out: string, replies: [JsonObject, JsonObject], what: string): { problems: string[]; on: Uint8Array; off: Uint8Array } {
  const problems: string[] = [];
  const [onReply, offReply] = replies;
  const fOn = frame0(onReply, `${what} with shadow: true`);
  const fOff = frame0(offReply, `${what} with shadow: false`);
  const passes = passNames(onReply, `${what} with shadow: true`);
  if (!passes.includes('scene3d.shadow')) problems.push(`${what} with shadow: true: the reply's passes (${passes.join(', ')}) hold no scene3d.shadow, so the sun's shadow pass didn't run`);
  if (!fOn.maps) problems.push(`${what} with shadow: true: frame 0 reports no cascades.maps`);
  else if (fOn.maps < 1) problems.push(`${what} with shadow: true: frame 0 reports no shadow map in cascades.maps, so the sun drew no shadow`);
  const on = readFinal(out, fOn, `${what} with shadow: true: final`);
  const off = readFinal(out, fOff, `${what} with shadow: false: final`);
  for (const [f, label] of [[fOn, 'true'], [fOff, 'false']] as const) {
    const ids = readIds(out, f, `${what} with shadow: ${label}: ids`);
    let sphere = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (ids(x, y) === 'sphere') sphere++;
    if (sphere < 0.95 * PIXELS) problems.push(`${what} with shadow: ${label}: the sphere covers ${pct(sphere)} of the frame in the object-ID target, under the 95% the repro's camera puts it at`);
  }
  let lit = 0;
  for (let i = 0; i < PIXELS; i++) if (Math.max(off[i * 4]!, off[i * 4 + 1]!, off[i * 4 + 2]!) >= 32) lit++;
  if (lit < 0.25 * PIXELS) problems.push(`${what} with shadow: false: only ${pct(lit)} of the frame reads code 32 or more, under a quarter: the sun doesn't light the sphere, so the comparison can't see a shadow`);
  return { problems, on, off };
}

describe(`${AC1} a convex smooth-shaded mesh under a casting key sun draws as with the shadow off`, () => {
  it(`${AC1} the repro's icosphere, subdivided twice and four times: every pixel of the final frame is within 4 codes of the same frame with shadow: false`, () => {
    requireMetal();
    const out = dir();
    const calls: JsonObject[] = [];
    for (const depth of DEPTHS) for (const shadow of [true, false]) { const r = reproDoc(out, depth, shadow); calls.push(view3dCall(r.doc, r.assets)); }
    const replies = runGpu(bin(), out, calls);
    const problems: string[] = [];
    for (const [k, depth] of DEPTHS.entries()) {
      const what = `the icosphere subdivided ${depth} times`;
      const p = pair(out, [replies[2 * k]!, replies[2 * k + 1]!], what);
      problems.push(...p.problems);
      if (p.problems.length > 0) continue;
      const d = diff(p.on, p.off, 4);
      const over2 = d.codes.reduce((n, c) => n + (c > 2 ? 1 : 0), 0);
      if (d.over > 0) {
        problems.push(`${what}: ${d.over} px of the final frame differ from the shadow: false frame by more than 4 codes (${over2} by more than 2), ${d.max} codes at most, at (${d.at![0]}, ${d.at![1]}): the sun's shadow darkens the convex sphere's own sunlit side`);
      }
    }
    none(problems, 'the convex sphere under the casting sun against the same frame with shadow: false');
  }, 3_600_000);

  it(`${AC1} guard: the comparison sees a shadow; a box between the sun and the sphere darkens the pixels it shadows by more than 4 codes`, () => {
    requireMetal();
    const out = dir();
    const depth = DEPTHS[0];
    const on = reproDoc(out, depth, true, true); const off = reproDoc(out, depth, false, true);
    const replies = runGpu(bin(), out, [view3dCall(on.doc, on.assets), view3dCall(off.doc, off.assets)]);
    const what = `the icosphere subdivided ${depth} times with the box between it and the sun`;
    const p = pair(out, [replies[0]!, replies[1]!], what);
    none(p.problems, what);
    const shadowed = interior(guardShadow(depth), 1, 3);
    const problems: string[] = [];
    if (shadowed.length < 5000) problems.push(`${what}: only ${shadowed.length} px lie in the box's shadow 3 px clear of its edge, under the 5,000 the guard is judged on`);
    const d = diff(p.on, p.off, 4);
    const dark = shadowed.filter((i) => d.codes[i]! > 4).length;
    if (dark < 0.95 * shadowed.length) {
      problems.push(`${what}: of the ${shadowed.length} px the box shadows, only ${dark} differ from the shadow: false frame by more than 4 codes, under 95%: the casting sun's shadow doesn't land where its caster puts it, so the comparison above proves nothing`);
    }
    none(problems, what);
  }, 3_600_000);
});
