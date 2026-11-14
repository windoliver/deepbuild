// AC3 #1897.de2ffa3e: "The GPU pixel hash equals the CPU's hash of the same read-back buffer bit for bit on 1,000 seeded
// rgba8 and rgba16float frames, and changes when any one bit flips at 100 random pixel positions or when two unequal
// pixels swap; a planted hash that XORs pixels without their position passes the flips and fails on the swap, naming
// the pixels"
//
// Through `deep-show run`'s `pixel_hash` call (README: `pixel_hash`): each frame, raw bytes from the evidence store, is
// put in a GPU texture of its format, reduced to 128 bits on the GPU (16 bytes read back), copied back to the CPU and
// hashed there by the CPU's twin of the same hash. The 1,000 frames alternate rgba8 and rgba16float, each of a seeded
// size up to 64 × 64 and seeded bits (so float frames hold NaN, infinity, subnormal and signed-zero patterns: floats
// travel only as bits, Determinism class). For each format, a 64 × 64 frame has one bit flipped at each of 100 seeded
// pixel positions (the flipped bit runs through every bit of a pixel in turn), and 10 seeded pairs of unequal pixels
// swapped; each must move the GPU pixel hash ("order-sensitive: swapping any two differing pixels changes it",
// Determinism: `pixel_hash`). Wrong programs: the base (no `pixel_hash` call); the planted `hash_xors_without_position`
// (`deep-show run --planted`), whose hash folds pixels by XOR with no term for where they are. A machine with no GPU is
// BLOCKED, never a pass.
import { describe, expect, it } from 'vitest';
import {
  AC, BYTES, FULL, TIMEOUT, below, failsNaming, frameCall, hashed, none, runShow, scenario, seeded, seededFrame, sha256, useShow, useTemp,
  type Format, type Frame, type Hashed,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const FORMATS: Format[] = ['rgba8', 'rgba16float'];

/** The 1,000 seeded frames: rgba8 and rgba16float in turn, each w × h with w and h in [1, 64]. */
function thousand(): Frame[] {
  const next = seeded(1897);
  return Array.from({ length: 1000 }, (_, i) => seededFrame(next, FORMATS[i % 2]!, [1 + below(next, 64), 1 + below(next, 64)]));
}

interface Flip { format: Format; x: number; y: number; bit: number }
interface Swap { format: Format; a: [number, number]; b: [number, number] }
interface Moves { frames: Frame[]; base: Record<Format, number>; flips: [Flip, number][]; swaps: [Swap, number][] }
/** Per format a seeded 64 × 64 frame, then 100 one-bit flips at distinct seeded pixels and 10 swaps of unequal pixels;
 * each changed frame's index in `frames` beside what changed it. */
function moves(): Moves {
  const next = seeded(18970);
  const frames: Frame[] = []; const flips: [Flip, number][] = []; const swaps: [Swap, number][] = [];
  const base = {} as Record<Format, number>;
  const W = 64; const H = 64;
  for (const format of FORMATS) {
    const px = BYTES[format];
    const original = seededFrame(next, format, [W, H]);
    base[format] = frames.push(original) - 1;
    const used = new Set<number>();
    while (used.size < 100) {
      const p = below(next, W * H);
      if (used.has(p)) continue;
      used.add(p);
      const bit = (used.size - 1) % (px * 8);
      const bytes = Buffer.from(original.bytes);
      const at = p * px + (bit >> 3);
      bytes[at] = bytes[at]! ^ (1 << (bit & 7));
      flips.push([{ format, x: p % W, y: Math.floor(p / W), bit }, frames.push({ format, size: [W, H], bytes }) - 1]);
    }
    while (swaps.filter(([s]) => s.format === format).length < 10) {
      const p = below(next, W * H); const q = below(next, W * H);
      const a = original.bytes.subarray(p * px, (p + 1) * px); const b = original.bytes.subarray(q * px, (q + 1) * px);
      if (p === q || a.equals(b)) continue;
      const bytes = Buffer.from(original.bytes);
      Buffer.from(b).copy(bytes, p * px); Buffer.from(a).copy(bytes, q * px);
      swaps.push([{ format, a: [p % W, Math.floor(p / W)], b: [q % W, Math.floor(q / W)] }, frames.push({ format, size: [W, H], bytes }) - 1]);
    }
  }
  return { frames, base, flips, swaps };
}
/** Each flip or swap that leaves the GPU pixel hash where it was, naming the pixel or pixels. */
function moveFailures(m: Moves, h: Hashed[]): { flips: string[]; swaps: string[] } {
  return {
    flips: m.flips.filter(([f, i]) => h[i]!.gpu === h[m.base[f.format]]!.gpu)
      .map(([f]) => `${f.format} frame: flipping bit ${f.bit} of pixel (${f.x}, ${f.y}) leaves the GPU pixel hash at ${h[m.base[f.format]]!.gpu}`),
    swaps: m.swaps.filter(([s, i]) => h[i]!.gpu === h[m.base[s.format]]!.gpu)
      .map(([s]) => `${s.format} frame: swapping pixels (${s.a.join(', ')}) and (${s.b.join(', ')}) leaves the GPU pixel hash at ${h[m.base[s.format]]!.gpu}`),
  };
}

describe(`${AC[3]} the GPU pixel hash is the CPU's, bit for bit, and sees every bit and every pixel's place`, () => {
  it(`${AC[3]} on 1,000 seeded rgba8 and rgba16float frames the GPU's hash equals the CPU's of the read-back buffer, which is the frame; one bit flipped at 100 seeded pixels per format and 10 swaps of unequal pixels per format each change it`, () => {
    const seededFrames = thousand();
    const m = moves();
    const evidence = temp();
    const [all, moved] = runShow(shows.bin(FULL), scenario(evidence, [frameCall(evidence, seededFrames), frameCall(evidence, m.frames)]), 'the pixel hashes');
    const h = hashed(all!, seededFrames.length, 'the 1,000 seeded frames');
    const failures: string[] = [];
    seededFrames.forEach((f, i) => {
      const what = `frame ${i} (${f.format}, ${f.size.join(' × ')})`;
      if (h[i]!.readback !== sha256(f.bytes)) failures.push(`${what}: the buffer read back (${h[i]!.readback}) isn't the frame's bytes (${sha256(f.bytes)})`);
      if (h[i]!.gpu !== h[i]!.cpu) failures.push(`${what}: the GPU's hash ${h[i]!.gpu} differs from the CPU's ${h[i]!.cpu}`);
    });
    none(failures, 'the GPU pixel hash against the CPU\'s hash of the same read-back buffer');
    expect(new Set(h.map((x) => x.gpu)).size, 'the 1,000 different frames give 1,000 different hashes').toBe(1000);
    const f = moveFailures(m, hashed(moved!, m.frames.length, 'the flipped and swapped frames'));
    none(f.flips, 'one bit flipped at 100 pixels per format');
    none(f.swaps, 'two unequal pixels swapped');
  }, TIMEOUT);

  it(`${AC[3]} a planted hash that XORs pixels without their position (hash_xors_without_position) passes the flips and fails on the swap, naming the pixels`, () => {
    const m = moves();
    const evidence = temp();
    const [moved] = runShow(shows.bin(FULL), scenario(evidence, [frameCall(evidence, m.frames)]), 'the flipped and swapped frames', 'hash_xors_without_position');
    const f = moveFailures(m, hashed(moved!, m.frames.length, 'the planted hash'));
    none(f.flips, 'the planted hash passes the flips');
    const [first] = m.swaps[0]!;
    failsNaming(f.swaps, new RegExp(`^${first.format} frame: swapping pixels \\(${first.a.join(', ')}\\) and \\(${first.b.join(', ')}\\)`), 'the planted hash (hash_xors_without_position) on the swaps');
  }, TIMEOUT);
});
