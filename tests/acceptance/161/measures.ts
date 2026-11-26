// What the tests measure on a picture, kept apart from the tests so each measure can be read, and run, on its own:
// the monotone cubic criterion 2 holds levels and curves to, the corners of a drawn quad (criterion 2), the strips a
// sliced frame moves (criterion 7) and the 10%-to-90% width of an edge (criterion 11). None of them draws anything.
import { fx, px8, type Floats, type Image } from './helpers.ts';

export type Pt = [number, number];

// ---------------------------------------------------------------------------------------------------
// Criterion 2: Fritsch and Carlson's monotone piecewise cubic, with Fritsch and Butland's interior slopes and the
// three-point, shape-preserving end slopes; held at its end values past either end, as the base's `spline@1` is.

function endSlope(h0: number, h1: number, m0: number, m1: number): number {
  const d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
  if (Math.sign(d) !== Math.sign(m0)) return 0;
  if (Math.sign(m0) !== Math.sign(m1) && Math.abs(d) > 3 * Math.abs(m0)) return 3 * m0;
  return d;
}
export function monotone(pts: Pt[]): (x: number) => number {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); const n = pts.length;
  const h = xs.slice(1).map((x, k) => x - xs[k]!); const m = ys.slice(1).map((y, k) => (y - ys[k]!) / h[k]!);
  const d = new Array<number>(n).fill(0);
  if (n === 2) { d[0] = m[0]!; d[1] = m[0]!; } else {
    for (let k = 1; k < n - 1; k++) {
      const m0 = m[k - 1]!; const m1 = m[k]!;
      if (Math.sign(m0) !== Math.sign(m1) || m0 === 0 || m1 === 0) continue;
      const w1 = 2 * h[k]! + h[k - 1]!; const w2 = h[k]! + 2 * h[k - 1]!;
      d[k] = (w1 + w2) / (w1 / m0 + w2 / m1);
    }
    d[0] = endSlope(h[0]!, h[1]!, m[0]!, m[1]!);
    d[n - 1] = endSlope(h[n - 2]!, h[n - 3]!, m[n - 2]!, m[n - 3]!);
  }
  return (x0) => {
    const x = Math.min(xs[n - 1]!, Math.max(xs[0]!, x0));
    let k = 0;
    while (k < n - 2 && x >= xs[k + 1]!) k++;
    const hk = h[k]!; const t = (x - xs[k]!) / hk; const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k]! + (t3 - 2 * t2 + t) * hk * d[k]! + (-2 * t3 + 3 * t2) * ys[k + 1]! + (t3 - t2) * hk * d[k + 1]!;
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the corners of a drawn quad, from the coverage (alpha) of an f32 picture.

/** Coverage at a point of the frame, bilinear between texel centres; 0 past the frame. */
export function coverage(im: Floats, x: number, y: number): number {
  const s = x - 0.5; const t = y - 0.5; const i = Math.floor(s); const j = Math.floor(t); const fs = s - i; const ft = t - j;
  const a = (ii: number, jj: number): number => (ii < 0 || jj < 0 || ii >= im.width || jj >= im.height ? 0 : fx(im, ii, jj)[3]);
  return (a(i, j) * (1 - fs) + a(i + 1, j) * fs) * (1 - ft) + (a(i, j + 1) * (1 - fs) + a(i + 1, j + 1) * fs) * ft;
}
/**
 * The four corners of what is drawn near the quad `want` (its corners clockwise on a y-down frame), and what stops
 * them being found. Each edge k, from corner k to corner k + 1, is found where coverage crosses one half on its way
 * out: at 25 places along the edge's middle 60%, within 4 px of it, with a line fitted through the crossings. Corner k
 * is where edge k − 1's line meets edge k's.
 */
export function drawnCorners(im: Floats, want: Pt[]): { corners: Pt[]; problems: string[] } {
  const problems: string[] = [];
  const lines: [Pt, Pt][] = [];
  for (let k = 0; k < 4; k++) {
    const p = want[k]!; const q = want[(k + 1) % 4]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]); const d: Pt = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    const n: Pt = [d[1], -d[0]];
    let sn = 0; let st = 0; let stt = 0; let ss = 0; let sts = 0;
    for (let i = 0; i < 25; i++) {
      const t = len * (0.2 + (0.6 * i) / 24);
      const cov = (s: number): number => coverage(im, p[0] + d[0] * t + n[0] * s, p[1] + d[1] * t + n[1] * s);
      let cross: number | null = null;
      for (let s = -4; s < 4; s += 0.125) {
        const a = cov(s); const b = cov(s + 0.125);
        if (a >= 0.5 && b < 0.5) { cross = s + (0.125 * (a - 0.5)) / (a - b); break; }
      }
      if (cross === null) continue;
      sn++; st += t; stt += t * t; ss += cross; sts += t * cross;
    }
    if (sn < 20) { problems.push(`edge ${k}, from (${p.join(', ')}) to (${q.join(', ')}): coverage crosses one half within 4 px of it at ${sn} of 25 places`); lines.push([p, q]); continue; }
    const slope = (sn * sts - st * ss) / (sn * stt - st * st); const offset = (ss - slope * st) / sn;
    lines.push([[p[0] + n[0] * offset, p[1] + n[1] * offset], [q[0] + n[0] * (offset + slope * len), q[1] + n[1] * (offset + slope * len)]]);
  }
  const corners = [0, 1, 2, 3].map((k): Pt => {
    const [a, b] = lines[(k + 3) % 4]!; const [c, e] = lines[k]!;
    const den = (a[0] - b[0]) * (c[1] - e[1]) - (a[1] - b[1]) * (c[0] - e[0]);
    const ab = a[0] * b[1] - a[1] * b[0]; const ce = c[0] * e[1] - c[1] * e[0];
    return [(ab * (c[0] - e[0]) - (a[0] - b[0]) * ce) / den, (ab * (c[1] - e[1]) - (a[1] - b[1]) * ce) / den];
  });
  return { corners, problems };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: the strips a sliced frame moves, against the clean title, on 8-bit pictures of one size.

const rowEquals = (a: Image, b: Image, y: number): boolean => { const w = a.width * 4; for (let i = y * w; i < (y + 1) * w; i++) if (a.rgba[i] !== b.rgba[i]) return false; return true; };
/** Of row `y`'s pixels whose source x − d is on the card, how many aren't the clean row there (3 codes), and how many
 * were read. Between texels the clean row is read by the two beside it. */
export function mismatch(shot: Image, clean: Image, y: number, d: number): { bad: number; read: number } {
  let bad = 0; let read = 0;
  const w = clean.width; const base = y * w * 4;
  for (let x = 0; x < w; x++) {
    const s = x - d; const i = Math.floor(s); const f = s - i;
    if (i < 0 || i + (f > 0 ? 1 : 0) >= w) continue;
    read++;
    for (let c = 0; c < 3; c++) {
      const want = f === 0 ? clean.rgba[base + i * 4 + c]! : clean.rgba[base + i * 4 + c]! * (1 - f) + clean.rgba[base + (i + 1) * 4 + c]! * f;
      if (Math.abs(shot.rgba[base + x * 4 + c]! - want) > 3) { bad++; break; }
    }
  }
  return { bad, read };
}
/** The shift, to a tenth of a px within ±80 px, that turns the clean row into row `y` on 95% of its pixels, or null. */
export function shiftOf(shot: Image, clean: Image, y: number): number | null {
  let best = 0; let least = Infinity;
  const share = (d: number): number => { const m = mismatch(shot, clean, y, d); return m.bad / Math.max(1, m.read); };
  for (let d = -80; d <= 80; d++) { if (d === 0) continue; const s = share(d); if (s < least) { least = s; best = d; } }
  const whole = best;
  for (let k = -9; k <= 9; k++) { const s = share(whole + k / 10); if (s < least - 1e-9) { least = s; best = whole + k / 10; } }
  return least <= 0.05 ? Math.round(best * 10) / 10 : null;
}
export interface Strip { from: number; rows: number; d: number }
/** The strips of `shot`: runs of rows that aren't the clean title's and share one shift. `stray` lists rows that are
 * neither the clean row nor that row moved sideways. */
export function stripsOf(shot: Image, clean: Image): { strips: Strip[]; stray: number[] } {
  const strips: Strip[] = []; const stray: number[] = [];
  for (let y = 0; y < clean.height; y++) {
    if (rowEquals(shot, clean, y)) continue;
    const d = shiftOf(shot, clean, y);
    if (d === null) { stray.push(y); continue; }
    const last = strips[strips.length - 1];
    if (last && last.from + last.rows === y && Math.abs(last.d - d) <= 0.25) last.rows++;
    else strips.push({ from: y, rows: 1, d });
  }
  return { strips, stray };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 11: the 10%-to-90% width of a dark-to-light vertical edge, on an 8-bit picture.

/** One row's width, px: between `x0` (dark) and `x1` (light), the mean of r, g and b crosses 10% and 90% of the way
 * from one level to the other at two places, found between pixels. NaN when the row has no such edge. */
export function rowWidth(im: Image, y: number, x0: number, x1: number): number {
  const v = (x: number): number => { const p = px8(im, x, y); return (p[0] + p[1] + p[2]) / 3; };
  const lo = v(x0); const hi = v(x1);
  if (!(hi - lo > 100)) return NaN;
  const cross = (level: number): number => { for (let x = x0; x < x1; x++) if (v(x) <= level && v(x + 1) > level) return x + (level - v(x)) / (v(x + 1) - v(x)); return NaN; };
  return cross(lo + 0.9 * (hi - lo)) - cross(lo + 0.1 * (hi - lo));
}
/** The median of the rows' widths, or NaN when a row has no edge. */
export function edgeWidth(im: Image, rows: readonly number[], x0: number, x1: number): number {
  const widths = rows.map((y) => rowWidth(im, y, x0, x1)).sort((a, b) => a - b);
  return widths.some((w) => Number.isNaN(w)) ? NaN : widths[Math.floor(widths.length / 2)]!;
}
