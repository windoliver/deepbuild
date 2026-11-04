// AC6 #422.9d4b631c: The light policy keeps the 32 lights that contribute most, breaking ties by ID, and cascade splits
// match their closed form, checked by exact fixtures.
//
// The light cut: 44 point lights at one point in view, each with range 1 m, so every score is power ÷ d² from the same
// d and the same frustum overlap (Light and the light policy): 24 at 8,000 lm (h00–h23), 16 tied at 1,000 lm
// (t00–t15) and 4 at 100 lm (w0–w3), listed weakest first and the tied ones in reverse ID order, so neither the
// document's order nor a stable sort keeps the right ones. The policy keeps the 24 strongest and the 8 tied ones whose
// IDs sort first: frame 0's `lights_over_budget` notice lists exactly t08–t15 and w0–w3 as left out.
// The splits: `view3d` with `cascades: true` reports each frame's split distances along the view axis, from the
// camera's near plane to `shadow_far`; each equals the practical scheme's closed form,
// λ·n·(f/n)^(i/N) + (1 − λ)·(n + (f − n)·i/N), within 1e-6 relative, for n = 1 m, f = 10,000 m, N = 4 at λ = 0
// (1, 2500.75, 5000.5, 7500.25, 10000), 0.5 and 1 (1, 10, 100, 1000, 10000), and with the design's defaults (three
// cascades, split 0.5) for n = 0.5 m, f = 64 m.
// Wrong programs: a cut by document order or by ties broken by order; the base, which reports no splits; splits from
// a fixed table, the far plane in place of shadow_far, λ read the other way round, or any count but the one asked.
import { describe, expect, it } from 'vitest';
import {
  AC, PLAIN_LOOK, arr, box, camera, closedSplits, frameAt, framesOf, material, runGpu, sessionDoc, str, sun, useDir, useGpu, view3dCall,
  requireMetal, writeJson, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 360];
const pad = (n: number): string => String(n).padStart(2, '0');

function lightsDoc(): JsonObject {
  const point = (power: number): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], range: 1 }, at: { pos: [0, 0.5, 0] } });
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2, 6], [0, 0.5, 0], 50, { near: 0.1, far: 100 }),
    grey: material({ base_color: [0.5, 0.5, 0.5, 1] }),
    floor: box([10, 0.1, 10], { pos: [0, -0.05, 0] }, { material: 'grey' }),
  };
  for (let i = 0; i < 4; i++) items[`w${i}`] = point(100);
  for (let i = 15; i >= 0; i--) items[`t${pad(i)}`] = point(1000);
  for (let i = 0; i < 24; i++) items[`h${pad(i)}`] = point(8000);
  return sessionDoc('light-cut', SIZE, items);
}
const LEFT_OUT = [...Array.from({ length: 8 }, (_, i) => `t${pad(i + 8)}`), 'w0', 'w1', 'w2', 'w3'].sort();

interface Splits { name: string; near: number; far: number; n: number; lambda: number; sun: JsonObject }
const SPLITS: Splits[] = [
  { name: 'uniform (split 0)', near: 1, far: 10_000, n: 4, lambda: 0, sun: { cascades: 4, split: 0, shadow_far: 10_000 } },
  { name: 'split 0.5', near: 1, far: 10_000, n: 4, lambda: 0.5, sun: { cascades: 4, split: 0.5, shadow_far: 10_000 } },
  { name: 'logarithmic (split 1)', near: 1, far: 10_000, n: 4, lambda: 1, sun: { cascades: 4, split: 1, shadow_far: 10_000 } },
  { name: 'the defaults (3 cascades, split 0.5)', near: 0.5, far: 64, n: 3, lambda: 0.5, sun: { shadow_far: 64 } },
];
const splitsDoc = (s: Splits): JsonObject => sessionDoc(`splits-${s.n}-${s.lambda}`, SIZE, {
  cam: camera([0, 2, 6], [0, 0.5, 0], 50, { near: s.near, far: 20_000 }),
  grey: material({ base_color: [0.5, 0.5, 0.5, 1] }),
  floor: box([100, 0.1, 100], { pos: [0, -0.05, 0] }, { material: 'grey' }),
  block: box([1, 1, 1], { pos: [0, 0.5, 0] }, { material: 'grey' }),
  sun: sun(10_000, [-45, 20, 0], { shadow: true, ...s.sun }),
});

describe(`${AC[6]} the light policy's cut and the cascades' closed form`, () => {
  it(`${AC[6]} of 44 lights the policy keeps the 32 that contribute most, ties broken by ID: exactly t08–t15 and w0–w3 are left out`, () => {
    requireMetal();
    const out = dir();
    const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'light-cut', lightsDoc()), look: PLAIN_LOOK, size: SIZE, frames: 1 })]);
    const f = frameAt(framesOf(reply!, 'the light cut'), 0, 'the light cut');
    const notice = f.notices.find((n) => n['code'] === 'lights_over_budget');
    expect(notice, `frame 0 reports the lights the budget left out: ${JSON.stringify(f.notices)}`).toBeDefined();
    const left = arr(notice!['lights'], 'lights_over_budget.lights').map((v, i) => str(v, `lights_over_budget.lights[${i}]`)).sort();
    console.log(`${AC[6]}: left out ${left.join(', ')}`);
    expect(left, 'the lights left out: the 8 tied ones whose IDs sort last and the 4 weakest').toEqual(LEFT_OUT);
  }, 1_800_000);

  it(`${AC[6]} each frame's cascade splits equal the closed form within 1e-6 at split 0, 0.5 and 1, and at the design's defaults`, () => {
    requireMetal();
    const out = dir();
    const replies = runGpu(bin(), out, SPLITS.map((s, i) => view3dCall({ doc: writeJson(out, `splits-${i}`, splitsDoc(s)), look: PLAIN_LOOK, size: SIZE, frames: 2, cascades: true })));
    const problems: string[] = [];
    for (const [i, s] of SPLITS.entries()) {
      const want = closedSplits(s.near, s.far, s.n, s.lambda);
      for (const f of framesOf(replies[i]!, s.name)) {
        const got = f.splits;
        if (!got || got.length !== want.length) { problems.push(`${s.name}: frame ${f.frame} reports splits ${JSON.stringify(got)}, not ${s.n} cascades (${want.length} distances)`); continue; }
        got.forEach((g, k) => { if (Math.abs(g - want[k]!) > 1e-6 * want[k]!) problems.push(`${s.name}: frame ${f.frame}: split ${k} is ${g}, the closed form gives ${want[k]}`); });
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  }, 1_800_000);
});
