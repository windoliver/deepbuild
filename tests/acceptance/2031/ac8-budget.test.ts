// AC8 #2031.416073b6: "Budget, on the reference Mac in the local preflight: 16 lights over a 1920 × 1080 lit group cost
// under 1 ms of GPU time a frame (a target, to be measured)"
//
// The lit side: a 1920 × 1080 white rect in the group `lamps` with 16 lights on a 4 × 4 grid (range 400, energy 0.5,
// three roles) and the default ambient; the plain side: the same document with the group's `light` removed. Both hold
// `tick`, a small rect outside the group that moves every frame, so every frame of each side is drawn. A run is one
// `deep-gpu run` process playing each side for 120 frames at 60 fps with `film2d` (#417's), whose rows give each
// frame's `gpu_ms`; the lights' cost in a run is the difference of the two sides' medians (as #465's budgets read a
// feature's cost), a cost below 0 read as 0 (README: Readings).
//   - First, one run on any Mac: each side draws all its frames, and the two sides' first frames hash apart, so the
//     measure sees what it times. Its reading is printed.
//   - Then only where the perf lane can judge a timing (a reference Mac on mains, Low Power Mode off, thermal state
//     nominal, the load within the cores, as scripts/benchmark.mjs's `judgeLimit` reads it): five more runs, judged
//     against 1 ms by the lane's rule. PASS passes, FAIL fails, anything else is INCONCLUSIVE; elsewhere the test fails
//     INCONCLUSIVE with the reading, never passing.
// Wrong programs: the base (no light drawn: the sides hash alike), a lit pass that costs 1 ms or more a frame, such as a
// pass per light over the whole group.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, films, group, inconclusive, item, judge, light, median, num, rect, requireMetal, str, timingProblem, unlitTwin, useBin, useDir, WHITE,
  type JsonObject, type Light,
} from './helpers.ts';

const ID = AC[8];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = 120;
const FPS = 60;
const LIMIT_MS = 1;
const ROLES = [WHITE, 'accent', 'focus'];
const LIGHTS: Light[] = Array.from({ length: 16 }, (_, k) => ({ at: [240 + 480 * (k % 4), 135 + 270 * Math.floor(k / 4)], energy: 0.5, range: 400 }));
const lit = doc('lit-budget', SIZE, [
  group('lamps', 'a0', { lights: LIGHTS.map((l, k) => light(l, ROLES[k % ROLES.length])) }),
  rect('sheet', 'a1', [0, 0, ...SIZE], 'lamps'),
  item('tick', 'rect@1', 'a2', { box: [0, 0, 8, 8], paint: { fill: { role: 'accent' } } }),
], {
  transport: { span: '2s' },
  channels: { 'tick-x': { target: 'items/tick/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 1900, interp: 'linear' } } } },
});
const plain = unlitTwin(lit, 'lamps');

/** One run: both sides played in one process; each side's median GPU ms and first frame's hash. */
function run(): { lit: number; plain: number; hashes: [string, string] } {
  const [a, b] = films(bin(), dir(), [lit, plain], { fps: FPS, frames: FRAMES });
  const ms = (rows: JsonObject[], what: string): number => median(rows.map((f, i) => num(f['gpu_ms'], `${what}: frame ${i}'s gpu_ms`)));
  return { lit: ms(a!, 'the lit side'), plain: ms(b!, 'the plain side'), hashes: [str(a![0]!['pixel_hash'], 'the lit side\'s first hash'), str(b![0]!['pixel_hash'], 'the plain side\'s first hash')] };
}
const cost = (r: { lit: number; plain: number }): number => Math.max(0, r.lit - r.plain);

describe(`${ID} the budget of 16 lights over a 1920 × 1080 lit group`, () => {
  it(`${ID} 16 lights over a 1920 × 1080 lit group cost under 1 ms of GPU time a frame, on the reference Mac`, () => {
    requireMetal();
    const first = run();
    const reading = `lit ${first.lit.toFixed(3)} ms, plain ${first.plain.toFixed(3)} ms, the lights ${cost(first).toFixed(3)} ms a frame (median of ${FRAMES} frames each)`;
    console.log(`${ID}: first run: ${reading}`);
    expect(first.hashes[0], 'the lit side draws its lights: its first frame hashes apart from the plain side\'s').not.toBe(first.hashes[1]);
    const problem = timingProblem();
    if (problem) inconclusive(`the budget is judged only on a reference Mac at rest: ${problem}; the reading: ${reading}`);
    const runs = Array.from({ length: 5 }, run);
    judge(`${ID} the 16 lights' GPU ms a frame`, LIMIT_MS, runs.map(cost));
  });
});
