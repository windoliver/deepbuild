// The numbers and the judges of the #3036 acceptance tests, with nothing of the test runner in them, so each judge can
// be run on planted sets by plain Node as well as by the tests (README: The judges, and the sets they must fail).
//
// Everything expected here is worked out from the issue's Scope and the fixtures' own numbers: where a ball stood at
// each whole multiple of the frame interval, which of those places had its lowest point within 2 cm of the plate, the
// raised-cosine profile across `width`, where a hop begins and ends, how far back a span reaches. Nothing is a value
// recorded from a run. A judge takes what a binary answered and returns its failures as sentences; an empty list
// passes.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

/** Each criterion's ID: `#3036.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const ID = {
  1: '#3036.ea21520e', 2: '#3036.c665f650', 3: '#3036.4fdba809', 4: '#3036.e57d7497', 5: '#3036.69707b1e', 6: '#3036.28aa4780',
} as const;
/** How every `describe` and test title starts. */
export const AC = {
  1: `AC1 ${ID[1]}`, 2: `AC2 ${ID[2]}`, 3: `AC3 ${ID[3]}`, 4: `AC4 ${ID[4]}`, 5: `AC5 ${ID[5]}`, 6: `AC6 ${ID[6]}`,
} as const;

/** A second in flicks (canvas primitives: Time and the flick). */
export const FLICKS = 705_600_000;
export const flicks = (seconds: number): number => Math.round(seconds * FLICKS);

// ---------------------------------------------------------------------------------------------------
// The issue's numbers

/** Criterion 1: "depth within 1 mm". */
export const DEPTH_TOL = 1e-3;
/** Criterion 1: "half of `width` within 5%". */
export const WIDTH_TOL = 0.05;
/** Scope: "Where the item's lowest point was within 2 cm of the surface". */
export const NEAR = 0.02;
/** Scope: "More than 4,096 samples alive on one plate are refused at check". */
export const MAX_SAMPLES = 4096;
/** Criterion 5: "a plate with 5,000 samples alive". */
export const OVER_SAMPLES = 5000;

// ---------------------------------------------------------------------------------------------------
// The fixtures' numbers (README: The fixtures). Metres, seconds, +Y up.

/** A terrain plate's `terrain` (Builder plate: terrain), its height one number: a level plate. */
export interface Terrain { height: number | string; size: [number, number]; spacing: number; tile: number; lod_levels: number }
/** The Scope's `tracks`, as a plate's `params.tracks` writes it; a field left out takes the Scope's default. */
export interface Tracks { items: string; width: number; depth: number; span?: number | 'all'; darken?: number }

/** The plate's ID in every fixture, the first ball's and the second's. */
export const PLATE = 'ground';
export const BALL = 'ball';
export const CROSSER = 'crosser';
/** The collection the tracks name, and the cap fixture's. */
export const ROLLERS = 'rollers';
export const CROWD = 'crowd';

/** Every level plate lies at 0.5 m, not 0: a plate that reads the ground as y = 0 finds every ball 0.5 m in the air. */
export const GROUND = 0.5;
/** Every ball's radius: `mark.sphere@1` of size 0.5 m, its lowest point its centre less this. */
export const RADIUS = 0.25;
/** The tracks' `width` and `depth` in every fixture that reads heights. */
export const WIDTH = 0.4;
export const DEPTH = 0.05;
export const TRACKS: Tracks = { items: ROLLERS, width: WIDTH, depth: DEPTH };

/**
 * The lane (criteria 1, 2, 4 and 5): 12 × 2 m at 0.05 m, 241 × 41 samples, level at 0.5 m. Its row of samples at
 * z = 0 is the roll's line (z = 2 × (20 ÷ 40 − 0.5) = 0 exactly), so the plate has vertices on the centre line, and
 * `width` is 8 spacings, so it has one at the half-depth point (width ÷ 4 = 0.1 m from the line) too.
 */
export const LANE: Terrain = { height: GROUND, size: [12, 2], spacing: 0.05, tile: 12, lod_levels: 1 };
/** The lane documents' frame rate: 2 frames a second, so the plate reads a place every 0.5 s. */
export const LANE_FPS = 2;
/** The lane documents' span, s. */
export const LANE_SPAN = 12;

/** Keys of a linear channel: `[seconds, value]`, held before the first and after the last. */
export type Keys = readonly (readonly [number, number])[];
/** How a ball moves: its x and its y by keys, its z fixed. */
export interface Motion { x: Keys; y: Keys; z: number }
export function keyed(keys: Keys, t: number): number {
  const first = keys[0]!, last = keys[keys.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  for (let k = 1; k < keys.length; k++) {
    const a = keys[k - 1]!, b = keys[k]!;
    if (t <= b[0]) return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
  }
  return last[1];
}
export const placeAt = (m: Motion, t: number): V3 => [keyed(m.x, t), keyed(m.y, t), m.z];

/** The roll: 10 m along +x on the line z = 0, from x = −5 m at 0 s to x = 5 m at 10 s, 1 m/s, the ball's centre one radius over the plate. */
export const ROLL = { from: -5, to: 5, seconds: 10 } as const;
export const ROLLING: Motion = { x: [[0, ROLL.from], [ROLL.seconds, ROLL.to]], y: [[0, GROUND + RADIUS], [ROLL.seconds, GROUND + RADIUS]], z: 0 };
/** One sample's spacing on the roll: 1 m/s × 0.5 s. It is wider than `width`, so places lowered one by one leave bare ground between them. */
export const SPACING = (ROLL.to - ROLL.from) / ROLL.seconds / LANE_FPS;
/**
 * The hop: the same roll, the ball leaving the plate at x = −1 m (4 s), 0.5 m up at x = 0 (5 s) and down again at
 * x = 1 m (6 s): 2 m through the air. Its lowest point is (0.5 × (1 − |t − 5|)) m over the plate between 4 and 6 s,
 * so more than 2 cm from 4.04 s to 5.96 s: the places read at 4.5, 5 and 5.5 s are in the air, those at 4 and 6 s on
 * the ground.
 */
export const HOP = { from: -1, to: 1, t0: 4, t1: 6, apex: 0.5 } as const;
export const HOPPING: Motion = {
  x: ROLLING.x, z: 0,
  y: [[0, GROUND + RADIUS], [HOP.t0, GROUND + RADIUS], [(HOP.t0 + HOP.t1) / 2, GROUND + RADIUS + HOP.apex], [HOP.t1, GROUND + RADIUS], [ROLL.seconds, GROUND + RADIUS]],
};
/** Criteria 1 and 2 read the lane once the roll is done. */
export const ROLLED_AT = 10;
/** Criterion 5: `span: 5s`, read at 8 s, a whole multiple of the frame interval: the ball is at x = 3 m and was at x = −2 m 5 s before. */
export const SPAN = 5;
export const SPAN_AT = 8;

/** One place a plate reads: the item's at frame `k` (k ÷ fps s), and whether its lowest point was within 2 cm of the plate. */
export interface Sample { k: number; t: number; at: V3; grounded: boolean }
/**
 * The places a plate reads at `t` (Scope: "each named item's position at whole multiples of the frame interval over
 * the span"): one at each whole multiple of the frame interval from t − span to t, both ends counted, none before the
 * document's start; `all` reaches back to the start. `t` is a whole multiple itself wherever the tests read heights.
 */
export function samplesAt(m: Motion, fps: number, t: number, span: number | 'all' = 'all'): Sample[] {
  const last = Math.floor(t * fps + 1e-9);
  const first = span === 'all' ? 0 : Math.max(0, Math.ceil((t - span) * fps - 1e-9));
  const out: Sample[] = [];
  for (let k = first; k <= last; k++) {
    const at = placeAt(m, k / fps);
    out.push({ k, t: k / fps, at, grounded: at[1] - RADIUS - GROUND <= NEAR + 1e-9 });
  }
  return out;
}
/** How many places are alive on a plate at a time past its span: each item's, from t − span to t, both ends counted. */
export const aliveCount = (items: number, fps: number, span: number): number => items * (Math.round(span * fps) + 1);

/** Criterion 5's plate with 5,000 samples alive: 8 balls at rest on the lane, 24 frames a second, `span: 26`: 8 × (26 × 24 + 1) = 5,000. */
export const CAP = { items: 8, fps: 24, span: 26, seconds: 30 } as const;
/** Its twin under the cap: `span: 20`, 8 × (20 × 24 + 1) = 3,848, no more than 4,096. */
export const UNDER_SPAN = 20;

// ---- Criterion 3: the yard, where the physics module rolls the balls

/** The yard: 16 × 6 m at 0.1 m, 161 × 61 samples, level at 0.5 m; its row at z = 0 is the first ball's line. */
export const YARD: Terrain = { height: GROUND, size: [16, 6], spacing: 0.1, tile: 16, lod_levels: 1 };
export const YARD_FPS = 10;
export const YARD_SPAN = 5;
/** The world's ID in the yard's document, its step rate, and its bodies' IDs. */
export const WORLD = 'lab';
export const STEP_RATE = 120;
export const ROLLER_BODY = 'roller';
export const CROSSER_BODY = 'crosser';
const deg = (rad: number): number => (rad * 180) / Math.PI;
/** How a yard's ball is launched: its place, its velocity (m/s, deg/s) and the axes its body's `locks` hold. */
export interface Launch { at: V3; linear: V3; angular: V3; locks: { linear: [boolean, boolean, boolean]; angular: [boolean, boolean, boolean] } }
/**
 * The first ball: from (−7, 0.75, 0) along +x at 3.5 m/s, turning as a ball that rolls without slipping does
 * (ω = v ÷ r about −z). Its body's `locks` hold it to the plane z = 0 and to that one turn, so its line is straight:
 * left free, the base's ball drifts 0.46 m off its line in 5 s.
 */
export const ROLLER: Launch = { at: [-7, GROUND + RADIUS, 0], linear: [3.5, 0, 0], angular: [0, 0, -deg(3.5 / RADIUS)], locks: { linear: [false, false, true], angular: [true, true, false] } };
/**
 * The second ball: from (−4, 0.75, −2) along +z at 0.8 m/s, held to the plane x = −4 m the same way. It meets the
 * first one's line a little over 2 s in, more than a second after the first ball passed there.
 */
export const CROSSING: Launch = { at: [-4, GROUND + RADIUS, -2], linear: [0, 0, 0.8], angular: [deg(0.8 / RADIUS), 0, 0], locks: { linear: [true, false, false], angular: [false, true, true] } };
/** When the yard's surfaces are read: 4.5 s, a whole multiple of the frame interval, the first ball some 10 m on. */
export const YARD_AT = 4.5;

/** A plate's samples a side. */
export const samplesOf = (t: Terrain): [number, number] => [Math.round(t.size[0] / t.spacing) + 1, Math.round(t.size[1] / t.spacing) + 1];
/** Sample (c, r) of a plate in its own space, as the base places it: size × (c ÷ (cols − 1) − ½). */
export function sampleAt(t: Terrain, c: number, r: number): [number, number] {
  const [cols, rows] = samplesOf(t);
  return [t.size[0] * (c / (cols - 1) - 0.5), t.size[1] * (r / (rows - 1) - 0.5)];
}

// ---------------------------------------------------------------------------------------------------
// Probes: where the tests ask for the drawn surface's height. Each is a ray straight down through (x, z).

export interface Probe { x: number; z: number }
/** A probe's answer: the height the ray met the drawn surface at, or null when it met nothing. */
export interface Height extends Probe { y: number | null }
/** One cross-section of the groove: heights along z at one x. */
export interface Cut { x: number; heights: Height[] }

/** The roll's line every 0.05 m (the lane's spacing) from x = −5 m to x = 5 m: 201 probes on the row z = 0. */
export const lineProbes = (): Probe[] => Array.from({ length: 201 }, (_, i) => ({ x: (i - 100) / 20, z: 0 }));
/**
 * Criterion 1's three cross-sections, 160 probes each, 5 mm apart from z = −0.3975 m to z = 0.3975 m: one at
 * x = 0.012 m, beside the place read at 5 s, and two between places, at x = −2.738 m (0.262 m and 0.238 m from the
 * places read at 2 s and 2.5 s) and x = 2.262 m. No probe lies on a row of samples or on a cell's diagonal, so each
 * ray meets one triangle's inside.
 */
export const CUTS_AT = [-2.738, 0.012, 2.262] as const;
export const cutProbes = (x: number): Probe[] => Array.from({ length: 160 }, (_, k) => ({ x, z: (k * 5 - 397.5) / 1000 }));

// ---------------------------------------------------------------------------------------------------
// The judges

const f = (x: number, digits = 4): string => String(Number(x.toFixed(digits)));
/** How much lower than the plate as built a height is; null when the ray met nothing. */
export const lowered = (h: Height): number | null => (h.y === null ? null : GROUND - h.y);
const told = (low: number | null): string => (low === null ? 'met by no ray' : `lowered by ${f(low, 5)} m`);

/** Where a point of the roll's line lies among the places read: at one of them, or in the gap between two. */
export function where(samples: readonly Sample[], x: number): { key: string; name: string } {
  const at = samples.find((s) => Math.abs(s.at[0] - x) < 1e-6);
  if (at) return { key: `s${at.k}`, name: `the place read at x ${f(at.at[0])} m (${f(at.t)} s)` };
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    if (x > Math.min(a.at[0], b.at[0]) && x < Math.max(a.at[0], b.at[0])) {
      return { key: `g${a.k}`, name: `the gap between the places read at x ${f(a.at[0])} m (${f(a.t)} s) and x ${f(b.at[0])} m (${f(b.t)} s)` };
    }
  }
  return { key: 'off', name: 'off the roll' };
}

/** Where a cross-section lies: beside a place read (within a quarter of one sample's spacing of it), or in the gap between two. */
export function whereCut(samples: readonly Sample[], x: number): string {
  const near = samples.find((s) => Math.abs(s.at[0] - x) <= SPACING / 4);
  return near ? `beside the place read at x ${f(near.at[0])} m (${f(near.t)} s)` : where(samples, x).name;
}

/** One sentence for each named stretch whose probes aren't as wanted, with one of them as its example. */
function stretches(line: readonly Height[], name: (h: Height) => { key: string; name: string } | null, ok: (low: number | null) => boolean, want: string): string[] {
  const groups = new Map<string, { name: string; total: number; off: Height[] }>();
  for (const h of line) {
    const n = name(h);
    if (!n) continue;
    const g = groups.get(n.key) ?? { name: n.name, total: 0, off: [] };
    g.total += 1;
    if (!ok(lowered(h))) g.off.push(h);
    groups.set(n.key, g);
  }
  const out: string[] = [];
  for (const g of groups.values()) {
    if (!g.off.length) continue;
    const one = g.off[Math.floor(g.off.length / 2)]!;
    out.push(`${g.name}: on the centre line the drawn surface is ${told(lowered(one))} at x ${f(one.x)} m, ${want} (${g.off.length} of ${g.total} probes there)`);
  }
  return out;
}
const isGroove = (low: number | null): boolean => low !== null && Math.abs(low - DEPTH) <= DEPTH_TOL;
const isBare = (low: number | null): boolean => low !== null && Math.abs(low) <= DEPTH_TOL;
const GROOVE = `not by the depth ${DEPTH} m within 1 mm`;
const BARE = 'where no groove may be (the plate as built within 1 mm)';

/**
 * A cross-section's width at half depth, m: the distance between the one place the lowering rises through
 * depth ÷ 2 and the one place it falls back through it, each found between two neighbouring probes by a straight
 * line. Or, as text, why it has none.
 */
export function widthAtHalfDepth(heights: readonly Height[]): number | string {
  const half = DEPTH / 2;
  const lows: number[] = [];
  for (const h of heights) {
    const low = lowered(h);
    if (low === null) return `the ray down through z ${f(h.z)} m met no drawn surface`;
    lows.push(low);
  }
  const cross = (i: number): number => {
    const a = heights[i]!.z, b = heights[i + 1]!.z;
    return a + ((b - a) * (half - lows[i]!)) / (lows[i + 1]! - lows[i]!);
  };
  const up: number[] = [], down: number[] = [];
  for (let i = 0; i + 1 < lows.length; i++) {
    if (lows[i]! < half && lows[i + 1]! >= half) up.push(cross(i));
    if (lows[i]! >= half && lows[i + 1]! < half) down.push(cross(i));
  }
  if (up.length !== 1 || down.length !== 1) {
    const deepest = Math.max(...lows);
    return `the lowering passes half the depth ${up.length} times going down and ${down.length} times coming up, not once each (its deepest probe is lowered by ${f(deepest, 5)} m)`;
  }
  return down[0]! - up[0]!;
}

/**
 * Criterion 1: why the roll's groove isn't `depth` deep on its centre line within 1 mm, or `width` ÷ 2 wide at half
 * depth within 5%. The centre line is judged between the roll's ends (x from −4.95 m to 4.95 m); the shape of an end
 * is no criterion's. Each failure names the place it is at: one the plate read, or the gap between two.
 */
export function grooveFailures(samples: readonly Sample[], line: readonly Height[], cuts: readonly Cut[]): string[] {
  const inside = (h: Height): boolean => h.x > ROLL.from + 1e-6 && h.x < ROLL.to - 1e-6;
  const out = stretches(line, (h) => (inside(h) ? where(samples, h.x) : null), isGroove, GROOVE);
  for (const cut of cuts) {
    const w = widthAtHalfDepth(cut.heights);
    const want = WIDTH / 2;
    const at = `${whereCut(samples, cut.x)}: across the groove at x ${f(cut.x)} m`;
    if (typeof w === 'string') out.push(`${at} ${w}, so it has no width at half depth; half the width is ${f(want)} m`);
    else if (Math.abs(w - want) > WIDTH_TOL * want) out.push(`${at} its width at half depth is ${f(w, 5)} m, not half the width ${f(want)} m within 5%`);
  }
  return out;
}

/** How far from each end of the hop a groove may still reach: one sample's spacing, and the half width a lowering reaches past its line. */
export const HOP_MARGIN = SPACING + WIDTH / 2;
/**
 * Criterion 2: why the hopping ball's groove isn't there before and after the hop, or is there under it. Before the
 * hop is x up to −1.05 m, after it x from 1.05 m; under it, the centre line from x = −1 m + 0.7 m to x = 1 m − 0.7 m
 * must lie as built. A failure under the hop names the span.
 */
export function hopFailures(line: readonly Height[]): string[] {
  const step = LANE.spacing;
  const span = `under the hop, the span from x ${f(HOP.from)} m to x ${f(HOP.to)} m (${f(HOP.t0)} s to ${f(HOP.t1)} s)`;
  const inside = (h: Height): boolean => h.x > ROLL.from + 1e-6 && h.x < ROLL.to - 1e-6;
  const before = stretches(line, (h) => (inside(h) && h.x <= HOP.from - step + 1e-6 ? { key: 'before', name: `before the hop (x ${f(ROLL.from)} m to ${f(HOP.from)} m)` } : null), isGroove, GROOVE);
  const after = stretches(line, (h) => (inside(h) && h.x >= HOP.to + step - 1e-6 ? { key: 'after', name: `after the hop (x ${f(HOP.to)} m to ${f(ROLL.to)} m)` } : null), isGroove, GROOVE);
  const under = stretches(line, (h) => (h.x > HOP.from + HOP_MARGIN + 1e-6 && h.x < HOP.to - HOP_MARGIN - 1e-6 ? { key: 'under', name: span } : null), isBare, `${BARE}: the ball was in the air, and this is more than one sample's spacing (${f(SPACING)} m) and half the width from either end`);
  return [...before, ...under, ...after];
}

/**
 * Criterion 5: why the groove behind the ball at `at` s isn't `span` s long. The ball is at x(at) and was at
 * x(at − span) `span` s before. The centre line must be `depth` deep from just over one sample's spacing past
 * x(at − span) up to the ball, and as built farther back than one sample's spacing and half the width behind
 * x(at − span), and ahead of the ball past half the width.
 */
export function spanFailures(line: readonly Height[], at: number, span: number): string[] {
  const head = placeAt(ROLLING, at)[0], tail = placeAt(ROLLING, at - span)[0];
  const step = LANE.spacing;
  const behind = `the ${f(span)} s behind the ball at ${f(at)} s (x ${f(tail)} m to ${f(head)} m)`;
  const groove = stretches(line, (h) => (h.x >= tail + SPACING + step - 1e-6 && h.x <= head - step + 1e-6 ? { key: 'in', name: behind } : null), isGroove, GROOVE);
  const older = stretches(line, (h) => (h.x <= tail - HOP_MARGIN - step + 1e-6 ? { key: 'old', name: `older than ${f(span)} s (the ball left x ${f(tail)} m ${f(span)} s before)` } : null), isBare, BARE);
  const ahead = stretches(line, (h) => (h.x >= head + WIDTH / 2 + step - 1e-6 ? { key: 'ahead', name: `ahead of the ball at ${f(at)} s (x ${f(head)} m)` } : null), isBare, BARE);
  return [...groove, ...older, ...ahead];
}

/** Why the keyed ball isn't where its keys put it at each place read (within 1e-4 m): the fixture is the roll, or the hop, the criterion describes. */
export function placeFailures(m: Motion, samples: readonly Sample[], got: readonly V3[]): string[] {
  const out: string[] = [];
  if (got.length !== samples.length) return [`${got.length} places were read, not the ${samples.length} asked for`];
  samples.forEach((s, i) => {
    const p = got[i]!, want = placeAt(m, s.t);
    if (p.some((v, k) => Math.abs(v - want[k]!) > 1e-4)) out.push(`at ${f(s.t)} s the ball is at (${p.map((v) => f(v, 5)).join(', ')}), not (${want.map((v) => f(v, 5)).join(', ')})`);
  });
  return out;
}

/** Why a show isn't refused at check with an error naming the plate and, in its `actual`, the count of samples alive. */
export function capFailures(reply: JsonObject, plate: string, count: number): string[] {
  const brief = (v: JsonValue | undefined): string => (JSON.stringify(v) ?? 'undefined').slice(0, 2000);
  if (reply['outcome'] !== 'refused') return [`the show's outcome is ${brief(reply['outcome'])}, not refused: ${brief(reply)}`];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter((i): i is JsonObject => typeof i === 'object' && i !== null && !Array.isArray(i)) : [];
  const path = `items/${plate}/params/tracks`;
  const named = issues.find((i) => {
    const actual = i['actual'];
    return i['severity'] === 'error' && Array.isArray(i['ids']) && i['ids'].includes(plate)
      && typeof i['path'] === 'string' && (i['path'] === path || i['path'].startsWith(`${path}/`))
      && typeof actual === 'object' && actual !== null && !Array.isArray(actual) && actual['count'] === count;
  });
  return named ? [] : [`no error names ${plate} at ${path} with the count ${count} in its actual; the issues: ${brief(issues)}`];
}

// ---- Criterion 3

/** Why two bakes' step hashes aren't the same: nothing baked, another number of steps, or the first step whose hash differs, by its number. */
export function stepFailures(on: readonly string[], off: readonly string[]): string[] {
  if (on.length < 2 || off.length < 2) return [`a bake answered ${on.length} step hashes with tracks on and ${off.length} with tracks off: no roll was stepped`];
  if (on.length !== off.length) return [`the roll has ${on.length - 1} steps with tracks on and ${off.length - 1} with tracks off`];
  const first = on.findIndex((h, k) => h !== off[k]);
  if (first < 0) return [];
  const differ = on.filter((h, k) => h !== off[k]).length;
  return [`step ${first}: the roll's step hash with tracks on (${on[first]!.slice(0, 16)}) isn't the one with tracks off (${off[first]!.slice(0, 16)}); ${differ} of ${on.length} step hashes differ, this the first`];
}
/** Why a body's path with tracks on isn't its path without: the first step whose position differs, by its number. */
export function pathFailures(body: string, on: readonly V3[], off: readonly V3[]): string[] {
  if (on.length < 2 || on.length !== off.length) return [`${body} has ${on.length} states with tracks on and ${off.length} with tracks off`];
  const first = on.findIndex((p, k) => p.some((v, i) => v !== off[k]![i]));
  if (first < 0) return [];
  return [`step ${first}: ${body} is at (${on[first]!.join(', ')}) with tracks on and at (${off[first]!.join(', ')}) without`];
}
/**
 * Why the yard's two balls don't do what the criterion describes, from the positions the bake answers, one a step:
 * the first rolls at least 10 m in a straight line (within 1 cm of z = 0) with its lowest point within 2 cm of the
 * plate; the second crosses that line (from z under −0.45 m to z over 0.45 m, within 5 cm of x = −4 m, its lowest
 * point within 2 cm of the plate too), and when it first comes within the groove's half width and its own radius of
 * the line, the first ball is at least 1 m past x = −4 m.
 */
export function yardFailures(roller: readonly V3[], crosser: readonly V3[]): string[] {
  const out: string[] = [];
  if (roller.length < 2 || crosser.length !== roller.length) return [`the bake answered ${roller.length} states of the first ball and ${crosser.length} of the second`];
  const reach = WIDTH / 2 + RADIUS;
  const end = roller[roller.length - 1]!;
  if (end[0] - ROLLER.at[0] < 10) out.push(`the first ball rolls ${f(end[0] - ROLLER.at[0])} m, not 10 m or more`);
  const side = roller.reduce((m, p) => Math.max(m, Math.abs(p[2])), 0);
  if (side > 0.01) out.push(`the first ball leaves its line by ${f(side, 5)} m, past 1 cm`);
  for (const [name, path] of [['first', roller], ['second', crosser]] as const) {
    const off = path.reduce((m, p) => Math.max(m, Math.abs(p[1] - RADIUS - GROUND)), 0);
    if (off > NEAR) out.push(`the ${name} ball's lowest point is ${f(off, 5)} m from the plate at some step, past 2 cm`);
  }
  const k = crosser.findIndex((p) => p[2] >= -reach);
  if (crosser[0]![2] >= -reach || k < 0) out.push(`the second ball never comes from z under ${f(-reach)} m to the first one's line`);
  else if (roller[k]![0] < CROSSING.at[0] + 1) out.push(`when the second ball reaches the groove (step ${k}) the first is at x ${f(roller[k]![0])} m, not yet 1 m past x ${f(CROSSING.at[0])} m`);
  if (crosser[crosser.length - 1]![2] <= reach) out.push(`the second ball ends at z ${f(crosser[crosser.length - 1]![2])} m: it never crosses the first one's line`);
  const drift = crosser.reduce((m, p) => Math.max(m, Math.abs(p[0] - CROSSING.at[0])), 0);
  if (drift > 0.05) out.push(`the second ball leaves x ${f(CROSSING.at[0])} m by ${f(drift, 5)} m, past 5 cm`);
  return out;
}
/** The yard's probes on the first ball's line, every 0.5 m from x = −6.5 m to x = 3 m: behind the ball at 4.5 s, the place the second ball crosses among them. */
export const yardLine = (): Probe[] => Array.from({ length: 20 }, (_, i) => ({ x: -6.5 + i * 0.5, z: 0 }));
/** Why the first ball's groove isn't drawn along its line (each probe lowered by at least half the depth and no more than the depth), or, with `drawn` false, why the plate isn't as built there. */
export function yardLineFailures(line: readonly Height[], drawn: boolean): string[] {
  const ok = drawn ? (low: number | null): boolean => low !== null && low >= DEPTH / 2 && low <= DEPTH + DEPTH_TOL : isBare;
  const want = drawn ? `not by between half the depth and the depth ${DEPTH} m: the groove isn't drawn there` : 'where the plate has no tracks (as built within 1 mm)';
  return stretches(line, () => ({ key: 'line', name: `the first ball's line at ${f(YARD_AT)} s` }), ok, want);
}
/**
 * Where a node's ray runs, from its sample: 13 mm along +x and 7 mm along +z, inside one triangle of the sample's
 * cell. A ray cast exactly at a sample runs along the height field's edges, and the base's physics shape answers
 * only about half of those.
 */
export const NODE_OFFSET: readonly [number, number] = [0.013, 0.007];
/**
 * The nodes the yard's physics shape is read at, and the height field a world's ground is written from them: one
 * beside every sample of the plate but its outer ring, 159 × 59 of them 0.1 m apart, row by row (a row along +x,
 * rows along +z), centred on the plate's centre.
 */
export function yardNodes(): { probes: Probe[]; cols: number; rows: number; scale: V3 } {
  const [cols, rows] = samplesOf(YARD);
  const probes: Probe[] = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) { const [x, z] = sampleAt(YARD, c, r); probes.push({ x: x + NODE_OFFSET[0], z: z + NODE_OFFSET[1] }); }
  return { probes, cols: cols - 2, rows: rows - 2, scale: [YARD.size[0] - 2 * YARD.spacing, 1, YARD.size[1] - 2 * YARD.spacing] };
}

// ---- Criterion 4

/** The frames a second criterion 4's film is drawn at, its last frame (10 s), and its 20 sampled frames: ten between the document's frames (0.4 s, 1.4 s … 9.4 s) and ten on them (1 s, 2 s … 10 s). */
export const FILM_FPS = 10;
export const FILM_LAST = 100;
export const SAMPLED: readonly number[] = Array.from({ length: 20 }, (_, k) => (k % 2 === 0 ? 5 * k + 4 : 5 * (k + 1)));
/** The order the seeks are made in: from the last sampled time back to the first, so the first seek opens at 10 s, the whole groove behind the ball. */
export const SEEK_ORDER: readonly number[] = [...SAMPLED].reverse();
/** Why a frame opened by a seek isn't the frame the film played to: one sentence a seek, in the order the seeks were made. */
export function seekFailures(order: readonly number[], fps: number, played: ReadonlyMap<number, string>, sought: ReadonlyMap<number, string>): string[] {
  const out: string[] = [];
  order.forEach((n, i) => {
    const nth = i === 0 ? `seek 1 of ${order.length} (the first seek)` : `seek ${i + 1} of ${order.length}`;
    const p = played.get(n), s = sought.get(n);
    if (p === undefined || s === undefined) out.push(`${nth}, to frame ${n} (${f(n / fps)} s): ${p === undefined ? 'the film has' : 'the seek drew'} no such frame`);
    else if (p !== s) out.push(`${nth}, to frame ${n} (${f(n / fps)} s): the frame's pixel hash ${s.slice(0, 12)} isn't the played frame's ${p.slice(0, 12)}`);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Planted sets: surfaces a wrong plate would draw, for the judges to fail (README). None of this stands in for the
// plate: the tests read every height from the binary.

/** The Scope's profile: a lowering of `depth` on the line, falling as a raised cosine to nothing at `width` ÷ 2 from it. */
export const profile = (d: number, width = WIDTH, depth = DEPTH): number => (d >= width / 2 ? 0 : depth * 0.5 * (1 + Math.cos((2 * Math.PI * d) / width)));
function toSegment(x: number, z: number, a: V3, b: V3): number {
  const [ax, az, bx, bz] = [a[0], a[2], b[0], b[2]];
  const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2));
  return Math.hypot(x - (ax + u * (bx - ax)), z - (az + u * (bz - az)));
}
/** How a planted plate lowers its surface from the places it read. */
export type Plate =
  /** The Scope's: along the path through the places on the ground, each joined to the next one on the ground. */
  | 'along_the_path'
  /** Criterion 1's wrong plate: about each place on the ground alone, nothing between them. */
  | 'at_the_samples'
  /** Criterion 2's wrong plate: along the path through every place, on the ground or in the air. */
  | 'ground_position_alone'
  /** A plate that draws no tracks: the base's. */
  | 'none';
export function lowering(samples: readonly Sample[], plate: Plate, width = WIDTH, depth = DEPTH): (x: number, z: number) => number {
  const on = samples.filter((s) => plate === 'ground_position_alone' || s.grounded);
  return (x, z) => {
    if (plate === 'none' || !on.length) return 0;
    let d = Infinity;
    for (const s of on) d = Math.min(d, Math.hypot(x - s.at[0], z - s.at[2]));
    if (plate !== 'at_the_samples') for (let i = 1; i < on.length; i++) if (on[i]!.k === on[i - 1]!.k + 1) d = Math.min(d, toSegment(x, z, on[i - 1]!.at, on[i]!.at));
    return profile(d, width, depth);
  };
}
/**
 * The surface a plate draws when it lowers each of its samples by `low` there: a vertex a sample, two triangles a
 * cell split from its (c, r + 1) corner to its (c + 1, r) one, as the base's plate is (#2014). The height over (x, z).
 */
export function surface(t: Terrain, low: (x: number, z: number) => number): (x: number, z: number) => number {
  const [cols, rows] = samplesOf(t);
  const made = new Map<number, number>();
  const at = (c: number, r: number): number => {
    const key = r * cols + c;
    let y = made.get(key);
    if (y === undefined) { const [x, z] = sampleAt(t, c, r); y = GROUND - low(x, z); made.set(key, y); }
    return y;
  };
  return (x, z) => {
    const gx = (x / t.size[0] + 0.5) * (cols - 1), gz = (z / t.size[1] + 0.5) * (rows - 1);
    const c = Math.min(cols - 2, Math.max(0, Math.floor(gx))), r = Math.min(rows - 2, Math.max(0, Math.floor(gz)));
    const u = gx - c, v = gz - r;
    const [h00, h10, h01, h11] = [at(c, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1)];
    return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
}
/** What probes read on a surface. */
export const read = (s: (x: number, z: number) => number, probes: readonly Probe[]): Height[] => probes.map((p) => ({ ...p, y: s(p.x, p.z) }));

function must(ok: boolean, what: string): void {
  if (!ok) throw Error(`a judge's self-check failed: ${what}`);
}
const all = (failures: readonly string[], word: string): boolean => failures.length > 0 && failures.every((x) => x.includes(word));

/** The lane as a planted plate draws it at `t`, read on the roll's line and at the three cross-sections. */
function laneRead(m: Motion, plate: Plate, t: number, span: number | 'all' = 'all', width = WIDTH, depth = DEPTH): { samples: Sample[]; line: Height[]; cuts: Cut[] } {
  const samples = samplesAt(m, LANE_FPS, t, span);
  const s = surface(LANE, lowering(samples, plate, width, depth));
  return { samples, line: read(s, lineProbes()), cuts: CUTS_AT.map((x) => ({ x, heights: read(s, cutProbes(x)) })) };
}

/**
 * Criterion 1's judge fails its planted sets:
 * - the fixture: 21 places 0.5 m apart, every one on the ground; the profile is `depth` on the line, half of it a
 *   quarter of `width` out, nothing from half of `width`;
 * - the Scope's plate passes; one that draws nothing fails at every gap and place; one that lowers at the samples
 *   alone fails at all 20 gaps and at no place it read, and at both cross-sections between places, each failure
 *   naming its gap; a groove 2 mm too shallow, one half as wide and one twice as wide fail.
 */
export function grooveJudgeFailsItsPlants(): void {
  const good = laneRead(ROLLING, 'along_the_path', ROLLED_AT);
  must(good.samples.length === 21 && good.samples.every((s) => s.grounded) && Math.abs(SPACING - 0.5) < 1e-12, 'the roll is read at 21 places 0.5 m apart, all on the ground');
  must(Math.abs(profile(0) - DEPTH) < 1e-12 && Math.abs(profile(WIDTH / 4) - DEPTH / 2) < 1e-12 && profile(WIDTH / 2) === 0, 'the raised cosine is the depth on the line, half of it at a quarter of the width, nothing at half the width');
  must(grooveFailures(good.samples, good.line, good.cuts).length === 0, `the groove judge passes the Scope's plate: ${grooveFailures(good.samples, good.line, good.cuts).join(' | ')}`);
  const w = good.cuts.map((c) => widthAtHalfDepth(c.heights));
  must(w.every((x) => typeof x === 'number' && Math.abs(x - WIDTH / 2) < 1e-9), `the Scope's groove is half the width wide at half depth on this plate: ${w.join(', ')}`);
  const bare = laneRead(ROLLING, 'none', ROLLED_AT);
  must(grooveFailures(bare.samples, bare.line, bare.cuts).length === 20 + 19 + 3, 'the groove judge fails a plate that draws nothing, at 20 gaps, 19 places and 3 cross-sections');
  const dots = laneRead(ROLLING, 'at_the_samples', ROLLED_AT);
  const dotted = grooveFailures(dots.samples, dots.line, dots.cuts);
  const gaps = dotted.filter((x) => x.startsWith('the gap between the places read at'));
  must(dotted.length === 22 && gaps.length === 22, `the groove judge fails a plate lowered at the samples alone at its 20 gaps and 2 cross-sections between places, naming each gap, and nowhere else: ${dotted.length} failures, ${gaps.length} naming a gap`);
  must(new Set(gaps.slice(0, 20)).size === 20 && gaps[0]!.includes('x -5 m (0 s) and x -4.5 m (0.5 s)'), `each gap is named by the two places it lies between: ${gaps[0]}`);
  const shallow = laneRead(ROLLING, 'along_the_path', ROLLED_AT, 'all', WIDTH, DEPTH - 0.002);
  must(all(grooveFailures(shallow.samples, shallow.line, []), 'on the centre line'), 'the groove judge fails a groove 2 mm too shallow');
  for (const width of [WIDTH / 2, WIDTH * 2]) {
    const wrong = laneRead(ROLLING, 'along_the_path', ROLLED_AT, 'all', width);
    must(all(grooveFailures(wrong.samples, [], wrong.cuts), 'width at half depth'), `the groove judge fails a groove ${width} m wide`);
  }
  const holes = good.cuts.map((c) => ({ x: c.x, heights: c.heights.map((h, k) => (k === 80 ? { ...h, y: null } : h)) }));
  must(all(grooveFailures(good.samples, [], holes), 'met no drawn surface'), 'the groove judge fails a cross-section a ray missed');
}

/**
 * Criterion 2's judge fails its planted sets:
 * - the fixture: the places read at 4.5, 5 and 5.5 s are in the air and the other 18 on the ground; the hop is 2 m;
 * - the Scope's plate passes; one that reads the ground position alone fails under the hop, naming the span, and
 *   nowhere else; one that draws nothing fails before and after the hop; one whose groove stops 1.5 m short of the
 *   hop fails before it.
 */
export function hopJudgeFailsItsPlants(): void {
  const good = laneRead(HOPPING, 'along_the_path', ROLLED_AT);
  const air = good.samples.filter((s) => !s.grounded).map((s) => s.t);
  must(air.join() === '4.5,5,5.5' && good.samples.length === 21 && HOP.to - HOP.from === 2, `the hop is 2 m and the places read at 4.5, 5 and 5.5 s are in the air: ${air.join()}`);
  must(hopFailures(good.line).length === 0, `the hop judge passes the Scope's plate: ${hopFailures(good.line).join(' | ')}`);
  const through = hopFailures(laneRead(HOPPING, 'ground_position_alone', ROLLED_AT).line);
  must(through.length === 1 && through[0]!.startsWith('under the hop, the span from x -1 m to x 1 m (4 s to 6 s)'), `the hop judge fails a plate that reads the ground position alone, under the hop alone, naming the span: ${through.join(' | ')}`);
  const none = hopFailures(laneRead(HOPPING, 'none', ROLLED_AT).line);
  must(none.length === 2 && none[0]!.startsWith('before the hop') && none[1]!.startsWith('after the hop'), 'the hop judge fails a plate that draws nothing, before and after the hop');
  const short = samplesAt(HOPPING, LANE_FPS, ROLLED_AT).filter((s) => s.t < 2.5 || s.t >= 6);
  const cut = hopFailures(read(surface(LANE, lowering(short, 'along_the_path')), lineProbes()));
  must(cut.length === 1 && cut[0]!.startsWith('before the hop'), 'the hop judge fails a groove that stops 1.5 m short of the hop');
}

/**
 * Criterion 5's judges fail their planted sets:
 * - the fixture: at 8 s the ball is at x = 3 m and was at x = −2 m 5 s before; 8 × (26 × 24 + 1) = 5,000 samples and
 *   8 × (20 × 24 + 1) = 3,848, one side of 4,096 each;
 * - the span: the Scope's plate with `span: 5` passes, and so does one that reads a place less (4.5 s back); with
 *   `span: all`, with 2.5 s and with 7.5 s it fails; a plate that draws the whole roll at once fails ahead of the
 *   ball; one that draws nothing fails;
 * - the refusal: an error naming the plate at its tracks with the count 5,000 passes; the base's unknown_field at the
 *   same path, a presented show, the count 4,992, a warning, and an error naming another plate fail.
 */
export function spanJudgesFailTheirPlants(): void {
  must(placeAt(ROLLING, SPAN_AT)[0] === 3 && placeAt(ROLLING, SPAN_AT - SPAN)[0] === -2, 'at 8 s the ball is at x 3 m, and at x -2 m 5 s before');
  must(aliveCount(CAP.items, CAP.fps, CAP.span) === OVER_SAMPLES && OVER_SAMPLES > MAX_SAMPLES, '8 balls read at 24 frames a second over 26 s are 5,000 samples, past the cap');
  must(aliveCount(CAP.items, CAP.fps, UNDER_SPAN) === 3848 && 3848 <= MAX_SAMPLES, 'over 20 s they are 3,848, within the cap');
  const at = (span: number | 'all', t = SPAN_AT): string[] => spanFailures(laneRead(ROLLING, 'along_the_path', t, span).line, SPAN_AT, SPAN);
  must(at(SPAN).length === 0, `the span judge passes the Scope's plate with span 5: ${at(SPAN).join(' | ')}`);
  must(at(4.5).length === 0, 'the span judge passes a groove one sample shorter');
  must(all(at('all'), 'older than 5 s'), 'the span judge fails span: all');
  must(all(at(7.5), 'older than 5 s'), 'the span judge fails a groove 7.5 s long');
  must(all(at(2.5), 'the 5 s behind the ball'), 'the span judge fails a groove 2.5 s long');
  must(all(at('all', ROLLED_AT), 'the ball'), 'the span judge fails a plate that draws the whole roll at 8 s');
  must(at('all', ROLLED_AT).some((x) => x.startsWith('ahead of the ball')), 'and names what lies ahead of the ball');
  must(all(spanFailures(laneRead(ROLLING, 'none', SPAN_AT, SPAN).line, SPAN_AT, SPAN), 'the 5 s behind the ball'), 'the span judge fails a plate that draws nothing');
  const issue = (code: string, actual: JsonValue, ids: string[] = [PLATE], severity = 'error'): JsonObject => ({ outcome: 'refused', issues: [{ code, severity, ids, path: `items/${ids[0]}/params/tracks`, actual }] });
  must(capFailures(issue('over_budget', { plate: PLATE, count: OVER_SAMPLES }), PLATE, OVER_SAMPLES).length === 0, 'the refusal judge passes the cap\'s refusal');
  must(capFailures(issue('unknown_field', { items: CROWD, width: WIDTH, depth: DEPTH, span: CAP.span }), PLATE, OVER_SAMPLES).length === 1, 'the refusal judge fails the base\'s unknown_field at the same path');
  must(capFailures({ outcome: 'presented', issues: [] }, PLATE, OVER_SAMPLES).length === 1, 'the refusal judge fails a presented show');
  must(capFailures(issue('over_budget', { count: 4992 }), PLATE, OVER_SAMPLES).length === 1, 'the refusal judge fails the count 4,992');
  must(capFailures(issue('over_budget', { count: OVER_SAMPLES }, [PLATE], 'warning'), PLATE, OVER_SAMPLES).length === 1, 'the refusal judge fails a warning');
  must(capFailures(issue('over_budget', { count: OVER_SAMPLES }, ['other']), PLATE, OVER_SAMPLES).length === 1, 'the refusal judge fails an error naming another plate');
}

/**
 * Criterion 3's judges fail their planted sets:
 * - the step hashes: equal lists pass; a list that differs from step 37 on fails naming step 37; lists of other
 *   lengths and lists with no step fail;
 * - a path: equal paths pass; one that dips at step 264 fails naming step 264;
 * - the yard: a first ball that rolls 17.5 m along its line and a second that crosses it afterwards pass; a first
 *   ball that rolls 9 m, one that drifts 2 cm, one 3 cm in the air, a second ball that stops short of the line, and
 *   one that reaches the line before the first has passed fail;
 * - the line: the groove drawn at every probe passes and the plate as built fails with tracks on, and the other way
 *   round with tracks off.
 */
export function physicsJudgesFailTheirPlants(): void {
  const hashes = Array.from({ length: 601 }, (_, k) => k.toString(16).padStart(16, '0'));
  must(stepFailures(hashes, [...hashes]).length === 0, 'the step judge passes equal step hashes');
  const fed = stepFailures(hashes.map((h, k) => (k >= 37 ? `f${h.slice(1)}` : h)), hashes);
  must(fed.length === 1 && fed[0]!.startsWith('step 37:'), `the step judge fails hashes that part at step 37, naming the step: ${fed.join()}`);
  must(stepFailures(hashes.slice(0, 600), hashes).length === 1 && stepFailures([], []).length === 1 && stepFailures(['a'], ['a']).length === 1, 'the step judge fails another number of steps, and no steps at all');
  const steps = YARD_SPAN * STEP_RATE;
  const roller = Array.from({ length: steps + 1 }, (_, k): V3 => [ROLLER.at[0] + (ROLLER.linear[0] * k) / STEP_RATE, GROUND + RADIUS, 0]);
  const crosser = Array.from({ length: steps + 1 }, (_, k): V3 => [CROSSING.at[0], GROUND + RADIUS, CROSSING.at[2] + (CROSSING.linear[2] * k) / STEP_RATE]);
  must(pathFailures(CROSSER, crosser, crosser.map((p): V3 => [...p])).length === 0, 'the path judge passes equal paths');
  const dipped = pathFailures(CROSSER, crosser.map((p, k): V3 => (k >= 264 ? [p[0], p[1] - 0.04, p[2]] : p)), crosser);
  must(dipped.length === 1 && dipped[0]!.startsWith('step 264:'), `the path judge fails a path that dips at step 264, naming the step: ${dipped.join()}`);
  must(yardFailures(roller, crosser).length === 0, `the yard judge passes the fixture's two balls: ${yardFailures(roller, crosser).join(' | ')}`);
  const wrong: [string, V3[], V3[]][] = [
    ['a first ball that rolls 9 m', roller.map((p): V3 => [ROLLER.at[0] + ((p[0] - ROLLER.at[0]) * 9) / (ROLLER.linear[0] * YARD_SPAN), p[1], p[2]]), crosser],
    ['a first ball that drifts 2 cm', roller.map((p, k): V3 => [p[0], p[1], (0.02 * k) / steps]), crosser],
    ['a first ball 3 cm in the air', roller.map((p): V3 => [p[0], p[1] + 0.03, p[2]]), crosser],
    ['a second ball that stops short of the line', roller, crosser.map((p): V3 => [p[0], p[1], Math.min(p[2], -1)])],
    ['a second ball at the line before the first has passed', roller, crosser.map((p, k): V3 => [p[0], p[1], -0.5 + (2.5 * k) / steps])],
  ];
  for (const [what, a, b] of wrong) must(yardFailures(a, b).length > 0, `the yard judge fails ${what}`);
  const line = yardLine();
  const drawn = line.map((p): Height => ({ ...p, y: GROUND - DEPTH })), built = line.map((p): Height => ({ ...p, y: GROUND }));
  must(yardLineFailures(drawn, true).length === 0 && yardLineFailures(built, true).length === 1, 'with tracks on, the line judge passes a drawn groove and fails the plate as built');
  must(yardLineFailures(built, false).length === 0 && yardLineFailures(drawn, false).length === 1, 'with tracks off, the line judge passes the plate as built and fails a groove');
  const nodes = yardNodes();
  must(nodes.cols === 159 && nodes.rows === 59 && nodes.probes.length === 159 * 59 && Math.abs(nodes.scale[0] - 15.8) < 1e-9 && Math.abs(nodes.scale[2] - 5.8) < 1e-9, 'the yard is read at 159 × 59 nodes over 15.8 × 5.8 m');
}

/**
 * Criterion 4's judge fails its planted sets: 20 sampled frames, none twice, the first seek to the last of them;
 * equal hashes pass; a film whose first seek alone differs fails naming the first seek; one whose every seek differs
 * fails 20 times, the first seek first; a seek that drew no frame fails.
 */
export function seekJudgeFailsItsPlants(): void {
  must(SAMPLED.length === 20 && new Set(SAMPLED).size === 20 && SAMPLED.every((n) => n > 0 && n <= FILM_LAST) && SEEK_ORDER[0] === FILM_LAST, `20 sampled frames, the first seek to frame ${FILM_LAST}: ${SAMPLED.join(' ')}`);
  must(SAMPLED.filter((n) => n % (FILM_FPS / LANE_FPS) === 0).length === 10, 'ten of the sampled times are whole multiples of the document\'s frame interval, ten are not');
  const played = new Map(SAMPLED.map((n) => [n, `${n}`.padStart(64, 'a')]));
  must(seekFailures(SEEK_ORDER, FILM_FPS, played, new Map(played)).length === 0, 'the seek judge passes equal frames');
  const first = seekFailures(SEEK_ORDER, FILM_FPS, played, new Map([...played].map(([n, h]) => [n, n === FILM_LAST ? 'b'.repeat(64) : h])));
  must(first.length === 1 && first[0]!.startsWith('seek 1 of 20 (the first seek), to frame 100 (10 s)'), `the seek judge fails a first seek that differs, naming it: ${first.join()}`);
  const every = seekFailures(SEEK_ORDER, FILM_FPS, played, new Map([...played].map(([n]) => [n, 'c'.repeat(64)])));
  must(every.length === 20 && every[0]!.includes('(the first seek)'), 'the seek judge fails every seek of a plate that keeps its surface, the first seek first');
  must(seekFailures(SEEK_ORDER, FILM_FPS, played, new Map()).length === 20, 'the seek judge fails seeks that drew nothing');
}
