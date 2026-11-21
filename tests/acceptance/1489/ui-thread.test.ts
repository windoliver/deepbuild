// AC2 (README: Criteria to tests): 200 looping GIFs as 60 px tiles, played 6 s by `live` on the real clock at 60 Hz,
// the UI thread's time read at every frame, and its p99 judged over five runs after a warm-up as the design judges a
// limit. The counts beside it (every frame draws all 200, each plays, the settled frame shows each at its frame) are
// judged on any Mac; the time only on a reference Mac.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOOK, LOOPING, PERIOD, SMALL, SMALL_VIEW, animDoc, animItem, benchmark, decodePng, frameAt, liveOf, one, oneMinuteLoad, percentile,
  put, scratch, smallBox, smallDelays, smallGif, smallId, smallShown, useRender, type LiveFrame,
} from './helpers.ts';

const render = useRender();
const dir = scratch('ui');

/** 6 s of play, one move frame per vsync at the same view: 360 frames a run, at least the design's 300. */
const MOVES = 360;
/** Each move's t is half a period past its vsync's, so no tile's frame changes exactly at a frame's t. */
const moves = Array.from({ length: MOVES }, (_, m) => ({ at: [0, 0], t: m * PERIOD + PERIOD / 2 }));
const LAST_T = (MOVES - 1) * PERIOD + PERIOD / 2;
/** A warm-up and five runs. */
const RUNS = 6;
const LIMIT_MS = 3;

/** The counts a run is judged on anywhere: each tile showed more than one frame while it played, and the settled frame shows each tile at its frame at the last t. */
function countProblems(frames: readonly LiveFrame[], settled: string, ids: readonly string[]): string[] {
  const out: string[] = [];
  const moving = frames.filter((f) => f.phase === 'move');
  for (const id of ids) {
    const drawn = new Set(moving.map((f) => f.animations.get(id)!.drawn).filter((d) => d !== null));
    if (drawn.size < 2) out.push(`${id} drew ${drawn.size} frame(s) of its GIF over the 6 s of play: it didn't play`);
  }
  const image = decodePng(readFileSync(settled));
  for (let i = 0; i < SMALL.count; i++) {
    const want = (i + frameAt(smallDelays(i), LAST_T, true)) % SMALL.frames;
    const [x, y] = smallBox(i);
    const got = smallShown(image, [x, y]);
    if (got !== want) out.push(`the settled frame shows tile ${smallId(i)} as ${typeof got === 'number' ? `color ${got}` : got}, not color ${want}, its GIF's frame at t ${LAST_T}`);
  }
  return out;
}

// Names are plain literals, so the trace lane reads them, and the criterion's ID, unrun.
describe('AC2 #1489.17043bb4 200 animations at 60 px keep UI-thread p99 under 3 ms', () => {
  it(`AC2 #1489.17043bb4 200 looping GIFs of 60 × 60, 40 to 100 ms a frame, drawn 1:1 as 60 px tiles in a 1280 × 640 view and played 6 s by live, a frame each vsync of the real clock at 60 Hz: every frame draws all 200 and each plays; in five runs after a warm-up on a reference Mac the UI thread's time per frame is under 3 ms at p99`, async () => {
    const bin = render();
    const store = join(dir, 'store');
    const ids = Array.from({ length: SMALL.count }, (_, i) => smallId(i));
    const doc = animDoc('tiles-1489', [SMALL_VIEW[2], SMALL_VIEW[3]], ids.map((id, i) => animItem(id, i, put(store, smallGif(i)), smallBox(i), LOOPING)));
    const p99s: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let run = 0; run < RUNS; run++) {
      const what = run === 0 ? 'the warm-up' : `run ${run}`;
      const settled = join(dir, `settled-${run}.png`);
      const start = oneMinuteLoad();
      const answer = one(bin, 'live', { doc, look: LOOK, store, view: { zoom: 1, rect: SMALL_VIEW }, moves, captures: [{ phase: 'settle', frame: 'last', out: settled }] }, 1_800_000);
      const end = oneMinuteLoad();
      const frames = liveOf(answer, what, MOVES, ids);
      expect(countProblems(frames, settled, ids), `${what}: every tile plays, and the settled frame shows each at its frame at the last t`).toEqual([]);
      const p99 = percentile(frames.filter((f) => f.phase === 'move').map((f) => f.ui_ms), 0.99);
      console.log(`AC2 ${what}: UI-thread time per frame at p99 over the ${MOVES} frames of play: ${p99.toFixed(3)} ms (one-minute load ${start.toFixed(1)} at its start, ${end.toFixed(1)} at its end)`);
      if (run > 0) {
        p99s.push(p99);
        loads.push({ start, end });
      }
    }
    const { fingerprint, judgeLimit } = await benchmark();
    const verdict = judgeLimit({ limit: LIMIT_MS, runs: p99s, fingerprint: fingerprint(), loads });
    console.log(`AC2: ${JSON.stringify(verdict)}`);
    if (verdict.status === 'INCONCLUSIVE' || verdict.status === 'BLOCKED') expect.fail(`${verdict.status}: ${verdict.reason ?? ''}; the five runs' p99s: ${p99s.map((p) => p.toFixed(3)).join(', ')} ms`);
    expect(verdict.status, `the UI thread's time per frame at p99 against ${LIMIT_MS} ms in five runs: ${JSON.stringify(verdict)}`).toBe('PASS');
  });
});
