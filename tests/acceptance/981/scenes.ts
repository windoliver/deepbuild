// The lane graphs, vehicles and runs of this suite, and every expected value worked out from first principles
// (README: The surface, Scenes). Nothing here reads a library: positions come from the rest-to-rest profile, zones
// from the zone rule, routes from a search over the drawn paths, and each run's timeline from the reservation rule,
// each written out in its fixture's answer (fixtures.ts).

import { seeded } from '../190/helpers.ts';

export type Pt = [number, number];
/** A floor path (path@1, straight lines): an edge from its first point to its last, or both ways. */
export interface Path { id: string; pts: Pt[]; twoWay?: boolean; speed: number }
export interface Vehicle { length: number; width: number; gap: number; speed: number; accel: number; decel: number; lift?: { max: number; speed: number } }
/** A lane graph, its bays (written in name order, so the item's order and name order agree) and its vehicle. */
export interface Scene { name: string; paths: Path[]; bays: Record<string, Pt>; vehicle: Vehicle; rate: number }

/** The state codes the library writes (README: Arrays). */
export const STATE = { parked: 0, driving: 1, waiting: 2, lifting: 3, lowering: 4 } as const;
/** The criteria's tolerance on positions. */
export const TOL = 1e-6;

const sorted = (bays: Record<string, Pt>): Record<string, Pt> => Object.fromEntries(Object.entries(bays).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
export const bayNames = (s: Scene): string[] => Object.keys(s.bays);
export function bay(s: Scene, name: string): number {
  const i = bayNames(s).indexOf(name);
  if (i < 0) throw Error(`${s.name} has no bay ${name}`);
  return i;
}

// ---------------------------------------------------------------------------------------------------
// Geometry.

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lengthOf = (pts: Pt[]): number => pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0);
/** The point a distance `s` along a polyline (clamped to its ends), with the heading there. */
export function along(pts: Pt[], s: number): { p: Pt; heading: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, d = dist(a, b);
    if (left <= d || i === pts.length - 1) {
      const f = d === 0 ? 0 : Math.min(left, d) / d;
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    left -= d;
  }
  return { p: pts[0]!, heading: 0 };
}
const same = (a: Pt, b: Pt): boolean => dist(a, b) <= 0.05;
/** A route as the polyline of its paths, each taken forward (+) or backward (−), joined end to start. */
export function polyline(s: Scene, legs: string[]): Pt[] {
  const out: Pt[] = [];
  for (const leg of legs) {
    const back = leg.startsWith('-');
    const path = s.paths.find((p) => p.id === leg.replace(/^[+-]/, ''));
    if (!path) throw Error(`${s.name} has no path ${leg}`);
    const pts = back ? [...path.pts].reverse() : path.pts;
    if (out.length && !same(out[out.length - 1]!, pts[0]!)) throw Error(`${s.name}: ${leg} doesn't start where the route is`);
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The graph as the check builds it (README: Lane graph): nodes where ends meet, junctions, zones and routes.

interface Graph { nodes: Pt[]; ends: [number, number][]; degree: number[]; edges: { path: string; from: number; to: number; length: number; time: number }[] }
function graphOf(s: Scene): Graph {
  const nodes: Pt[] = [];
  const node = (p: Pt): number => { const i = nodes.findIndex((n) => same(n, p)); if (i >= 0) return i; nodes.push(p); return nodes.length - 1; };
  const ends = s.paths.map((p) => [node(p.pts[0]!), node(p.pts[p.pts.length - 1]!)] as [number, number]);
  const degree = nodes.map((_, i) => ends.reduce((n, [a, b]) => n + (a === i ? 1 : 0) + (b === i ? 1 : 0), 0));
  const edges = s.paths.flatMap((p, i) => {
    const [a, b] = ends[i]!;
    const length = lengthOf(p.pts);
    const fwd = { path: p.id, from: a, to: b, length, time: length / p.speed };
    return p.twoWay ? [fwd, { ...fwd, from: b, to: a }] : [fwd];
  });
  return { nodes, ends, degree, edges };
}
/** The node a point names (a bay), or −1. */
const nodeAt = (g: Graph, p: Pt): number => g.nodes.findIndex((n) => same(n, p));
/** The quickest time from node `from` to node `to` over the directed edges (Dijkstra; ties don't change a time). */
function quickest(g: Graph, from: number, to: number, avoid: (e: Graph['edges'][number]) => boolean = () => false): number {
  const best = g.nodes.map(() => Infinity);
  const done = g.nodes.map(() => false);
  best[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < best.length; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0) return Infinity;
    if (u === to) return best[u]!;
    done[u] = true;
    for (const e of g.edges) if (e.from === u && !avoid(e) && best[u]! + e.time < best[e.to]!) best[e.to] = best[u]! + e.time;
  }
}
/** The bays no other bay reaches (README: refusals): every bay must be reachable from some other bay. */
export function unreachableBays(s: Scene): string[] {
  const g = graphOf(s);
  const at = bayNames(s).map((n) => nodeAt(g, s.bays[n]!));
  return bayNames(s).filter((_, i) => !at.some((from, j) => j !== i && quickest(g, from, at[i]!) < Infinity));
}

/** A junction's zone reaches this far along each path that ends there: half a vehicle's length plus its gap. */
export const junctionReach = (v: Vehicle): number => (v.length + v.gap) / 2;
interface PathZones { path: string; length: number; zones: [number, number][]; startJunction: boolean; endJunction: boolean }
/**
 * The zone rule (README: Zones): a node where three or more path ends meet is a junction, one zone reaching
 * junctionReach along each of its paths; each path's stretch left between its junctions is cut into
 * max(1, ⌊stretch ÷ (length + gap)⌋) equal zones, named `<path>.<i>` from its first point.
 */
export function zonesOf(s: Scene): { paths: PathZones[]; junctions: { node: number; name: string; paths: string[] }[] } {
  const g = graphOf(s);
  const r = junctionReach(s.vehicle);
  const unit = s.vehicle.length + s.vehicle.gap;
  const paths = s.paths.map((p, i) => {
    const [a, b] = g.ends[i]!;
    const length = lengthOf(p.pts);
    const startJunction = g.degree[a]! >= 3, endJunction = g.degree[b]! >= 3;
    const from = startJunction ? r : 0, to = length - (endJunction ? r : 0);
    const n = Math.max(1, Math.floor((to - from) / unit + 1e-12));
    const z = (to - from) / n;
    return { path: p.id, length, startJunction, endJunction, zones: Array.from({ length: n }, (_, k) => [from + k * z, from + (k + 1) * z] as [number, number]) };
  });
  const junctions = g.nodes.flatMap((_, node) => {
    if (g.degree[node]! < 3) return [];
    const ids = s.paths.filter((_, i) => g.ends[i]!.includes(node)).map((p) => p.id).sort();
    return [{ node, name: `junction:${ids.join(',')}`, paths: ids }];
  });
  return { paths, junctions };
}
export const pathZones = (s: Scene, id: string): PathZones => {
  const z = zonesOf(s).paths.find((p) => p.path === id);
  if (!z) throw Error(`${s.name} has no path ${id}`);
  return z;
};
/** A route's zones in the order it meets them, at distances along the route from its start (README: Zones). */
export interface RouteZone { name: string; from: number; to: number; junction: boolean }
export function routeZones(s: Scene, legs: string[]): RouteZone[] {
  const g = graphOf(s);
  const { paths, junctions } = zonesOf(s);
  const r = junctionReach(s.vehicle);
  const out: RouteZone[] = [];
  let at = 0;
  legs.forEach((leg, i) => {
    const id = leg.replace(/^[+-]/, ''), back = leg.startsWith('-');
    const z = paths.find((p) => p.path === id)!;
    const pz = z.zones.map(([a, b], k) => (back ? { name: `${id}.${k}`, from: at + z.length - b, to: at + z.length - a } : { name: `${id}.${k}`, from: at + a, to: at + b }));
    out.push(...(back ? pz.reverse() : pz).map((x) => ({ ...x, junction: false })));
    at += z.length;
    if (i + 1 < legs.length) {
      const [a, b] = g.ends[s.paths.findIndex((p) => p.id === id)]!;
      const j = junctions.find((x) => x.node === (back ? a : b));
      if (j) out.push({ name: j.name, from: at - r, to: at + r, junction: true });
    }
  });
  return out.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------------------------------
// Motion: rest to rest over a distance, speeding up at accel to the limit, slowing at decel (README: Motion).

export interface Profile { distance: number; time: number; at: (t: number) => number; speed: (t: number) => number; reach: (s: number) => number }
/** The rest-to-rest profile over `d` with top speed `v` (reached: every leg here is long enough), accel `a`, decel `b`. */
export function profile(d: number, v: number, a: number, b: number): Profile {
  const ta = v / a, tb = v / b, sa = (v * v) / (2 * a), sb = (v * v) / (2 * b);
  if (d < sa + sb) throw Error(`a leg of ${d} m doesn't reach ${v} m/s`);
  const T = ta + tb + (d - sa - sb) / v;
  const at = (t: number): number => (t <= 0 ? 0 : t <= ta ? (a * t * t) / 2 : t <= T - tb ? sa + v * (t - ta) : t <= T ? d - (b * (T - t) * (T - t)) / 2 : d);
  const speed = (t: number): number => (t <= 0 ? 0 : t <= ta ? a * t : t <= T - tb ? v : t <= T ? b * (T - t) : 0);
  /** The time the profile first reaches distance s. */
  const reach = (s: number): number => (s <= sa ? Math.sqrt((2 * s) / a) : s <= d - sb ? ta + (s - sa) / v : T - Math.sqrt((2 * (d - s)) / b));
  return { distance: d, time: T, at, speed, reach };
}
/** The step whose end first comes at or after time t, steps of dt from t0 (step k ends at t0 + (k + 1)·dt). */
export const stepEnding = (t: number, dt: number, t0 = 0): number => Math.ceil((t - t0) / dt - 1e-9) - 1;
/** The look-ahead within which a vehicle reserves (README: Reservation): one step at its top speed plus its stop from there. */
export const horizon = (v: Vehicle, dt: number): number => v.speed * dt + (v.speed * v.speed) / (2 * v.decel);
/** The first step whose start finds `boundary` (a distance its front reaches) within the horizon, on a free run from step k0. */
export function attemptStep(p: Profile, frontAt0: number, boundary: number, h: number, dt: number, k0 = 0): number {
  for (let k = k0; ; k++) if (frontAt0 + p.at((k - k0) * dt) + h >= boundary) return k;
}

// ---------------------------------------------------------------------------------------------------
// The scenes.

const VEHICLE: Vehicle = { length: 2, width: 1, gap: 0.5, speed: 2, accel: 1, decel: 1 };

/** Criterion 1: one vehicle on a straight 20 m two-way edge with a 2 m/s limit; its own top speed is 3 m/s, so the edge's limit holds it. */
export const STRAIGHT: Scene = {
  name: 'straight', rate: 10,
  paths: [{ id: 'e', pts: [[0, 0], [20, 0]], twoWay: true, speed: 2 }],
  bays: sorted({ 'park.a': [0, 0], 'rack.b': [20, 0] }),
  vehicle: { ...VEHICLE, speed: 3 },
};

/**
 * Criterion 2: two lanes, `a` from the west and `b` from the south, meet `c1` at the junction J (0, 0); c1 runs east to
 * the bay rack.m, then c2 to dock.e. Vehicle 0 starts at park.w (20 m west), vehicle 1 at park.s (20 m south); both
 * go through J onto c1, vehicle 0 on to dock.e, vehicle 1 to rack.m. Every path is two-way, so every bay reaches
 * every other.
 */
export const MERGE: Scene = {
  name: 'merge', rate: 10,
  paths: [
    { id: 'a', pts: [[-20, 0], [0, 0]], twoWay: true, speed: 2 },
    { id: 'b', pts: [[0, -20], [0, 0]], twoWay: true, speed: 2 },
    { id: 'c1', pts: [[0, 0], [6.25, 0]], twoWay: true, speed: 2 },
    { id: 'c2', pts: [[6.25, 0], [16.25, 0]], twoWay: true, speed: 2 },
  ],
  bays: sorted({ 'dock.e': [16.25, 0], 'park.s': [0, -20], 'park.w': [-20, 0], 'rack.m': [6.25, 0] }),
  vehicle: VEHICLE,
};

// Criterion 3's square: corners N0..N3 counterclockwise, each side one way; each corner links out along its diagonal
// to an outer junction O_i, from which a spur runs on to the bay park.i, and the O_i make a one-way outer ring.
const D = 6 / Math.SQRT2;
const N: Pt[] = [[-3, -3], [3, -3], [3, 3], [-3, 3]];
const OUT: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const O: Pt[] = N.map((n, i) => [n[0] + OUT[i]![0] * D, n[1] + OUT[i]![1] * D]);
const B: Pt[] = O.map((o, i) => [o[0] + OUT[i]![0] * D, o[1] + OUT[i]![1] * D]);
/**
 * Criterion 3: the square of four junctions N0..N3 (sides s0: N0→N1, s1: N1→N2, s2: N2→N3, s3: N3→N0, 6 m, one way),
 * links l_i (O_i–N_i, 6 m, two-way), the outer ring o_i (O_i→O_{i+1}, one way) and spurs p_i (park.i–O_i, 6 m,
 * two-way). Vehicle i starts at park.i and goes to park.(i+2): spur, link, side s_i, side s_{i+1}, link, spur.
 */
export const LOOP: Scene = {
  name: 'loop', rate: 10,
  paths: [
    ...[0, 1, 2, 3].map((i) => ({ id: `l${i}`, pts: [O[i]!, N[i]!], twoWay: true, speed: 2 })),
    ...[0, 1, 2, 3].map((i) => ({ id: `o${i}`, pts: [O[i]!, O[(i + 1) % 4]!], speed: 2 })),
    ...[0, 1, 2, 3].map((i) => ({ id: `p${i}`, pts: [B[i]!, O[i]!], twoWay: true, speed: 2 })),
    ...[0, 1, 2, 3].map((i) => ({ id: `s${i}`, pts: [N[i]!, N[(i + 1) % 4]!], speed: 2 })),
  ],
  bays: sorted({ 'park.0': B[0]!, 'park.1': B[1]!, 'park.2': B[2]!, 'park.3': B[3]! }),
  vehicle: VEHICLE,
};
/** Vehicle i's quickest route, from park.i to park.(i+2), as paths. */
export const loopRoute = (i: number): string[] => [`+p${i}`, `+l${i}`, `+s${i}`, `+s${(i + 1) % 4}`, `-l${(i + 2) % 4}`, `-p${(i + 2) % 4}`];
/** Vehicle 0's next quickest route avoiding the zone of s1 it waits for: out at N1 by l1, round the ring o1 to O2, in to park.2. */
export const LOOP_DETOUR = ['+p0', '+l0', '+s0', '-l1', '+o1', '-p2'];
/** The step vehicle 0 is sent (README: Scenes: loop): late enough that the three others wait first. */
export const LOOP_V0_AT = 10;

/**
 * Criterion 4: park.p (0, 0) – rack.r (10.1, 0) – dock.d (20, 0), two-way; the vehicle's mast lifts to 6 m at 1 m/s.
 * The rack is 10.1 m out so the vehicle comes to rest inside a step (at 7.15 s), not on a step's end.
 */
export const LIFT: Scene = {
  name: 'lift', rate: 10,
  paths: [{ id: 'p', pts: [[0, 0], [10.1, 0]], twoWay: true, speed: 2 }, { id: 'q', pts: [[10.1, 0], [20, 0]], twoWay: true, speed: 2 }],
  bays: sorted({ 'dock.d': [20, 0], 'park.p': [0, 0], 'rack.r': [10.1, 0] }),
  vehicle: { ...VEHICLE, lift: { max: 6, speed: 1 } },
};
export const RACK_LEVEL = 5.4;
export const FORKS_LOW = 0.1;

// Criterion 5: a one-way loop round a 75 m square, counterclockwise, with 20 junctions 15 m apart (at 7.5 m + 15k
// along it, none at a corner), each with a 5 m two-way spur out to a bay. Six of the bays are the vehicles' park bays.
const SIDE = 75;
const corner = (k: number): Pt => [[0, 0], [SIDE, 0], [SIDE, SIDE], [0, SIDE]][k % 4] as Pt;
function onLoop(p: number): { at: Pt; out: Pt } {
  const side = Math.floor(p / SIDE) % 4, f = p - side * SIDE;
  const a = corner(side), b = corner(side + 1);
  const at: Pt = [a[0] + ((b[0] - a[0]) * f) / SIDE, a[1] + ((b[1] - a[1]) * f) / SIDE];
  return { at, out: ([[0, -1], [1, 0], [0, 1], [-1, 0]] as Pt[])[side]! };
}
const FLEET_PARKS = [0, 3, 7, 10, 13, 17];
const two = (k: number): string => String(k).padStart(2, '0');
const fleetBayName = (k: number): string => `${FLEET_PARKS.includes(k) ? 'park' : 'rack'}.${two(k)}`;
function fleet(): Scene {
  const stops = [...Array.from({ length: 20 }, (_, k) => 7.5 + 15 * k), 0, 75, 150, 225].sort((a, b) => a - b);
  const paths: Path[] = stops.map((p, i) => ({ id: `l${two(i)}`, pts: [onLoop(p).at, onLoop(stops[(i + 1) % stops.length]!).at], speed: 2 }));
  const bays: Record<string, Pt> = {};
  for (let k = 0; k < 20; k++) {
    const { at, out } = onLoop(7.5 + 15 * k);
    const end: Pt = [at[0] + 5 * out[0], at[1] + 5 * out[1]];
    paths.push({ id: `s${two(k)}`, pts: [end, at], twoWay: true, speed: 2 });
    bays[fleetBayName(k)] = end;
  }
  return { name: 'fleet', rate: 2, paths, bays: sorted(bays), vehicle: VEHICLE };
}
export const FLEET = fleet();
/** Eight simulated hours. */
export const FLEET_STEPS = 8 * 3600 * FLEET.rate;
export const FLEET_TASKS = 500;
/**
 * The 500 seeded tasks (mulberry32, seed 981): task t goes to vehicle t mod 6 as two legs, a pickup bay and a drop bay,
 * both drawn among the 14 work bays, the pickup never the bay the vehicle is at and the drop never the pickup; after
 * its last task each vehicle goes back to its own park bay. Legs are bay indexes.
 */
export function fleetLegs(): number[][] {
  const r = seeded(981);
  const parks = FLEET_PARKS.map((k) => bay(FLEET, fleetBayName(k)));
  const work = bayNames(FLEET).map((_, i) => i).filter((i) => !parks.includes(i));
  const pick = (not: number): number => { for (;;) { const b = work[Math.floor(r() * work.length)]!; if (b !== not) return b; } };
  const legs: number[][] = parks.map(() => []);
  for (let t = 0; t < FLEET_TASKS; t++) {
    const v = t % parks.length;
    const last = legs[v]!.length ? legs[v]![legs[v]!.length - 1]! : parks[v]!;
    const a = pick(last);
    legs[v]!.push(a, pick(a));
  }
  parks.forEach((p, v) => legs[v]!.push(p));
  return legs;
}
export const fleetParks = (): number[] => FLEET_PARKS.map((k) => bay(FLEET, fleetBayName(k)));

/** Criterion 6: m1 and m2 two-way along y = 0 between park.1 and park.2, and rack.7's spur r running one way out of the rack. */
export function refused(twoWayRack: boolean): Scene {
  return {
    name: twoWayRack ? 'reached' : 'refused', rate: 10,
    paths: [
      { id: 'm1', pts: [[0, 0], [10, 0]], twoWay: true, speed: 2 },
      { id: 'm2', pts: [[10, 0], [20, 0]], twoWay: true, speed: 2 },
      { id: 'r', pts: [[10, -5], [10, 0]], twoWay: twoWayRack, speed: 2 },
    ],
    bays: sorted({ 'park.1': [0, 0], 'park.2': [20, 0], 'rack.7': [10, -5] }),
    vehicle: VEHICLE,
  };
}

// Criterion 8: a 6 × 32 grid of nodes 10 m apart with one-way streets, rows east and west by turns (row 0 east) and
// columns south and north by turns (column 0 south), so its rim is one counterclockwise loop and every node reaches
// every other; and 54 two-way 5 m spurs, from the bottom row's and the top row's columns 1 to 27 out to bays.
// 6·31 + 5·32 + 54 = 400 paths.
export const GRID = { rows: 6, cols: 32, spacing: 10, spurCols: 27, vehicles: 50 };
function grid(): Scene {
  const { rows, cols, spacing: h } = GRID;
  const p = (c: number, r: number): Pt => [c * h, r * h];
  const paths: Path[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) paths.push({ id: `h${r}.${two(c)}`, pts: r % 2 === 0 ? [p(c, r), p(c + 1, r)] : [p(c + 1, r), p(c, r)], speed: 2 });
  for (let c = 0; c < cols; c++) for (let r = 0; r + 1 < rows; r++) paths.push({ id: `v${two(c)}.${r}`, pts: c % 2 === 0 ? [p(c, r + 1), p(c, r)] : [p(c, r), p(c, r + 1)], speed: 2 });
  const bays: Record<string, Pt> = {};
  for (let c = 1; c <= GRID.spurCols; c++) {
    bays[`bot.${two(c)}`] = [c * h, -5];
    bays[`top.${two(c)}`] = [c * h, (rows - 1) * h + 5];
    paths.push({ id: `sb.${two(c)}`, pts: [[c * h, -5], p(c, 0)], twoWay: true, speed: 2 });
    paths.push({ id: `st.${two(c)}`, pts: [[c * h, (rows - 1) * h + 5], p(c, rows - 1)], twoWay: true, speed: 2 });
  }
  return { name: 'grid', rate: 10, paths, bays: sorted(bays), vehicle: VEHICLE };
}
export const GRIDSCENE = grid();
/** The far bay pairs the route-search program asks for in turn: bot.01 → top.27, top.27 → bot.01, bot.27 → top.01, top.01 → bot.27. */
export const SEARCHES: [number, number][] = [['bot.01', 'top.27'], ['top.27', 'bot.01'], ['bot.27', 'top.01'], ['top.01', 'bot.27']].map(([a, b]) => [bay(GRIDSCENE, a!), bay(GRIDSCENE, b!)]);
/** The quickest time between two bays of a scene, in seconds (length ÷ speed limit, summed). */
export function bayTime(s: Scene, from: number, to: number): number {
  const g = graphOf(s);
  return quickest(g, nodeAt(g, s.bays[bayNames(s)[from]!]!), nodeAt(g, s.bays[bayNames(s)[to]!]!));
}
/** Every node of a scene's graph reaches every other (a check of this suite's own grid). */
export function stronglyConnected(s: Scene): boolean {
  const g = graphOf(s);
  const reach = (from: number, fwd: boolean): number => {
    const seen = new Set([from]);
    const todo = [from];
    while (todo.length) { const u = todo.pop()!; for (const e of g.edges) { const [a, b] = fwd ? [e.from, e.to] : [e.to, e.from]; if (a === u && !seen.has(b)) { seen.add(b); todo.push(b); } } }
    return seen.size;
  };
  return reach(0, true) === g.nodes.length && reach(0, false) === g.nodes.length;
}
