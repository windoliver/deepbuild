// Criterion 1 (its reads): "A test canvas module stepping at 50 Hz (14,112,000 flicks a step) that writes its step
// index into a held array reads 50 at t = 1.019 s and 49 at t = 0.999 s, and every frame at 24, 30 and 60 fps reads
// the index of the last step at or before its time, by seeking and by playing; …"
//
// Through `deep-show run`, built with `test-held` (README: The test canvas module). Three boards, at 24, 30 and 60 fps,
// each hold one `test.held@1` item stepping at 50 Hz: step k runs at k × 14,112,000 flicks and leaves k in the
// document array `test.held.index`. Each `eval` asks for that array as its frame reads it (`arrays`). Playing is one
// session evaluated at every frame of the 2 s span in time order; seeking is the same frames in a seeded order after a
// first frame at the span's last flick, so every jump but the first goes back in time. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, STEP_50, TIMEOUT, doc, evalHeld, fl, heldBoard, heldRead, none, presented, run, scenario, seeded, showDoc, shuffled, useEvidence, useHeldShow } from './helpers.ts';

const show = useHeldShow();
const evidence = useEvidence();

const RATES = [24, 30, 60] as const;
/** Board n (1 to 3) plays at RATES[n - 1]. */
const BOARDS = RATES.map((fps) => heldBoard(`Held index at ${fps} fps`, 50, fps));
const SPAN = fl(2);
const AT_1019 = fl(1.019);
const AT_0999 = fl(0.999);

/** Every frame of each board over its 2 s span, as [board, flick]; the 60 fps board also at 0.999 s and 1.019 s. */
function frames(): [number, number][] {
  const out: [number, number][] = [];
  RATES.forEach((fps, i) => {
    const times = Array.from({ length: 2 * fps }, (_, k) => (k * FLICKS) / fps);
    if (fps === 60) times.push(AT_0999, AT_1019);
    for (const t of times.sort((a, b) => a - b)) out.push([i + 1, t]);
  });
  return out;
}
const FRAMES = frames();

/** Runs the evals in `order` after the boards are shown; each failure names the board's rate, the flick and both indices. */
function reads(order: [number, number][], what: string): { failures: string[]; at: Map<string, number> } {
  const replies = run(show(), scenario(evidence(), [...BOARDS.map((b, i) => showDoc(i + 1, b)), ...order.map(([n, t]) => evalHeld(n, t))]));
  BOARDS.forEach((_, i) => presented(replies[i]!, `board ${i + 1} (${RATES[i]} fps)`));
  const failures: string[] = []; const at = new Map<string, number>();
  order.forEach(([n, t], i) => {
    const got = heldRead(replies[BOARDS.length + i]!, `${what}: eval of ${doc(n)} at ${t}`);
    const want = Math.floor(t / STEP_50);
    at.set(`${n}:${t}`, got);
    if (got !== want) failures.push(`${what}: at ${RATES[n - 1]} fps, ${t} flicks (${(t / FLICKS).toFixed(4)} s) reads ${got}, the last step at or before it is ${want}`);
  });
  return { failures, at };
}

describe(`${AC[1]} a frame reads a held array as the last step at or before its time left it`, () => {
  it(`${AC[1]} playing every frame at 24, 30 and 60 fps in order, each reads the last 50 Hz step's index: 50 at 1.019 s, 49 at 0.999 s`, () => {
    const { failures, at } = reads(FRAMES, 'playing');
    expect(at.get(`3:${AT_1019}`), 'at t = 1.019 s the frame reads step 50').toBe(50);
    expect(at.get(`3:${AT_0999}`), 'at t = 0.999 s the frame reads step 49').toBe(49);
    none(failures, 'every played frame reads the last step at or before its time');
  }, TIMEOUT);

  it(`${AC[1]} seeking to the same frames in a seeded order, back from the span's end, each reads the last 50 Hz step's index`, () => {
    const order: [number, number][] = [...RATES.map((_, i): [number, number] => [i + 1, SPAN - 1]), ...shuffled(FRAMES, seeded(497_01))];
    const { failures, at } = reads(order, 'seeking');
    expect(at.get(`3:${AT_1019}`), 'at t = 1.019 s the frame reads step 50').toBe(50);
    expect(at.get(`3:${AT_0999}`), 'at t = 0.999 s the frame reads step 49').toBe(49);
    none(failures, 'every frame sought reads the last step at or before its time');
  }, TIMEOUT);
});
