// The expected values of #3604's fixtures, worked from first principles (README: Fixtures) and nothing taken from a
// library: the constants the issue states (a breaker's θ at opening 1.69 = 1.3² and τ = 60 s, its magnetic multiples,
// an RCD's 0.2 s and its 0.01 s floor), the closed forms they give, and a nodal solver for resistive circuits with
// ideal transformers that the budget's board and the doorbell are held to.

import type { Circuit, Part } from './circuits.ts';

/** A breaker's thermal element: it opens at θ = 1.69 (1.3²), and θ' = ((i ÷ rating)² − θ) ÷ τ, τ = 60 s. */
export const BREAKER = { open: 1.69, tau: 60, magnetic: { B: 4, C: 7.5, D: 15 } } as const;
/** An RCD's count: its time 0.2 s × rating ÷ residual, never under 0.01 s. */
export const RCD = { time: 0.2, floor: 0.01 } as const;

/** θ after t seconds at x times the rating, from θ0: x² − (x² − θ0) e^(−t/τ). */
export const heatAfter = (x2: number, t: number, theta0 = 0): number => x2 - (x2 - theta0) * Math.exp(-t / BREAKER.tau);
/** The time θ takes to reach 1.69 at x² from θ0: −τ ln((x² − 1.69) ÷ (x² − θ0)); never at or under 1.69. */
export const thermalTime = (x2: number, theta0 = 0): number => (x2 <= BREAKER.open ? Infinity : -BREAKER.tau * Math.log((x2 - BREAKER.open) / (x2 - theta0)));
/** The time an RCD's count takes to reach 1 at a steady residual at or above its rating. */
export const rcdTime = (residual: number, rating: number): number => (residual < rating ? Infinity : Math.max(RCD.floor, (RCD.time * rating) / residual));
/**
 * The step the count gives, counted as the issue counts it at a step of `dt` s: it rises by dt ÷ time at each step
 * from the first, and the RCD opens at the start of the first step it has reached 1.
 */
export function rcdSteps(residual: number, rating: number, dt: number): number {
  const rise = dt / rcdTime(residual, rating);
  let count = 0;
  for (let n = 0; n < 1e6; n++) { if (count >= 1) return n; count += rise; }
  return Infinity;
}
/**
 * The steps a breaker's thermal element takes to open at a step of `dt` s, its heat moved over each step it carries
 * x times the rating as the closed form gives it (θ e^(−dt/τ) + x² (1 − e^(−dt/τ))), opening at the start of the
 * first step θ has reached 1.69.
 */
export function thermalSteps(x2: number, dt: number, theta0 = 0): { steps: number; theta: number } {
  const c = Math.exp(-dt / BREAKER.tau);
  let theta = theta0;
  for (let n = 0; n < 1e7; n++) { if (theta >= BREAKER.open) return { steps: n, theta }; theta = theta * c + x2 * (1 - c); }
  return { steps: Infinity, theta };
}
/** A load's resistance from its rating: v_rated² ÷ p_rated. */
export const loadOhms = (pRated: number, vRated: number): number => (vRated * vRated) / pRated;

/**
 * Nodal analysis of a resistive circuit as rms values, its sources in phase: node 0 at 0 V, an unknown for every other
 * node, one for each part of no resistance (a closed switch, connector, fuse or breaker, each RCD pole, a changeover's
 * joined way, a resistor of 0 Ω, a source with no internal resistance), and two for each ideal transformer (its
 * windings' currents, with V₂ = V₁ × n2 ÷ n1 and I₁ = −I₂ × n2 ÷ n1, each winding's volts from its first node to its
 * second and its current from its first node to its second through it). A part of the network that nothing joins to
 * node 0 is held at 0 V at its lowest node. Gaussian elimination with partial pivoting. `way(part)` is a changeover's
 * joined way ('a' or 'b'); every other part conducts. Returns each part's current `i` (an RCD's live pole, a
 * transformer's primary) and `i2` (an RCD's neutral pole, a transformer's secondary), signed from first node to second.
 */
export function solveRms(c: Circuit, way: (p: Part) => 'a' | 'b' = () => 'a'): { v: number[]; i: number[]; i2: number[] } {
  const node = new Map(c.nodes.map((n, k) => [n, k]));
  const at = (x: unknown): number => node.get(String(x))!;
  const n = c.nodes.length - 1;
  type Branch = { part: number; second: boolean; a: number; b: number; g: number; e: number; ideal: boolean };
  const branches: Branch[] = [];
  const tx: { part: number; p: [number, number]; s: [number, number]; ratio: number }[] = [];
  const num = (p: Part, key: string, d = 0): number => (typeof p[key] === 'number' ? (p[key] as number) : d);
  const ideal = (part: number, a: number, b: number, e = 0, second = false): void => { branches.push({ part, second, a, b, g: 0, e, ideal: true }); };
  c.parts.forEach((p, k) => {
    const pair = (key: string): [number, number] => { const x = p[key] as unknown as [string, string]; return [at(x[0]), at(x[1])]; };
    switch (p.kind) {
      case 'source_dc': case 'source_ac': {
        const e = p.kind === 'source_dc' ? num(p, 'v') : num(p, 'v_rms'), r = num(p, 'r_internal');
        if (r > 0) branches.push({ part: k, second: false, a: at(p['from']), b: at(p['to']), g: 1 / r, e, ideal: false });
        else ideal(k, at(p['from']), at(p['to']), e);
        break;
      }
      case 'load': branches.push({ part: k, second: false, a: at(p['from']), b: at(p['to']), g: 1 / loadOhms(num(p, 'p_rated'), num(p, 'v_rated')), e: 0, ideal: false }); break;
      case 'resistor': case 'fault': {
        const r = num(p, 'r');
        if (r > 0) branches.push({ part: k, second: false, a: at(p['from']), b: at(p['to']), g: 1 / r, e: 0, ideal: false });
        else ideal(k, at(p['from']), at(p['to']));
        break;
      }
      case 'switch': case 'connector': case 'fuse': case 'breaker': ideal(k, at(p['from']), at(p['to'])); break;
      case 'rcd': { const [la, lb] = pair('live'), [na, nb] = pair('neutral'); ideal(k, la, lb); ideal(k, na, nb, 0, true); break; }
      case 'changeover': ideal(k, at(p['common']), at(p[way(p)])); break;
      case 'transformer': { const t = p['turns'] as number[]; tx.push({ part: k, p: pair('primary'), s: pair('secondary'), ratio: t[1]! / t[0]! }); break; }
      default: throw Error(`solveRms: no model of a ${p.kind}`);
    }
  });
  // Conductive groups: what each node joins through a part (a transformer's winding joins its own two nodes only).
  const group = c.nodes.map((_, k) => k);
  const find = (k: number): number => (group[k] === k ? k : (group[k] = find(group[k]!)));
  const join = (a: number, b: number): void => { group[find(a)] = find(b); };
  for (const b of branches) join(b.a, b.b);
  for (const t of tx) { join(t.p[0], t.p[1]); join(t.s[0], t.s[1]); }
  const pinned = new Set<number>();
  for (let k = 1; k <= n; k++) if (find(k) !== find(0) && ![...pinned].some((q) => find(q) === find(k))) pinned.add(k);
  const ideals = branches.filter((x) => x.ideal);
  const size = n + ideals.length + 2 * tx.length;
  const m = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  const row = (k: number): number => k - 1;
  const add = (r: number, k: number, x: number): void => { if (k !== 0 && !pinned.has(r + 1)) m[r]![row(k)]! += x; };
  for (const x of branches) {
    if (x.ideal) continue;
    for (const [k, s] of [[x.a, 1], [x.b, -1]] as const) {
      if (k === 0 || pinned.has(k)) continue;
      add(row(k), x.a, s * x.g); add(row(k), x.b, -s * x.g);
      m[row(k)]![size]! -= s * x.g * x.e;
    }
  }
  const current = (col: number, a: number, b: number): void => {
    if (a !== 0 && !pinned.has(a)) m[row(a)]![col]! += 1;
    if (b !== 0 && !pinned.has(b)) m[row(b)]![col]! -= 1;
  };
  ideals.forEach((x, j) => {
    const col = n + j;
    current(col, x.a, x.b);
    if (x.b !== 0) m[col]![row(x.b)]! += 1;
    if (x.a !== 0) m[col]![row(x.a)]! -= 1;
    m[col]![size] = x.e;
  });
  tx.forEach((t, j) => {
    const c1 = n + ideals.length + 2 * j, c2 = c1 + 1;
    current(c1, t.p[0], t.p[1]); current(c2, t.s[0], t.s[1]);
    // V₂ − ratio V₁ = 0, each winding's volts from its first node to its second.
    const volts = (r: number, [a, b]: [number, number], s: number): void => { if (a !== 0) m[r]![row(a)]! += s; if (b !== 0) m[r]![row(b)]! -= s; };
    volts(c1, t.s, 1); volts(c1, t.p, -t.ratio);
    // I₁ + ratio I₂ = 0: no power taken.
    m[c2]![c1] = 1; m[c2]![c2] = t.ratio;
  });
  for (const k of pinned) m[row(k)]![row(k)] = 1;
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
  const i = new Array<number>(c.parts.length).fill(0), i2 = new Array<number>(c.parts.length).fill(0);
  for (const b of branches) {
    const amps = b.ideal ? x[n + ideals.indexOf(b)]! : b.g * (v[b.a]! - v[b.b]! + b.e);
    if (b.second) i2[b.part] = amps; else i[b.part] = amps;
  }
  tx.forEach((t, j) => { i[t.part] = x[n + ideals.length + 2 * j]!; i2[t.part] = x[n + ideals.length + 2 * j + 1]!; });
  return { v, i, i2 };
}
