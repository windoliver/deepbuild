// #418.e08a1aeb Deband changes no pixel by more than 2 code values, keeps each 16 × 16 block's mean within 0.25 of
// a code value of the smooth gradient, and leaves status colors exact.
//
// The ball (a 3 m sphere lit from the front, its badge bound to a failed verdict) at a dark exposure (scale 0.1),
// tone map none, is drawn once with `deband: none` and once with `deband: spatial`, `deband_lsb: 1` (the issue's
// defaults for a physical look). The smooth gradient is this suite's f64 encoding of the linear target read back,
// unquantized: 255 × sRGB(linear × 0.1) per channel. Blocks are the 16 × 16 cells of the frame that lie wholly on the
// ball and off every status mark and legend entry (grown 2 px). The twin: the frame drawn without deband misses the
// smooth gradient's block mean by more than 0.25 somewhere, so the block check sees banding. At the base the look
// reads no `deband`, so the two frames are the same and the deband frame bands.
import { describe, expect, it } from 'vitest';
import {
  FAIL, FAILED, answered, ball, ev100, frameAt, inBox, look, pixel, readIds, readPng, readTarget, requireGpu, run, srgbEncode, statusExact,
  statusMask, statusOf, texel, useGpuBin, useOut, writeJson, type F32, type Ids, type Image, type JsonObject, type Rgb,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const SIZE: [number, number] = [512, 512];
const SCALE = 0.1;
const ROLES: Record<string, Rgb> = { ball: [184, 188, 196] };

/** The 16 × 16 blocks wholly on the ball and off status, each block's worst channel |mean(final) − mean(smooth)|. */
function blocks(final: Image, lin: F32, ids: Ids, mask: Uint8Array): { count: number; off: string[] } {
  let count = 0; const off: string[] = [];
  for (let by = 0; by + 16 <= SIZE[1]; by += 16) for (let bx = 0; bx + 16 <= SIZE[0]; bx += 16) {
    let inside = true;
    for (let y = by; y < by + 16 && inside; y++) for (let x = bx; x < bx + 16; x++) if (ids.at(x, y) !== 'ball' || mask[y * SIZE[0] + x]) { inside = false; break; }
    if (!inside) continue;
    count++;
    const got = [0, 0, 0]; const smooth = [0, 0, 0];
    for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) {
      const p = pixel(final, x, y); const l = texel(lin, x, y);
      for (let c = 0; c < 3; c++) { got[c]! += p[c]!; smooth[c]! += 255 * srgbEncode(l[c]! * SCALE); }
    }
    const worst = Math.max(...[0, 1, 2].map((c) => Math.abs(got[c]! - smooth[c]!) / 256));
    if (worst > 0.25) off.push(`block (${bx}, ${by}): mean off the smooth gradient by ${worst.toFixed(3)} code values`);
  }
  return { count, off };
}

describe('#418.e08a1aeb deband dithers within 2 code values, keeps block means on the smooth gradient and leaves status exact', () => {
  it('#418.e08a1aeb on a dark gradient, deband moves no pixel more than 2 code values, keeps every 16 × 16 block\'s mean within 0.25 of the smooth gradient, and draws the fail mark exactly', () => {
    requireGpu();
    const doc = writeJson(out(), 'ball.json', ball('ball-418'));
    const call = (deband: JsonObject): JsonObject => ({ call: 'view3d', doc, look: look('deband-418', ROLES, { exposure: ev100(SCALE), ...deband }), size: SIZE, states: FAILED, targets: ['final', 'linear', 'ids'], capture: [0] });
    const [plainR, debandR] = run(gpu.bin(), out(), [call({ deband: 'none' }), call({ deband: 'spatial', deband_lsb: 1 })]).map((r, i) => answered(r, i ? 'the ball with deband' : 'the ball without deband'));
    const plainF = frameAt(plainR!, 0, 'without deband'); const debandF = frameAt(debandR!, 0, 'with deband');
    const plain = readPng(out(), plainF, 'final', 'without deband');
    const dithered = readPng(out(), debandF, 'final', 'with deband');
    const lin = readTarget(out(), debandF, 'linear', SIZE, 'with deband');
    const ids = readIds(out(), debandF, 'with deband');
    const status = statusOf(debandR!, 'with deband');

    // No pixel moves by more than 2 code values, and deband does move pixels.
    let worst = 0; let where = ''; let moved = 0; let onBall = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const a = pixel(plain, x, y); const b = pixel(dithered, x, y);
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!)));
      if (d > worst) { worst = d; where = `(${x}, ${y})`; }
      if (ids.at(x, y) === 'ball') { onBall++; if (d > 0) moved++; }
    }
    expect(worst, `deband changes no pixel by more than 2 code values (the most is ${worst}, at ${where})`).toBeLessThanOrEqual(2);
    expect(moved / onBall, `deband dithers the gradient (${moved} of ${onBall} ball pixels changed)`).toBeGreaterThan(0.01);

    // Each block's mean stays within 0.25 of the smooth gradient; without deband, some block doesn't.
    const mask = statusMask(status, SIZE[0], SIZE[1]);
    const withDeband = blocks(dithered, lin, ids, mask);
    expect(withDeband.count, 'at least 50 blocks lie wholly on the ball').toBeGreaterThanOrEqual(50);
    expect(withDeband.off, `with deband, every block's mean is within 0.25 of a code value of the smooth gradient (${withDeband.off.length} of ${withDeband.count} off)`).toEqual([]);
    const twin = blocks(plain, readTarget(out(), plainF, 'linear', SIZE, 'without deband'), readIds(out(), plainF, 'without deband'), mask);
    expect(twin.off.length, 'the twin: without deband, at least one block bands off the smooth gradient by more than 0.25, so this check sees banding').toBeGreaterThan(0);

    // Status colors exact: the fail mark and the legend draw the fail color, and the mark's pixels are the undithered frame's.
    expect(statusExact(status, dithered, FAIL, 'with deband')).toEqual([]);
    const mark = status.marks.find((m) => m.state === 'fail');
    const keep = inBox(mark!.bounds, 1);
    const changed: string[] = [];
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++)
      if (keep(x, y) && pixel(plain, x, y).join() !== pixel(dithered, x, y).join() && changed.length < 5) changed.push(`(${x}, ${y})`);
    expect(changed, 'deband touches no pixel of the status mark').toEqual([]);
  }, 1_800_000);
});
