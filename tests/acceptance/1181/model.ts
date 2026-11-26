// The expected values of #1181's fixtures, worked from first principles (README: Fixtures), and nothing taken from a
// library: the constants the issue states, the fuse curve this suite states for the interface (README: The fuse curve),
// and a small nodal solver for resistive circuits that the budget's circuit is held to. Every number a test asserts is
// either written by hand in circuits.ts and checked here, or computed here from the issue's own constants.

import type { Circuit, Part } from './circuits.ts';

/** The elementary charge, C (the issue's 1.602176634 × 10⁻¹⁹). */
export const E = 1.602176634e-19;
/** Carrier densities, m⁻³ (the issue's Fields: copper 8.5 × 10²⁸, aluminium 1.8 × 10²⁹). */
export const CARRIERS = { copper: 8.5e28, aluminium: 1.8e29 } as const;
/** The fuse curves' time constants, s (README: The fuse curve). */
export const TAU = { fast: 1, slow: 10 } as const;

/** A load's resistance from its rating: v_rated² ÷ p_rated. */
export const loadOhms = (pRated: number, vRated: number): number => (vRated * vRated) / pRated;
/**
 * The time a fuse of rating `rating` on curve `tau` takes to open at a steady rms current `i` past its rating
 * (README: The fuse curve): τ · ln(i² ÷ (i² − rating²)); never at or under its rating.
 */
export function fuseTime(i: number, rating: number, tau: number): number {
  return i > rating ? tau * Math.log((i * i) / (i * i - rating * rating)) : Infinity;
}
/** The step a fuse opens at: the first k ≥ `from` with (k − from) ÷ rate ≥ its curve's time (README: The fuse curve). */
export const fuseStep = (from: number, i: number, rating: number, tau: number, rate: number): number =>
  from + Math.ceil(fuseTime(i, rating, tau) * rate - 1e-9);
/** Electrons' drift speed in a wire of `areaMm2` mm² carrying `amps`: I ÷ (n A e), m/s. */
export const drift = (amps: number, areaMm2: number, n: number): number => amps / (n * areaMm2 * 1e-6 * E);
/**
 * Their displacement from rest at t, s, for a sine current of rms `iRms` at `f` Hz, phase 0, flowing from t = 0: the
 * closed form ∫₀ᵗ √2·v·sin(2πft) dt = A (1 − cos 2πft), A = √2·v ÷ 2πf, v the rms drift speed.
 */
export const swing = (vRms: number, f: number): number => (Math.SQRT2 * vRms) / (2 * Math.PI * f);
export const displacement = (vRms: number, f: number, t: number): number => swing(vRms, f) * (1 - Math.cos(2 * Math.PI * f * t));

/**
 * Nodal analysis of a resistive circuit as rms values, every source in phase (README: Fixtures: grid): node 0 at 0 V,
 * an unknown for every other node and one for each part of no resistance (a closed switch, connector or fuse, a
 * resistor of r 0, a source with no internal resistance), solved by Gaussian elimination with partial pivoting.
 * `conducts(part)` says whether a part with an input is closed. Returns each node's volts and each part's current,
 * signed from `from` to `to` through the part (0 for parts out of the circuit: open ones, meters and wires).
 */
export function solveRms(c: Circuit, conducts: (p: Part) => boolean): { v: number[]; i: number[] } {
  const node = new Map(c.nodes.map((n, k) => [n, k]));
  const at = (p: Part, k: 'from' | 'to'): number => node.get(String(p[k]))!;
  const n = c.nodes.length - 1;
  type Branch = { part: number; a: number; b: number; g: number; e: number; ideal: boolean };
  const branches: Branch[] = [];
  c.parts.forEach((p, k) => {
    if (p.kind === 'meter' || p.kind === 'wire' || !conducts(p)) return;
    const a = at(p, 'from'), b = at(p, 'to');
    const num = (key: string, d = 0): number => (typeof p[key] === 'number' ? (p[key] as number) : d);
    switch (p.kind) {
      case 'source_dc': case 'source_ac': {
        const e = p.kind === 'source_dc' ? num('v') : num('v_rms'), r = num('r_internal');
        branches.push(r > 0 ? { part: k, a, b, g: 1 / r, e, ideal: false } : { part: k, a, b, g: 0, e, ideal: true });
        break;
      }
      case 'load': branches.push({ part: k, a, b, g: 1 / loadOhms(num('p_rated'), num('v_rated')), e: 0, ideal: false }); break;
      case 'resistor': case 'fault': {
        const r = num('r');
        branches.push(r > 0 ? { part: k, a, b, g: 1 / r, e: 0, ideal: false } : { part: k, a, b, g: 0, e: 0, ideal: true });
        break;
      }
      default: branches.push({ part: k, a, b, g: 0, e: 0, ideal: true }); // switch, connector, fuse: closed, no resistance
    }
  });
  const ideal = branches.filter((x) => x.ideal);
  const size = n + ideal.length;
  const m = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  const row = (k: number): number => k - 1; // node k ≥ 1
  // KCL, written as the current leaving each node through its parts = 0. A part's current runs from a to b.
  for (const x of branches) {
    if (x.ideal) continue;
    // i = g (Va − Vb) + g e: the part's current from a to b (a source with internal resistance r drives e from a to b).
    for (const [k, s] of [[x.a, 1], [x.b, -1]] as const) {
      if (k === 0) continue;
      if (x.a !== 0) m[row(k)]![row(x.a)]! += s * x.g;
      if (x.b !== 0) m[row(k)]![row(x.b)]! -= s * x.g;
      m[row(k)]![size]! -= s * x.g * x.e;
    }
  }
  ideal.forEach((x, j) => {
    const col = n + j;
    if (x.a !== 0) m[row(x.a)]![col]! += 1; // leaves a
    if (x.b !== 0) m[row(x.b)]![col]! -= 1; // arrives at b
    // Vb − Va = e
    if (x.b !== 0) m[col]![row(x.b)]! += 1;
    if (x.a !== 0) m[col]![row(x.a)]! -= 1;
    m[col]![size] = x.e;
  });
  for (let c0 = 0; c0 < size; c0++) {
    let best = c0;
    for (let r = c0 + 1; r < size; r++) if (Math.abs(m[r]![c0]!) > Math.abs(m[best]![c0]!)) best = r;
    if (Math.abs(m[best]![c0]!) < 1e-300) throw Error(`solveRms: the circuit has no single solution (column ${c0})`);
    [m[c0], m[best]] = [m[best]!, m[c0]!];
    for (let r = 0; r < size; r++) {
      if (r === c0) continue;
      const f = m[r]![c0]! / m[c0]![c0]!;
      if (f === 0) continue;
      for (let q = c0; q <= size; q++) m[r]![q]! -= f * m[c0]![q]!;
    }
  }
  const x = m.map((r, k) => r[size]! / r[k]!);
  const v = [0, ...x.slice(0, n)];
  const i = new Array<number>(c.parts.length).fill(0);
  for (const b of branches) i[b.part] = b.ideal ? x[n + ideal.indexOf(b)]! : b.g * (v[b.a]! - v[b.b]! + b.e);
  return { v, i };
}
