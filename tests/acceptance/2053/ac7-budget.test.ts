// AC7 #2053.1e05370b: "Budget, on the reference Mac in the local preflight: 16 lights over a 1920 × 1080 paged image cost
// under 1.5 ms of GPU time a frame (a target, to be measured)"
//
// The paged side: a white 1920 × 1080 image `wall` with a 1920 × 1080 page of seeded bumps, in the lit group `lamps`
// with 16 lights on a 4 × 4 grid (range 400, energy 0.5, their height the default, three roles) and the default
// ambient; the plain side: the same document with the group's `light` removed, where the page is outside a lit group and
// the image draws as with none. Both hold `tick`, a small rect outside the group that moves every frame, so every frame
// of each side is drawn. A run is one `deep-gpu run` process playing each side for 120 frames at 60 fps with `film2d`
// (with the store), whose rows give each frame's `gpu_ms`; the cost in a run is the difference of the two sides' medians,
// read as 0 when negative, as #2031's AC8 reads its lights' cost (README: Readings).
//   - First, one run on any Mac, which also plays the paged side with no `normal`: the paged side's first frame hashes
//     apart from the plain side's and from the side with no page, so the measure sees the lights and the page it
//     times. Its reading is printed.
//   - Then only where the perf lane can judge a timing (a reference Mac on mains, Low Power Mode off, thermal state
//     nominal, the load within the cores, as scripts/benchmark.mjs's `judgeLimit` reads it): five more runs, judged
//     against 1.5 ms by the lane's rule. PASS passes, FAIL fails, anything else is INCONCLUSIVE; elsewhere the test fails
//     INCONCLUSIVE with the reading, never passing.
// Wrong programs: the base (no store: the image doesn't draw), a page left unread, a lit pass that costs 1.5 ms or more
// a frame, such as a pass per light over the whole image or a page decoded per light.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, films, inconclusive, item, judge, keyed, light, median, num, putPng, requireMetal, storeIn, str, timingProblem, unlitTwin, useBin,
  useDir, wall, WHITE, whiteImage, type JsonObject, type Light,
} from './helpers.ts';

const ID = AC[7];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 120;
const FPS = 60;
const LIMIT_MS = 1.5;
const ROLES = [WHITE, 'accent', 'focus'];
/** #2031's light, which names no `height`: each takes the default, range ÷ 4. */
const LAMPS: Light[] = Array.from({ length: 16 }, (_, k) => ({ at: [240 + 480 * (k % 4), 135 + 270 * Math.floor(k / 4)], energy: 0.5, range: 400 }));

/** The paged side, the plain side and the side with no page, their PNGs in a fresh store. */
function sides(): { store: string; paged: JsonObject; plain: JsonObject; bare: JsonObject } {
  const store = storeIn(dir());
  const asset = whiteImage(store, ...SIZE);
  // Seeded bumps: each texel's red and green lean by a sine of its column and row, blue 0 and alpha 255.
  const page = putPng(store, ...SIZE, (x, y) => [Math.round(128 + 60 * Math.sin(x / 13)), Math.round(128 + 60 * Math.cos(y / 11)), 0, 255]).hash;
  const side = (id: string, normal?: string): JsonObject => doc(id, SIZE, [
    item('lamps', 'group@1', 'a0', { light: { lights: LAMPS.map((l, k) => light(l, ROLES[k % ROLES.length])) } }),
    wall(asset, 'lamps', { size: SIZE, at: [SIZE[0] / 2, SIZE[1] / 2], ...(normal ? { normal } : {}) }),
    item('tick', 'rect@1', 'a2', { box: [0, 0, 8, 8], paint: { fill: { role: 'accent' } } }),
  ], { transport: { span: '2s' }, channels: { 'tick-x': keyed('items/tick/params/box/0', [[0, 0], [2, 1900]]) } });
  const paged = side('paged-budget', page);
  return { store, paged, plain: unlitTwin(paged, 'lamps'), bare: side('bare-budget') };
}
/** One run: the sides played in one process; each side's median GPU ms and first frame's hash. */
function run(s: ReturnType<typeof sides>, withBare: boolean): { paged: number; plain: number; hashes: string[] } {
  const rows = films(bin(), dir(), s.store, withBare ? [s.paged, s.plain, s.bare] : [s.paged, s.plain], { fps: FPS, from: 0, frames: FRAMES });
  const ms = (r: Map<number, JsonObject>, what: string): number => median([...r.values()].map((f, i) => num(f['gpu_ms'], `${what}: frame ${i}'s gpu_ms`)));
  return { paged: ms(rows[0]!, 'the paged side'), plain: ms(rows[1]!, 'the plain side'), hashes: rows.map((r, i) => str(r.get(0)?.['pixel_hash'], `side ${i}'s first hash`)) };
}
const cost = (r: { paged: number; plain: number }): number => Math.max(0, r.paged - r.plain);

describe(`${ID} the budget of 16 lights over a 1920 × 1080 paged image`, () => {
  it(`${ID} 16 lights over a 1920 × 1080 paged image cost under 1.5 ms of GPU time a frame, on the reference Mac`, () => {
    requireMetal();
    const s = sides();
    const first = run(s, true);
    const reading = `paged ${first.paged.toFixed(3)} ms, plain ${first.plain.toFixed(3)} ms, the lights and the page ${cost(first).toFixed(3)} ms a frame (median of ${FRAMES} frames each)`;
    console.log(`${ID}: first run: ${reading}`);
    expect(first.hashes[0], 'the paged side draws its lights: its first frame hashes apart from the plain side\'s').not.toBe(first.hashes[1]);
    expect(first.hashes[0], 'the paged side reads its page: its first frame hashes apart from the same side with no normal').not.toBe(first.hashes[2]);
    const problem = timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest: ${problem}; the reading: ${reading}`);
    const runs = Array.from({ length: 5 }, () => run(s, false));
    judge(`${ID} the 16 lights' GPU ms a frame over the paged image`, LIMIT_MS, runs.map(cost));
  });
});
