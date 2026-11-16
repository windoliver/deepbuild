// The reading and the judge of this redraft (README: Reading the drawing, Judging against the golden). Pure: no
// binary, no vitest, so each rule can be read on its own. The binaries are driven through the earlier suite's helpers
// (tests/acceptance/233/helpers.ts), imported by the test file.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type P2 = [number, number];
export type Axis = 'x' | 'y';
export interface Tick { axis: Axis; value: number; px: P2 }
export interface Golden { ticks: Tick[]; curve: P2[] }

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const fmt = (p: P2): string => `(${p.map((v) => +v.toFixed(2)).join(', ')})`;

/** Sub-paths as `deep-canvas-render geometry` answers them: `{closed, verbs, points}`, verbs M, L, Q, C, Z. */
interface Sub { verbs: string[]; points: P2[]; closed: boolean }
function subpaths(answer: JsonObject): Sub[] {
  const list = Array.isArray(answer['subpaths']) ? answer['subpaths'] : [];
  return list.filter(isObject).map((s) => ({
    verbs: Array.isArray(s['verbs']) ? s['verbs'].map(String) : [],
    points: (Array.isArray(s['points']) ? s['points'] : [])
      .filter((p): p is number[] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
      .map((p) => [p[0]!, p[1]!] as P2),
    closed: s['closed'] === true,
  }));
}

/** Each sub-path flattened to a polyline: lines as they are, each quadratic and cubic at 32 steps, a close back to
 * its start. */
export function flatten(answer: JsonObject): P2[][] {
  const out: P2[][] = [];
  for (const s of subpaths(answer)) {
    const line: P2[] = [];
    let k = 0;
    let at: P2 | null = null;
    const step = (n: number, f: (t: number) => P2): void => { for (let i = 1; i <= n; i++) line.push(f(i / n)); };
    for (const v of s.verbs) {
      if (v === 'M' || v === 'L') { at = s.points[k++]!; line.push(at); continue; }
      if (v === 'Z') { if (line.length) line.push(line[0]!); continue; }
      const p0: P2 = at ?? s.points[k]!;
      if (v === 'Q') {
        const [c, e] = [s.points[k]!, s.points[k + 1]!]; k += 2;
        step(32, (t) => [0, 1].map((d) => (1 - t) ** 2 * p0[d]! + 2 * (1 - t) * t * c[d]! + t * t * e[d]!) as P2);
        at = e;
      } else if (v === 'C') {
        const [c1, c2, e] = [s.points[k]!, s.points[k + 1]!, s.points[k + 2]!]; k += 3;
        step(32, (t) => [0, 1].map((d) => (1 - t) ** 3 * p0[d]! + 3 * (1 - t) ** 2 * t * c1[d]! + 3 * (1 - t) * t * t * c2[d]! + t ** 3 * e[d]!) as P2);
        at = e;
      }
    }
    if (line.length) out.push(line);
  }
  return out;
}

/** The distance from `p` to the nearest of `lines` (a one-point line counts as that point). */
export function distanceTo(p: P2, lines: P2[][]): number {
  let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) best = Math.min(best, Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]));
    for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = [line[i]!, line[i + 1]!];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
      const s = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      best = Math.min(best, Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy));
    }
  }
  return best;
}

/** A sub-path's box: [x0, y0, x1, y1]. */
function extent(s: Sub): [number, number, number, number] | null {
  if (!s.points.length) return null;
  const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
/** Thin: at most 3 u across, as a stroked line's centre line (0) or a rule drawn as a filled rectangle (its width). */
const THIN = 3;
/** A tick mark is at most this long across its axis line. */
const TICK_MAX = 60;

/**
 * The ticks one axis@1 draws, from its own geometry answer (README: Reading the drawing). Its line is its longest thin
 * sub-path; it is an x axis when that runs horizontally, a y axis when vertically. Its tick marks are its thin
 * sub-paths across that line, at most 60 u long; a mark's place along the axis is its centre there, and its place
 * across is the line's centre (a mark may stand on one side of the line, as the upstream library's are centred on it).
 * Its shown ticks are the answer's `ticks` with opacity above 0, one mark each, paired in value order: rightward for
 * x, upward for y (the stated conversion: y flips).
 */
export function axisTicks(id: string, answer: JsonObject): { ticks: Tick[]; failure: string } {
  const shown = (Array.isArray(answer['ticks']) ? answer['ticks'] : []).filter(isObject)
    .filter((t) => typeof t['value'] === 'number' && typeof t['opacity'] === 'number' && (t['opacity'] as number) > 0)
    .map((t) => t['value'] as number).sort((a, b) => a - b);
  const boxes = subpaths(answer).map(extent).filter((b): b is [number, number, number, number] => b !== null);
  const thin = boxes.filter(([x0, y0, x1, y1]) => Math.min(x1 - x0, y1 - y0) <= THIN);
  const long = (b: number[]): number => Math.max(b[2]! - b[0]!, b[3]! - b[1]!);
  const line = [...thin].sort((p, q) => long(q) - long(p))[0];
  if (!line || long(line) <= TICK_MAX) return { ticks: [], failure: `${id}: draws no axis line (no thin sub-path longer than ${TICK_MAX} u among ${boxes.length})` };
  const horizontal = line[2] - line[0] >= line[3] - line[1];
  const across = horizontal ? (line[1] + line[3]) / 2 : (line[0] + line[2]) / 2;
  const marks = thin.filter((b) => b !== line).filter(([x0, y0, x1, y1]) => {
    const [along, acr] = horizontal ? [x1 - x0, y1 - y0] : [y1 - y0, x1 - x0];
    return along <= THIN && acr > along && acr <= TICK_MAX;
  }).map(([x0, y0, x1, y1]) => (horizontal ? (x0 + x1) / 2 : (y0 + y1) / 2)).sort((a, b) => a - b);
  if (marks.length !== shown.length) {
    return { ticks: [], failure: `${id}: ${shown.length} shown ticks (${shown.join(', ')}) but ${marks.length} tick marks across its ${horizontal ? 'horizontal' : 'vertical'} line at ${+across.toFixed(2)} u` };
  }
  const ordered = horizontal ? marks : [...marks].reverse(); // u's y grows down, so y's values rise as u falls
  const axis: Axis = horizontal ? 'x' : 'y';
  return { ticks: shown.map((value, k) => ({ axis, value, px: horizontal ? [ordered[k]!, across] : [across, ordered[k]!] })), failure: '' };
}

/** The golden's parts, or why it can't be judged against. */
export function readGolden(g: JsonValue): { golden: Golden; problems: string[] } {
  const problems: string[] = [];
  const o = isObject(g) ? g : {};
  if (JSON.stringify(o['frame_px']) !== '[1920,1080]') problems.push(`frame_px is ${JSON.stringify(o['frame_px'])}, not [1920, 1080]`);
  const ticks = (Array.isArray(o['ticks']) ? o['ticks'] : []).filter(isObject)
    .filter((t) => (t['axis'] === 'x' || t['axis'] === 'y') && typeof t['value'] === 'number' && Array.isArray(t['px']) && t['px'].length === 2)
    .map((t) => ({ axis: t['axis'] as Axis, value: t['value'] as number, px: t['px'] as P2 }));
  const curve = (Array.isArray(o['curve']) ? o['curve'] : []).filter((p): p is number[] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number')).map((p) => [p[0]!, p[1]!] as P2);
  for (const a of ['x', 'y'] as const) if (ticks.filter((t) => t.axis === a).length < 2) problems.push(`it holds fewer than 2 ${a} ticks`);
  if (curve.length < 601) problems.push(`it holds ${curve.length} curve points, not at least 601`);
  return { golden: { ticks, curve }, problems };
}

/** The values a range `[min, max, step]` steps through. */
export const steps = ([min, max, step]: [number, number, number]): number[] =>
  Array.from({ length: Math.round((max - min) / step) + 1 }, (_, k) => min + k * step);

/**
 * Every tick and the curve against the golden (README: Judging against the golden). Each golden tick has one of ours
 * on the same axis at the same value within 1 px. Each tick of ours is at a step of its axis's range; one at a value
 * the golden draws is judged above, one at a step the golden leaves undrawn (its origin and tip ends) within 1 px of
 * where the golden's axis puts that value (the line through the golden's ticks of that axis). Every golden curve point
 * lies within 1 px of our curve, and every point of our curve within 1 px of the golden's.
 */
export function judge(golden: Golden, ours: Tick[], curve: P2[][], ranges: Record<Axis, [number, number, number]>): string[] {
  const failures: string[] = [];
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  for (const g of golden.ticks) {
    const mine = ours.filter((t) => t.axis === g.axis && same(t.value, g.value));
    if (!mine.length) { failures.push(`the golden's ${g.axis} tick at ${g.value} ${fmt(g.px)} has no tick of ours`); continue; }
    for (const o of mine) {
      const d = Math.hypot(o.px[0] - g.px[0], o.px[1] - g.px[1]);
      if (d > 1) failures.push(`our ${g.axis} tick at ${g.value} is at ${fmt(o.px)} px, ${d.toFixed(2)} px from the golden's ${fmt(g.px)}`);
    }
  }
  for (const o of ours) {
    if (golden.ticks.some((g) => g.axis === o.axis && same(g.value, o.value))) continue;
    if (!steps(ranges[o.axis]).some((v) => same(v, o.value))) { failures.push(`our ${o.axis} tick at ${o.value} ${fmt(o.px)} is at no step of ${o.axis}_range [${ranges[o.axis].join(', ')}]`); continue; }
    const gs = golden.ticks.filter((g) => g.axis === o.axis);
    const k: 0 | 1 = o.axis === 'x' ? 0 : 1; // the coordinate that runs along the axis
    const n = gs.length; const mv = gs.reduce((s, g) => s + g.value, 0) / n; const mp = gs.reduce((s, g) => s + g.px[k], 0) / n;
    const slope = gs.reduce((s, g) => s + (g.value - mv) * (g.px[k] - mp), 0) / gs.reduce((s, g) => s + (g.value - mv) ** 2, 0);
    const acrossAt = gs.reduce((s, g) => s + g.px[k === 0 ? 1 : 0], 0) / n;
    const want: P2 = k === 0 ? [mp + slope * (o.value - mv), acrossAt] : [acrossAt, mp + slope * (o.value - mv)];
    const d = Math.hypot(o.px[0] - want[0], o.px[1] - want[1]);
    if (d > 1) failures.push(`our ${o.axis} tick at ${o.value} (a step the golden leaves undrawn) is at ${fmt(o.px)} px, ${d.toFixed(2)} px from where the golden's ${o.axis} axis puts it ${fmt(want)}`);
  }
  golden.curve.forEach((p, i) => { const d = distanceTo(p, curve); if (d > 1) failures.push(`the golden's curve point ${i} ${fmt(p)} is ${d.toFixed(2)} px from our curve`); });
  curve.flat().forEach((p, i) => { const d = distanceTo(p, [golden.curve]); if (d > 1) failures.push(`our curve point ${i} ${fmt(p)} is ${d.toFixed(2)} px from the golden's curve`); });
  return failures;
}
