// The CPU reference for the #430 acceptance tests, in f64, written from the design and the published formulas and
// importing no implementation.
//
// Blending, on premultiplied RGBA in 0..1. The general form is W3C Compositing and Blending's:
//   co = cs(1 − αb) + cb(1 − αs) + αs·αb·B(Cb, Cs),  αo = αs + αb(1 − αs)
// The ten formula modes are the published Photoshop-family formulas: linear light, vivid light and pin light are each
// two halves split at Cs = 0.5 (linear burn and dodge, color burn and dodge at 2Cs, darken and lighten at 2Cs); hard
// mix is vivid light thresholded at 0.5, which is Cb + Cs ≥ 1; color burn and dodge take W3C's rules at their poles;
// divide reads 0/0 as 0 and x/0 as 1. Darker and lighter color pick the whole color by W3C's Lum.
//
// Dissolve is the design's: it keeps a pixel where hash(document seed, item ID, pixel) is under the group's opacity,
// and dancing adds the video frame index ⌊t × frame_rate⌋ to the hash (Frame and group: blend modes). In the design's
// own terms that is rand(hash(seed, x, y[, frame])) < opacity, with `seed` the operator input "hash of the document
// seed and item ID", and `hash` and `rand` the public steps: README, Readings. The four functions below are those
// steps as the base's op table defines them (crates/deep-canvas/src/steps.rs, deep-gpu-layer's item_seed).

export type Rgba = [number, number, number, number];
export type Rgb = [number, number, number];

export const FORMULA_MODES = ['subtract', 'divide', 'linear_burn', 'linear_dodge', 'linear_light', 'vivid_light', 'pin_light', 'hard_mix', 'darker_color', 'lighter_color'] as const;
export type FormulaMode = (typeof FORMULA_MODES)[number];
/** The eleven GPU-layer modes. */
export const ELEVEN = [...FORMULA_MODES, 'dissolve'] as const;
export type Eleven = (typeof ELEVEN)[number];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const burn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));

/** W3C's Lum. */
export const lum = (c: Rgb): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** Each separable mode's B(Cb, Cs). */
const SEPARABLE: Record<Exclude<FormulaMode, 'darker_color' | 'lighter_color'>, (b: number, s: number) => number> = {
  subtract: (b, s) => Math.max(0, b - s),
  divide: (b, s) => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s)),
  linear_burn: (b, s) => Math.max(0, b + s - 1),
  linear_dodge: (b, s) => Math.min(1, b + s),
  linear_light: (b, s) => clamp01(b + 2 * s - 1),
  vivid_light: (b, s) => (s < 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1)),
  pin_light: (b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  hard_mix: (b, s) => (b + s >= 1 ? 1 : 0),
};

/** B(Cb, Cs) of a formula mode, on straight colors. */
export function mode(name: FormulaMode, cb: Rgb, cs: Rgb): Rgb {
  if (name === 'darker_color') return lum(cs) < lum(cb) ? cs : cb;
  if (name === 'lighter_color') return lum(cs) > lum(cb) ? cs : cb;
  const f = SEPARABLE[name];
  return [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
}

const straight = (p: readonly number[]): Rgb => (p[3]! > 0 ? [p[0]! / p[3]!, p[1]! / p[3]!, p[2]! / p[3]!] : [0, 0, 0]);

/** A formula mode over premultiplied inputs, in W3C's general form; premultiplied out. */
export function blend(name: FormulaMode, b: readonly number[], s: readonly number[]): Rgba {
  const [ab, as] = [b[3]!, s[3]!];
  const m = mode(name, straight(b), straight(s));
  const c = (i: 0 | 1 | 2): number => s[i]! * (1 - ab) + b[i]! * (1 - as) + as * ab * m[i];
  return [c(0), c(1), c(2), as + ab * (1 - as)];
}

/** Source-over, premultiplied. */
export const over = (s: readonly number[], d: readonly number[]): Rgba => [0, 1, 2, 3].map((i) => s[i]! + d[i]! * (1 - s[3]!)) as Rgba;

// The public steps `hash` and `rand`, and the input `seed`.
const u32 = (v: number): number => v >>> 0;
export function hash1(x: number): number {
  const s = u32(Math.imul(x, 747_796_405) + 2_891_336_453);
  const w = u32(Math.imul(u32(s >>> ((s >>> 28) + 4)) ^ s, 277_803_737));
  return u32((w >>> 22) ^ w);
}
export const hash = (args: readonly number[]): number => args.slice(1).reduce((h, x) => hash1(u32(h ^ x)), hash1(args[0]!));
export const rand = (key: number): number => (hash1(key) >>> 8) * 2 ** -24;
export function itemSeed(docSeed: number, id: string): number {
  let h = u32(hash1(docSeed) ^ hash1(0x9e37_79b9));
  for (const b of Buffer.from(id, 'utf8')) h = hash1(u32(h ^ b));
  return h;
}

/** Whether dissolve keeps pixel (x, y) of a group: `frame` only when it dances. */
export const keeps = (seed: number, x: number, y: number, opacity: number, frame?: number): boolean =>
  rand(hash(frame === undefined ? [seed, x, y] : [seed, x, y, frame])) < opacity;

/** One pixel of a dissolve, premultiplied: the source over the backdrop where kept, else the backdrop. */
export const dissolve = (kept: boolean, b: readonly number[], s: readonly number[]): Rgba => (kept ? over(s, b) : [b[0]!, b[1]!, b[2]!, b[3]!]);

/** The eleven's reference for one pixel. */
export const eleven = (name: Eleven, b: readonly number[], s: readonly number[], kept: boolean): Rgba =>
  (name === 'dissolve' ? dissolve(kept, b, s) : blend(name, b, s));

/** The formulas' own numbers, worked by hand from the published forms: [mode, Cb, Cs, B]. A reference that misses one isn't an oracle. */
export const STATED: readonly [FormulaMode, number, number, number][] = [
  ['subtract', 0.75, 0.25, 0.5], ['subtract', 0.25, 0.75, 0],
  ['divide', 0.25, 0.5, 0.5], ['divide', 0.75, 0.5, 1],
  ['linear_burn', 0.75, 0.5, 0.25], ['linear_burn', 0.25, 0.5, 0],
  ['linear_dodge', 0.25, 0.5, 0.75], ['linear_dodge', 0.75, 0.5, 1],
  ['linear_light', 0.5, 0.75, 1], ['linear_light', 0.5, 0.25, 0], ['linear_light', 0.25, 0.5, 0.25],
  ['vivid_light', 0.75, 0.25, 0.5], ['vivid_light', 0.25, 0.75, 0.5],
  ['pin_light', 0.25, 0.75, 0.5], ['pin_light', 0.75, 0.25, 0.5], ['pin_light', 0.5, 0.5, 0.5],
  ['hard_mix', 0.6, 0.5, 1], ['hard_mix', 0.4, 0.5, 0],
];

// Color spaces.
export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toEncoded = (l: number): number => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

// The fixtures' own composed blur, in f64: the mean of 25 taps on a square grid, `stride` px apart, of premultiplied
// color, reading nothing outside the source image (each fixture keeps its reads inside the figure).
export type Field = (x: number, y: number) => readonly number[];
export function gridBlur(field: Field, x: number, y: number, stride: number): Rgba {
  const sum: Rgba = [0, 0, 0, 0];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const p = field(x + dx * stride, y + dy * stride);
    for (let i = 0; i < 4; i++) sum[i] = sum[i]! + p[i]!;
  }
  return sum.map((v) => v / 25) as Rgba;
}
