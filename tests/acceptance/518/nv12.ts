// The CPU reference criterion 7 holds the export's conversion pass to, and the ramp it is held on. No test framework
// is imported here, so the reference can be run on its own.
//
// The formula is the one the encode tool's planes are made by at the base (crates/deep-gpu/src/frame_checks.rs,
// `nv12`), which is the design's: BT.709 limited range in fixed point, each 2 × 2 block's chroma averaged with
// rounding, integers only. For a straight BGRA8 frame of even width and height:
//
//   Y  = 16 + ((47·R + 157·G + 16·B + 128) >> 8)                                  one byte a pixel, rows top-down
//   Cb = 128 + ((−26·SR − 86·SG + 112·SB + 512) >> 10)                            SR, SG, SB: the sums of a 2 × 2
//   Cr = 128 + ((112·SR − 102·SG − 10·SB + 512) >> 10)                            block's four pixels; >> floors
//
// The Y plane is w × h bytes; the chroma plane is (w/2) × (h/2) pairs, Cb then Cr. Alpha is not read. The + 512 is
// the rounding to nearest; a pass that leaves it out rounds chroma down (the criterion's planted pass).

export interface Planes { y: Uint8Array; cbcr: Uint8Array }

/** The NV12 planes of a straight BGRA8 frame, by the fixed-point BT.709 formula above. */
export function nv12(bgra: Uint8Array, w: number, h: number): Planes {
  if (w % 2 !== 0 || h % 2 !== 0) throw Error(`NV12 takes an even width and height, not ${w} × ${h}`);
  if (bgra.length !== w * h * 4) throw Error(`a ${w} × ${h} frame is ${w * h * 4} bytes, not ${bgra.length}`);
  const y = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < y.length; i++, p += 4) y[i] = 16 + ((47 * bgra[p + 2]! + 157 * bgra[p + 1]! + 16 * bgra[p]! + 128) >> 8);
  const cbcr = new Uint8Array((w * h) / 2);
  let o = 0;
  for (let row = 0; row < h; row += 2) {
    for (let col = 0; col < w; col += 2) {
      const a = (row * w + col) * 4; const b = a + 4; const c = a + w * 4; const d = c + 4;
      const sb = bgra[a]! + bgra[b]! + bgra[c]! + bgra[d]!;
      const sg = bgra[a + 1]! + bgra[b + 1]! + bgra[c + 1]! + bgra[d + 1]!;
      const sr = bgra[a + 2]! + bgra[b + 2]! + bgra[c + 2]! + bgra[d + 2]!;
      cbcr[o++] = 128 + ((-26 * sr - 86 * sg + 112 * sb + 512) >> 10);
      cbcr[o++] = 128 + ((112 * sr - 102 * sg - 10 * sb + 512) >> 10);
    }
  }
  return { y, cbcr };
}

/** The same planes with chroma rounded down: what the criterion's planted pass gives. Used only to show the ramp
 * tells the two apart. */
export function nv12ChromaFloored(bgra: Uint8Array, w: number, h: number): Planes {
  const planes = nv12(bgra, w, h);
  let o = 0;
  for (let row = 0; row < h; row += 2) {
    for (let col = 0; col < w; col += 2) {
      const a = (row * w + col) * 4; const b = a + 4; const c = a + w * 4; const d = c + 4;
      const sb = bgra[a]! + bgra[b]! + bgra[c]! + bgra[d]!;
      const sg = bgra[a + 1]! + bgra[b + 1]! + bgra[c + 1]! + bgra[d + 1]!;
      const sr = bgra[a + 2]! + bgra[b + 2]! + bgra[c + 2]! + bgra[d + 2]!;
      planes.cbcr[o++] = 128 + ((-26 * sr - 86 * sg + 112 * sb) >> 10);
      planes.cbcr[o++] = 128 + ((112 * sr - 102 * sg - 10 * sb) >> 10);
    }
  }
  return planes;
}

/**
 * The reference held to known colours before it judges anything: the base's own unit vector (frame_checks.rs,
 * `nv12_of_known_colours`: a 4 × 4 frame of 2 × 2 blocks, red and blue on top, green and white below) and black,
 * and the limits of the range, white at Y 235 and black at Y 16 with neutral chroma. Throws naming what differs.
 */
export function checkReference(): void {
  const px = (r: number, g: number, b: number): number[] => [b, g, r, 255];
  const row = (l: number[], r: number[]): number[] => [...l, ...l, ...r, ...r];
  const red = px(255, 0, 0); const green = px(0, 255, 0); const blue = px(0, 0, 255); const white = px(255, 255, 255);
  const top = row(red, blue); const bottom = row(green, white);
  const got = nv12(Uint8Array.from([...top, ...top, ...bottom, ...bottom]), 4, 4);
  const wantY = [63, 63, 32, 32, 63, 63, 32, 32, 172, 172, 235, 235, 172, 172, 235, 235];
  const wantC = [102, 240, 240, 118, 42, 26, 128, 128];
  if (String([...got.y]) !== String(wantY)) throw Error(`the NV12 reference gives Y ${String([...got.y])} for the known colours, not ${String(wantY)}`);
  if (String([...got.cbcr]) !== String(wantC)) throw Error(`the NV12 reference gives CbCr ${String([...got.cbcr])} for the known colours, not ${String(wantC)}`);
  const black = nv12(Uint8Array.from([...px(0, 0, 0), ...px(0, 0, 0), ...px(0, 0, 0), ...px(0, 0, 0)]), 2, 2);
  if (String([...black.y, ...black.cbcr]) !== String([16, 16, 16, 16, 128, 128])) throw Error(`the NV12 reference gives ${String([...black.y, ...black.cbcr])} for black, not 16 and neutral chroma`);
}

/** The ramp's size and frame count: ten 1920 × 1080 frames. */
export const RAMP = { size: [1920, 1080] as [number, number], frames: 10, tile: 256, cols: 7, rows: 4 } as const;

/**
 * Frame `f` of the 1080p ramp through every 8-bit red, green and blue value: the frame is tiled 256 × 256; in a tile
 * red is x mod 256 and green is y mod 256, and blue is one value a tile. The 28 whole tiles of a frame (7 across,
 * 4 down) take the blue values 28·f + 7·ty + tx (mod 256), and the part tiles at the right and bottom edges take
 * their whole neighbour's, so over the ten frames every one of the 256 blue values has a whole tile and every 8-bit
 * colour appears. Opaque BGRA8, rows top-down.
 */
export function rampFrame(f: number): Uint8Array {
  const [w, h] = RAMP.size;
  const out = new Uint8Array(w * h * 4);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ty = Math.min(y >> 8, RAMP.rows - 1);
    for (let x = 0; x < w; x++) {
      const tx = Math.min(x >> 8, RAMP.cols - 1);
      out[p++] = (RAMP.cols * RAMP.rows * f + RAMP.cols * ty + tx) & 255;
      out[p++] = y & 255;
      out[p++] = x & 255;
      out[p++] = 255;
    }
  }
  return out;
}

/** Where two planes first differ: the byte's offset with both values, or null when they are equal byte for byte. */
export function firstDifference(got: Uint8Array, want: Uint8Array): { at: number; got: number | null; want: number | null } | null {
  const n = Math.min(got.length, want.length);
  for (let i = 0; i < n; i++) if (got[i] !== want[i]) return { at: i, got: got[i]!, want: want[i]! };
  if (got.length !== want.length) return { at: n, got: got[n] ?? null, want: want[n] ?? null };
  return null;
}
