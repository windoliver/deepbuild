// AC2 #1646.7fba4dd6: "`cells(p, seed)` returns f1 ≤ f2, an id and a center that seeking equals playing, and a planted
// cells seeded from t fails naming the frame"
//
// `cells(p, seed)` of the closed function list, called by drivers and evaluated by `deep-motion eval` (README: The
// surface under test). Its four outputs are read by name, `cells(p, 7).f1`, `.f2`, `.id` and `.center.x`, `.center.y`,
// each written by its own driver into an item's position: item `m` gets [f1, f2, id] and `mc` [center.x, center.y] at
// a moving point p = (0.37 + 1.9 t, −2.15 + 0.7 t), t the time in seconds, which crosses some two dozen cells over
// 4 s; items `s` and `sc` the same at the still point q = (3.3, −1.7). Played: one eval line at frames 0 … 120 at
// 30 fps; seeked: frames 1, 17, 45, 89 and 120, each its own line in a fresh process, equal to the played frame, all
// five outputs, exactly.
// At each played frame: f1 ≤ f2; id a whole number in [0, 2³²); center the nearest feature point, so |p − center| = f1
// (euclidean, the two-argument form's metric) within 1e-9, inside the 3 × 3 cells around p; one id never names two
// centers; the still point's outputs at every frame are frame 0's. The moving point visits at least 8 ids and f1
// spreads over 0.2 or more, so equal values aren't a constant.
// Planted: `cells_seeded_from_t`, the eval line's `planted` (cells' seed taken with the time), so the still point's
// outputs move with t, and the check names the frame.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, type JsonObject, arr, failsNaming, film, item, lines, none, num, obj, shown, useBins,
} from './helpers.ts';

const bins = useBins(['deep-motion']);
const FPS = 30;
const STEP = FLICKS / FPS;
const FRAMES = Array.from({ length: 121 }, (_, n) => n);
const SEEKS = [1, 17, 45, 89, 120];
const P = 'vec2(0.37 + 1.9 * t, -2.15 + 0.7 * t)';
const Q = 'vec2(3.3, -1.7)';
const pAt = (n: number): [number, number] => { const t = (n * STEP) / FLICKS; return [0.37 + 1.9 * t, -2.15 + 0.7 * t]; };
const Q_AT: [number, number] = [3.3, -1.7];

const rect = (id: string): JsonObject => item(id, 'rect@1', `a${id}`, { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, { at: { pos: [100, 100, 0] } });
function drivers(): JsonObject {
  const out: JsonObject = {};
  for (const [id, p, vars] of [['m', P, { t: 'time' }], ['s', Q, {}]] as const) {
    const d = (target: string, field: string): JsonObject => ({ target, expr: `cells(${p}, 7).${field}`, vars });
    out[`${id}_f1`] = d(`items/${id}/at/pos/0`, 'f1');
    out[`${id}_f2`] = d(`items/${id}/at/pos/1`, 'f2');
    out[`${id}_id`] = d(`items/${id}/at/pos/2`, 'id');
    out[`${id}_cx`] = d(`items/${id}c/at/pos/0`, 'center.x');
    out[`${id}_cy`] = d(`items/${id}c/at/pos/1`, 'center.y');
  }
  return out;
}
const DOC = film('cells-1646', ['m', 'mc', 's', 'sc'].map(rect), { drivers: drivers() }, '4s', FPS);

interface Cells { f1: number; f2: number; id: number; center: [number, number] }
const fmt = (c: Cells): string => JSON.stringify(c);
/** The five outputs at one point, from the eval frame's item positions. */
function cellsOf(frame: JsonObject, id: string, what: string): Cells {
  const pos = (i: string): number[] => arr(obj(obj(obj(frame['items'], `${what}: items`)[i], `${what}: items.${i}`)['at'], `${what}: items.${i}.at`)['pos'], `${what}: items.${i}.at.pos`)
    .map((v, k) => num(v, `${what}: items.${i}.at.pos[${k}]`));
  const [f1, f2, n] = pos(id); const [cx, cy] = pos(`${id}c`);
  return { f1: f1!, f2: f2!, id: n!, center: [cx!, cy!] };
}
/** One `deep-motion eval` line per entry of `times`, in one process; each accepted with one frame per time. */
function evalFrames(times: number[][], planted?: string): JsonObject[][] {
  const answers = lines(bins.bin('deep-motion'), ['eval'], times.map((ts) => ({ doc: DOC, times: ts.map((n) => n * STEP), ...(planted ? { planted } : {}) })));
  return answers.map((a, k) => {
    expect(a['ok'], `deep-motion eval accepts the cells drivers${planted ? ` (planted ${planted})` : ''}: ${shown(a)}`).toBe(true);
    const frames = arr(a['frames'], `eval line ${k + 1}: frames`).map((f, i) => obj(f, `eval line ${k + 1}: frames[${i}]`));
    expect(frames.length, `eval line ${k + 1}: one frame per time`).toBe(times[k]!.length);
    return frames;
  });
}

/** Every played frame's outputs against what `cells` states; failures name the frame. */
function playedProblems(frames: JsonObject[]): string[] {
  const problems: string[] = [];
  const centerOf = new Map<number, [number, number]>();
  const ids = new Set<number>();
  let lo = Infinity; let hi = -Infinity;
  const first = cellsOf(frames[0]!, 's', 'frame 0');
  frames.forEach((f, n) => {
    for (const [id, p] of [['m', pAt(n)], ['s', Q_AT]] as const) {
      const c = cellsOf(f, id, `frame ${n}`);
      const at = `frame ${n}: cells((${p[0].toFixed(4)}, ${p[1].toFixed(4)}), 7)`;
      if (!(c.f1 <= c.f2)) problems.push(`${at} gives f1 ${c.f1} above f2 ${c.f2}`);
      if (!(Number.isInteger(c.id) && c.id >= 0 && c.id < 2 ** 32)) problems.push(`${at} gives id ${c.id}, not a u32`);
      const d = Math.hypot(p[0] - c.center[0], p[1] - c.center[1]);
      if (!(Math.abs(d - c.f1) <= 1e-9)) problems.push(`${at} gives f1 ${c.f1}, but its center (${c.center.join(', ')}) lies ${d} away`);
      for (const k of [0, 1] as const) if (!(Math.abs(c.center[k] - (Math.floor(p[k]) + 0.5)) <= 1.5 + 1e-12)) problems.push(`${at}: its center (${c.center.join(', ')}) lies outside the 3 × 3 cells around p`);
      const seen = centerOf.get(c.id);
      if (seen && (Math.abs(seen[0] - c.center[0]) > 1e-12 || Math.abs(seen[1] - c.center[1]) > 1e-12)) problems.push(`${at} gives id ${c.id} the center (${c.center.join(', ')}), where an earlier frame gave it (${seen.join(', ')})`);
      if (!seen) centerOf.set(c.id, c.center);
      if (id === 'm') { ids.add(c.id); lo = Math.min(lo, c.f1); hi = Math.max(hi, c.f1); }
      if (id === 's' && (c.f1 !== first.f1 || c.f2 !== first.f2 || c.id !== first.id || c.center[0] !== first.center[0] || c.center[1] !== first.center[1])) {
        problems.push(`${at}, a still point, gives ${fmt(c)}, not frame 0's ${fmt(first)}`);
      }
    }
  });
  if (ids.size < 8) problems.push(`the moving point visits ${ids.size} ids over 4 s; it crosses some two dozen cells`);
  if (hi - lo < 0.2) problems.push(`the moving point's f1 spreads only from ${lo} to ${hi}`);
  return problems;
}

describe(`${AC[2]} cells(p, seed) states its outputs f1, f2, id and center`, () => {
  it(`${AC[2]} cells(p, seed) returns f1 ≤ f2, a u32 id and the nearest center at every frame played, and the same outputs seeked`, () => {
    const [played] = evalFrames([FRAMES]);
    none(playedProblems(played!), `${AC[2]} cells played`);
    const seeked = evalFrames(SEEKS.map((n) => [n]));
    const problems: string[] = [];
    SEEKS.forEach((n, k) => {
      for (const id of ['m', 's']) {
        const a = cellsOf(seeked[k]![0]!, id, `frame ${n} seeked`); const b = cellsOf(played![n]!, id, `frame ${n} played`);
        if (fmt(a) !== fmt(b)) problems.push(`frame ${n} seeked: ${id === 'm' ? 'the moving' : 'the still'} point's cells ${fmt(a)}, played ${fmt(b)}`);
      }
    });
    none(problems, `${AC[2]} cells seeked equals played`);
  });

  it(`${AC[2]} a planted cells seeded from t (planted cells_seeded_from_t) fails, naming the frame`, () => {
    const [played] = evalFrames([FRAMES], 'cells_seeded_from_t');
    failsNaming(playedProblems(played!), [/frame [1-9]\d*: cells\(\(3\.3000, -1\.7000\), 7\)/], `${AC[2]} the planted cells_seeded_from_t`);
  });
});
