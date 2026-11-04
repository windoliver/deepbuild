// #418.186ac2bb The finish pass with every built-in effect at its identity default changes no pixel.
//
// #382's film (no status binding) under tone map none at the exposure whose scale is 1 is drawn three ways in one
// process: (A) the finish at identity as #378 left it (`finish: []`, no `grade`, `deband: none`); (B) with the grade
// and every field at the issue's default (white balance 6500 K, tint 0, the CDL's slope 1, offset 0, power 1,
// saturation 1); and (C) with that grade and deband present at amplitude 0 (`deband: spatial`, `deband_lsb: 0`).
// B and C must have A's pixel hash. And A's final frame must be the CPU's sRGB encoding of its own linear target,
// rounded: exactly, wherever the encoded value lies 0.1 or more of a code value from a rounding tie, and within one
// code value at a tie, so a finish that moves pixels in all three frames alike fails too. Grain, vignette, print
// wear, the tone curve and the screen are #464's finishes, not built in at this issue (README: Readings). The kit's
// planted bit implementation that moves one pixel at identity is in kit.test.ts.
import { describe, expect, it } from 'vitest';
import {
  GRADE_DEFAULTS, answered, frameAt, look, pixel, readPng, readTarget, requireGpu, run, srgbEncode, texel, film, useGpuBin, useOut, writeJson,
  type JsonObject, type Rgb,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const SIZE: [number, number] = [480, 360];
const ROLES: Record<string, Rgb> = { lamp: [217, 164, 65], block: [184, 188, 196], crate: [127, 167, 201], floor: [42, 45, 51] };

describe('#418.186ac2bb the finish at identity changes no pixel', () => {
  it('#418.186ac2bb the grade at its defaults, with deband absent or at amplitude 0, draws the frame the identity finish draws, and that frame is the plain sRGB encoding of the linear target', () => {
    requireGpu();
    const doc = writeJson(out(), 'film.json', film('film-finish-418'));
    const call = (change: JsonObject): JsonObject => ({ call: 'view3d', doc, look: look('finish-418', ROLES, change), size: SIZE, targets: ['final', 'linear'], capture: [0] });
    const names = ['the identity finish', 'the grade at its defaults', 'the grade at its defaults and deband at amplitude 0', 'a grade off identity', 'deband at amplitude 1'];
    const [a, b, c, d, e] = run(gpu.bin(), out(), [
      call({}), call({ grade: GRADE_DEFAULTS }), call({ grade: GRADE_DEFAULTS, deband: 'spatial', deband_lsb: 0 }),
      call({ grade: { ...GRADE_DEFAULTS, slope: [0.9, 1, 1] } }), call({ deband: 'spatial', deband_lsb: 1 }),
    ]).map((r, i) => frameAt(answered(r, names[i]!), 0, names[i]!));
    expect(b!.pixel_hash, `${names[1]} changes no pixel: its pixel hash is ${names[0]}'s`).toBe(a!.pixel_hash);
    expect(c!.pixel_hash, `${names[2]} changes no pixel: its pixel hash is ${names[0]}'s`).toBe(a!.pixel_hash);
    // The finish reads these fields: off identity, each changes the frame, so the two equalities above are the identity's.
    expect(d!.pixel_hash, `${names[3]} (slope [0.9, 1, 1]) changes the frame`).not.toBe(a!.pixel_hash);
    expect(e!.pixel_hash, `${names[4]} changes the frame`).not.toBe(a!.pixel_hash);

    const final = readPng(out(), a!, 'final', names[0]!);
    const lin = readTarget(out(), a!, 'linear', SIZE, names[0]!);
    const off: string[] = []; let count = 0;
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      const p = pixel(final, x, y); const l = texel(lin, x, y);
      for (let ch = 0; ch < 3; ch++) {
        const v = 255 * srgbEncode(l[ch]!);
        const tie = Math.abs((v - Math.floor(v)) - 0.5) < 0.1;
        const ok = tie ? Math.abs(p[ch]! - v) <= 1 : p[ch] === Math.round(v);
        if (!ok) { count++; if (off.length < 5) off.push(`(${x}, ${y}) channel ${ch}: ${p[ch]} where the encoding gives ${v.toFixed(3)}`); }
      }
    }
    expect(count, `the identity finish's frame is the sRGB encoding of its linear target, rounded (${count} channels off): ${off.join('; ')}`).toBe(0);
  }, 1_800_000);
});
