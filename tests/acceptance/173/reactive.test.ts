// AC3 #173.3d79705e: A sign whose emission a channel switches from 0 to 4 at 1 s shows its new value in the first frame
// after, within 1 code value of that frame's own render, while a resolve without the reactive mask lags by at least 3
// frames.
//
// The fixture (helpers: `signDoc`): a sign on a black sky with no light, its material emitting (0.1, 0.12, 0.15) times
// a strength a channel holds at 0 and switches to 4 at 1 s (`hold` keys); the orthographic camera pans 1 px a frame, so
// the view moves. `view3d` draws frames 0–36 at 30 fps with frame history on (antialias, window 8), the colour clamp off
// in both legs so the reactive mask is judged alone: `reject: {depth: true, clamp: none, reactive: auto}` against
// `reactive: []` (no part reactive). The frame's own render is the same frame with history off. The first frame after
// the switch is the first whose own render lights the sign's interior (frame 30, or 31 if the key holds its old value
// at exactly 1 s); the interior is the sign's pixels inset 4 px, which the pan moves 1 px a frame. With the mask that
// frame is within 1 code value of its own render on every interior pixel (each channel of the final 8-bit target);
// without it, that frame and the two after it each sit more than 1 code from their own render on average: a lag of at
// least 3 frames.
// Wrong programs: the base (no history: the unmasked resolve doesn't lag, so it fails); a reactive mask that misses a
// part whose emission a channel changes, or a resolve that ignores `reject.reactive`.
import { describe, expect, it } from 'vitest';
import {
  AC, HISTORY_OFF, HISTORY_ON, SIGN, codeDiff, frameAt, framesOf, look, px, readPng, reject, requireMetal, runGpu, signDoc, signInterior, useDir, useGpu,
  view3dCall, writeJson, type Image,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const FRAMES = 37;
const CAPTURED = Array.from({ length: 11 }, (_, i) => 26 + i);

/** Over the sign's interior at frame n: the largest and the mean of each pixel's largest channel difference. */
function diff(a: Image, b: Image, n: number): { max: number; mean: number } {
  const r = signInterior(n);
  let max = 0; let sum = 0; let count = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) { const d = codeDiff(a, b, x, y); max = Math.max(max, d); sum += d; count++; }
  return { max, mean: sum / count };
}
/** The mean green code over the sign's interior at frame n. */
function interiorGreen(im: Image, n: number): number {
  const r = signInterior(n);
  let sum = 0; let count = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) { sum += px(im, x, y)[1]; count++; }
  return sum / count;
}

describe(`${ID} a part whose emission a channel switches shows its new value at once`, () => {
  it(`${ID} the sign shows emission 4 in the first frame after the switch within 1 code of its own render, and without the reactive mask it lags at least 3 frames`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'sign', signDoc());
    const common = { doc, size: SIGN.size, fps: SIGN.fps, frames: FRAMES, capture: CAPTURED, targets: ['final' as const] };
    const names = ['with the reactive mask', 'without the reactive mask', 'its own render'];
    const [masked, unmasked, own] = runGpu(bin(), out, [
      view3dCall({ ...common, look: look({ history: HISTORY_ON, reject: reject(true, 'auto') }) }),
      view3dCall({ ...common, look: look({ history: HISTORY_ON, reject: reject(true, []) }) }),
      view3dCall({ ...common, look: look({ history: HISTORY_OFF }) }),
    ]).map((r, i) => framesOf(r, names[i]!));
    const img = (frames: typeof own, i: number, n: number): Image => readPng(out, frameAt(frames!, n, names[i]!).final, `${names[i]}: frame ${n}`);
    // The first frame after the switch: the first whose own render lights the interior.
    const lit = CAPTURED.find((n) => interiorGreen(img(own, 2, n), n) > 100);
    expect(lit, `the own render lights the sign within frames ${CAPTURED[0]}–${CAPTURED.at(-1)}`).toBeDefined();
    const f = lit!;
    expect([30, 31], `the first frame after the switch at 1 s is frame 30 or 31 (got ${f})`).toContain(f);
    expect(interiorGreen(img(own, 2, f - 1), f - 1), `the own render of frame ${f - 1}, before the switch, is dark`).toBeLessThan(30);
    for (const [i, frames] of [masked!, unmasked!].entries()) {
      const h = frameAt(frames, f, names[i]!).history;
      expect(h, `${names[i]}: frame ${f} reports its frame history`).not.toBeNull();
      expect(h!.mode, `${names[i]}: frame ${f} drew with history`).toBe('antialias');
    }
    const first = diff(img(masked, 0, f), img(own, 2, f), f);
    const lag = [f, f + 1, f + 2].map((n) => diff(img(unmasked, 1, n), img(own, 2, n), n).mean);
    console.log(`${ID}: frame ${f}: with the mask at most ${first.max} codes from its own render; without it ${lag.map((m) => m.toFixed(2)).join(', ')} codes on average at frames ${f}–${f + 2}`);
    expect(first.max, `with the reactive mask, frame ${f}, the first after the switch, is within 1 code value of its own render on every interior pixel`).toBeLessThanOrEqual(1);
    lag.forEach((m, k) => expect(m, `without the reactive mask, frame ${f + k} still lags its own render (more than 1 code on average)`).toBeGreaterThan(1));
  }, 1_800_000);
});
