// #379.1e889bee: a counting allocator sees zero heap allocations per frame after warm-up.
//
// The `test-meter` build carries the counting allocator; `allocs` is what it counted in each frame of a live
// window of two writers' moving documents on Metal (README: The live call). Frames 1–60 are the warm-up. The
// stub meter holds both writers at 1 ms, so no rung changes during the run (a change may compile and
// allocate; criterion #379.1fbf8952 shows 1 ms moves nothing). `--planted allocates_per_frame` (a meter that
// grows a list every frame) must fail the check, naming the frame. Off macOS: INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import { W, liveCall, liveReply, one, requireMetal, sceneDoc, useBuilds, useOut, writeDoc, type Live } from './helpers.ts';

const builds = useBuilds(['test-meter']);
const out = useOut();
const ID = '#379.1e889bee';
const WARM_UP = 60;
const FRAMES = 300;

function counted(planted?: 'allocates_per_frame'): Live {
  const a = writeDoc(out(), 'alpha', sceneDoc({ title: 'Alpha', class: 'work_product', size: [256, 256], boxes: 8, moving: true }));
  const b = writeDoc(out(), 'bravo', sceneDoc({ title: 'Bravo', class: 'work_product', size: [256, 256], boxes: 8, moving: true }));
  return liveReply(one(builds.bin('test-meter'), out(), liveCall({
    frames: FRAMES,
    sessions: [{ session: 's-alpha', writer: W.alpha, doc: a }, { session: 's-bravo', writer: W.bravo, doc: b }],
    events: [{ frame: 150, camera: { session: 's-alpha', azimuth: 15 } }],
    report: ['allocs'],
    stub_meter: { writers: { [W.alpha]: [{ from: 1, gpu_ms: 1 }], [W.bravo]: [{ from: 1, gpu_ms: 1 }] } },
  }), planted ? { planted } : {}));
}

/** Frames after the warm-up that allocated: one sentence each, naming the frame. */
function allocating(live: Live): string[] {
  return live.frames.filter((f) => f.frame > WARM_UP && f.allocs !== 0).map((f) => `frame ${f.frame}: ${f.allocs} heap allocations`);
}

describe(`${ID} no heap allocation per frame after warm-up`, () => {
  it(`${ID} after ${WARM_UP} warm-up frames, every one of frames ${WARM_UP + 1}–${FRAMES} of two moving writers allocates nothing, a camera move included`, () => {
    requireMetal();
    const live = counted();
    expect(live.frames.length, `${FRAMES} frames`).toBe(FRAMES);
    for (const f of live.frames) expect(typeof f.allocs, `frame ${f.frame} reports the counting allocator's count`).toBe('number');
    expect(live.frames.filter((f) => f.views.every((v) => v.drawn)).length, 'every frame draws both views (the documents move)').toBe(FRAMES);
    expect(live.changes.filter((c) => c.reason !== 'initial'), 'no rung changes during the run').toEqual([]);
    expect(allocating(live), 'no frame after warm-up allocates').toEqual([]);
  }, 1_200_000);

  it(`${ID} a planted meter that allocates every frame fails the check, naming the frame`, () => {
    requireMetal();
    const problems = allocating(counted('allocates_per_frame'));
    expect(problems.length, 'the planted program allocates after warm-up').toBeGreaterThan(0);
    expect(problems[0], 'the failure names the first frame after warm-up').toMatch(new RegExp(`^frame ${WARM_UP + 1}: \\d+ heap allocations`));
  }, 1_200_000);
});
