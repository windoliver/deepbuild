// The numbers of the #853 acceptance tests and the judges that read them: each fixture's sizes with every expected
// value derived from them and from the issue's words, and each check a test makes of a buffer, a ring, a reply or a
// timing, as a function that returns its failures as sentences naming what failed. Nothing here starts a program or
// imports the test runner, so `plantedSetFailures()` runs every judge on planted sets of numbers (a right set it must
// pass, wrong sets it must fail, naming what its criterion says a failure names) before any binary is asked for, and
// as a plain node script.

export type V3 = [number, number, number];

/** Flicks a second (Time and the flick). */
export const FLICKS = 705_600_000;
/** The fixed step of every fixture: 60 Hz, the issue's default; 705,600,000 ÷ 60 = 11,760,000 flicks, a whole number. */
export const STEP_RATE = 60;
/** Gravity in every fixture that has any, m/s². */
export const G = 9.81;
/** Words a particle holds with no attributes (README: The buffer): x, y, z, vx, vy, vz, age. */
export const STRIDE = 7;
const AGE = 6;
export const SHA = /^[0-9a-f]{64}$/;

const fmt = (x: number, digits = 4): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
/** The whole numbers from `from` to `to`, both included. */
export const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

// ---------------------------------------------------------------------------------------------------
// A buffer's particles.

export const xOf = (w: Float32Array, i: number): number => w[STRIDE * i]!;
export const yOf = (w: Float32Array, i: number): number => w[STRIDE * i + 1]!;
export const zOf = (w: Float32Array, i: number): number => w[STRIDE * i + 2]!;
/** A particle is live when its age is 0 or more (README: The buffer). */
export const isLive = (w: Float32Array, i: number): boolean => w[STRIDE * i + AGE]! >= 0;
export function liveCount(w: Float32Array, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (isLive(w, i)) n++;
  return n;
}
/** How many particles hold another position in `b` than in `a`, among those live in both. */
export function movedCount(a: Float32Array, b: Float32Array, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!isLive(a, i) || !isLive(b, i)) continue;
    if (xOf(a, i) !== xOf(b, i) || yOf(a, i) !== yOf(b, i) || zOf(a, i) !== zOf(b, i)) n++;
  }
  return n;
}
/** Why a buffer isn't `count` particles of 7 f32 words, or '' when it is. */
export function sizeProblem(w: Float32Array, count: number, what: string): string {
  return w.length === count * STRIDE ? '' : `${what}: the buffer holds ${w.length} words, not ${count * STRIDE} (${count} particles × ${STRIDE} f32: position, velocity, age)`;
}

// ---------------------------------------------------------------------------------------------------
// The checkpoint ring (Checkpoint ring; Logic: checkpoints and bake: "a checkpoint every `every` steps; when the ring
// passes its budget, the spacing doubles"; as the base's stepped operators keep theirs, #252).

/** The steps a ring holds once step `last` has run: a checkpoint at each multiple of the spacing from step 0, the
 * spacing doubling, and the checkpoints off it dropped, each time the ring passes `budget` bytes. */
export function ringHeld(last: number, every: number, budget: number, bytes: number): number[] {
  let spacing = every;
  let held: number[] = [];
  if (bytes > budget) return held;
  for (let step = 0; step <= last; step++) {
    if (step % spacing !== 0) continue;
    held.push(step);
    while (held.length * bytes > budget) {
      spacing *= 2;
      held = held.filter((s) => s % spacing === 0);
    }
  }
  return held;
}
/** Every step at which that ring took a checkpoint on the way to `last`, kept or dropped since. */
export function ringTaken(last: number, every: number, budget: number, bytes: number): number[] {
  const taken = new Set<number>();
  for (let step = 0; step <= last; step++) for (const s of ringHeld(step, every, budget, bytes)) taken.add(s);
  return [...taken].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// A tray of sand: a box floor whose top is y = 0 inside four walls, and what is poured into it.

export interface Tray {
  count: number;
  /** The least distance kept between two particles, m (`spacing`). */
  spacing: number;
  /** The tray's inner half width: its walls' inner faces stand at x = ±half and z = ±half. */
  half: number;
  /** The walls' thickness and height, and the floor box's thickness, m. */
  wall: number;
  wallHeight: number;
  floor: number;
  /** Where the emit box is centred, and its size, m. */
  emitAt: V3;
  emitSize: V3;
  rate: number;
  span: number;
  velocity: V3;
  every: number;
  budget: number;
}

/** The pour (criteria 1, 3 and 6): 100,000 grains 2 cm apart, poured from a box 1.75 m up at 3 m/s downward into a
 * tray 0.8 m square. At their loosest (a cubic stack, spacing³ each) they fill it to 100,000 × 0.02³ ÷ 0.64 = 1.25 m,
 * half a metre under the emitter. */
export const POUR_BYTES = 100_000 * STRIDE * 4;
export const POUR: Tray = {
  count: 100_000, spacing: 0.02, half: 0.4, wall: 0.2, wallHeight: 2.2, floor: 0.2,
  emitAt: [0, 1.8, 0], emitSize: [0.6, 0.1, 0.6], rate: 50_000, span: 2, velocity: [0, -3, 0],
  every: 60,
  // 8 of the buffer's 2,800,000 bytes: 22,400,000. With checkpoints every 60 steps the ring holds 0, 60, … 420 (8) at
  // step 420; the ninth, at step 480, passes the budget, so the spacing doubles to 120 and the ring keeps 0, 120, 240,
  // 360, 480; step 600 makes six, within 8. So after 600 steps (10 s) the checkpoint at step 120 (2 s) is held, and it
  // is the nearest at or before step 150 (2.5 s). Under the design's default budget, 16 MiB = 16,777,216 bytes, the
  // ring holds 5 of these: it doubles at step 300 (to 120) and again at step 600 (to 240), leaving 0, 240, 480, with
  // no checkpoint at 2 s; that is why the fixture declares its budget. A checkpoint a third larger than the buffer
  // still gives 0, 120, … 600 at step 600 (6 × 1.33 ≤ 8).
  budget: 8 * POUR_BYTES,
};
/** The other seed criterion 1's seeded run pours with; the pour's own is the document's, 853. */
export const POUR_SEED = 853;
export const OTHER_SEED = 1853;
/** Steps of the pour the criteria name, at 60 steps a second: 1 s, 2 s, 2.5 s, 5 s and 10 s. */
export const POUR_STEPS = { halfPoured: 60, checkpoint: 120, sought: 150, fiveSeconds: 300, tenSeconds: 600 } as const;
/** "Within 1%". */
export const WITHIN = 0.01;

/** The flood (criterion 5): 1,000,000 grains 1 cm apart into a tray 2 m square, a showpiece. Its ring is forced to 2
 * of its 28,000,000-byte buffers: over 300 steps checkpoints are due at 0, 60, … 300 (6), so the spacing doubles at
 * step 120 (to 120) and at step 240 (to 240), and the ring ends holding 0 and 240. */
export const FLOOD_BYTES = 1_000_000 * STRIDE * 4;
export const FLOOD: Tray = {
  count: 1_000_000, spacing: 0.01, half: 1, wall: 0.2, wallHeight: 1.4, floor: 0.2,
  emitAt: [0, 1, 0], emitSize: [1.6, 0.2, 1.6], rate: 500_000, span: 2, velocity: [0, -3, 0],
  every: 60, budget: 2 * FLOOD_BYTES,
};
export const FLOOD_STEPS = 300;

/** The emit box's lowest face: every grain that left the emitter is under it. */
export const emitBottom = (t: Tray): number => t.emitAt[1] - t.emitSize[1] / 2;
/**
 * The height `count` spheres `spacing` across fill the tray to at their densest: each takes spacing³ ÷ √2 of space
 * (the close packing of equal spheres), so count × spacing³ ÷ (√2 × the tray's floor area). No bed of particles kept
 * `spacing` apart is lower than this. The pour: 100,000 × 0.02³ ÷ (√2 × 0.64) = 0.884 m; the flood: 0.177 m.
 */
export const closePacked = (t: Tray): number => (t.count * t.spacing ** 3) / (Math.SQRT2 * (2 * t.half) ** 2);
/** The least height a test takes for a pile: half of that, which leaves a soft spacing its slack and still stands
 * 22 layers (the pour) above the one layer that particles which never push each other apart would lie in. */
export const leastPile = (t: Tray): number => closePacked(t) / 2;

/**
 * The pile's height at the centre: over the 25 cells, each 2 spacings square, of the square of 10 spacings around the
 * tray's axis, the mean of each cell's highest live particle, above the floor's top (y = 0). Null when a cell holds
 * no particle.
 */
export function centreHeight(w: Float32Array, t: Tray): number | null {
  const n = 5;
  const cell = 2 * t.spacing;
  const tops = new Float64Array(n * n).fill(-Infinity);
  for (let i = 0; i < t.count; i++) {
    if (!isLive(w, i)) continue;
    const cx = Math.floor((xOf(w, i) + (n * cell) / 2) / cell);
    const cz = Math.floor((zOf(w, i) + (n * cell) / 2) / cell);
    if (cx < 0 || cx >= n || cz < 0 || cz >= n) continue;
    const y = yOf(w, i);
    if (y > tops[cz * n + cx]!) tops[cz * n + cx] = y;
  }
  let sum = 0;
  for (const y of tops) {
    if (y === -Infinity) return null;
    sum += y;
  }
  return sum / (n * n);
}

/**
 * Whether a buffer is the tray's sand, settled into a pile: all `count` particles poured (live), none through the
 * floor box or outside the walls, none left at the emitter, and the pile at the centre at least `leastPile` high and
 * under the emitter. Fails particles that pass through the floor, that never leave the emitter and that never push
 * each other apart.
 */
export function pileProblems(w: Float32Array, t: Tray, what: string): string[] {
  const size = sizeProblem(w, t.count, what);
  if (size) return [size];
  const p: string[] = [];
  const live = liveCount(w, t.count);
  if (live !== t.count) p.push(`${what}: ${live} of the ${t.count} particles are live, so not all were poured`);
  const outer = t.half + t.wall;
  const bottom = emitBottom(t);
  let through = 0; let out = 0; let stuck = 0; let wild = 0;
  let first = '';
  for (let i = 0; i < t.count; i++) {
    if (!isLive(w, i)) continue;
    const [x, y, z] = [xOf(w, i), yOf(w, i), zOf(w, i)];
    const note = (s: string): void => { if (!first) first = s; };
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { wild++; note(`particle ${i} is at (${x}, ${y}, ${z})`); } else if (y < -t.floor) { through++; note(`particle ${i} is at y = ${fmt(y)} m, under the floor box's bottom face at ${fmt(-t.floor)} m: it passed through the floor`); } else if (Math.abs(x) > outer || Math.abs(z) > outer) { out++; note(`particle ${i} is at (${fmt(x)}, ${fmt(z)}), past a wall's outer face at ${fmt(outer)} m`); } else if (y >= bottom) { stuck++; note(`particle ${i} is at y = ${fmt(y)} m, not under the emitter's bottom at ${fmt(bottom)} m: it never left the emitter`); }
  }
  if (wild + through + out + stuck > 0) p.push(`${what}: ${wild} particles aren't at a finite place, ${through} passed through the floor, ${out} are outside the walls and ${stuck} never left the emitter; the first: ${first}`);
  const h = centreHeight(w, t);
  if (h === null) p.push(`${what}: no pile at the centre: a cell of the 10-spacing square around the axis holds no particle`);
  else if (!(h >= leastPile(t))) p.push(`${what}: the pile is ${fmt(h)} m high at the centre, under ${fmt(leastPile(t))} m, half of what ${t.count} particles kept ${t.spacing} m apart fill this tray to at their densest (${fmt(closePacked(t))} m): they don't push each other apart`);
  else if (!(h < bottom)) p.push(`${what}: the pile is ${fmt(h)} m high at the centre, not under the emitter's bottom at ${fmt(bottom)} m`);
  return p;
}
/** Whether height `h` matches `other` within 1% of `other`. */
export function heightProblems(h: number | null, other: number | null, what: string, against: string): string[] {
  if (h === null || other === null) return [`${what}: no height at the centre to compare with ${against}`];
  const gap = Math.abs(h - other) / other;
  return gap <= WITHIN ? [] : [`${what}: the pile's height at the centre, ${fmt(h)} m, is ${fmt(gap * 100, 2)}% off ${against}, ${fmt(other)} m, past 1%`];
}
/** Whether the pour is poured over its span, not all at once and not later: 40% to 60% of it live half way. */
export function halfPouredProblems(w: Float32Array, t: Tray, what: string): string[] {
  const size = sizeProblem(w, t.count, what);
  if (size) return [size];
  const live = liveCount(w, t.count);
  return live >= 0.4 * t.count && live <= 0.6 * t.count ? [] : [`${what}: ${live} of ${t.count} particles are live half way through the pour's ${t.span} s, not 40% to 60%`];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's seek: "seeking from 10 s back to 2.5 s restores the checkpoint at 2 s and steps forward to the same
// buffer hash as playing to 2.5 s".

export interface Seek {
  /** The checkpoints the ring holds at the last played frame (step 600). */
  held: number[];
  /** The sought frame's row: the step it holds and what it restored. */
  step: number | null;
  restored: { from: number; steps: number } | null;
  soughtHash: string | null;
  playedHash: string | null;
  /** How many particles moved between the restored checkpoint's step and the sought step, in the play. */
  moved: number;
}
export function seekProblems(s: Seek, at = POUR_STEPS): string[] {
  const p: string[] = [];
  const to = `the seek from step ${at.tenSeconds} (10 s) back to step ${at.sought} (2.5 s)`;
  if (!s.held.includes(at.checkpoint)) p.push(`after ${at.tenSeconds} steps the ring holds checkpoints [${s.held.join(', ')}], none at step ${at.checkpoint} (2 s)`);
  if (!s.restored) p.push(`${to} restored no checkpoint`);
  else if (s.restored.from !== at.checkpoint || s.restored.steps !== at.sought - at.checkpoint) p.push(`${to} restored the checkpoint at step ${s.restored.from} and stepped ${s.restored.steps}, not the checkpoint at step ${at.checkpoint} (2 s) and ${at.sought - at.checkpoint} steps`);
  if (s.step !== at.sought) p.push(`${to} holds the buffer at step ${String(s.step)}`);
  if (!s.playedHash || !SHA.test(s.playedHash)) p.push(`the play read no buffer at step ${at.sought}`);
  else if (s.soughtHash !== s.playedHash) p.push(`${to} hashes ${String(s.soughtHash)}, playing to step ${at.sought} ${s.playedHash}`);
  if (s.moved < 1000) p.push(`only ${s.moved} particles moved between step ${at.checkpoint} and step ${at.sought} of the play, so the seek's ${at.sought - at.checkpoint} steps prove nothing`);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's frame rates: the buffer at one step read at 60, 30 and 144 frames a second.

export interface Play { fps: number; frame: number; hash: string | null; step: number | null }
/** Each problem starts with the step: "at step 150 (2.5 s), the pour played at 30 frames a second …". */
export function rateProblems(step: number, plays: readonly Play[]): string[] {
  const at = `at step ${step} (${step / STEP_RATE} s),`;
  const p: string[] = [];
  for (const a of plays) {
    if (!a.hash || !SHA.test(a.hash)) p.push(`${at} the pour played at ${a.fps} frames a second (frame ${a.frame}) read no buffer`);
    if (a.step !== step) p.push(`${at} the pour played at ${a.fps} frames a second (frame ${a.frame}) holds the buffer at step ${String(a.step)}`);
  }
  for (let i = 0; i < plays.length; i++) {
    for (let j = i + 1; j < plays.length; j++) {
      const [a, b] = [plays[i]!, plays[j]!];
      if (a.hash && b.hash && a.hash !== b.hash) p.push(`${at} the pour played at ${b.fps} frames a second (frame ${b.frame}) hashes ${b.hash}, at ${a.fps} frames a second (frame ${a.frame}) ${a.hash}`);
    }
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2, the lift: a kinematic floor under 1,024 particles at rest.

/**
 * The lift is a box 2 × 0.2 × 2 m whose top is y = 0 until 1 s (step 60), rises 1.2 m/s for 1 s and stops with its
 * top at 1.2 m from 2 s (step 120) on. It moves 1.2 ÷ 60 = 0.02 m a step, a tenth of its thickness. The particles are
 * born at 0 s in a square 1 m across, 1 cm above it: they fall √(2 × 0.01 ÷ 9.81) = 0.045 s and lie on it well before
 * step 50.
 */
export const LIFT = {
  count: 1024, half: [1, 0.1, 1] as V3, emitSize: [1, 0, 1] as V3, emitAbove: 0.01,
  restFrom: 50, movesAt: 60, stopsAt: 120, last: 150, speed: 1.2,
  /** A quarter of the floor's move in a step: a particle a step behind the floor is 0.02 m under it. */
  slack: 0.005,
} as const;
/** The lift's top at a step: its `follow` channel's value at the step's own time (step ÷ 60 s), plus its half height. */
export function liftTop(step: number): number {
  if (step <= LIFT.movesAt) return 0;
  if (step >= LIFT.stopsAt) return (LIFT.speed * (LIFT.stopsAt - LIFT.movesAt)) / STEP_RATE;
  return (LIFT.speed * (step - LIFT.movesAt)) / STEP_RATE;
}
/** A particle that leaves a floor moving up at 1.2 m/s rises 1.2² ÷ (2 × 9.81) = 0.0734 m once the floor stops; a
 * test takes half of that as having bounced off it. A floor that only carries the particles' places leaves them at 0. */
export const LIFT_RISE = LIFT.speed ** 2 / (2 * G) / 2;

/**
 * "Particles bounce off a moving kinematic floor at the step it moves": before it moves they lie on it; at each step
 * it moves, 61 to 120, none is under the floor as that step's own time puts it; and once it stops each has left it
 * upward by at least LIFT_RISE. Each problem names the step.
 */
export function liftProblems(states: ReadonlyMap<number, Float32Array>): string[] {
  const n = LIFT.count;
  for (const s of range(LIFT.restFrom, LIFT.last)) {
    const w = states.get(s);
    if (!w) return [`no frame read the buffer at step ${s}`];
    const size = sizeProblem(w, n, `the lift at step ${s}`);
    if (size) return [size];
    for (let i = 0; i < n; i++) if (!isLive(w, i) || !Number.isFinite(yOf(w, i))) return [`at step ${s} particle ${i} isn't a live particle at a finite height (y = ${yOf(w, i)})`];
  }
  for (const s of range(LIFT.restFrom, LIFT.movesAt)) {
    const w = states.get(s)!;
    for (let i = 0; i < n; i++) {
      const y = yOf(w, i);
      if (Math.abs(y - liftTop(s)) > LIFT.slack) return [`at step ${s}, before the floor moves, particle ${i} is at y = ${fmt(y)} m, not at rest on the floor's top at ${fmt(liftTop(s))} m`];
    }
  }
  const p: string[] = [];
  let under = 0;
  for (const s of range(LIFT.movesAt + 1, LIFT.last)) {
    const w = states.get(s)!;
    const top = liftTop(s);
    for (let i = 0; i < n; i++) {
      const y = yOf(w, i);
      if (y >= top - LIFT.slack) continue;
      if (under++ === 0) p.push(`at step ${s}, ${s <= LIFT.stopsAt ? `the step the floor moved to y = ${fmt(top)} m` : `with the floor stopped at y = ${fmt(top)} m`}, particle ${i} is at y = ${fmt(y)} m, ${fmt(top - y)} m under it`);
    }
  }
  if (under > 1) p.push(`${under} readings in all are under the moving floor`);
  let flat = 0;
  const top = liftTop(LIFT.stopsAt);
  for (let i = 0; i < n; i++) {
    let rise = -Infinity;
    for (const s of range(LIFT.stopsAt + 1, LIFT.last)) rise = Math.max(rise, yOf(states.get(s)!, i) - top);
    if (rise >= LIFT_RISE) continue;
    if (flat++ === 0) p.push(`after step ${LIFT.stopsAt}, where the floor stops, particle ${i} rises ${fmt(rise)} m above it at most, under ${fmt(LIFT_RISE)} m: it didn't bounce off the floor that moved under it at ${LIFT.speed} m/s`);
  }
  if (flat > 1) p.push(`${flat} particles in all didn't bounce off the moving floor`);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2, the corridor: 1,024 fast particles between two thin static walls.

/**
 * Two walls 2 cm thick and 4 m square face each other across x: their near faces at x = ±3 m, their far faces at
 * ±3.02 m. The particles are born at 0 s in a cube 1 m across at the origin, moving 24 m/s along +x with no force on
 * them: 24 ÷ 60 = 0.4 m a step, 20 times a wall's thickness. From x0 in [−0.5, 0.5] one is last short of the near
 * face at a step up to 8, at x in (2.6, 3.0], and its next step ends past the far face unless it started that step
 * in (2.6, 2.62], a twentieth of them; so at least 80% reach the wall able to cross it whole in a step.
 */
export const CORRIDOR = { count: 1024, near: 3, thick: 0.02, wallHalf: 2, emitSize: [1, 1, 1] as V3, speed: 24, steps: 600, reachBy: 12 } as const;
const CORRIDOR_FAR = CORRIDOR.near + CORRIDOR.thick;
const CORRIDOR_STEP = CORRIDOR.speed / STEP_RATE;

/**
 * "None passes through a static wall in 600 steps": at every step 0 … 600 no particle is past a wall's far face.
 * Guards: each particle moves 0.4 m a step before it meets a wall, and at least 80% of them are seen short of the
 * near face with a step that would end past the far face. Each failure names the particle.
 */
export function wallProblems(states: readonly (Float32Array | undefined)[]): string[] {
  const n = CORRIDOR.count;
  for (let s = 0; s <= CORRIDOR.steps; s++) {
    const w = states[s];
    if (!w) return [`no frame read the buffer at step ${s}`];
    const size = sizeProblem(w, n, `the corridor at step ${s}`);
    if (size) return [size];
  }
  const p: string[] = [];
  let slow = 0; let reached = 0;
  for (let i = 0; i < n; i++) {
    const dx = xOf(states[2]!, i) - xOf(states[1]!, i);
    if (!(dx >= CORRIDOR_STEP - 0.01) && slow++ === 0) p.push(`particle ${i} moves ${fmt(dx)} m from step 1 to step 2, not the ${CORRIDOR_STEP} m a step of ${CORRIDOR.speed} m/s: it can't cross the ${CORRIDOR.thick} m wall in one step`);
    for (let s = 1; s <= CORRIDOR.reachBy; s++) {
      const x = xOf(states[s]!, i);
      const d = x - xOf(states[s - 1]!, i);
      if (x < CORRIDOR.near && d >= CORRIDOR_STEP - 0.01 && x + d > CORRIDOR_FAR) { reached++; break; }
    }
  }
  if (slow > 1) p.push(`${slow} particles in all are too slow to cross the wall in one step`);
  if (reached < 0.8 * n) p.push(`only ${reached} of ${n} particles reach the wall short of it with a step that would end past its far face, under 80%: none is fast enough to tunnel, so nothing is shown`);
  let passed = 0;
  const seen = new Set<number>();
  for (let s = 0; s <= CORRIDOR.steps; s++) {
    const w = states[s]!;
    for (let i = 0; i < n; i++) {
      const x = xOf(w, i);
      const ok = isLive(w, i) && Math.abs(x) <= CORRIDOR_FAR;
      if (ok || seen.has(i)) continue;
      seen.add(i);
      if (passed++ < 3) p.push(isLive(w, i) && Number.isFinite(x) ? `particle ${i} passed through the wall: at step ${s} it is at x = ${fmt(x)} m, ${fmt(Math.abs(x) - CORRIDOR_FAR)} m past the far face at ${x < 0 ? '-' : ''}${CORRIDOR_FAR} m` : `particle ${i} isn't a live particle at a finite place at step ${s} (x = ${x})`);
    }
  }
  if (passed > 3) p.push(`${passed} particles in all passed through a wall in ${CORRIDOR.steps} steps`);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: two runs, a second machine, an export.

export interface Run { hashes: ReadonlyMap<number, string>; taken: readonly number[] }
/**
 * "Two runs on one machine reach the same buffer hash at every checkpoint": at each step a checkpoint can fall on
 * (`steps`, the multiples of the ring's `every`), both runs read a buffer and the two hash alike. Each run reports
 * the same checkpoints, all among those steps, and among them the ones the ring's own arithmetic still holds when the
 * play ends (`held`). Guard: the buffers at those steps aren't one buffer. Each problem names the checkpoint's step.
 */
export function checkpointProblems(a: Run, b: Run, steps: readonly number[], held: readonly number[]): string[] {
  const p: string[] = [];
  for (const s of steps) {
    const [x, y] = [a.hashes.get(s), b.hashes.get(s)];
    if (!x || !y || !SHA.test(x) || !SHA.test(y)) p.push(`at the checkpoint at step ${s}, a run read no buffer (first ${String(x)}, second ${String(y)})`);
    else if (x !== y) p.push(`at the checkpoint at step ${s}, the second run's buffer hashes ${y}, the first run's ${x}`);
  }
  const distinct = new Set(steps.map((s) => a.hashes.get(s))).size;
  if (distinct !== steps.length) p.push(`the first run's ${steps.length} checkpoints hash to ${distinct} buffers: the buffer didn't step between them`);
  [a, b].forEach((r, i) => {
    const which = i === 0 ? 'first' : 'second';
    const off = r.taken.filter((s) => !steps.includes(s));
    const missing = held.filter((s) => !r.taken.includes(s));
    if (off.length) p.push(`the ${which} run reports checkpoints at steps [${off.join(', ')}], where no buffer was compared`);
    if (missing.length) p.push(`the ${which} run reports no checkpoint at steps [${missing.join(', ')}] (it reports [${r.taken.join(', ')}])`);
  });
  if (a.taken.join(',') !== b.taken.join(',')) p.push(`the two runs report other checkpoints: the first at steps [${a.taken.join(', ')}], the second at [${b.taken.join(', ')}]`);
  return p;
}
/**
 * Whether a run's buffers are the pour stepping and not one state hashed eleven times: few particles live at step 0,
 * 40% to 60% at step 60, at least 95% at step 120 and every one at step 600, and at least 10,000 of them at another
 * place at step 120 than at step 60 (at 1 s the bed is half poured, 50,000 a second take 0.28 s to fall the 1.25 m
 * to it from 3 m/s, so about 14,000 are in the air then, and all of them have landed by 2 s).
 */
export function pouringProblems(at: { 0: Float32Array; 60: Float32Array; 120: Float32Array; 600: Float32Array }, t: Tray): string[] {
  for (const [s, w] of Object.entries(at)) {
    const size = sizeProblem(w, t.count, `the pour at step ${s}`);
    if (size) return [size];
  }
  const p = halfPouredProblems(at[60], t, 'the pour at step 60');
  const live = [liveCount(at[0], t.count), liveCount(at[120], t.count), liveCount(at[600], t.count)];
  if (live[0]! > 0.05 * t.count) p.push(`${live[0]} particles are live at step 0, before the pour`);
  if (live[1]! < 0.95 * t.count) p.push(`${live[1]} of ${t.count} particles are live at step 120, when the pour's ${t.span} s end`);
  if (live[2] !== t.count) p.push(`${live[2]} of ${t.count} particles are live at step 600`);
  const moved = movedCount(at[60], at[120], t.count);
  if (moved < 10_000) p.push(`only ${moved} particles are at another place at step 120 than at step 60: the buffer's particles don't move`);
  return p;
}

/** A `golden` reply, as far as these tests read it. */
export interface GoldenRead { verdict: string | null; reason: string | null; cls: string | null; gpu: string | null; recordedGpu: string | null; numbers: boolean; text: string }
/** "A comparison of the same run on a second machine reads INCONCLUSIVE, naming the class": never compared, under the
 * class same_machine, naming both machines. Each problem names the class the comparison read. */
export function secondMachineProblems(g: GoldenRead, otherGpu: string, recording: string): string[] {
  const at = `on a second machine (gpu ${String(g.gpu)}), the pour at 2.5 s against the ${recording} recording, class ${g.cls ?? 'unreported'}`;
  const p: string[] = [];
  if (g.verdict === 'PASS' || g.verdict === 'FAIL') p.push(`${at}, was compared and read ${g.verdict}`);
  else if (g.verdict !== 'INCONCLUSIVE') p.push(`${at}, reads ${String(g.verdict)}, not INCONCLUSIVE`);
  if (g.reason !== 'environment_changed') p.push(`${at}, reads reason ${String(g.reason)}, not environment_changed`);
  if (g.numbers) p.push(`${at}, carries comparison numbers`);
  if (!g.recordedGpu || g.recordedGpu === g.gpu || !g.text.includes(g.recordedGpu) || !g.text.includes(otherGpu)) p.push(`${at}, doesn't name both machines' GPUs, the recording's and this run's`);
  if (g.cls !== 'same_machine') p.push(`${at}: the comparison names class ${g.cls ?? 'none'}, not same_machine`);
  return p;
}

/** The 20 sampled times of criterion 3's export: every half second from 0.5 s to 10 s, frames 30, 60, … 600 at 60
 * frames a second. The pour runs until 2 s and has settled by 5 s, so the first of them differ and the last may not. */
export const SAMPLED = Array.from({ length: 20 }, (_, i) => 30 * (i + 1));
export interface Shot { pixel: string | null; buffer: string | null }
/**
 * "An export of the pour reads the bake by hash and matches its live frames at 20 sampled times by pixel hash": the
 * recording and the export name one bake key; at each sampled frame the export's pixel hash is the live frame's and
 * the buffer it read is the buffer the live frame read. Guards: the live frames aren't one picture (at least five
 * differ, and 0.5 s isn't 10 s), so the pour is drawn and moves. Each problem names the time.
 */
export function exportProblems(live: ReadonlyMap<number, Shot>, exported: ReadonlyMap<number, Shot>, keys: { live: string | null; exported: string | null }): string[] {
  const p: string[] = [];
  if (!keys.live || !SHA.test(keys.live)) p.push(`the live play names no bake key for the buffer (${String(keys.live)})`);
  else if (keys.exported !== keys.live) p.push(`the export read the bake under key ${String(keys.exported)}, the live play recorded it under ${keys.live}`);
  for (const f of SAMPLED) {
    const at = `at ${f / STEP_RATE} s (frame ${f}),`;
    const [l, e] = [live.get(f), exported.get(f)];
    if (!l?.pixel || !l.buffer) { p.push(`${at} the live play has no pixel hash and buffer`); continue; }
    if (!e?.pixel) { p.push(`${at} the export drew no frame`); continue; }
    if (e.pixel !== l.pixel) p.push(`${at} the export's pixel hash is ${e.pixel}, the live frame's ${l.pixel}`);
    if (e.buffer !== l.buffer) p.push(`${at} the export read the buffer ${String(e.buffer)}, the live frame ${l.buffer}`);
  }
  const pixels = SAMPLED.map((f) => live.get(f)?.pixel ?? '');
  if (new Set(pixels).size < 5) p.push(`the live play's 20 sampled frames hold ${new Set(pixels).size} pictures, under 5: the pour isn't drawn, or doesn't move`);
  if (pixels[0] === pixels[pixels.length - 1]) p.push('the live frame at 0.5 s is the frame at 10 s: the pour isn\'t drawn, or doesn\'t move');
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4, the drops: 1,024 particles falling through a gate a logic item counts in.

/**
 * The drops are born at 0 s in a box 0.5 × 1 × 0.5 m centred at (0, 2.5, 0), y from 2 to 3 m, at rest, and fall under
 * 9.81 m/s² with nothing to hit. The gate is the box from (0, 0, −1) to (1, 1.9, 1) m: the half of the column where
 * x > 0, from y = 0 to 1.9 m. A drop from y0 enters it √(2 (y0 − 1.9) ÷ 9.81) s on, 0.143 to 0.474 s (steps 9 to 29),
 * and leaves through y = 0 after √(2 y0 ÷ 9.81) s, 0.639 to 0.782 s (steps 39 to 47). So the count is 0 at step 0,
 * rises over 20 steps to every drop with x > 0, about half of them, holds from step 29 to 38, and is 0 again by step
 * 47. Step 33 (0.55 s) is 0.076 s past the last entry and 0.089 s short of the first exit, more than 4 steps either
 * way, where a first-order step's drop differs from the exact one by 9.81 × 33 ÷ (2 × 60²) = 0.045 m at most.
 */
export const DROPS = { count: 1024, emitAt: [0, 2.5, 0] as V3, emitSize: [0.5, 1, 0.5] as V3, gate: [[0, 0, -1], [1, 1.9, 1]] as [V3, V3], frames: 60, plateau: 33 } as const;

/** How many live particles lie in the gate: strictly inside it, and inside it or on its faces. */
export function gateCount(w: Float32Array, count: number, gate: readonly [V3, V3] = DROPS.gate): { strict: number; loose: number } {
  let strict = 0; let loose = 0;
  for (let i = 0; i < count; i++) {
    if (!isLive(w, i)) continue;
    const q = [xOf(w, i), yOf(w, i), zOf(w, i)];
    if (q.every((v, a) => v > gate[0][a]! && v < gate[1][a]!)) strict++;
    if (q.every((v, a) => v >= gate[0][a]! && v <= gate[1][a]!)) loose++;
  }
  return { strict, loose };
}
/** How many live particles stand in the gate's columns (inside it in x and z), whatever their height. */
export function gateColumns(w: Float32Array, count: number, gate: readonly [V3, V3] = DROPS.gate): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (isLive(w, i) && xOf(w, i) > gate[0][0] && xOf(w, i) < gate[1][0] && zOf(w, i) > gate[0][2] && zOf(w, i) < gate[1][2]) n++;
  return n;
}
/**
 * "A logic item that reads the count of particles inside a region gets the reading the module published after the
 * step": at each logic step k from 1 on, the value the item read is the count the buffer held after particle step
 * k − 1 (README), and 0 at step 0. `seen[k]` is what the logic item wrote at step k; `strict[k]` and `loose[k]` the
 * counts in the buffer a frame read at step k; `columns` the particles in the gate's columns at the plateau step.
 * Guards: the buffer's own count is 0 at step 0, every particle of the gate's columns (40% to 60% of them all) at the
 * plateau step, 0 at the last step, and differs between at least 20 pairs of steps, so a count read a step late or
 * early, a count of every particle and no count at all each fail. Each problem names the step.
 */
export function readingProblems(seen: readonly (number | null)[], strict: readonly number[], loose: readonly number[], columns: number): string[] {
  const p: string[] = [];
  const last = DROPS.frames - 1;
  if (strict.length <= last || loose.length <= last || seen.length <= last) return [`the play read ${strict.length} buffers and ${seen.length} values of the logic item, not ${DROPS.frames} of each`];
  if (loose[0] !== 0) p.push(`at step 0 the buffer holds ${loose[0]} particles in the gate, not 0: the drops don't start above it`);
  if (strict[DROPS.plateau] !== columns || loose[DROPS.plateau] !== columns) p.push(`at step ${DROPS.plateau} the buffer holds ${strict[DROPS.plateau]} particles in the gate, not the ${columns} of its columns: the drops don't fall through it as 9.81 m/s² takes them`);
  if (!(columns >= 0.4 * DROPS.count && columns <= 0.6 * DROPS.count)) p.push(`${columns} of ${DROPS.count} particles stand in the gate's columns, not 40% to 60%: the gate doesn't halve them`);
  if (loose[last] !== 0) p.push(`at step ${last} the buffer still holds ${loose[last]} particles in the gate`);
  let changes = 0;
  for (let k = 1; k <= last; k++) if (strict[k] !== strict[k - 1]) changes++;
  if (changes < 20) p.push(`the buffer's count in the gate changes between only ${changes} pairs of steps, under 20: a reading a step off wouldn't show`);
  if (seen[0] !== 0) p.push(`at step 0 the logic item read ${String(seen[0])}, not 0: nothing is published before the first step`);
  let wrong = 0;
  for (let k = 1; k <= last; k++) {
    const v = seen[k];
    if (v !== null && v !== undefined && Number.isInteger(v) && v >= strict[k - 1]! && v <= loose[k - 1]!) continue;
    if (wrong++ < 3) p.push(`at step ${k} the logic item read ${String(v)}; the reading published after step ${k - 1} is the buffer's count in the gate then, ${strict[k - 1]}${loose[k - 1] === strict[k - 1] ? '' : ` to ${loose[k - 1]}`}`);
  }
  if (wrong > 3) p.push(`${wrong} steps in all read another value than the reading published after the step before`);
  return p;
}

/** A reply of `view3d`, as far as the document check's verdict goes. */
type Loose = { [key: string]: unknown };
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string => JSON.stringify(v)?.slice(0, 600) ?? 'undefined';
/**
 * The check a document meets in `view3d`: no problem when the reply drew frames, else one sentence for each issue of
 * the refusal, each holding the issue's `actual`, so a refusal names what it refuses.
 */
export function checkProblems(reply: unknown, what: string): string[] {
  if (!isObj(reply)) return [`${what}: the reply isn't an object: ${show(reply)}`];
  if (reply['code'] === undefined && Array.isArray(reply['frames']) && reply['frames'].length > 0) return [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObj) : [];
  if (reply['code'] !== 'refused' || issues.length === 0) return [`${what}: view3d drew no frame and answered ${show(reply)}`];
  return issues.map((i) => `${what}: refused at check: ${String(i['severity'])} ${String(i['code'])} at ${String(i['path'])}, naming ${show(i['actual'])} (ids ${show(i['ids'])}): ${String(i['what'])}`);
}
/**
 * Whether a reply is the refusal of a logic item that names the buffer (README): `{code: "refused", issues}` with an
 * error issue whose `ids` hold the logic item and the particles item, whose `path` is the read and whose `actual` is
 * the buffer's name.
 */
export function bufferRefusalProblems(reply: unknown, logic: string, particles: string, buffer: string): string[] {
  if (!isObj(reply)) return [`the reply isn't an object: ${show(reply)}`];
  if (Array.isArray(reply['frames']) && reply['frames'].length > 0) return [`a logic item that names ${buffer} was drawn, not refused at check`];
  if (reply['code'] !== 'refused' || !Array.isArray(reply['issues'])) return [`a logic item that names ${buffer} isn't refused as a checked document is ({code: "refused", issues}): ${show(reply)}`];
  const path = `items/${logic}/params/reads/0`;
  const hit = reply['issues'].filter(isObj).some((i) => i['severity'] === 'error' && Array.isArray(i['ids']) && i['ids'].includes(logic) && i['ids'].includes(particles) && i['path'] === path && i['actual'] === buffer);
  return hit ? [] : [`no error issue names the buffer: one with ids holding ${logic} and ${particles}, path ${path} and actual "${buffer}"; the issues are ${show(reply['issues'])}`];
}

// The tally: the logic item's program, as WebAssembly bytes (Logic `logic@1`: one memory whose maximum is its
// minimum, the immutable i32 globals `reads_at` and `writes_at`, `init(seed: i64)` and `step(k: i64)`, no imports),
// written as #265's suite writes its own.
const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (n: number): number[] => {
  const o: number[] = [];
  let v = BigInt(n | 0);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) { o.push(b); return o; }
    o.push(b | 0x80);
  }
};
const wasmName = (s: string): number[] => [...uleb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];
/** Where the tally keeps its read region and its write region. */
export const TALLY = { readsAt: 0, writesAt: 4096 } as const;
/**
 * Each step the tally reads the i32 at the start of its read region, its one read (README: a logic item's read of a
 * published reading), and writes it as an f64 into its one array, `seen`:
 * `(f64.store (i32.const 4096) (f64.convert_i32_s (i32.load (i32.const 0))))`. `init` does nothing.
 */
export function tallyBytes(): Uint8Array {
  const body = (b: number[]): number[] => { const f = [0x00, ...b, 0x0b]; return [...uleb(f.length), ...f]; };
  const step = [0x41, ...sleb(TALLY.writesAt), 0x41, ...sleb(TALLY.readsAt), 0x28, 0x02, 0x00, 0xb7, 0x39, 0x03, 0x00];
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, 0x01, 0x01]])),
    ...section(6, vec([[0x7f, 0x00, 0x41, ...sleb(TALLY.readsAt), 0x0b], [0x7f, 0x00, 0x41, ...sleb(TALLY.writesAt), 0x0b]])),
    ...section(7, vec([[...wasmName('memory'), 0x02, 0x00], [...wasmName('reads_at'), 0x03, 0x00], [...wasmName('writes_at'), 0x03, 0x01], [...wasmName('init'), 0x00, 0x00], [...wasmName('step'), 0x00, 0x01]])),
    ...section(10, vec([body([]), body(step)])),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: the ring's bytes, and a step's GPU time.

export interface RingRow { frame: number; step: number; bytes: number; budget: number; checkpoints: number[] }
/**
 * "The checkpoint ring stays inside its byte budget": on every frame the ring names the declared budget, holds no
 * more bytes than it, and no fewer than its checkpoints' buffers. Guards: the ring holds a checkpoint when the play
 * ends, and over the play it took more checkpoints than the budget fits (`fits`), so it thinned to stay inside.
 */
export function ringProblems(rows: readonly RingRow[], declared: number, bytes: number, last: number): string[] {
  const p: string[] = [];
  if (rows.length === 0) return ['no frame reports the buffer\'s ring'];
  const fits = Math.floor(declared / bytes);
  const taken = new Set<number>();
  for (const r of rows) {
    for (const c of r.checkpoints) taken.add(c);
    if (r.budget !== declared) { p.push(`at frame ${r.frame} the ring names a budget of ${r.budget} bytes, not the declared ${declared}`); break; }
    if (r.bytes > declared) { p.push(`at frame ${r.frame}, step ${r.step}, the ring holds ${r.bytes} bytes (${r.checkpoints.length} checkpoints), past its budget of ${declared}`); break; }
    if (r.bytes < r.checkpoints.length * bytes) { p.push(`at frame ${r.frame} the ring reports ${r.bytes} bytes for ${r.checkpoints.length} checkpoints of a ${bytes}-byte buffer`); break; }
  }
  const end = rows[rows.length - 1]!;
  if (end.step !== last) p.push(`the last frame holds the buffer at step ${end.step}, not ${last}`);
  if (end.checkpoints.length === 0) p.push(`at step ${end.step} the ring holds no checkpoint`);
  if (taken.size <= fits) p.push(`the ring took ${taken.size} checkpoints over the play, no more than the ${fits} its budget fits: staying inside it shows nothing`);
  return p;
}

/** The 95th percentile of a run's values. */
export const p95 = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? NaN;
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
/**
 * The design's judge of a timing limit (Every task carries its own budgets): five runs after a warm-up; PASS when all
 * five are within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and their
 * spread), otherwise INCONCLUSIVE. On a loaded machine (a one-minute load over 1 a core) the runs are a reading:
 * INCONCLUSIVE whatever they are, never PASS or FAIL.
 */
export function timingVerdict(name: string, runs: readonly number[], limit: number, loadPerCore: number): { verdict: Verdict; line: string } {
  const spread = runs.length ? (Math.max(...runs) - Math.min(...runs)) / limit : 0;
  const margin = Math.max(0.05, spread);
  const line = `${name}: ${runs.map((r) => fmt(r, 3)).join(', ')} against ${limit} (margin ${fmt(margin * 100, 0)}%, load ${fmt(loadPerCore, 2)} a core)`;
  if (runs.length !== 5 || runs.some((r) => !Number.isFinite(r) || r <= 0)) return { verdict: 'INCONCLUSIVE', line: `not five runs with a GPU time: ${line}` };
  if (!(loadPerCore <= 1)) return { verdict: 'INCONCLUSIVE', line: `under load: ${line}` };
  if (runs.every((r) => r <= limit)) return { verdict: 'PASS', line };
  return { verdict: runs.every((r) => r > limit * (1 + margin)) ? 'FAIL' : 'INCONCLUSIVE', line };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6: the recorded taste call.

export interface TasteFiles { screenshots: Readonly<Record<string, string>>; recordings: Readonly<Record<string, string>> }
/** The taste call on exactly these files: PASS only for `looks_right` by a named person at a time, on these hashes. */
export function tasteVerdict(record: unknown, criterion: string, files: TasteFiles): { verdict: Verdict; line: string } {
  if (record === null || record === undefined) return { verdict: 'INCONCLUSIVE', line: 'no taste call is recorded' };
  if (!isObj(record)) return { verdict: 'INCONCLUSIVE', line: 'TASTE.json is not an object' };
  const same = (got: unknown, want: Readonly<Record<string, string>>): boolean => isObj(got) && Object.keys(got).sort().join() === Object.keys(want).sort().join() && Object.keys(want).every((k) => got[k] === want[k]);
  const who = typeof record['who'] === 'string' ? record['who'].trim() : '';
  const when = typeof record['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(record['when']) && !Number.isNaN(Date.parse(record['when'])) ? record['when'] : '';
  if (record['issue'] !== 853 || record['criterion'] !== criterion || !who || !when) return { verdict: 'INCONCLUSIVE', line: `the recorded call isn't a call on ${criterion} by a named person at an ISO 8601 time` };
  if (!same(record['screenshots'], files.screenshots) || !same(record['recordings'], files.recordings)) return { verdict: 'INCONCLUSIVE', line: `the recorded call (${who}, ${when}) was made on other files than this run's` };
  if (record['verdict'] === 'looks_right') return { verdict: 'PASS', line: `taste call recorded by ${who} at ${when}: looks right` };
  if (record['verdict'] === 'looks_wrong') return { verdict: 'FAIL', line: `the taste call (${who}, ${when}) says they don't look right${typeof record['note'] === 'string' ? `: ${record['note']}` : ''}` };
  return { verdict: 'INCONCLUSIVE', line: `the recorded call's verdict is ${show(record['verdict'])}, not looks_right or looks_wrong` };
}

// ---------------------------------------------------------------------------------------------------
// Planted sets: numbers a right program would give, which each judge must pass, and numbers a wrong program would
// give, which it must fail naming what its criterion names.

/** A seeded number in [0, 1): a small generator of the tests' own. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const particle = (w: Float32Array, i: number, x: number, y: number, z: number, age = 1): void => { w.set([x, y, z, 0, 0, 0, age], STRIDE * i); };
/** A bed: the tray filled in layers, `spacing` apart across and `dy` apart in height, from the floor up. */
function bed(t: Tray, dy: number): Float32Array {
  const w = new Float32Array(t.count * STRIDE);
  const side = Math.round((2 * t.half) / t.spacing);
  for (let i = 0; i < t.count; i++) {
    const layer = Math.floor(i / (side * side));
    const k = i % (side * side);
    particle(w, i, -t.half + t.spacing * (0.5 + (k % side)), dy * (0.5 + layer), -t.half + t.spacing * (0.5 + Math.floor(k / side)));
  }
  return w;
}
/** Every particle at a seeded place across the tray at height `y`. */
function sheet(t: Tray, y: number): Float32Array {
  const w = new Float32Array(t.count * STRIDE);
  const r = random(7);
  for (let i = 0; i < t.count; i++) particle(w, i, (2 * r() - 1) * t.half, y, (2 * r() - 1) * t.half);
  return w;
}
/** The lift's particles under a floor program: `right` rides the floor and flies off it; `late` meets the floor a
 * step behind; `ignores` never meets it; `carried` is set on it with no speed. */
function liftRun(how: 'right' | 'late' | 'ignores' | 'carried'): Map<number, Float32Array> {
  const out = new Map<number, Float32Array>();
  for (let s = LIFT.restFrom; s <= LIFT.last; s++) {
    const w = new Float32Array(LIFT.count * STRIDE);
    const t = (s - LIFT.stopsAt) / STEP_RATE;
    const flown = s > LIFT.stopsAt ? Math.max(0, LIFT.speed * t - (G * t * t) / 2) : 0;
    const y = how === 'ignores' ? 0 : how === 'late' ? liftTop(s - 1) : liftTop(s) + (how === 'right' ? flown : 0);
    for (let i = 0; i < LIFT.count; i++) particle(w, i, (i % 32) / 32 - 0.5, y, Math.floor(i / 32) / 32 - 0.5);
    out.set(s, w);
  }
  return out;
}
/** The corridor's particles under a wall program: `swept` stops each at the wall it would cross and sends it back at
 * half its speed; `end` tests only where a step ends; `still` never moves; `slow` moves 0.6 m/s. */
function corridorRun(how: 'swept' | 'end' | 'still' | 'slow'): Float32Array[] {
  const n = CORRIDOR.count;
  const x = Float64Array.from({ length: n }, (_, i) => -0.5 + (i + 0.5) / n);
  const v = new Float64Array(n).fill(how === 'still' ? 0 : how === 'slow' ? 0.6 : CORRIDOR.speed);
  const out: Float32Array[] = [];
  for (let s = 0; s <= CORRIDOR.steps; s++) {
    const w = new Float32Array(n * STRIDE);
    for (let i = 0; i < n; i++) {
      if (s > 0) {
        const next = x[i]! + v[i]! / STEP_RATE;
        const side = Math.sign(v[i]!);
        const crosses = how === 'end' ? Math.abs(next) >= CORRIDOR.near && Math.abs(next) <= CORRIDOR_FAR : Math.abs(next) >= CORRIDOR.near && Math.abs(x[i]!) <= CORRIDOR.near;
        if (crosses) { x[i] = side * CORRIDOR.near; v[i] = -v[i]! / 2; } else x[i] = next;
      }
      particle(w, i, x[i]!, 0, 0);
    }
    out.push(w);
  }
  return out;
}

/** Every judge on its planted sets: the judges that pass a wrong set, fail a right one or don't name what their
 * criterion names. Empty when each judge holds. */
export function plantedSetFailures(): string[] {
  const bad: string[] = [];
  const passes = (name: string, problems: string[]): void => { if (problems.length) bad.push(`${name}: the judge fails a right set: ${problems[0]}`); };
  const fails = (name: string, problems: string[], ...naming: (string | RegExp)[]): void => {
    if (problems.length === 0) { bad.push(`${name}: the judge passes a wrong set`); return; }
    const text = problems.join('\n');
    for (const n of naming) if (!(typeof n === 'string' ? text.includes(n) : n.test(text))) bad.push(`${name}: the judge's failure doesn't name ${String(n)}: ${problems[0]}`);
  };
  const eq = (name: string, got: unknown, want: unknown): void => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`); };

  // The ring's arithmetic, for the two fixtures' budgets and for the design's default.
  eq('the pour\'s ring at step 600', ringHeld(600, POUR.every, POUR.budget, POUR_BYTES), [0, 120, 240, 360, 480, 600]);
  eq('the pour\'s ring at step 420', ringHeld(420, POUR.every, POUR.budget, POUR_BYTES), [0, 60, 120, 180, 240, 300, 360, 420]);
  eq('the pour\'s checkpoints taken by step 600', ringTaken(600, POUR.every, POUR.budget, POUR_BYTES), [0, 60, 120, 180, 240, 300, 360, 420, 480, 600]);
  eq('the pour\'s ring at step 600 with checkpoints a third larger', ringHeld(600, POUR.every, POUR.budget, Math.floor(POUR_BYTES * 1.33)), [0, 120, 240, 360, 480, 600]);
  eq('the pour\'s ring at step 600 under the default 16 MiB', ringHeld(600, 60, 16 * 1024 * 1024, POUR_BYTES), [0, 240, 480]);
  eq('the flood\'s ring at step 300', ringHeld(FLOOD_STEPS, FLOOD.every, FLOOD.budget, FLOOD_BYTES), [0, 240]);
  eq('the flood\'s checkpoints taken by step 300', ringTaken(FLOOD_STEPS, FLOOD.every, FLOOD.budget, FLOOD_BYTES), [0, 60, 120, 240]);
  eq('a ring whose buffer is past its budget', ringHeld(600, 60, POUR_BYTES - 1, POUR_BYTES), []);

  // The pile.
  const settled = bed(POUR, POUR.spacing);
  passes('the pile judge, a bed in layers', pileProblems(settled, POUR, 'a bed'));
  eq('the pile\'s least height, m', Number(leastPile(POUR).toFixed(4)), 0.4419);
  fails('the pile judge, particles that never push each other apart', pileProblems(sheet(POUR, 0), POUR, 'one layer'), 'push each other apart');
  fails('the pile judge, particles through the floor', pileProblems(sheet(POUR, -5), POUR, 'fallen'), 'passed through the floor');
  fails('the pile judge, particles that never leave the emitter', pileProblems(sheet(POUR, POUR.emitAt[1]), POUR, 'unpoured'), 'never left the emitter');
  const outside = bed(POUR, POUR.spacing);
  particle(outside, 5, 2, 0.5, 0);
  fails('the pile judge, a particle outside the walls', pileProblems(outside, POUR, 'spilt'), 'particle 5', 'past a wall');
  const unborn = bed(POUR, POUR.spacing);
  for (let i = 0; i < 100; i++) unborn[STRIDE * i + AGE] = -1;
  fails('the pile judge, particles not poured', pileProblems(unborn, POUR, 'part poured'), '99900 of the 100000');
  fails('the pile judge, a short buffer', pileProblems(settled.subarray(0, 700), POUR, 'short'), '700 words');
  const h = centreHeight(settled, POUR);
  passes('the height judge, a seeded run 0.5% higher', heightProblems(centreHeight(bed(POUR, POUR.spacing * 1.005), POUR), h, 'a bed', 'a seeded run\'s'));
  fails('the height judge, a seeded run 2% higher', heightProblems(centreHeight(bed(POUR, POUR.spacing * 1.02), POUR), h, 'a bed', 'a seeded run\'s'), 'past 1%');
  fails('the height judge, no pile', heightProblems(null, h, 'a bed', 'a seeded run\'s'), 'no height');
  const half = bed(POUR, POUR.spacing);
  for (let i = 50_000; i < POUR.count; i++) half[STRIDE * i + AGE] = -1;
  passes('the pour judge, half poured', halfPouredProblems(half, POUR, 'at 1 s'));
  fails('the pour judge, all at once', halfPouredProblems(settled, POUR, 'at 1 s'), 'not 40% to 60%');
  passes('the pile judge, the flood as a bed', pileProblems(bed(FLOOD, FLOOD.spacing), FLOOD, 'the flood'));
  fails('the pile judge, the flood in one layer', pileProblems(sheet(FLOOD, 0), FLOOD, 'the flood'), 'push each other apart');

  // The seek.
  const hash = (c: string): string => c.repeat(64);
  const seek: Seek = { held: [0, 120, 240, 360, 480, 600], step: 150, restored: { from: 120, steps: 30 }, soughtHash: hash('a'), playedHash: hash('a'), moved: 20_000 };
  passes('the seek judge', seekProblems(seek));
  fails('the seek judge, a ring without the checkpoint at 2 s', seekProblems({ ...seek, held: [0, 240, 480], restored: { from: 0, steps: 150 } }), 'none at step 120', 'restored the checkpoint at step 0');
  fails('the seek judge, another hash', seekProblems({ ...seek, soughtHash: hash('b') }), 'hashes');
  fails('the seek judge, no restore', seekProblems({ ...seek, restored: null }), 'restored no checkpoint');
  fails('the seek judge, a buffer that didn\'t move', seekProblems({ ...seek, moved: 0 }), 'prove nothing');

  // The frame rates.
  const plays = (h30: string, h144: string): Play[] => [{ fps: 60, frame: 150, hash: hash('a'), step: 150 }, { fps: 30, frame: 75, hash: h30, step: 150 }, { fps: 144, frame: 360, hash: h144, step: 150 }];
  passes('the rate judge', rateProblems(150, plays(hash('a'), hash('a'))));
  fails('the rate judge, a module that integrates by frame time', rateProblems(150, plays(hash('b'), hash('c'))), /^at step 150 \(2\.5 s\), the pour played at 144 frames a second \(frame 360\) hashes c+, at 30 frames a second \(frame 75\) b+$/m);
  fails('the rate judge, another step', rateProblems(150, [{ fps: 30, frame: 75, hash: hash('a'), step: 75 }]), 'at step 150', 'holds the buffer at step 75');

  // The lift.
  passes('the lift judge', liftProblems(liftRun('right')));
  fails('the lift judge, a floor met a step late', liftProblems(liftRun('late')), 'at step 61, the step the floor moved', 'particle 0', '0.0200 m under it');
  fails('the lift judge, a floor never met', liftProblems(liftRun('ignores')), 'at step 61');
  fails('the lift judge, a floor that only carries', liftProblems(liftRun('carried')), 'after step 120', 'didn\'t bounce');
  const early = liftRun('right');
  early.get(55)![STRIDE * 3 + 1] = 0.2;
  fails('the lift judge, a particle not at rest', liftProblems(early), 'at step 55, before the floor moves, particle 3');

  // The corridor.
  passes('the wall judge', wallProblems(corridorRun('swept')));
  fails('the wall judge, a step that tests only the end position', wallProblems(corridorRun('end')), /particle \d+ passed through the wall: at step \d+ it is at x = /);
  fails('the wall judge, particles that never move', wallProblems(corridorRun('still')), 'can\'t cross');
  fails('the wall judge, slow particles', wallProblems(corridorRun('slow')), 'can\'t cross', 'none is fast enough to tunnel');

  // Two runs.
  const steps = range(0, 10).map((k) => 60 * k);
  const held = ringHeld(600, POUR.every, POUR.budget, POUR_BYTES);
  const taken = ringTaken(600, POUR.every, POUR.budget, POUR_BYTES);
  const runOf = (salt: string): Run => ({ hashes: new Map(steps.map((s) => [s, (salt + s.toString(16)).padStart(64, '0')])), taken });
  passes('the checkpoint judge', checkpointProblems(runOf(''), runOf(''), steps, held));
  const other = runOf('');
  (other.hashes as Map<number, string>).set(360, hash('f'));
  fails('the checkpoint judge, a second run that differs', checkpointProblems(runOf(''), other, steps, held), 'at the checkpoint at step 360');
  const stuck: Run = { hashes: new Map(steps.map((s) => [s, hash('a')])), taken };
  fails('the checkpoint judge, a buffer that never steps', checkpointProblems(stuck, stuck, steps, held), 'didn\'t step');
  fails('the checkpoint judge, a run with no checkpoint', checkpointProblems({ ...runOf(''), taken: [] }, runOf(''), steps, held), 'the first run reports no checkpoint at steps [0, 120', 'other checkpoints');
  fails('the checkpoint judge, a checkpoint off the compared steps', checkpointProblems(runOf(''), { ...runOf(''), taken: [...taken, 630] }, steps, held), 'the second run reports checkpoints at steps [630]');
  const poured = (share: number): Float32Array => { const w = bed(POUR, POUR.spacing); for (let i = Math.round(share * POUR.count); i < POUR.count; i++) w[STRIDE * i + AGE] = -1; return w; };
  const lower = poured(0.5);
  for (let i = 0; i < 50_000; i++) lower[STRIDE * i + 1] = lower[STRIDE * i + 1]! + 0.5;
  passes('the pouring judge', pouringProblems({ 0: poured(0), 60: lower, 120: poured(1), 600: poured(1) }, POUR));
  fails('the pouring judge, a buffer that never moves', pouringProblems({ 0: poured(1), 60: poured(1), 120: poured(1), 600: poured(1) }, POUR), 'not 40% to 60%', 'before the pour', 'don\'t move');
  fails('the pouring judge, a pour that never ends', pouringProblems({ 0: poured(0), 60: lower, 120: poured(0.6), 600: poured(0.9) }, POUR), 'live at step 120', 'live at step 600');

  // A second machine.
  const golden: GoldenRead = { verdict: 'INCONCLUSIVE', reason: 'environment_changed', cls: 'same_machine', gpu: 'B', recordedGpu: 'A', numbers: false, text: '{"gpu":"A","run":"B"}' };
  passes('the second-machine judge', secondMachineProblems(golden, 'B', 'unshifted'));
  fails('the second-machine judge, a comparison across machines', secondMachineProblems({ ...golden, verdict: 'FAIL', reason: null, cls: 'exact', numbers: true }, 'B', 'shifted'), 'was compared and read FAIL', 'class exact');
  fails('the second-machine judge, a pass', secondMachineProblems({ ...golden, verdict: 'PASS', reason: null }, 'B', 'unshifted'), 'read PASS');
  fails('the second-machine judge, no class', secondMachineProblems({ ...golden, cls: null }, 'B', 'unshifted'), 'names class none');

  // The export.
  const shots = (salt: string): Map<number, Shot> => new Map(SAMPLED.map((f) => [f, { pixel: (salt + f.toString(16)).padStart(64, '0'), buffer: ('b' + f.toString(16)).padStart(64, '0') }]));
  passes('the export judge', exportProblems(shots(''), shots(''), { live: hash('c'), exported: hash('c') }));
  fails('the export judge, an export that differs at one time', exportProblems(shots(''), new Map([...shots('')].map(([f, s]) => [f, f === 300 ? { ...s, pixel: hash('d') } : s])), { live: hash('c'), exported: hash('c') }), 'at 5 s (frame 300), the export\'s pixel hash');
  fails('the export judge, another bake', exportProblems(shots(''), shots(''), { live: hash('c'), exported: hash('d') }), 'under key');
  fails('the export judge, no bake key', exportProblems(shots(''), shots(''), { live: null, exported: null }), 'names no bake key');
  const still = new Map(SAMPLED.map((f): [number, Shot] => [f, { pixel: hash('e'), buffer: hash('b') }]));
  fails('the export judge, a pour that isn\'t drawn', exportProblems(still, still, { live: hash('c'), exported: hash('c') }), 'isn\'t drawn');
  fails('the export judge, an export that draws nothing', exportProblems(shots(''), new Map(), { live: hash('c'), exported: hash('c') }), 'the export drew no frame');

  // The reading.
  const counts = Array.from({ length: DROPS.frames }, (_, k) => (k < 9 ? 0 : k < 29 ? 25 * (k - 8) + (k % 3) : k < 39 ? 512 : k < 47 ? 512 - 64 * (k - 38) : 0));
  const after = counts.map((_, k) => (k === 0 ? 0 : counts[k - 1]!));
  passes('the reading judge', readingProblems(after, counts, counts, 512));
  fails('the reading judge, a count read from this step\'s buffer', readingProblems(counts, counts, counts, 512), /at step \d+ the logic item read \d+; the reading published after step \d+/);
  fails('the reading judge, a count two steps late', readingProblems(counts.map((_, k) => (k < 2 ? 0 : counts[k - 2]!)), counts, counts, 512), 'at step');
  fails('the reading judge, nothing published', readingProblems(counts.map(() => 0), counts, counts, 512), 'at step');
  fails('the reading judge, a count of every particle', readingProblems(after.map((c) => 2 * c), counts, counts, 512), 'at step');
  fails('the reading judge, particles that never fall', readingProblems(counts.map(() => 0), counts.map(() => 0), counts.map(() => 0), 512), 'at step 33');
  fails('the reading judge, a gate that holds them all', readingProblems(after.map((c) => 2 * c), counts.map((c) => 2 * c), counts.map((c) => 2 * c), 1024), 'not 40% to 60%');

  // The check.
  passes('the check judge, a drawn document', checkProblems({ frames: [{ frame: 0 }] }, 'a document'));
  const issue = (ids: string[], path: string, actual: unknown): Loose => ({ code: 'refused', issues: [{ code: 'x', severity: 'error', ids, path, actual, what: 'w', fix: 'f' }] });
  const refusal = issue(['tally', 'drops'], 'items/tally/params/reads/0', 'drops.buffer');
  fails('the check judge, the refusal', checkProblems(refusal, 'a document'), 'drops.buffer');
  fails('the check judge, another refusal', checkProblems({ code: 'logic_refused', refusal: { read: 'drops.buffer' } }, 'a document'), 'drew no frame');
  passes('the refusal judge', bufferRefusalProblems(refusal, 'tally', 'drops', 'drops.buffer'));
  fails('the refusal judge, a drawn document', bufferRefusalProblems({ frames: [{ frame: 0 }] }, 'tally', 'drops', 'drops.buffer'), 'was drawn');
  fails('the refusal judge, the base\'s refusal of any unknown read', bufferRefusalProblems({ code: 'logic_refused', refusal: { read: 'drops.buffer' } }, 'tally', 'drops', 'drops.buffer'), 'isn\'t refused as a checked document');
  fails('the refusal judge, an issue on the logic item alone', bufferRefusalProblems(issue(['tally'], 'items/tally/params', { read: 'drops.buffer' }), 'tally', 'drops', 'drops.buffer'), 'no error issue names the buffer');
  fails('the refusal judge, an issue naming another read', bufferRefusalProblems(issue(['tally', 'drops'], 'items/tally/params/reads/0', 'drops.in_gate'), 'tally', 'drops', 'drops.buffer'), 'no error issue names the buffer');

  // The ring's bytes.
  const rows = (keepsAll: boolean): RingRow[] => range(0, FLOOD_STEPS).map((s) => {
    const checkpoints = keepsAll ? range(0, Math.floor(s / 60)).map((k) => 60 * k) : ringHeld(s, FLOOD.every, FLOOD.budget, FLOOD_BYTES);
    return { frame: s, step: s, bytes: checkpoints.length * FLOOD_BYTES, budget: FLOOD.budget, checkpoints };
  });
  passes('the ring judge', ringProblems(rows(false), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS));
  fails('the ring judge, a ring that keeps every checkpoint', ringProblems(rows(true), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'at frame 120', 'past its budget');
  fails('the ring judge, another budget', ringProblems(rows(false).map((r) => ({ ...r, budget: 16 * 1024 * 1024 })), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'not the declared');
  fails('the ring judge, bytes under its checkpoints\'', ringProblems(rows(false).map((r) => ({ ...r, bytes: 0 })), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'reports 0 bytes');
  fails('the ring judge, a ring that takes no checkpoint', ringProblems(rows(false).map((r) => ({ ...r, bytes: 0, checkpoints: [] })), FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'holds no checkpoint', 'shows nothing');
  fails('the ring judge, no rows', ringProblems([], FLOOD.budget, FLOOD_BYTES, FLOOD_STEPS), 'no frame');

  // The timing.
  eq('p95 of 1 … 300', p95(range(1, 300)), 285);
  eq('the timing judge, five within', timingVerdict('t', [3.1, 3.2, 3.0, 3.3, 3.2], 4, 0.4).verdict, 'PASS');
  eq('the timing judge, five well over', timingVerdict('t', [5.1, 5.2, 5.0, 5.3, 5.2], 4, 0.4).verdict, 'FAIL');
  eq('the timing judge, five astride the limit', timingVerdict('t', [3.9, 4.1, 3.8, 4.2, 4.0], 4, 0.4).verdict, 'INCONCLUSIVE');
  eq('the timing judge, five over within the margin', timingVerdict('t', [4.1, 4.15, 4.1, 4.12, 4.1], 4, 0.4).verdict, 'INCONCLUSIVE');
  eq('the timing judge, five within on a loaded machine', timingVerdict('t', [3.1, 3.2, 3.0, 3.3, 3.2], 4, 2.5).verdict, 'INCONCLUSIVE');
  eq('the timing judge, five over on a loaded machine', timingVerdict('t', [9, 9, 9, 9, 9], 4, 2.5).verdict, 'INCONCLUSIVE');
  eq('the timing judge, four runs', timingVerdict('t', [3, 3, 3, 3], 4, 0.4).verdict, 'INCONCLUSIVE');
  eq('the timing judge, a run with no GPU time', timingVerdict('t', [3, 3, 0, 3, 3], 4, 0.4).verdict, 'INCONCLUSIVE');
  eq('the timing judge, an unread load', timingVerdict('t', [3, 3, 3, 3, 3], 4, NaN).verdict, 'INCONCLUSIVE');

  // The taste call.
  const files: TasteFiles = { screenshots: { 'a.png': hash('1') }, recordings: { 'b.apng': hash('2') } };
  const call = { issue: 853, criterion: '#853.a7fb57f6', verdict: 'looks_right', who: 'the owner', when: '2026-11-22T10:00:00Z', ...files };
  eq('the taste judge, none', tasteVerdict(null, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  eq('the taste judge, looks right', tasteVerdict(call, '#853.a7fb57f6', files).verdict, 'PASS');
  eq('the taste judge, looks wrong', tasteVerdict({ ...call, verdict: 'looks_wrong' }, '#853.a7fb57f6', files).verdict, 'FAIL');
  eq('the taste judge, other files', tasteVerdict({ ...call, screenshots: { 'a.png': hash('3') } }, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  eq('the taste judge, a file missing', tasteVerdict({ ...call, recordings: {} }, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  eq('the taste judge, nobody', tasteVerdict({ ...call, who: ' ' }, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  eq('the taste judge, another criterion', tasteVerdict({ ...call, criterion: '#853.fe931abe' }, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  eq('the taste judge, no verdict', tasteVerdict({ ...call, verdict: 'fine' }, '#853.a7fb57f6', files).verdict, 'INCONCLUSIVE');
  return bad;
}
