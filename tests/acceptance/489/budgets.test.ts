// Criterion 8: "Budgets, on the reference Mac in the local preflight, compared with the merge base: seeking anywhere
// on a 10-minute timeline takes under 50 ms, and evaluating channels for 10,000 items under 2 ms per frame"
//
// Through `deep-motion eval` with `timing: true`: each frame is then `{t, eval_ms}`, the binary's own wall time for
// evaluating that frame (the document compiled before it; reading and writing JSON outside it) (README: Choices
// where the issue is open). A seek is a fresh line with one time, so nothing of an earlier frame is cached; a play is
// one line of 70 frames at 60 fps, judged on the median of frames 10–69. Each budget runs in five fresh processes
// after a warm-up and is judged by the design's rule for timing results (PASS when every run is within the budget,
// FAIL when every run is over it by more than the margin, else INCONCLUSIVE). Off a reference Mac (Mac15,7 or
// Mac15,12), with Low Power Mode on or unknown, or with a thermal warning, both tests skip with an INCONCLUSIVE
// message; they never pass by skipping. The merge-base comparison is the preflight's perf lane (README). No
// upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, arr, environmentProblem, evalAll, film, fl, follow, judge, keyed, median, num, obj, rect, seededTimes, useMotion, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const problem = environmentProblem();

/** A 10-minute film: 20 follow channels whose sources step every 0.1 s (6,000 changes each), 20 keyed channels with 600 keys each. */
function longDoc(): JsonObject {
  const items: JsonObject[] = []; const channels: JsonObject = {};
  const interps = ['linear', { bezier: { x1: 0.3, y1: 0, x2: 0.7, y2: 1 } }, { spring: { freq_hz: 2, damping_ratio: 0.5 } }, { auto: { clamp: true } }];
  for (let i = 0; i < 20; i++) {
    items.push(rect(`f${i}`, [10, 10 + i]), rect(`k${i}`, [300, 10 + i]));
    const source: [number, number][] = Array.from({ length: 6000 }, (_, j) => [j / 10, ((j * 37 + i * 11) % 101) + 0.5]);
    channels[`follow${i}`] = follow(`items/f${i}/at/pos/0`, source, i % 2 ? { spring: { freq_hz: 1.5, damping_ratio: 0.4 } } : { first_order: { tau_up: 0.2, tau_down: 0.5 } });
    channels[`keys${i}`] = keyed(`items/k${i}/at/pos/1`, Object.fromEntries(Array.from({ length: 600 }, (_, j) => [`k${j}`, { t: `${j}s`, value: (j * 13 + i) % 97, interp: interps[(i + j) % 4]! }])));
  }
  return film('ten-minutes', items, { channels }, { span: '600s' });
}
/** 10,000 items, each with one keyed channel of four keys, the interpolations mixed. */
function wideDoc(): JsonObject {
  const items: JsonObject[] = []; const channels: JsonObject = {};
  const interps = ['linear', { bezier: { x1: 0.3, y1: 0, x2: 0.7, y2: 1 } }, { spring: { freq_hz: 2, damping_ratio: 0.5 } }, { auto: { clamp: true } }];
  for (let i = 0; i < 10_000; i++) {
    items.push(rect(`r${i}`, [(i % 100) * 6, Math.floor(i / 100) * 3]));
    channels[`c${i}`] = keyed(`items/r${i}/at/pos/0`, Object.fromEntries([0, 0.4, 0.8, 1.2].map((s, j) => [`k${j}`, { t: `${s}s`, value: (i % 100) * 6 + j * 4, interp: interps[(i + j) % 4]! }])));
  }
  return film('ten-thousand', items, { channels }, { span: '2s' });
}

/** The `eval_ms` of each frame of one timed line. */
function timed(answer: JsonObject, n: number, what: string): number[] {
  expect(answer['ok'], `${what} is accepted: ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`);
  expect(frames.length, `${what}: one frame per time`).toBe(n);
  return frames.map((f, i) => num(obj(f, `${what}: frames[${i}]`)['eval_ms'], `${what}: frames[${i}].eval_ms`));
}

describe('criterion 8: budgets on the reference Mac', () => {
  it('criterion 8: seeking anywhere on a 10-minute timeline takes under 50 ms (the slowest of 10 seeded seeks, five fresh processes after a warm-up)', (ctx) => {
    const doc = longDoc();
    const seeks = seededTimes(489_08, 10, 0, fl(600));
    const once = (): number => Math.max(...evalAll(motion.bin(), seeks.map((t) => ({ doc, times: [t], timing: true }))).map((a, i) => timed(a, 1, `the seek to ${seeks[i]}`)[0]!));
    const warm = once();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, ${warm.toFixed(3)} ms): ${problem}`);
    const runs = Array.from({ length: 5 }, once);
    judge(ctx, 'criterion 8: the slowest seek on a 10-minute timeline (ms)', runs, 50);
  }, TIMEOUT);

  it('criterion 8: evaluating channels for 10,000 items takes under 2 ms per frame (median of frames 10–69 at 60 fps, five fresh processes after a warm-up)', (ctx) => {
    const doc = wideDoc();
    const times = Array.from({ length: 70 }, (_, k) => (k * FLICKS) / 60);
    const once = (): number => median(timed(evalAll(motion.bin(), [{ doc, times, timing: true }])[0]!, 70, 'the 10,000-item play').slice(10));
    const warm = once();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only, ${warm.toFixed(3)} ms): ${problem}`);
    const runs = Array.from({ length: 5 }, once);
    judge(ctx, 'criterion 8: channels for 10,000 items per frame (ms)', runs, 2);
  }, TIMEOUT);
});
