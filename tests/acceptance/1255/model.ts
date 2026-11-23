// The model the expected values come from (README: The distance, window and delay rules): movers that fly straight
// between fixes, closest approach and conflict windows solved in closed form on each stretch where both keep one
// velocity, and the delay rule. Nothing here samples time, and nothing here comes from a run. It counts as a reference
// because it gives the cases worked by hand in the README (the tests hold it to them) and because its wrong twin, the
// sampler at whole seconds below, fails them. It imports nothing, so it runs in plain node too.

/** A position in metres: [x, y, z], +Y up (design: Units and axes), so y is the altitude and (x, z) the lateral plane. */
export type Vec3 = [number, number, number];
export interface Fix { fix: string; at: Vec3 }
export interface SpeedFrom { from_fix: string; speed: number }
export interface Band { fix: string; min: number; max: number }
export interface Mover { id: string; class: string; route: Fix[]; speed: SpeedFrom[]; band: Band[]; start: number }
export type Basis = 'invented' | { cited: { source: string; section: string } };
export interface Row { leader: string; follower: string; min: number; at: string; basis?: Basis }
export interface Minima { lateral: number; vertical: number; by_pair: Row[] }
export interface Scene { movers: Mover[]; minima: Minima }

/** A mover as flown: one slot for each fix of its route (ref: its index there), and one (ref −1) for the off-route point a stretch adds. */
export interface Slot { ref: number; at: Vec3; speed: number; time: number }
/** A conflict window (README: Windows): the pair by index, a < b; the minimum that applied; its row (−1: the table's lateral minimum) and that row's basis (0 none, 1 cited, 2 invented). */
export interface Window { a: number; b: number; from: number; to: number; min: number; row: number; basis: number }
export const BASIS = { none: 0, cited: 1, invented: 2 } as const;

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const norm = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
const fail = (what: string): never => { throw Error(`model: ${what}`); };

/** A mover's slots from its document data: its start, then each fix's time from the leg's straight-line length ÷ the speed given from the fix before. */
export function fly(m: Mover): Slot[] {
  let v = NaN, t = m.start;
  const out: Slot[] = [];
  m.route.forEach((f, j) => {
    if (j > 0) t += norm(sub(f.at, m.route[j - 1]!.at)) / v;
    const given = m.speed.find((s) => s.from_fix === f.fix);
    if (given) v = given.speed;
    if (!(v > 0)) fail(`${m.id} has no speed from ${f.fix}`);
    out.push({ ref: j, at: [...f.at], speed: j < m.route.length - 1 ? v : 0, time: t });
  });
  return out;
}
export const flyAll = (s: Scene): Slot[][] => s.movers.map(fly);
const first = (s: Slot[]): number => s[0]!.time;
const last = (s: Slot[]): number => s[s.length - 1]!.time;
/** The leg a mover is on at t (its last leg at its last fix's time). */
function legAt(s: Slot[], t: number): number {
  let j = 0;
  while (j < s.length - 2 && t >= s[j + 1]!.time) j += 1;
  return j;
}
/** Where a mover is at t, linear between its slots; null off its route. */
export function positionAt(s: Slot[], t: number): Vec3 | null {
  if (t < first(s) || t > last(s)) return null;
  const j = legAt(s, t), p = s[j]!, q = s[j + 1]!;
  const u = (t - p.time) / (q.time - p.time);
  return [p.at[0] + (q.at[0] - p.at[0]) * u, p.at[1] + (q.at[1] - p.at[1]) * u, p.at[2] + (q.at[2] - p.at[2]) * u];
}
function velocityOn(s: Slot[], j: number): Vec3 {
  const p = s[j]!, q = s[j + 1]!, d = q.time - p.time;
  return [(q.at[0] - p.at[0]) / d, (q.at[1] - p.at[1]) / d, (q.at[2] - p.at[2]) / d];
}
/** The stretches of [lo, hi] on which both movers keep one velocity: cut at every slot time of either inside it. */
function stretches(a: Slot[], b: Slot[], lo: number, hi: number): { from: number; to: number; p: Vec3; v: Vec3 }[] {
  const cuts = [lo, ...[...a, ...b].map((s) => s.time).filter((t) => t > lo && t < hi).sort((x, y) => x - y), hi].filter((t, i, all) => i === 0 || t > all[i - 1]!);
  const out: { from: number; to: number; p: Vec3; v: Vec3 }[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!, to = cuts[i + 1]!, mid = (from + to) / 2;
    out.push({ from, to, p: sub(positionAt(b, from)!, positionAt(a, from)!), v: sub(velocityOn(b, legAt(b, mid)), velocityOn(a, legAt(a, mid))) });
  }
  return out;
}
/** The times both movers are on their routes within [t0, t1], or null. */
function shared(a: Slot[], b: Slot[], t0: number, t1: number): [number, number] | null {
  const lo = Math.max(t0, first(a), first(b)), hi = Math.min(t1, last(a), last(b));
  return lo < hi ? [lo, hi] : null;
}

/**
 * closest(a, b, t0, t1): the smallest straight-line distance between two movers while both are on their routes within
 * the span, and its time. On each stretch the squared distance is |p + v·τ|², a quadratic in τ whose least value is at
 * τ = −p·v ÷ v·v, held to the stretch. The earliest time wins a tie.
 */
export function closest(a: Slot[], b: Slot[], t0: number, t1: number): { dist: number; time: number } | null {
  const span = shared(a, b, t0, t1);
  if (!span) return null;
  let best: { dist: number; time: number } | null = null;
  for (const s of stretches(a, b, span[0], span[1])) {
    const vv = s.v[0] * s.v[0] + s.v[1] * s.v[1] + s.v[2] * s.v[2];
    const tau = vv === 0 ? 0 : Math.min(Math.max(-(s.p[0] * s.v[0] + s.p[1] * s.v[1] + s.p[2] * s.v[2]) / vv, 0), s.to - s.from);
    const dist = norm([s.p[0] + s.v[0] * tau, s.p[1] + s.v[1] * tau, s.p[2] + s.v[2] * tau]);
    if (!best || dist < best.dist) best = { dist, time: s.from + tau };
  }
  return best;
}

/** The lateral and vertical distance between two movers at t. */
export function apart(a: Slot[], b: Slot[], t: number): { lateral: number; vertical: number } | null {
  const p = positionAt(a, t), q = positionAt(b, t);
  return p && q ? { lateral: Math.hypot(q[0] - p[0], q[2] - p[2]), vertical: Math.abs(q[1] - p[1]) } : null;
}
/** The part of a stretch on which the pair is under its minimum: lateral distance < L (a quadratic's two roots) and vertical distance < V (a line's two crossings), both strict. */
function under(s: { from: number; to: number; p: Vec3; v: Vec3 }, L: number, V: number): [number, number] | null {
  let lo = 0, hi = s.to - s.from;
  const A = s.v[0] * s.v[0] + s.v[2] * s.v[2], B = 2 * (s.p[0] * s.v[0] + s.p[2] * s.v[2]), C = s.p[0] * s.p[0] + s.p[2] * s.p[2] - L * L;
  if (A === 0) { if (!(C < 0)) return null; } else {
    const disc = B * B - 4 * A * C;
    if (!(disc > 0)) return null;
    const r = Math.sqrt(disc);
    lo = Math.max(lo, (-B - r) / (2 * A));
    hi = Math.min(hi, (-B + r) / (2 * A));
  }
  if (s.v[1] === 0) { if (!(Math.abs(s.p[1]) < V)) return null; } else {
    const x = (-V - s.p[1]) / s.v[1], y = (V - s.p[1]) / s.v[1];
    lo = Math.max(lo, Math.min(x, y));
    hi = Math.min(hi, Math.max(x, y));
  }
  return lo < hi ? [s.from + lo, s.from + hi] : null;
}
const basisOf = (r: Row): number => (r.basis === 'invented' ? BASIS.invented : r.basis ? BASIS.cited : BASIS.none);

/**
 * conflicts(t0, t1): every window where a pair is under its minimum (README: Windows). The table's lateral minimum
 * gives, for each pair, the maximal stretches of time on which it is under it, pieces that meet at a slot's time
 * joined into one. A row measured at a fix gives an instant: the time its leader passes the fix, when the follower,
 * yet to pass it, is under the row's minimum there. Windows come by start, then pair.
 */
export function conflicts(scene: Scene, flown: Slot[][], t0: number, t1: number): Window[] {
  const out: Window[] = [];
  const { lateral, vertical, by_pair } = scene.minima;
  for (let a = 0; a < flown.length; a++) {
    for (let b = a + 1; b < flown.length; b++) {
      const span = shared(flown[a]!, flown[b]!, t0, t1);
      if (!span) continue;
      let open: [number, number] | null = null;
      for (const s of stretches(flown[a]!, flown[b]!, span[0], span[1])) {
        const u = under(s, lateral, vertical);
        if (open && u && u[0] - open[1] <= 1e-9) { open[1] = u[1]; continue; }
        if (open) out.push({ a, b, from: open[0], to: open[1], min: lateral, row: -1, basis: BASIS.none });
        open = u;
      }
      if (open) out.push({ a, b, from: open[0], to: open[1], min: lateral, row: -1, basis: BASIS.none });
    }
  }
  by_pair.forEach((r, row) => {
    if (r.at === 'always') return;
    scene.movers.forEach((lead, i) => scene.movers.forEach((follow, j) => {
      if (i === j || lead.class !== r.leader || follow.class !== r.follower) return;
      const at = (m: Mover, s: Slot[]): number | null => { const k = m.route.findIndex((f) => f.fix === r.at); return k < 0 ? null : s.find((x) => x.ref === k)!.time; };
      const ti = at(lead, flown[i]!), tj = at(follow, flown[j]!);
      if (ti === null || tj === null || !(ti < tj) || ti < t0 || ti > t1) return;
      const d = apart(flown[i]!, flown[j]!, ti);
      if (d && d.lateral < r.min && d.vertical < vertical) out.push({ a: Math.min(i, j), b: Math.max(i, j), from: ti, to: ti, min: r.min, row, basis: basisOf(r) });
    }));
  });
  return out.sort((x, y) => x.from - y.from || x.a - y.a || x.b - y.b);
}

// ---------------------------------------------------------------------------------------------------
// The wrong model: a sampler at whole seconds (the issue's own wrong program). It must fail the cases worked by hand.

const wholeSeconds = (t0: number, t1: number): number[] => Array.from({ length: Math.max(0, Math.floor(t1) - Math.ceil(t0) + 1) }, (_, i) => Math.ceil(t0) + i);
/** The smallest distance among the whole seconds of the span, and that second. */
export function sampledClosest(a: Slot[], b: Slot[], t0: number, t1: number): { dist: number; time: number } | null {
  let best: { dist: number; time: number } | null = null;
  for (const k of wholeSeconds(t0, t1)) {
    const p = positionAt(a, k), q = positionAt(b, k);
    if (p && q && (!best || norm(sub(q, p)) < best.dist)) best = { dist: norm(sub(q, p)), time: k };
  }
  return best;
}
/** Each run of whole seconds in a row at which a pair is under the table's minimum, from its first second to its last. */
export function sampledConflicts(scene: Scene, flown: Slot[][], t0: number, t1: number): Window[] {
  const out: Window[] = [];
  for (let a = 0; a < flown.length; a++) {
    for (let b = a + 1; b < flown.length; b++) {
      let open: [number, number] | null = null;
      for (const k of wholeSeconds(t0, t1)) {
        const d = apart(flown[a]!, flown[b]!, k);
        if (d && d.lateral < scene.minima.lateral && d.vertical < scene.minima.vertical) { open = open ? [open[0], k] : [k, k]; continue; }
        if (open) out.push({ a, b, from: open[0], to: open[1], min: scene.minima.lateral, row: -1, basis: BASIS.none });
        open = null;
      }
      if (open) out.push({ a, b, from: open[0], to: open[1], min: scene.minima.lateral, row: -1, basis: BASIS.none });
    }
  }
  return out.sort((x, y) => x.from - y.from || x.a - y.a || x.b - y.b);
}

// ---------------------------------------------------------------------------------------------------
// Delays (README: The delay rule).

export const KIND = { refused: 0, speed: 1, stretch: 2, hold: 3 } as const;
export const WHY = { none: 0, band: 1, route: 2 } as const;
/** A control as its record holds it (README: The control record): fixes by their index in the mover's document route. */
export interface Control { kind: number; mover: number; from: number; to: number; value: number; why: number }

/**
 * delay(mover, seconds) asked at time t. The mover's next leg runs from the first fix it has not left at t (its start
 * while it hasn't started) to the fix after it, where the delay is wanted. In order: the speed that takes `seconds`
 * longer over the leg, when the band at the leg's first fix allows it; a stretch of the leg, unless it is the route's
 * last; a hold, for a mover not yet started. Else it refuses: `band` when a leg is left, `route` when none is.
 */
export function delay(m: Mover, mover: number, flown: Slot[], seconds: number, t: number): Control {
  const j = flown.findIndex((s) => s.time >= t);
  if (j < 0 || j >= flown.length - 1) return { kind: KIND.refused, mover, from: -1, to: -1, value: 0, why: WHY.route };
  const p = flown[j]!, q = flown[j + 1]!, from = p.ref, to = q.ref;
  const length = norm(sub(q.at, p.at)), needs = length / (length / p.speed + seconds);
  const band = m.band.find((x) => x.fix === m.route[from]!.fix);
  if (!band || (needs >= band.min && needs <= band.max)) return { kind: KIND.speed, mover, from, to, value: needs, why: WHY.none };
  if (j + 1 < flown.length - 1) return { kind: KIND.stretch, mover, from, to, value: Math.sqrt((length + p.speed * seconds) ** 2 - length ** 2) / 2, why: WHY.none };
  if (t < first(flown)) return { kind: KIND.hold, mover, from: -1, to: -1, value: seconds, why: WHY.none };
  return { kind: KIND.refused, mover, from, to: -1, value: needs, why: WHY.band };
}

/** apply(control): the mover as flown after it. A speed holds from `from` to `to` and the speeds after stay; a stretch adds its off-route point; a hold moves every time. */
export function apply(flown: Slot[], c: Control): Slot[] {
  const out = flown.map((s) => ({ ...s, at: [...s.at] as Vec3 }));
  const retime = (): void => { for (let q = 1; q < out.length; q++) out[q]!.time = out[q - 1]!.time + norm(sub(out[q]!.at, out[q - 1]!.at)) / out[q - 1]!.speed; };
  if (c.kind === KIND.hold) for (const s of out) s.time += c.value;
  if (c.kind === KIND.speed) {
    const i = out.findIndex((s) => s.ref === c.from), k = out.findIndex((s) => s.ref === c.to);
    for (let q = i; q < k; q++) out[q]!.speed = c.value;
    retime();
  }
  if (c.kind === KIND.stretch) {
    const i = out.findIndex((s) => s.ref === c.from), p = out[i]!, q = out[i + 1]!;
    const along = Math.hypot(q.at[0] - p.at[0], q.at[2] - p.at[2]);
    // The leg's midpoint, moved `offset` to the left of travel in the lateral plane: left of (dx, dz) is (dz, −dx), +Y up.
    const off: Vec3 = [(p.at[0] + q.at[0]) / 2 + c.value * (q.at[2] - p.at[2]) / along, (p.at[1] + q.at[1]) / 2, (p.at[2] + q.at[2]) / 2 - c.value * (q.at[0] - p.at[0]) / along];
    out.splice(i + 1, 0, { ref: -1, at: off, speed: p.speed, time: 0 });
    retime();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The forty movers (README: Fixtures: forty).

/** A seeded generator (mulberry32), so the fixture is the same everywhere. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const FORTY = { seed: 1255, movers: 40, span: [0, 7200] as [number, number], lateral: 5556, vertical: 300, levels: [3000, 3350, 3700] };
/**
 * Forty movers of two legs each: in from a ring 90 km out, through a point within 12 km of the centre, out to the
 * ring again, each fix at one of three levels 350 m apart, at 150 to 250 m/s, starting within the first 100 minutes.
 * Whole metres, whole metres a second and whole seconds, so the document's numbers are exact.
 */
export function forty(seed = FORTY.seed): Scene {
  const rnd = seeded(seed);
  const level = (): number => FORTY.levels[Math.floor(rnd() * FORTY.levels.length)]!;
  const movers: Mover[] = Array.from({ length: FORTY.movers }, (_, i) => {
    const turn = rnd() * 2 * Math.PI, out = turn + Math.PI + (rnd() - 0.5) * (2 * Math.PI / 3), r = rnd() * 12_000, w = rnd() * 2 * Math.PI;
    const at = (x: number, z: number): Vec3 => [Math.round(x), level(), Math.round(z)];
    const route: Fix[] = [
      { fix: 'in', at: at(90_000 * Math.cos(turn), 90_000 * Math.sin(turn)) },
      { fix: 'mid', at: at(r * Math.cos(w), r * Math.sin(w)) },
      { fix: 'out', at: at(90_000 * Math.cos(out), 90_000 * Math.sin(out)) },
    ];
    const v = 150 + Math.floor(rnd() * 101);
    return {
      id: `m${String(i).padStart(2, '0')}`, class: 'medium', route,
      speed: [{ from_fix: 'in', speed: v }, { from_fix: 'mid', speed: v }],
      band: route.map((f) => ({ fix: f.fix, min: 100, max: 300 })),
      start: Math.floor(rnd() * 6000),
    };
  });
  return { movers, minima: { lateral: FORTY.lateral, vertical: FORTY.vertical, by_pair: [] } };
}

/**
 * What would make a scene's windows hang on rounding, so that two right libraries could differ by more than 1e-6 s:
 * a pair within a metre of a minimum, the other one held, at a slot's time or at the span's ends, or grazing the
 * lateral minimum in between; a window or a gap under a second; a window's end the pair crosses at under 1 m/s
 * laterally or 0.01 m/s vertically. A fixture must list none.
 */
export function fragile(scene: Scene, flown: Slot[][], t0: number, t1: number): string[] {
  const out: string[] = [];
  const { lateral: L, vertical: V } = scene.minima;
  const windows = conflicts(scene, flown, t0, t1);
  for (let a = 0; a < flown.length; a++) {
    for (let b = a + 1; b < flown.length; b++) {
      const span = shared(flown[a]!, flown[b]!, t0, t1);
      if (!span) continue;
      const pair = `${scene.movers[a]!.id}, ${scene.movers[b]!.id}`;
      for (const s of stretches(flown[a]!, flown[b]!, span[0], span[1])) {
        for (const t of [s.from, s.to]) {
          const d = apart(flown[a]!, flown[b]!, t)!;
          if ((Math.abs(d.lateral - L) <= 1 && d.vertical < V + 1) || (Math.abs(d.vertical - V) <= 1 && d.lateral < L + 1)) out.push(`${pair} at ${t}: ${d.lateral} m, ${d.vertical} m, within a metre of a minimum`);
        }
        // The stretch's least lateral distance, where it grazes the minimum.
        const A = s.v[0] * s.v[0] + s.v[2] * s.v[2];
        const tau = A === 0 ? 0 : Math.min(Math.max(-(s.p[0] * s.v[0] + s.p[2] * s.v[2]) / A, 0), s.to - s.from);
        const d = apart(flown[a]!, flown[b]!, s.from + tau)!;
        if (Math.abs(d.lateral - L) <= 1 && d.vertical < V + 1) out.push(`${pair} at ${s.from + tau}: grazes the lateral minimum, ${d.lateral} m`);
      }
      const own = windows.filter((w) => w.a === a && w.b === b);
      own.forEach((w, i) => {
        if (w.to - w.from < 1) out.push(`${pair}: a window of ${w.to - w.from} s`);
        if (i > 0 && w.from - own[i - 1]!.to < 1) out.push(`${pair}: windows ${w.from - own[i - 1]!.to} s apart`);
        for (const t of [w.from, w.to]) {
          if (t === span[0] || t === span[1]) continue;
          // Which minimum the end sits on, and how fast the pair crosses it (a difference over 2 ms; rounding is far below it).
          const at = apart(flown[a]!, flown[b]!, t)!, h = 1e-3;
          const x = apart(flown[a]!, flown[b]!, Math.max(span[0], t - h))!, y = apart(flown[a]!, flown[b]!, Math.min(span[1], t + h))!;
          const onLateral = Math.abs(at.lateral - L) <= Math.abs(at.vertical - V);
          const rate = Math.abs(onLateral ? y.lateral - x.lateral : y.vertical - x.vertical) / (2 * h);
          if (rate < (onLateral ? 1 : 0.01)) out.push(`${pair}: its window's end at ${t} is crossed at ${rate} m/s`);
        }
      });
    }
  }
  return out;
}
