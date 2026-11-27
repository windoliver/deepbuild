// AC2 #2033.6912f5fe: Behind the wall at every elevation and in every cascade, each plane pixel whose ray to the sun
// passes through 0.25 m or more of the wall is within 4 code values (drafted) of the frame with the sun off. A planted
// constant bias of 2 m toward the sun fails, naming the elevation and the count of lit pixels.
//
// The sun fixture (helpers: SUN_PARTS) at 640 × 480 under a 3 lx key sun from azimuth 20°, at each elevation 15° to 75°
// in 10° steps, the whole fixture inside each of 4 cascades in turn (helpers: sunPlacement), under a black sky with no
// ambient. Each casting frame is compared with the same frame with the sun off (its illuminance 0, all else kept). The
// judged pixels come from the CPU rays alone (helpers: classify, `behind`): the pixel's centre and four corners meet
// the plane, and each one's ray toward the sun runs 0.25 m or more inside the wall. A judged pixel more than 4 codes
// over the sun-off frame is lit; none may be.
// So the comparison means something, each pair must: be drawn where the rays put the fixture, have drawn its shadow
// maps (scene3d.shadow, four cascades), place the fixture inside the cascade it names, judge 200 or more pixels behind
// the wall, and show the sun lighting the fixture: 2,000 or more pixels more than 4 codes over the sun-off frame, and,
// where the rays call 200 or more pixels lit (as AC1 reads them), 90% of those.
// Wrong programs: the planted `two-metre-bias` twin (light through the wall; fails naming elevation and the count of lit
// pixels); a renderer that draws no shadow at all (every judged pixel lit); one whose sun lights nothing (the lit-plane
// guard); a fixture outside its cascade (the splits check).
import { describe, it } from 'vitest';
import {
  AC2, CASCADES, ELEVATIONS, LIT, SUN_PARTS, classify, fixtureDoc, none, pixelsOf, readPair, requireHardware, requireReference, runGpu,
  sunLight, sunPlacement, useDir, useGpu, view3dCall, worst, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC2} the plane behind the wall stays as dark as with the sun off`, () => {
  it(`${AC2} at every elevation 15°–75° and with the fixture in each of 4 cascades, every plane pixel whose ray to the sun runs 0.25 m inside the wall is within 4 codes of the sun-off frame`, (ctx) => {
    requireReference(ctx.skip);
    const out = dir();
    requireHardware(bin(), out);
    const problems: string[] = [];
    const rows: string[] = [];
    for (const e of ELEVATIONS) {
      const placed = CASCADES.map((i) => sunPlacement(i));
      const calls: JsonObject[] = [];
      for (const [i, p] of placed.entries()) for (const v of ['shadow', 'off'] as const) {
        const d = fixtureDoc(out, `wall-e${e}-c${i}`, SUN_PARTS, p.cam, sunLight(e, p.shadowFar), v);
        calls.push(view3dCall(d.doc, d.assets));
      }
      const replies = runGpu(bin(), out, calls);
      for (const [i, p] of placed.entries()) {
        const what = `elevation ${e}°, cascade ${i}`;
        const light = sunLight(e, p.shadowFar);
        const k = classify(SUN_PARTS, p.cam, light);
        const pair = readPair(out, [replies[2 * i]!, replies[2 * i + 1]!], k, light, what, 'the sun off');
        const splits = pair.on0.splits ?? [];
        const local: string[] = [...pair.problems];
        if (splits.length !== 5) local.push(`${what}: the casting frame reports splits ${JSON.stringify(splits)}, not 4 cascades`);
        else {
          const lo = splits[i]!; const hi = splits[i]! + 0.9 * (splits[i + 1]! - splits[i]!);
          let outside = 0;
          for (let j = 0; j < k.depth.length; j++) if (k.agree[j] && (k.depth[j]! < lo || k.depth[j]! > hi)) outside++;
          if (outside > 0) local.push(`${what}: ${outside} px of the fixture lie outside cascade ${i}'s first nine tenths [${lo.toFixed(2)}, ${hi.toFixed(2)}] m`);
        }
        const behind = pixelsOf(k.behind, 1);
        // The pixels the rays call lit (plane, spheres, box; 0.25 m from a shadow edge) and those the light lifts.
        const open = pixelsOf(k.cls, LIT);
        const lifted = open.filter((j) => pair.diff[j]! > 4).length;
        if (behind.length < 200) local.push(`${what}: only ${behind.length} plane px lie 0.25 m behind the wall, under the 200 the comparison is judged on`);
        const raised = pair.diff.reduce((n, c) => n + (c > 4 ? 1 : 0), 0);
        if (raised < 2000) local.push(`${what}: only ${raised} px of the casting frame read more than 4 codes over the frame with the sun off, under 2,000: the sun lights nothing, so the comparison proves nothing`);
        if (open.length >= 200 && lifted < 0.9 * open.length) local.push(`${what}: of ${open.length} px the rays call lit, only ${lifted} read more than 4 codes over the frame with the sun off: the sun doesn't light them, so the comparison proves nothing`);
        const w = worst(behind, pair.diff);
        const texel = pair.on0.cascades?.[i]?.texel;
        rows.push(`${AC2} e=${e}° cascade=${i} texel=${texel?.toFixed(4) ?? '?'} m: behind the wall ${behind.length} px, lit ${w.over}, worst ${w.max} at ${w.at}; lit ${open.length} px, lifted ${lifted}; raised ${raised} px`);
        if (w.over > 0) local.push(`elevation ${e}°, cascade ${i} (texel ${texel?.toFixed(4) ?? '?'} m): ${w.over} lit px behind the wall: of ${behind.length} plane px whose ray to the sun runs 0.25 m or more inside it, ${w.over} read more than 4 codes over the sun-off frame, worst ${w.max} codes at ${w.at}`);
        problems.push(...local);
      }
    }
    console.log(rows.join('\n'));
    none(problems, 'the plane behind the wall against the frame with the sun off, by elevation and cascade');
  }, 1_150_000);
});
