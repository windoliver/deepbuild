// AC4 #2033.4b94b05f: The second criterion holds for the spot and for the point light at 1 m, 4 m and 16 m, each
// against its own frame with the light off. The planted 2 m bias fails, naming the light and the distance.
//
// For each of a shadowed spot and a shadowed point light (local maps at 512 px), 45° above the plane from the wall's
// centre and 1, 4 and 16 m from its face (helpers: localFixture), the wall alone on the plane under a black sky with no
// ambient: the casting frame against the same frame with the light off (its power 0, all else kept). Judged as in AC2
// (helpers: classify, `behind`): plane pixels whose centre's and corners' rays to the light each run 0.25 m or more
// inside the wall. A judged pixel more than 4 codes over the light-off frame is lit; none may be.
// So the comparison means something, each pair must: be drawn where the rays put it, report the light's shadow map,
// judge 200 or more pixels behind the wall, 100 or more of them inside a spot's cone (where the light would reach), and
// show a leak would be seen: in a third frame, the same with `shadow: false`, 100 or more of the judged pixels read more
// than 4 codes over the light-off frame; and, where the rays call 200 or more pixels lit (as AC3 reads them), 90% of
// those read more than 4 codes over it in the casting frame. (The visible lit area can't stand in for the first: with
// the spot 1 m from the wall's far face, all it lights is hidden from the camera by the wall.)
// Wrong programs: the planted `two-metre-bias` twin (light through the wall; fails naming the light and the distance);
// a local light that casts no shadow (every judged pixel in its reach lit); one that lights nothing (the lit guard).
import { describe, it } from 'vitest';
import {
  AC4, DISTANCES, LIT, LOCAL_KINDS, classify, codes, dot, frame0, fixtureDoc, localFixture, none, pixelsOf, rad, readPair, requireHardware,
  requireReference, runGpu, sub, unit, useDir, useGpu, view3dCall, worst, pinhole, readFinal, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC4} the plane behind the wall stays as dark as with the local light off`, () => {
  it(`${AC4} for the spot and the point light at 1, 4 and 16 m, every plane pixel whose ray to the light runs 0.25 m inside the wall is within 4 codes of its own light-off frame`, (ctx) => {
    requireReference(ctx.skip);
    const out = dir();
    requireHardware(bin(), out);
    const problems: string[] = [];
    const rows: string[] = [];
    for (const kind of LOCAL_KINDS) {
      const fx = DISTANCES.map((d) => localFixture(kind, d, 'wall'));
      const calls: JsonObject[] = [];
      for (const [n, f] of fx.entries()) for (const v of ['shadow', 'off', 'noshadow'] as const) {
        const doc = fixtureDoc(out, `${kind}-${DISTANCES[n]}-wall`, f.parts, f.cam, f.light, v);
        calls.push(view3dCall(doc.doc, doc.assets));
      }
      const replies = runGpu(bin(), out, calls);
      for (const [n, f] of fx.entries()) {
        const d = DISTANCES[n]!;
        const what = `the ${kind} light at ${d} m`;
        const k = classify(f.parts, f.cam, f.light);
        const pair = readPair(out, [replies[3 * n]!, replies[3 * n + 1]!], k, f.light, what, 'the light off');
        const local: string[] = [...pair.problems];
        const behind = pixelsOf(k.behind, 1);
        // Where the light would reach but for the wall: inside a spot's cone (every pixel for a point light).
        const { ray } = pinhole(f.cam);
        const light = f.light;
        const reach = light.kind === 'spot'
          ? behind.filter((j) => {
            const v = ray((j % 640) + 0.5, Math.floor(j / 640) + 0.5);
            const t = -f.cam.position[1] / v[1];
            const p: [number, number, number] = [f.cam.position[0] + v[0] * t, 0, f.cam.position[2] + v[2] * t];
            return dot(unit(sub(p, light.pos)), light.axis) >= Math.cos(rad(light.inner));
          })
          : behind;
        // The pixels the rays call lit (plane, spheres, box; 0.25 m from a shadow edge) and those the light lifts.
        const open = pixelsOf(k.cls, LIT);
        const lifted = open.filter((j) => pair.diff[j]! > 4).length;
        if (behind.length < 200) local.push(`${what}: only ${behind.length} plane px lie 0.25 m behind the wall, under the 200 the comparison is judged on`);
        if (reach.length < 100) local.push(`${what}: only ${reach.length} px behind the wall lie inside the spot's cone, under the 100 the comparison is judged on`);
        // With the shadow off, the judged pixels the light lifts: where a leak through the wall would show.
        const bare = codes(readFinal(out, frame0(replies[3 * n + 2]!, `${what}, shadow: false`), `${what}, shadow: false: final`), pair.ref);
        const exposed = behind.filter((j) => bare[j]! > 4).length;
        if (exposed < 100) local.push(`${what}: with the shadow off only ${exposed} of the ${behind.length} px behind the wall read more than 4 codes over the frame with the light off, under 100: a leak wouldn't show, so the comparison proves nothing`);
        if (open.length >= 200 && lifted < 0.9 * open.length) local.push(`${what}: of ${open.length} px the rays call lit, only ${lifted} read more than 4 codes over the frame with the light off: the light doesn't light them, so the comparison proves nothing`);
        const w = worst(behind, pair.diff);
        rows.push(`${AC4} ${kind} d=${d} m: behind the wall ${behind.length} px (${reach.length} in reach), lit ${w.over}, worst ${w.max} at ${w.at}; lit ${open.length} px, lifted ${lifted}; ${exposed} behind it lifted with the shadow off`);
        if (w.over > 0) local.push(`the ${kind} light at ${d} m: ${w.over} lit px behind the wall: of ${behind.length} plane px whose ray to the light runs 0.25 m or more inside it, ${w.over} read more than 4 codes over the light-off frame, worst ${w.max} codes at ${w.at}`);
        problems.push(...local);
      }
    }
    console.log(rows.join('\n'));
    none(problems, 'the plane behind the wall against the frame with the local light off, by light and distance');
  }, 1_150_000);
});
