// The #3257 suite's maps, checkers and chains made here, with no vitest import, so it runs on its own
// (BASE-FAILURE.txt). Nothing here stands in for the product: a test reads a chain from a binary and holds it to the
// criteria's numbers with the checkers below. The chains made here are what the criteria plant (first row first; color
// averaged with no regard for alpha), the merge base's published box rule, and one control that satisfies the criteria
// another way than the issue's walk, to show that the checkers accept a chain that does (README: The chains made here).

export interface Level { w: number; h: number; /** RGBA8 as stored, rows top-down. */ px: Uint8Array }
export type Rgb = readonly [number, number, number];

// ---------------------------------------------------------------------------------------------------
// Chains

/** A full chain's level count for a `w` × `h` map. */
export const fullChain = (w: number, h: number): number => Math.floor(Math.log2(Math.max(w, h, 1))) + 1;
/** A full chain's bytes, every level end to end, largest first; its levels, or null where the length isn't a chain's. */
export function levelsOf(data: Uint8Array, w: number, h: number): Level[] | null {
  const out: Level[] = [];
  let at = 0;
  for (let l = 0; l < fullChain(w, h); l++) {
    const [lw, lh] = [Math.max(1, w >> l), Math.max(1, h >> l)];
    out.push({ w: lw, h: lh, px: data.subarray(at, at + lw * lh * 4) });
    at += lw * lh * 4;
  }
  return at === data.length ? out : null;
}
export const bytesOf = (levels: readonly Level[]): Buffer => Buffer.concat(levels.map((l) => l.px));
export const named = (l: number, level: Level): string => `level ${l} (${level.w} × ${level.h})`;

/** Whether a stored alpha is kept at `cutoff`: the shader discards an alpha under it. */
export const kept = (alpha: number, cutoff: number): boolean => alpha >= cutoff * 255;
export function keptShare(level: Level, cutoff: number): number {
  let n = 0;
  for (let i = 3; i < level.px.length; i += 4) if (kept(level.px[i]!, cutoff)) n++;
  return n / (level.w * level.h);
}
/** Level 0's kept or not, box-filtered down to each level: the share of the level-0 texels under each texel that are
 * kept (edge texels repeated on an odd side, as the chain's own filter reads them). */
export function shares(top: Level, cutoff: number): Float64Array[] {
  let { w, h } = top;
  let c = Float64Array.from({ length: w * h }, (_, i) => (kept(top.px[4 * i + 3]!, cutoff) ? 1 : 0));
  const out = [c];
  while (w > 1 || h > 1) {
    const [nw, nh] = [Math.max(1, w >> 1), Math.max(1, h >> 1)];
    const n = new Float64Array(nw * nh);
    const [cw, ch, cc] = [w, h, c];
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) n[y * nw + x] = under(x, y, cw, ch).reduce((s, i) => s + cc[i]!, 0) / 4;
    out.push(n);
    [w, h, c] = [nw, nh, n];
  }
  return out;
}
/** The indices of the four texels of a `w` × `h` level under texel (x, y) of the next. */
const under = (x: number, y: number, w: number, h: number): number[] =>
  [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => Math.min(2 * y + dy!, h - 1) * w + Math.min(2 * x + dx!, w - 1));

const f = Math.fround;
const toLinear32 = (c: number): number => { const v = f(c / 255); return v <= f(0.04045) ? f(v / f(12.92)) : f(Math.pow(f(f(v + f(0.055)) / f(1.055)), f(2.4))); };
const fromLinear32 = (c: number): number => {
  const v = c <= f(0.0031308) ? f(c * f(12.92)) : f(f(f(1.055) * f(Math.pow(c, f(1 / f(2.4))))) - f(0.055));
  return Math.min(255, Math.max(0, Math.round(f(v * 255))));
};
/** sRGB decoding and encoding in f64, for the expected colors (compared within a code or two). */
export const decode = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const encode = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/** The merge base's rule (`rgba8` in crates/deep-codecs/src/maps.rs): each level a plain 2 × 2 box of the stored level
 * above, alpha included, color in linear light. Its alpha is in f32 operation by operation, so it is the merge base's
 * byte for byte; its color goes through this engine's `pow`, so a color byte may differ from a binary's. */
export function boxChain(top: Level): Level[] {
  const out = [top];
  while (out.at(-1)!.w > 1 || out.at(-1)!.h > 1) {
    const { w, h, px } = out.at(-1)!;
    const [nw, nh] = [Math.max(1, w >> 1), Math.max(1, h >> 1)];
    const next = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const four = under(x, y, w, h);
      for (let c = 0; c < 4; c++) {
        const sum = four.reduce((s, i) => f(s + (c < 3 ? toLinear32(px[4 * i + c]!) : f(px[4 * i + c]! / 255))), 0);
        next[4 * (y * nw + x) + c] = c < 3 ? fromLinear32(f(sum / 4)) : Math.round(f(f(sum / 4) * 255));
      }
    }
    out.push({ w: nw, h: nh, px: next });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The chains made here

/** A chain of `top` whose alphas below level 0 are 255 where `keep(level)` says so and 0 elsewhere, and whose colors
 * are the four above's mean weighted by their unthresholded box alpha (`weigh`), or the plain mean. */
function chainOf(top: Level, keep: (l: number, w: number, h: number, share: Float64Array) => Uint8Array, weigh: boolean): Level[] {
  const share = shares(top, 0.5);
  const out = [top];
  let lin = Float64Array.from(top.px, (v, i) => (i % 4 === 3 ? v / 255 : decode(v)));
  for (let l = 1; l < share.length; l++) {
    const above = out[l - 1]!;
    const [w, h] = [Math.max(1, above.w >> 1), Math.max(1, above.h >> 1)];
    const on = keep(l, w, h, share[l]!);
    const px = new Uint8Array(w * h * 4);
    const next = new Float64Array(w * h * 4);
    const from = lin;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const four = under(x, y, above.w, above.h);
      const o = 4 * (y * w + x);
      const total = four.reduce((s, i) => s + from[4 * i + 3]!, 0);
      for (let c = 0; c < 3; c++) {
        next[o + c] = weigh && total > 0 ? four.reduce((s, i) => s + from[4 * i + c]! * from[4 * i + 3]!, 0) / total : four.reduce((s, i) => s + from[4 * i + c]!, 0) / 4;
        px[o + c] = encode(next[o + c]!);
      }
      next[o + 3] = total / 4;
      px[o + 3] = on[y * w + x]! ? 255 : 0;
    }
    out.push({ w, h, px });
    lin = next;
  }
  return out;
}
/** The control: each level's kept count is halved down through its quarters by their shares (largest remainder), a rule
 * of this suite's own and not the issue's walk, so a chain that spreads its kept texels passes the checkers. */
function quarters(_l: number, w: number, h: number, share: Float64Array): Uint8Array {
  const out = new Uint8Array(w * h);
  const sum = (x0: number, y0: number, s: number): number => {
    let t = 0;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) t += share[y * w + x]!;
    return t;
  };
  const fill = (x0: number, y0: number, s: number, n: number): void => {
    if (s === 1) { out[y0 * w + x0] = n; return; }
    const half = s / 2;
    const parts = [[0, 0], [half, half], [half, 0], [0, half]].map(([dx, dy]) => ({ x: x0 + dx!, y: y0 + dy!, t: sum(x0 + dx!, y0 + dy!, half) }));
    const counts = parts.map((p) => Math.floor(p.t + 1e-9));
    let left = n - counts.reduce((a, b) => a + b, 0);
    for (const { i } of parts.map((p, i) => ({ i, r: p.t - counts[i]! })).sort((a, b) => b.r - a.r)) if (left > 0) { counts[i]!++; left--; }
    parts.forEach((p, i) => fill(p.x, p.y, half, counts[i]!));
  };
  fill(0, 0, w, Math.round(sum(0, 0, w)));
  return out;
}
export const controlChain = (top: Level): Level[] => chainOf(top, quarters, true);
/** AC2's planted chain: the right kept count at every level, filled from the first row. */
export const firstRowChain = (top: Level): Level[] => chainOf(top, (_l, w, h, share) => {
  const n = Math.round(share.reduce((a, b) => a + b, 0));
  return Uint8Array.from({ length: w * h }, (_, i) => (i < n ? 1 : 0));
}, true);
/** AC4's planted chain: the control's alphas, its colors averaged with no regard for alpha. */
export const plainColorChain = (top: Level): Level[] => chainOf(top, quarters, false);

// ---------------------------------------------------------------------------------------------------
// The checkers: one line a fault, each naming its level

/** The levels the criteria read: level 0 down to the one whose shorter side is 16 texels. */
export const readLevels = (levels: readonly Level[]): number[] => levels.flatMap((l, i) => (Math.min(l.w, l.h) >= 16 ? [i] : []));
const pct = (v: number): string => `${(100 * v).toFixed(2)}%`;

/** AC1: each level down to 16 × 16 keeps within one percentage point of `share` (level 0 within rounding). */
export function shareFaults(levels: readonly Level[], cutoff: number, share: number): string[] {
  return readLevels(levels).flatMap((l) => {
    const got = keptShare(levels[l]!, cutoff);
    return Math.abs(got - share) <= (l === 0 ? 1e-9 : 0.01) ? [] : [`${named(l, levels[l]!)} keeps ${pct(got)} at cutoff ${cutoff}, not ${pct(share)}${l === 0 ? '' : ' within one percentage point'}`];
  });
}
const QUADRANTS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** AC2: at each of those levels, each quadrant keeps within two texels of its share (the box-filtered kept or not of
 * level 0, summed over the quadrant). */
export function quadrantFaults(levels: readonly Level[], cutoff: number): string[] {
  const share = shares(levels[0]!, cutoff);
  return readLevels(levels).flatMap((l) => {
    const { w, h, px } = levels[l]!;
    return QUADRANTS.flatMap((name, q) => {
      const [x0, y0] = [(q % 2) * (w / 2), Math.floor(q / 2) * (h / 2)];
      let got = 0; let want = 0;
      for (let y = y0; y < y0 + h / 2; y++) for (let x = x0; x < x0 + w / 2; x++) {
        if (kept(px[4 * (y * w + x) + 3]!, cutoff)) got++;
        want += share[l]![y * w + x]!;
      }
      return Math.abs(got - want) <= 2 + 1e-9 ? [] : [`${named(l, levels[l]!)}: its ${name} quadrant keeps ${got} texels, not its share of ${want.toFixed(2)} within two`];
    });
  });
}
/** The scope's two stored alphas below level 0: the same distance either side of the cutoff, as far apart as 0 and 1
 * allow (each rounded to a code). */
export function storedFaults(levels: readonly Level[], cutoff: number): string[] {
  const alphas = [...new Set(levels.slice(1).flatMap((l) => [...l.px].filter((_, i) => i % 4 === 3)))].sort((a, b) => a - b);
  const c = cutoff * 255;
  const [lo, hi] = alphas;
  if (alphas.length !== 2 || lo === undefined || hi === undefined) return [`the levels below level 0 store ${alphas.length} alphas (${alphas.slice(0, 8).join(', ')}${alphas.length > 8 ? ', …' : ''}), not two`];
  const spread = 2 * Math.min(c, 255 - c);
  return Math.abs((lo + hi) / 2 - c) <= 1 && hi - lo >= spread - 2 && !kept(lo, cutoff) && kept(hi, cutoff) ? [] : [`the levels below level 0 store alphas ${lo} and ${hi}, not two the same distance either side of ${c.toFixed(1)} and ${spread.toFixed(0)} apart`];
}
/** AC4: from level `from` on, every texel `counts` says counts is within 2 code values of `color`; a level down to
 * 16 × 16 with none that counts is a fault too. One line a level, naming its first texel in row order. */
export function colorFaults(levels: readonly Level[], color: Rgb, counts: (alpha: number) => boolean, what: string, from = 0): string[] {
  const read = readLevels(levels);
  return levels.flatMap((level, l) => {
    if (l < from) return [];
    const { w, h, px } = level;
    let first = ''; let off = 0; let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!counts(px[4 * i + 3]!)) continue;
      n++;
      const got = [px[4 * i]!, px[4 * i + 1]!, px[4 * i + 2]!];
      if (Math.max(...got.map((v, k) => Math.abs(v - color[k]!))) <= 2) continue;
      off++;
      first ||= `texel (${i % w}, ${Math.floor(i / w)}) is ${got.join(', ')}`;
    }
    if (n === 0 && read.includes(l)) return [`${named(l, level)} has no texel ${what}`];
    return off ? [`${named(l, level)}: ${first}, not ${color.join(', ')} within 2 codes (${off} of its ${n} texels ${what})`] : [];
  });
}

// ---------------------------------------------------------------------------------------------------
// Maps (level 0)

export type Texel = (x: number, y: number) => readonly [number, number, number, number];
export function mapOf(w: number, h: number, at: Texel): Level {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(at(x, y), 4 * (y * w + x));
  return { w, h, px };
}
/** The fence's line: one texel wide every 8 texels each way. */
export const onLine = (x: number, y: number): boolean => x % 8 === 0 || y % 8 === 0;
/** What the fence keeps: 1 − (7 ÷ 8)², 23.4375%. */
export const FENCE_SHARE = 15 / 64;
/** The criteria's 256 × 256 map: opaque lines, transparent between, all white. */
export const fence = (): Level => mapOf(256, 256, (x, y) => [255, 255, 255, onLine(x, y) ? 255 : 0]);
export const GREEN: Rgb = [46, 139, 60];
/** AC4's: the same lines in one green, magenta stored under the transparent texels. */
export const greenFence = (): Level => mapOf(256, 256, (x, y) => (onLine(x, y) ? [...GREEN, 255] : [255, 0, 255, 0]));
/** AC5's: the fence's lines at alpha 255 and, inside each cell, a 3 × 3 patch at alpha 100 (0.392): kept at cutoff 0.3
 * and dropped at 0.5, so the map keeps 24 ÷ 64 at 0.3 and 15 ÷ 64 at 0.5. */
export const TWO_CUTOFFS = { 0.5: 15 / 64, 0.3: 24 / 64 } as const;
export const twoCutoffs = (): Level => mapOf(256, 256, (x, y) => [200, 180, 40, onLine(x, y) ? 255 : x % 8 >= 3 && x % 8 <= 5 && y % 8 >= 3 && y % 8 <= 5 ? 100 : 0]);
/** Four texels of four colors and alphas, tiled: every level below level 0 is one color, their mean weighted by alpha
 * in linear light. */
export const TILE: readonly (readonly [number, number, number, number])[] = [[255, 255, 255, 255], [20, 40, 200, 160], [200, 30, 30, 96], [0, 255, 0, 0]];
export const tiled = (): Level => mapOf(64, 64, (x, y) => TILE[(y % 2) * 2 + (x % 2)]!);
export const TILE_MEAN: Rgb = [0, 1, 2].map((c) => encode(TILE.reduce((s, t) => s + decode(t[c]!) * t[3], 0) / TILE.reduce((s, t) => s + t[3], 0))) as unknown as Rgb;
/** A 32-bit linear congruential generator, the same every run. */
export function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(1664525, x) + 1013904223) >>> 0; return x >>> 24; };
}
/** AC6's: 512 × 512 texels of random color and alpha, so a platform's own float functions show in some byte. */
export function noise(): Level {
  const next = seeded(3257);
  return mapOf(512, 512, () => [next(), next(), next(), next()]);
}
/** AC5's opaque maps: random color, alpha 255 throughout, one of odd sides. */
export function opaque(w: number, h: number): Level {
  const next = seeded(w * 10_000 + h);
  return mapOf(w, h, () => [next(), next(), next(), 255]);
}
/** AC7's 2,048 × 2,048 maps: a smooth gradient (so reading the PNG is a small part of the time) with the fence's alpha,
 * or with alpha 255 throughout. */
export const large = (alpha: 'fence' | 'opaque'): Level => mapOf(2048, 2048, (x, y) => [x >> 3, y >> 3, (x + y) >> 4, alpha === 'opaque' || onLine(x, y) ? 255 : 0]);
/** AC8's leaf card: a bent stem and eleven pairs of thin leaflets in greens, edges softened over a texel, near-white
 * stored under the transparent texels as many leaf files do. */
export function leaf(): Level {
  return mapOf(256, 256, (x, y) => {
    const [u, v] = [(x + 0.5 - 128) / 128, (y + 0.5) / 256];
    let d = Math.abs(u - 0.05 * Math.sin(3 * v)) * 128 - 1.5 + (v < 0.02 ? 8 : 0);
    for (let k = 0; k < 11; k++) for (const side of [-1, 1]) {
      const root = 0.1 + 0.08 * k;
      const long = 0.75 * Math.sin(Math.PI * (0.2 + 0.07 * k)) + 0.1;
      const along = (side * u) / long;
      const across = v - root - 0.1 * along;
      if (along > 0 && along < 1) d = Math.min(d, (Math.abs(across) - 0.018 * Math.sin(Math.PI * along)) * 256);
    }
    const a = Math.round(255 * Math.min(1, Math.max(0, 0.5 - d)));
    return a === 0 ? [235, 235, 225, 0] : [40 + Math.round(40 * v), 110 + Math.round(50 * (1 - v)), 45, a];
  });
}
