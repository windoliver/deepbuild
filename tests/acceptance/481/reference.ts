// The CPU reference AC1 holds the spread to: Christensen and Burley's diffusion profile (Christensen & Burley 2015,
// "Approximate Reflectance Profiles for Efficient Subsurface Scattering"), in its mean-free-path form, convolved with
// the line of light the renderer draws without the lobe, and the width read from it (README: The CPU reference).
// Written from the published form, in f64; nothing here is taken from the renderer. It imports no vitest, so it runs
// on its own (BASE-FAILURE.txt).
//
//   R(r) = A · s · (e^(−s·r/ℓ) + e^(−s·r/(3ℓ))) ÷ (8π · ℓ · r)        ∫ R dA over the plane = A
//   s = 1.85 − A + 7·|A − 0.8|³                                        (the paper's searchlight fit for ℓ)
//
// with ℓ the channel's mean free path (`radius`) and A the channel's albedo (the lobe's color). The lobe takes its
// share from the diffuse, so the light it spreads is its own and the profile is used as a distribution: p = R ÷ A.

/** The paper's scaling factor for the mean-free-path parameterisation, searchlight configuration. */
export const scaling = (albedo: number): number => 1.85 - albedo + 7 * Math.abs(albedo - 0.8) ** 3;

/** The profile's radial distribution, 2πr · p(r): (s ÷ 4ℓ)(e^(−sr/ℓ) + e^(−sr/(3ℓ))), integrating to 1 over r ≥ 0. */
export const radialPdf = (r: number, mfp: number, s: number): number => (s / (4 * mfp)) * (Math.exp((-s * r) / mfp) + Math.exp((-s * r) / (3 * mfp)));
/** Its integral from 0 to r: 1 − e^(−sr/ℓ)/4 − 3e^(−sr/(3ℓ))/4. */
export const radialCdf = (r: number, mfp: number, s: number): number => 1 - Math.exp((-s * r) / mfp) / 4 - (3 / 4) * Math.exp((-s * r) / (3 * mfp));

/** The share of the profile's light inside the strip |x| < X about a line through its centre: all of a ring of radius
 * r ≤ X, and (2/π)·asin(X/r) of a wider one. The tail is integrated with r = X + w² so its end-point slope is smooth. */
export function stripShare(X: number, mfp: number, s: number): number {
  if (X <= 0) return 0;
  const W = Math.sqrt((80 * mfp) / s); const n = 4000; const dw = W / n;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    const w = (i + 0.5) * dw; const r = X + w * w;
    tail += radialPdf(r, mfp, s) * (2 / Math.PI) * Math.asin(Math.min(1, X / r)) * 2 * w * dw;
  }
  return radialCdf(X, mfp, s) + tail;
}

/** The profile's line-spread function integrated over each pixel column `pitch` m wide: entry m is the share of a
 * line's light that lands in the column m columns from the line's own, for m = 0 … n − 1. */
export function columnKernel(pitch: number, n: number, mfp: number, s: number): number[] {
  const k: number[] = [];
  for (let m = 0; m < n; m++) k.push(m === 0 ? stripShare(0.5 * pitch, mfp, s) : (stripShare((m + 0.5) * pitch, mfp, s) - stripShare((m - 0.5) * pitch, mfp, s)) / 2);
  return k;
}
/** A row of columns convolved with a symmetric column kernel (entry 0 the centre), over the row's own extent. */
export function convolve(row: readonly number[], kernel: readonly number[]): number[] {
  return row.map((_, i) => { let v = 0; for (let j = 0; j < row.length; j++) v += row[j]! * (kernel[Math.abs(i - j)] ?? 0); return v; });
}

/** The centre of a row of columns, in pixel units (column i spans [i, i + 1)). */
export function centroid(row: readonly number[]): number {
  let a = 0; let b = 0;
  row.forEach((v, i) => { a += v * (i + 0.5); b += v; });
  return a / b;
}
/** The share of a row's light within `half` px of `centre`, each column's light spread evenly across it. */
export function shareWithin(row: readonly number[], centre: number, half: number): number {
  const lo = centre - half; const hi = centre + half;
  let inside = 0; let total = 0;
  row.forEach((v, i) => { total += v; inside += v * Math.max(0, Math.min(i + 1, hi) - Math.max(i, lo)); });
  return inside / total;
}
/** The width at share f: the half-width about `centre`, in px, within which the share f of the row's light lies. */
export function widthAt(row: readonly number[], centre: number, f: number): number {
  let lo = 0; let hi = row.length;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (shareWithin(row, centre, mid) < f) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** The 20 shares AC1's widths are read at: 0.10, 0.14, … 0.86 (README: The CPU reference). */
export const SHARES: readonly number[] = Array.from({ length: 20 }, (_, k) => Math.round((0.1 + 0.04 * k) * 100) / 100);
