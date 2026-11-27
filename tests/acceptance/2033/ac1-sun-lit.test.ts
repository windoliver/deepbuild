// AC1 #2033.572c2d31: Under the sun at every elevation and in every cascade, each pixel of the plane, the spheres and
// the box that the CPU rays call lit, that lies 0.25 m or more from a shadow edge, and whose face normal and smooth
// normal both face the sun by 10° or more, is within 4 code values (drafted) of the same frame with `shadow: false` on
// the sun. A planted lookup with no bias fails, naming the elevation and the cascade.
//
// The sun fixture (helpers: SUN_PARTS) at 640 × 480 under a 3 lx key sun from azimuth 20°, at each elevation 15° to 75°
// in 10° steps, with the whole fixture placed inside each of 4 cascades in turn (helpers: sunPlacement). Each casting
// frame is compared with the same frame with `shadow: false` on the sun, R, G and B of the final target. The judged
// pixels come from the CPU rays alone (helpers: classify, LIT): the pixel's centre and four corners meet one of the
// plane, the spheres or the box, each point unoccluded toward the sun and facing it by 10° or more by its face and
// smooth normals, and every sample of the 0.25 m disk about the centre sees the sun too. None may differ by more than 4.
// So the comparison means something, each pair must: be drawn where the rays put the fixture (the object-ID target),
// have drawn its shadow maps (scene3d.shadow and four cascades), place the fixture inside the cascade it names (the
// frame's reported splits), show 2,000 or more judged pixels, three quarters of them at code 16 or more with the shadow
// off, and darken by more than 4 codes 90% of the pixels the rays call occluded 0.25 m or more inside a shadow.
// Wrong programs: the planted `no-bias` twin (acne across lit faces; fails naming elevation and cascade); a renderer
// that draws no shadow (the occluded-pixels guard and the pass check); one that draws nothing or leaves the fixture
// unlit (coverage and lit checks); a fixture outside the cascade it names (the splits check).
import { describe, it } from 'vitest';
import {
  AC1, CASCADES, DARK, ELEVATIONS, LIT, SUN_PARTS, brightest, cascadeOf, classify, fixtureDoc, none, pixelsOf, readPair, requireHardware,
  requireReference, runGpu, sunLight, sunPlacement, useDir, useGpu, view3dCall, worst, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC1} sun-lit pixels match the frame with the sun's shadow off`, () => {
  it(`${AC1} at every elevation 15°–75° and with the fixture in each of 4 cascades, every lit pixel 0.25 m from a shadow edge and facing the sun by 10° is within 4 codes of shadow: false`, (ctx) => {
    requireReference(ctx.skip);
    const out = dir();
    requireHardware(bin(), out);
    const problems: string[] = [];
    const rows: string[] = [];
    for (const e of ELEVATIONS) {
      const placed = CASCADES.map((i) => sunPlacement(i));
      const calls: JsonObject[] = [];
      for (const [i, p] of placed.entries()) for (const v of ['shadow', 'noshadow'] as const) {
        const d = fixtureDoc(out, `sun-e${e}-c${i}`, SUN_PARTS, p.cam, sunLight(e, p.shadowFar), v);
        calls.push(view3dCall(d.doc, d.assets));
      }
      const replies = runGpu(bin(), out, calls);
      for (const [i, p] of placed.entries()) {
        const what = `elevation ${e}°, cascade ${i}`;
        const light = sunLight(e, p.shadowFar);
        const k = classify(SUN_PARTS, p.cam, light);
        const pair = readPair(out, [replies[2 * i]!, replies[2 * i + 1]!], k, light, what, 'shadow: false');
        const splits = pair.on0.splits ?? [];
        const local: string[] = [...pair.problems];
        // The fixture lies inside cascade i, short of its last tenth.
        if (splits.length !== 5) local.push(`${what}: the casting frame reports splits ${JSON.stringify(splits)}, not 4 cascades`);
        else {
          const lo = splits[i]!; const hi = splits[i]! + 0.9 * (splits[i + 1]! - splits[i]!);
          let outside = 0;
          for (let j = 0; j < k.depth.length; j++) if (k.agree[j] && (k.depth[j]! < lo || k.depth[j]! > hi)) outside++;
          if (outside > 0) local.push(`${what}: ${outside} px of the fixture lie outside cascade ${i}'s first nine tenths [${lo.toFixed(2)}, ${hi.toFixed(2)}] m (splits ${splits.map((s) => s.toFixed(2)).join(', ')})`);
        }
        const lit = pixelsOf(k.cls, LIT); const dark = pixelsOf(k.cls, DARK);
        const bright = lit.filter((j) => brightest(pair.ref, j) >= 16).length;
        if (lit.length < 2000) local.push(`${what}: only ${lit.length} px are judged lit, under the 2,000 the comparison is judged on`);
        else if (bright < 0.75 * lit.length) local.push(`${what}: only ${bright} of ${lit.length} judged lit px read code 16 or more with the shadow off: the sun doesn't light the fixture`);
        const darkened = dark.filter((j) => pair.diff[j]! > 4).length;
        if (dark.length < 200) local.push(`${what}: only ${dark.length} px lie 0.25 m inside a shadow, under the 200 the shadow guard is judged on`);
        else if (darkened < 0.9 * dark.length) local.push(`${what}: of ${dark.length} px the rays call occluded 0.25 m inside a shadow, only ${darkened} differ from shadow: false by more than 4 codes: the casting sun draws no shadow there, so the comparison proves nothing`);
        const w = worst(lit, pair.diff);
        const texel = pair.on0.cascades?.[i]?.texel;
        const byPart = new Map<string, number>();
        for (const j of lit) if (pair.diff[j]! > 4) { const id = k.ids[k.part[j]!]!; byPart.set(id, (byPart.get(id) ?? 0) + 1); }
        const where = [...byPart].map(([id, n]) => `${id} ${n}`).join(', ');
        rows.push(`${AC1} e=${e}° cascade=${i} texel=${texel?.toFixed(4) ?? '?'} m: lit ${lit.length} px, over 4 codes ${w.over}${where ? ` (${where})` : ''}, worst ${w.max} at ${w.at}; occluded ${dark.length} px, darkened ${darkened}`);
        if (w.over > 0) {
          const firstOver = lit.find((j) => pair.diff[j]! > 4)!;
          local.push(`elevation ${e}°, cascade ${i} (texel ${texel?.toFixed(4) ?? '?'} m): ${w.over} of ${lit.length} sunlit px differ from the frame with shadow: false by more than 4 codes (${where}), worst ${w.max} codes at ${w.at}; the first lies in cascade ${cascadeOf(splits, k.depth[firstOver]!)} by the splits`);
        }
        problems.push(...local);
      }
    }
    console.log(rows.join('\n'));
    none(problems, 'sunlit pixels against the frame with shadow: false, by elevation and cascade');
  }, 1_150_000);
});
