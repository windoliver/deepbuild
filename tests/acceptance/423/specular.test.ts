// AC1 #423.1611056a: With specular antialiasing, a glossy normal-mapped plane's mean luminance at one sample per
// pixel stays within 2% of a 16-sample reference on the same machine.
//
// A glossy plane (base color 0.5, roughness 0.2) carries a normal map made here: 256 × 256 texels of bumps 8 texels
// across (surface slopes up to 0.6), tiled every 0.5 m, so a pixel of the 480 × 360 frame spans about 2.5 texels and
// the bumps are finer than a pixel: the case specular antialiasing exists for. A sun sets its highlight on the plane.
// `view3d` draws it into the linear target twice in one run, under the same look with `samples: {live: 1}` and with
// `samples: {live: 16}` (Look `look@1`: samples); over the plane's pixels (the object-ID target's, 2 px in from its
// edge), the one-sample mean luminance is within 2% of the 16-sample mean. So the test can't pass on a renderer that
// ignores the map, the 16-sample plane with the map must differ from the same plane without it by over 5% on at least
// a tenth of those pixels.
// Wrong programs: the base (no normal maps); a map read without filtering or specular antialiasing, whose one sample
// lands on a bump's facet and sparkles; a renderer that drops the normal map.
import { describe, it } from 'vitest';
import {
  AC, encodePng, frame0, look, lum, material, none, perspective, readIds, readLinear, requireMetal, runGpu, sessionDoc, slab, sun, useDir, useGpu,
  view3dCall, writeAsset, writeJson,
  type Ids, type JsonObject, type Linear,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 360];
const N = 256;
const PERIOD = 8;
const SLOPE = 0.6;

/** The bump map: height A sin(2πx/P) sin(2πy/P) with A × 2π/P = SLOPE, as a tangent-space normal map. */
function bumps(): Buffer {
  const k = (2 * Math.PI) / PERIOD;
  return encodePng(N, N, (x, y) => {
    const dx = SLOPE * Math.cos(k * x) * Math.sin(k * y);
    const dy = SLOPE * Math.sin(k * x) * Math.cos(k * y);
    const l = Math.hypot(dx, dy, 1);
    return [Math.round(((-dx / l + 1) / 2) * 255), Math.round(((-dy / l + 1) / 2) * 255), Math.round(((1 / l + 1) / 2) * 255), 255];
  });
}
function planeDoc(normalMap: string | null): JsonObject {
  return sessionDoc(`glossy-${normalMap ? 'mapped' : 'flat'}`, SIZE, {
    cam: perspective([0, 1.5, 3], [0, 0, 0], 40),
    glossy: material({ base_color: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.2, ...(normalMap ? { normal_map: normalMap } : {}) }),
    floor: slab([6, 0.02, 6], { pos: [0, -0.02, 0] }, 'y', 0.5, { material: 'glossy' }),
    sun: sun(3, [-145, 0, 0]),
  });
}
/** The plane's pixels, 2 px in from every edge of it, in every render. */
function planePixels(ids: Ids[]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 2; y < SIZE[1] - 2; y++) for (let x = 2; x < SIZE[0] - 2; x++) {
    let inside = true;
    for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2 && inside; dx++) if (!ids.every((i) => i.at(x + dx, y + dy) === 'floor')) inside = false;
    if (inside) out.push([x, y]);
  }
  return out;
}
const mean = (t: Linear, px: [number, number][]): number => px.reduce((s, [x, y]) => s + lum(t.at(x, y)), 0) / px.length;

describe(`${AC[1]} specular antialiasing at one sample per pixel against a 16-sample reference`, () => {
  it(`${AC[1]} a glossy normal-mapped plane's mean luminance at one sample is within 2% of 16 samples, and the map visibly changes the plane`, () => {
    requireMetal();
    const out = dir();
    const map = writeAsset(out, 'bumps.png', bumps());
    const assets = { [map.sha]: map.path };
    const mapped = writeJson(out, 'mapped', planeDoc(map.sha));
    const flat = writeJson(out, 'flat', planeDoc(null));
    const one = look({ samples: { live: 1 } });
    const sixteen = look({ samples: { live: 16 } });
    const call = (doc: string, l: JsonObject): JsonObject => view3dCall({ doc, look: l, size: SIZE, targets: ['linear', 'ids'], assets });
    const { replies } = runGpu(bin(), out, [call(mapped, one), call(mapped, sixteen), call(flat, sixteen)]);
    const frames = replies.map((r, i) => frame0(r, ['mapped, 1 sample', 'mapped, 16 samples', 'flat, 16 samples'][i]!));
    const linear = frames.map((f, i) => readLinear(out, f, SIZE, `render ${i}: linear`));
    const px = planePixels(frames.map((f, i) => readIds(out, f, `render ${i}: ids`)));
    const problems: string[] = [];
    if (px.length < 20_000) problems.push(`the plane covers only ${px.length} px 2 px in from its edges; the fixture needs 20,000`);
    const [m1, m16] = [mean(linear[0]!, px), mean(linear[1]!, px)];
    const changed = px.filter(([x, y]) => { const a = lum(linear[1]!.at(x, y)); const b = lum(linear[2]!.at(x, y)); return Math.abs(a - b) > 0.05 * Math.max(b, 1e-4); }).length;
    console.log(`${AC[1]}: ${px.length} px; mean linear luminance ${m1.toFixed(5)} at 1 sample, ${m16.toFixed(5)} at 16 (${(((m1 - m16) / m16) * 100).toFixed(2)}%); the map changes ${changed} px by over 5%`);
    if (Math.abs(m1 - m16) > 0.02 * m16) problems.push(`the normal-mapped plane's mean luminance at 1 sample, ${m1.toFixed(5)}, is ${((Math.abs(m1 - m16) / m16) * 100).toFixed(2)}% off the 16-sample ${m16.toFixed(5)}: over 2%`);
    if (changed < 0.1 * px.length) problems.push(`the normal map changes only ${changed} of ${px.length} px by over 5%: the plane isn't drawn with its normal map`);
    none(problems, 'specular antialiasing');
  }, 1_800_000);
});
