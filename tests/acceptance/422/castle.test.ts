// AC1 #422.4c4893c7: A castle on floating islands, with lit windows and drifting clouds, renders from its description,
// its frames at four sampled times of its orbit each matching its golden pixel hash on the reference Mac with the blank
// guard (#64) before each comparison, and the orbit's frame time at p50 stays within the showpiece class; a planted
// build that draws the frame black reads BLOCKED under the guard, never PASS, and one that drops the clouds misses the
// golden and fails, naming the time.
//
// The castle is the checkout's own description, `packs/examples/castle.json` drawn in `packs/examples/castle.look.json`
// with its recipes from `packs/composites-1.0.0` (README: The castle and its goldens): at least two floating islands,
// a `sky@1`, clouds, the showpiece class, and a transport span that is one turn of its orbit. #378's `view3d` draws it
// at its own size, internal scale 1, at 30 fps, and captures the final target at the four quarter-turns 0, span/4,
// span/2 and 3·span/4. Each frame goes to #380's `golden` call with this suite's pixel-hash oracle against the golden
// `castle-t<k>` in `tests/goldens/422`: the blank guard first, then the frame's RGBA8 pixel hash against the golden's.
// All four PASS, and the suite's own pixel hash of each frame equals that of the golden's stored PNG.
// `--planted draws_black` (every final target black) reads BLOCKED `blank` at all four times, with no numbers;
// `--planted drops_clouds` (the cloud puffs not drawn) reads FAIL, never PASS or BLOCKED, at one time or more, and the
// check's failure names each time it missed.
// The p50: the orbit drawn full screen on this reference Mac's display at the showpiece's render scale while moving
// (internal scale 0.5), 300 frames at 30 fps with `timings`, the p50 of each run's `gpu_ms` against 10 ms, by the
// five-run rule. Off a reference Mac both tests are INCONCLUSIVE; a golden recorded under another environment is too.
// Wrong programs: the base (no sky, environment, puffs or pack expansion in `view3d`; no hash oracle); a castle that
// isn't on islands or has no clouds; a frame that differs from its golden; a black frame passed by a guard run after
// the comparison, or not at all; a castle too slow for the showpiece class.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, CASTLE_PACKS, GOLDEN_STORE, RUNS, SHOWPIECE_GPU_MS, castle, decodePng, failsNaming, frameAt, framesOf, goldenCall, goldenOf,
  inconclusive, judge, none, percentile, pixelHash, readNamed, requireReferenceMac, runGpu, useDir, useGpu, view3dCall,
  type GpuPlanted,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const FPS = CASTLE_FPS;
const PACKS = CASTLE_PACKS;
const TIMED_FRAMES = 300;

interface Judged { failures: string[]; verdicts: { t: string; verdict: string; reason: string | null; numbers: boolean }[] }
/** The four frames drawn and each judged against its golden; failures name the time. */
function goldens(planted?: GpuPlanted): Judged {
  const out = dir();
  const c = castle();
  const last = Math.max(...c.samples.map((s) => s.frame));
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: c.doc, look: c.look, size: c.size, frames: last + 1, fps: FPS, capture: c.samples.map((s) => s.frame), targets: ['final'], packs: PACKS })], planted);
  const frames = framesOf(reply!, 'the castle');
  const pngs = c.samples.map((s) => frameAt(frames, s.frame, `the castle at ${s.t}`).final!);
  const replies = runGpu(bin(), out, c.samples.map((s, i) => goldenCall(`castle-t${s.k}`, join(out, `${pngs[i]}.png`))));
  const failures: string[] = [];
  const verdicts: Judged['verdicts'] = [];
  for (const [i, s] of c.samples.entries()) {
    const g = goldenOf(replies[i]!, `the golden at t = ${s.t}`);
    verdicts.push({ t: s.t, verdict: g.verdict, reason: g.reason, numbers: g.numbers !== null });
    console.log(`${AC[1]}${planted ? ` (--planted ${planted})` : ''}: t = ${s.t} (frame ${s.frame}): ${g.verdict}${g.reason ? ` ${g.reason}` : ''}`);
    if (g.verdict === 'INCONCLUSIVE' && !planted) inconclusive(`the castle's golden at t = ${s.t} reads INCONCLUSIVE (${g.reason}): ${JSON.stringify(replies[i])}`);
    if (g.verdict !== 'PASS') { failures.push(`t = ${s.t} (frame ${s.frame}): the golden castle-t${s.k} reads ${g.verdict}${g.reason ? ` (${g.reason})` : ''}`); continue; }
    expect(g.oracle, `t = ${s.t}: the golden compared by the pixel-hash oracle`).toBe('hash');
    // A PASS means the pixels are the golden's: the suite reads both and hashes them itself.
    const snapshot = decodePng(readNamed(out, pngs[i]!, 'png', `the castle at ${s.t}`));
    const stored = decodePng(readFileSync(join(GOLDEN_STORE, `castle-t${s.k}.png`)));
    if (pixelHash(snapshot) !== pixelHash(stored)) failures.push(`t = ${s.t}: the golden call says PASS, but the frame's pixels hash ${pixelHash(snapshot)} and the golden's ${pixelHash(stored)}`);
  }
  return { failures, verdicts };
}

describe(`${AC[1]} the castle above the clouds against its goldens and the showpiece class`, () => {
  it(`${AC[1]} the castle's frames at four times of its orbit each match their golden pixel hash under the blank guard; a planted black frame reads BLOCKED at each, never PASS; a planted castle without clouds fails, naming the time`, () => {
    requireReferenceMac();
    none(goldens().failures, 'the castle against its four goldens');

    const black = goldens('draws_black');
    for (const v of black.verdicts) {
      expect(v.verdict, `--planted draws_black at t = ${v.t}: the blank guard reads BLOCKED, never PASS`).toBe('BLOCKED');
      expect(v.reason, `--planted draws_black at t = ${v.t}: BLOCKED by the blank guard`).toBe('blank');
      expect(v.numbers, `--planted draws_black at t = ${v.t}: the guard ran before the comparison, so there are no numbers`).toBe(false);
    }

    const cloudless = goldens('drops_clouds');
    expect(cloudless.verdicts.filter((v) => v.verdict === 'BLOCKED').map((v) => v.t), '--planted drops_clouds: no time is BLOCKED (the frame isn\'t blank)').toEqual([]);
    expect(cloudless.verdicts.filter((v) => v.verdict === 'FAIL').length, '--planted drops_clouds misses the golden and fails at one time or more').toBeGreaterThan(0);
    failsNaming(cloudless.failures, cloudless.verdicts.filter((v) => v.verdict === 'FAIL').map((v) => `t = ${v.t}`), 'the planted drops_clouds');
  }, 3_600_000);

  it(`${AC[1]} the castle's orbit, full screen on the reference Mac's display at internal scale 0.5, draws in ${SHOWPIECE_GPU_MS} ms of GPU time at p50, in five runs`, () => {
    const display = requireReferenceMac();
    const c = castle();
    const timed = (): number => {
      const out = dir();
      const [reply] = runGpu(bin(), out, [view3dCall({ doc: c.doc, look: c.look, size: display, frames: TIMED_FRAMES, fps: FPS, timings: true, surface: { internal_scale: 0.5 }, packs: PACKS })]);
      const frames = framesOf(reply!, 'the timed castle');
      expect(frames.length, `the timed castle draws ${TIMED_FRAMES} frames`).toBe(TIMED_FRAMES);
      return percentile(frames.map((f, i) => { expect(f.gpu_ms, `the timed castle's frame ${i} carries its GPU time`).not.toBeNull(); return f.gpu_ms!; }), 50);
    };
    timed(); // the warm-up run, discarded
    judge(`${AC[1]}: the castle's p50 GPU frame time at ${display.join(' × ')}, internal scale 0.5 (ms)`, Array.from({ length: RUNS }, timed), SHOWPIECE_GPU_MS);
  }, 3_600_000);
});
