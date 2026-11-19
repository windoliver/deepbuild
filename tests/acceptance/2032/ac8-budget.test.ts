// AC8 #2032.1a4ae9f6: "Budget, on the reference Mac in the local preflight: 16 lights and 4,096 occluder segments at 1920 ×
// 1080 cost under 2 ms of GPU time a frame (a target, to be measured)"
//
// The shadowed side: a 1920 × 1080 white rect in the group `lamps` with 16 point lights on a 4 × 4 grid (range 400,
// energy 0.5, three roles) and the default ambient, and 64 closed white paths with `occlude: true` on an 8 × 8 grid,
// each of 64 corners: 4,096 occluder segments, none holding a light. The plain side: the same document with the
// group's `light` and every path's `occlude` removed. Both hold `tick`, a small rect outside the group that moves
// every frame, so every frame of each side is drawn. A run is one `deep-gpu run` process playing each side for 120
// frames at 60 fps with `film2d`, whose rows give each frame's `gpu_ms`; the cost of the lights and their shadows in a
// run is the difference of the two sides' medians (as #2031's budget reads its lights' cost), a cost below 0 read as
// 0 (README: Readings).
//   - First, one run on any Mac, with a third side beside the two: the shadowed document with `occlude` taken off
//     every path. The shadowed side's first frame hashes apart from it, so the measure sees shadows. Its reading is
//     printed.
//   - Then only where the perf lane can judge a timing (a reference Mac on mains, Low Power Mode off, thermal state
//     nominal, the load within the cores, as scripts/benchmark.mjs's `judgeLimit` reads it): five more runs, judged
//     against 2 ms by the lane's rule. PASS passes, FAIL fails, anything else is INCONCLUSIVE; elsewhere the test fails
//     INCONCLUSIVE with the reading, never passing.
// Wrong programs: the base (`occlude` isn't read: the shadowed side hashes as with `occlude` off), a shadow pass that
// costs 2 ms or more a frame, such as every segment tested for every light at every pixel.
import { describe, expect, it } from 'vitest';
import {
  AC, blob, distinctCorners, doc, films, group, inconclusive, inside, item, judge, light, median, num, outline, rect, requireMetal,
  segments, str, timingProblem, unlitTwin, useBin, useDir, WHITE, withoutOcclude, type JsonObject, type Light, type Poly,
} from './helpers.ts';

const ID = AC[8];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 120;
const FPS = 60;
const LIMIT_MS = 2;
const ROLES = [WHITE, 'accent', 'focus'];
const LIGHTS: Light[] = Array.from({ length: 16 }, (_, k) => ({ at: [240 + 480 * (k % 4), 135 + 270 * Math.floor(k / 4)], energy: 0.5, range: 400 }));
/** 64 outlines of 64 corners, one at the centre of each 240 × 135 u cell; the lights sit on cell corners. */
const ROCKS: Poly[] = Array.from({ length: 64 }, (_, k) => blob(120 + 240 * (k % 8), 67.5 + 135 * Math.floor(k / 8), 64, 44, 8000 + k));
const shadowed = doc('shadow-budget', SIZE, [
  group('lamps', 'a0', { lights: LIGHTS.map((l, k) => light(l, ROLES[k % ROLES.length])) }),
  rect('floor', 'a1', [0, 0, ...SIZE], 'lamps'),
  ...ROCKS.map((p, k) => outline(`rock-${k}`, `b${String(k).padStart(2, '0')}`, p, 'lamps', { occlude: true })),
  item('tick', 'rect@1', 'c0', { box: [0, 0, 8, 8], paint: { fill: { role: 'accent' } } }),
], {
  transport: { span: '2s' },
  channels: { 'tick-x': { target: 'items/tick/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 1900, interp: 'linear' } } } },
});
const unshadowed = withoutOcclude(shadowed);
const plain = unlitTwin(unshadowed, 'lamps');

/** One run: the sides played in one process; the shadowed and plain sides' median GPU ms, and every side's first hash. */
function run(sides: JsonObject[]): { shadowed: number; plain: number; hashes: string[] } {
  const rows = films(bin(), dir(), sides, { fps: FPS, frames: FRAMES });
  const ms = (side: JsonObject[], what: string): number => median(side.map((f, i) => num(f['gpu_ms'], `${what}: frame ${i}'s gpu_ms`)));
  return { shadowed: ms(rows[0]!, 'the shadowed side'), plain: ms(rows[1]!, 'the plain side'), hashes: rows.map((r, i) => str(r[0]!['pixel_hash'], `side ${i}'s first hash`)) };
}
const cost = (r: { shadowed: number; plain: number }): number => Math.max(0, r.shadowed - r.plain);

describe(`${ID} the budget of 16 lights and 4,096 occluder segments at 1920 × 1080`, () => {
  it(`${ID} 16 lights and 4,096 occluder segments at 1920 × 1080 cost under 2 ms of GPU time a frame, on the reference Mac`, () => {
    expect([LIGHTS.length, segments(ROCKS), distinctCorners(ROCKS), LIGHTS.some((l) => ROCKS.some((p) => inside(l.at, p)))], '16 lights and 4,096 occluder segments, none of no length, no light inside an outline').toEqual([16, 4096, true, false]);
    requireMetal();
    const first = run([shadowed, plain, unshadowed]);
    const reading = `shadowed ${first.shadowed.toFixed(3)} ms, plain ${first.plain.toFixed(3)} ms, the lights and their shadows ${cost(first).toFixed(3)} ms a frame (median of ${FRAMES} frames each)`;
    console.log(`${ID}: first run: ${reading}`);
    expect(first.hashes[0], 'the shadowed side draws its shadows: its first frame hashes apart from the same document with occlude off').not.toBe(first.hashes[2]);
    const problem = timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest: ${problem}; the reading: ${reading}`);
    const runs = Array.from({ length: 5 }, () => run([shadowed, plain]));
    judge(`${ID} the GPU ms a frame of 16 lights and 4,096 occluder segments`, LIMIT_MS, runs.map(cost));
  });
});
