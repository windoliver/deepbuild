// #853.efbe6335: "Budgets, on the reference Mac: 1,000,000 particles step in under 4 ms of GPU at 60 Hz with
// collision and spacing, and the checkpoint ring stays inside its byte budget"
//
// The flood (helpers.ts: floodDoc; judges.ts: FLOOD) is a showpiece (1,000,000 is under its cap of 1,048,576): one
// `particles.stepped@1` item, `flood`, of 1,000,000 particles 1 cm apart, poured over 2 s into a tray 2 m square (the
// world `pit`, as the pour's: a static floor box and four static wall boxes), stepped at 60 Hz, its ring declared
// `{every: 60, budget: 56,000,000}`: two of its 28,000,000-byte buffers. Through `view3d` at 60 frames a second, so
// each frame from 1 on runs one step.
//
// The ring. Played 300 steps (5 s), checkpoints fall due at steps 0, 60, … 300, six where two fit. On every frame the
// row `carried["flood.buffer"].ring` names the declared budget, holds no more bytes than it and no fewer than its
// checkpoints' buffers; at step 300 it holds a checkpoint, and over the play it took more than two, so it thinned to
// stay inside (judges.ts: ringProblems). This part reads bytes, so it runs on any Mac with a Metal device. The buffer
// at step 300 shows the document is the one the criterion times, "with collision and spacing": all 1,000,000 live,
// none through the floor or outside the walls, and the bed at the centre at least half of what 1,000,000 spheres 1 cm
// across fill the tray to at their densest (0.177 m), where particles that don't push each other apart lie in a layer.
//
// The GPU time. One step's GPU time is what the frame that runs it reports for the item (#380's `timings`:
// `passes_ms["op.flood"]` and any `op.flood.…`, summed). A run plays steps 1 to 300 and its value is their 95th
// percentile (Every task carries its own budgets: a limit at p95 is taken over every frame of the run, at least 300).
// The design's judge takes five runs after a warm-up one on a reference Mac: PASS when all five are within 4 ms, FAIL
// when all five are over by more than the margin (the larger of 5% and their spread), otherwise INCONCLUSIVE; and on
// a machine whose one-minute load is over 1 a core the runs are a reading, INCONCLUSIVE whatever they are, as off a
// reference Mac. At the base no kind `particles.stepped@1` exists.
import { describe, expect, it } from 'vitest';
import { FLOOD, FLOOD_BYTES, FLOOD_STEPS, p95, pileProblems, ringProblems, timingVerdict } from './judges.ts';
import {
  FLOODED, ac, bufferOn, carriedOn, floodDoc, frameAt, inconclusive, judgesHold, loadPerCore, none, requireGpu, requireReferenceMac, ringRows, run, stepMs, useBin,
  useOut, view3dCall, view3dFrames, writeJson,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
/** "Under 4 ms of GPU". */
const STEP_MS = 4;

describe(`${ac(5)} 1,000,000 particles with collision and spacing: the ring inside its byte budget, a step inside its GPU time`, () => {
  it(`${ac(5)} over 300 steps of 1,000,000 particles the checkpoint ring stays inside its byte budget of two buffers, thinning to do it`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const what = 'the flood played 300 steps';
    const [reply] = run(bin(), dir, [view3dCall({ doc: writeJson(dir, 'flood.json', floodDoc()), frames: FLOOD_STEPS + 1, capture: [FLOOD_STEPS], read: [FLOODED] })]);
    const frames = view3dFrames(reply!, what);
    expect(frames.length, `${what} drew ${FLOOD_STEPS + 1} frames`).toBe(FLOOD_STEPS + 1);
    none(ringProblems(ringRows(frames, FLOODED, what), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'on every frame the ring is inside its declared budget, and it thinned to stay there');
    const end = bufferOn(dir, frameAt(frames, FLOOD_STEPS, what), FLOODED, what);
    none(pileProblems(end.words, FLOOD, 'the flood at 5 s'), 'the 1,000,000 particles collide with the tray and push each other apart');
  }, 3_600_000);

  it(`${ac(5)} one step of 1,000,000 particles takes under ${STEP_MS} ms of GPU on the reference Mac (the 95th percentile of 300 steps, five runs after a warm-up), or the budget reads INCONCLUSIVE`, () => {
    judgesHold();
    requireReferenceMac();
    const dir = out();
    const call = view3dCall({ doc: writeJson(dir, 'flood.json', floodDoc()), frames: FLOOD_STEPS + 1, timings: true });
    const before = loadPerCore();
    const replies = run(bin(), dir, Array.from({ length: 6 }, () => call));
    const runs = replies.map((reply, n) => {
      const what = `timed run ${n} of the flood`;
      const frames = view3dFrames(reply, what);
      expect(frames.length, `${what} drew ${FLOOD_STEPS + 1} frames`).toBe(FLOOD_STEPS + 1);
      return p95(frames.filter((f) => f.frame >= 1).map((f) => {
        expect(carriedOn(f, FLOODED, what).step, `${what}: frame ${f.frame} ran step ${f.frame}`).toBe(f.frame);
        const ms = stepMs(f, 'flood');
        expect(ms, `${what}, frame ${f.frame}: passes_ms reports the step's GPU time under op.flood; it holds ${[...(f.passesMs ?? new Map<string, number>()).keys()].join(', ') || 'nothing'}`).not.toBeNull();
        return ms!;
      }));
    });
    const judged = timingVerdict('1,000,000 particles with collision and spacing, GPU ms a step (p95 of 300 steps)', runs.slice(1), STEP_MS, Math.max(before, loadPerCore()));
    console.log(judged.line);
    if (judged.verdict === 'INCONCLUSIVE') inconclusive(judged.line);
    expect(judged.verdict, judged.line).toBe('PASS');
  }, 3_600_000);
});
