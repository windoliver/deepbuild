// AC3 #2033.51cea4a6: The first criterion holds for the spot and for the point light at 1 m, 4 m and 16 m, each against
// its own frame with `shadow: false`. The planted lookup with no bias fails, naming the light and the distance.
//
// For each of a shadowed spot and a shadowed point light (the light policy's local maps at 512 px), 45° above the plane
// from the subject's centre and 1, 4 and 16 m from the subject's surface (helpers: localFixture), and for each subject
// of the first criterion (the icosphere at subdivision 2, at subdivision 4, the box), each on the plane alone: the
// casting frame against the same frame with the light's `shadow: false`. Judged as in AC1 (helpers: classify, LIT):
// pixels of the plane and the subject the CPU rays call lit (inside a spot's cone), 0.25 m from a shadow edge, facing
// the light by 10° or more by face and smooth normal. None may differ by more than 4 codes.
// So the comparison means something, each pair must: be drawn where the rays put it, report the light's shadow map,
// judge 2,000 or more lit pixels, 2,000 or more of them at code 16 or more with the shadow off (a count, not a share: a
// light 1 m away falls off steeply, so its far lit pixels are dim), and darken by more than 4 codes 90% of 100 or more
// pixels the rays call occluded 0.25 m inside a shadow.
// Wrong programs: the planted `no-bias` twin (acne on lit faces; fails naming the light and the distance); a local light
// that casts no shadow (the shadow guard and the map check); one that draws nothing or lights nothing.
import { describe, it } from 'vitest';
import {
  AC3, DARK, DISTANCES, LIT, LOCAL_KINDS, brightest, classify, fixtureDoc, localFixture, none, pixelsOf, readPair, requireHardware,
  requireReference, runGpu, useDir, useGpu, view3dCall, worst, type JsonObject, type Subject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SUBJECTS: Subject[] = ['sphere2', 'sphere4', 'box'];

describe(`${AC3} pixels a local light lights match the frame with its shadow off`, () => {
  it(`${AC3} for the spot and the point light at 1, 4 and 16 m, every lit pixel 0.25 m from a shadow edge and facing the light by 10° is within 4 codes of its own shadow: false frame`, (ctx) => {
    requireReference(ctx.skip);
    const out = dir();
    requireHardware(bin(), out);
    const problems: string[] = [];
    const rows: string[] = [];
    for (const kind of LOCAL_KINDS) for (const d of DISTANCES) {
      const fx = SUBJECTS.map((s) => localFixture(kind, d, s));
      const calls: JsonObject[] = [];
      for (const [n, f] of fx.entries()) for (const v of ['shadow', 'noshadow'] as const) {
        const doc = fixtureDoc(out, `${kind}-${d}-${SUBJECTS[n]}`, f.parts, f.cam, f.light, v);
        calls.push(view3dCall(doc.doc, doc.assets));
      }
      const replies = runGpu(bin(), out, calls);
      for (const [n, f] of fx.entries()) {
        const what = `the ${kind} light at ${d} m from ${SUBJECTS[n]}`;
        const k = classify(f.parts, f.cam, f.light);
        const pair = readPair(out, [replies[2 * n]!, replies[2 * n + 1]!], k, f.light, what, 'shadow: false');
        const local: string[] = [...pair.problems];
        const lit = pixelsOf(k.cls, LIT); const dark = pixelsOf(k.cls, DARK);
        const bright = lit.filter((j) => brightest(pair.ref, j) >= 16).length;
        if (lit.length < 2000) local.push(`${what}: only ${lit.length} px are judged lit, under the 2,000 the comparison is judged on`);
        else if (bright < 2000) local.push(`${what}: only ${bright} of ${lit.length} judged lit px read code 16 or more with the shadow off, under 2,000: the light doesn't light the fixture`);
        const darkened = dark.filter((j) => pair.diff[j]! > 4).length;
        if (dark.length < 100) local.push(`${what}: only ${dark.length} px lie 0.25 m inside a shadow, under the 100 the shadow guard is judged on`);
        else if (darkened < 0.9 * dark.length) local.push(`${what}: of ${dark.length} px the rays call occluded 0.25 m inside a shadow, only ${darkened} differ from shadow: false by more than 4 codes: the light casts no shadow there, so the comparison proves nothing`);
        const w = worst(lit, pair.diff);
        const byPart = new Map<string, number>();
        for (const j of lit) if (pair.diff[j]! > 4) { const id = k.ids[k.part[j]!]!; byPart.set(id, (byPart.get(id) ?? 0) + 1); }
        const where = [...byPart].map(([id, c]) => `${id} ${c}`).join(', ');
        rows.push(`${AC3} ${kind} d=${d} m ${SUBJECTS[n]}: lit ${lit.length} px, over 4 codes ${w.over}${where ? ` (${where})` : ''}, worst ${w.max} at ${w.at}; occluded ${dark.length} px, darkened ${darkened}`);
        if (w.over > 0) local.push(`the ${kind} light at ${d} m (${SUBJECTS[n]}): ${w.over} of ${lit.length} lit px differ from its frame with shadow: false by more than 4 codes (${where}), worst ${w.max} codes at ${w.at}`);
        problems.push(...local);
      }
    }
    console.log(rows.join('\n'));
    none(problems, 'pixels a local light lights against its own frame with shadow: false, by light and distance');
  }, 1_150_000);
});
