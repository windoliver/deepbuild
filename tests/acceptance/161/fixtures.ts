// The fixtures of criterion 1, one picture per effect category, made here so every texel is readable: 128 × 72 px,
// 8-bit premultiplied RGBA, handed to the operator check as a texture asset (each channel ÷ 255, as linear data).
//
// Every picture is smooth: each channel is a sum of two low sinusoids (at most two cycles across the frame, texels
// under 10/255 apart), and what a category adds is soft too (texels under 26/255 apart; the noise fixture's specks
// and the color fixture's two patches are the only edges). A GPU's bilinear filter weighs its taps in 8 bits; over
// texels that close its result stays within half a 10-bit code of the f64 reference's, so an operator that samples
// between texels (a blur, a distortion) can meet one code, which a hard-edged picture would deny a right program.
// What each category adds to that base is what its operators need something of to change at all:
//   color        a soft alpha field that reaches 0 and 1, and two flat 8 × 8 patches whose answers the issue states:
//                premultiplied (0.8, 0, 0, 1) at (8, 8) and (0.2, 0, 0, 64/255) at (24, 8)
//   blur         a soft bright bump on the base, under a soft alpha field
//   distort      the base, opaque
//   stylize      two soft bumps, opaque
//   generate     the base under a soft alpha field
//   noise        the base, opaque, with 24 one-texel specks half a unit brighter (dust)
//   channel      the base under a soft alpha field
//   keying       a backing of (0, 1, 0) with a soft-edged warm subject and a soft shadow in a corner, opaque
//   matte        a soft-edged opaque disc on transparent
//   transitions  the base, opaque
import { type Category } from './helpers.ts';

export const FIXTURE_SIZE = [128, 72] as const;
const [W, H] = FIXTURE_SIZE;
/** The color fixture's two patches, [x, y, w, h], and the premultiplied 8-bit texel each holds. */
export const PATCH_OPAQUE = { box: [8, 8, 8, 8] as const, texel: [204, 0, 0, 255] as const };
export const PATCH_QUARTER = { box: [24, 8, 8, 8] as const, texel: [51, 0, 0, 64] as const };

const TAU = 2 * Math.PI;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** A low sinusoid field in [0.1, 0.9]: `k` picks its two directions and phases. */
function wave(x: number, y: number, k: number): number {
  const u = x / W; const v = y / H;
  const a = Math.sin(TAU * ((1 + (k % 2)) * u + (0.5 + 0.25 * (k % 3)) * v) + 0.9 * k);
  const b = Math.sin(TAU * ((0.5 + 0.25 * (k % 4)) * u - (0.5 + 0.5 * (k % 2)) * v) + 2.1 * k + 0.4);
  return 0.5 + 0.28 * a + 0.12 * b;
}
/** A soft bump of height 1 at (cx, cy), `sigma` px wide. */
const bump = (x: number, y: number, cx: number, cy: number, sigma: number): number => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma));
/** A soft alpha field that is exactly 0 in the frame's left tenth and exactly 1 over its right half. */
const softAlpha = (x: number): number => clamp01((x / W - 0.1) / 0.4);
const SALT: Record<Category, number> = { color: 1, blur: 2, distort: 3, stylize: 4, generate: 5, noise: 6, channel: 7, keying: 8, matte: 9, transitions: 10 };
const inPatch = (p: { box: readonly [number, number, number, number] }, x: number, y: number): boolean => x >= p.box[0] && x < p.box[0] + p.box[2] && y >= p.box[1] && y < p.box[1] + p.box[3];

/** One straight color and alpha per texel, before premultiplying. */
function texel(c: Category, x: number, y: number): [number, number, number, number] {
  const s = SALT[c];
  let rgb: [number, number, number] = [wave(x, y, s), wave(x, y, s + 11), wave(x, y, s + 23)];
  let a = 1;
  if (c === 'color' || c === 'generate' || c === 'channel') a = softAlpha(x);
  if (c === 'blur') { const b = 0.6 * bump(x, y, 80, 36, 9); rgb = [clamp01(rgb[0] * 0.5 + b), clamp01(rgb[1] * 0.5 + b), clamp01(rgb[2] * 0.5 + 0.5 * b)]; a = clamp01(0.25 + 0.75 * softAlpha(x)); }
  if (c === 'stylize') { const b = 0.5 * bump(x, y, 40, 30, 10) - 0.4 * bump(x, y, 92, 44, 12); rgb = [clamp01(rgb[0] + b), clamp01(rgb[1] + b), clamp01(rgb[2] - b)]; }
  if (c === 'noise') {
    // 24 specks on a 6 × 4 lattice, each one texel, away from the frame's edge.
    if (x % 20 === 11 && y % 16 === 9 && x < 120 && y < 64) rgb = [clamp01(rgb[0] + 0.5), clamp01(rgb[1] + 0.5), clamp01(rgb[2] + 0.5)];
  }
  if (c === 'keying') {
    const m = clamp01(0.5 + (26 - Math.hypot(x - 64, (y - 36) * 1.2)) / 12);
    const subject: [number, number, number] = [0.55 + 0.3 * (rgb[0] - 0.5), 0.45 + 0.2 * (rgb[1] - 0.5), 0.4 + 0.2 * (rgb[2] - 0.5)];
    // A soft shadow in the lower left, down to a tenth of the light, for the keys that read luminance.
    const shade = 1 - 0.9 * bump(x, y, 22, 54, 11);
    rgb = [(subject[0] * m) * shade, (subject[1] * m + (1 - m)) * shade, (subject[2] * m) * shade];
  }
  if (c === 'matte') a = clamp01(0.5 + (24 - Math.hypot(x - 64, y - 36)) / 10);
  return [rgb[0], rgb[1], rgb[2], a];
}

/** The category's picture: `rgba` premultiplied, 8 bits a channel, rows top-down. */
export function picture(c: Category): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    if (c === 'color' && inPatch(PATCH_OPAQUE, x, y)) { rgba.set(PATCH_OPAQUE.texel, o); continue; }
    if (c === 'color' && inPatch(PATCH_QUARTER, x, y)) { rgba.set(PATCH_QUARTER.texel, o); continue; }
    const [r, g, b, a] = texel(c, x, y);
    const a8 = Math.round(a * 255);
    rgba.set([Math.min(a8, Math.round(r * a * 255)), Math.min(a8, Math.round(g * a * 255)), Math.min(a8, Math.round(b * a * 255)), a8], o);
  }
  return rgba;
}
