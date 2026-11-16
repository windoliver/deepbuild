// AC9 #233.5c072eb1: "`math.polar_plane {azimuth_units: degrees, azimuth_step: 12}` draws 12 rays labelled 0° to 330° in
// 30° steps; `math.table` of 2 × 3 entries with row and column labels and `lines: inner` draws 5 inner rules and no
// border; `math.matrix` of 2 × 2 entries puts each entry's centre on its column's centre within 0.5 px, inside both
// brackets"
//
// Three figures at 1920 × 1080 u, each presented by `deep show` and its drawn form read by `deep-canvas-render
// geometry` (README: Reading the drawing):
//   - `pp`, math.polar_plane {azimuth_units: degrees, azimuth_step: 12} (its other params the upstream defaults). Its
//     rays are the straight sub-paths it draws with one end at the plane's centre (the point most segments end at): 12,
//     at 0°, 30°, … 330° counter-clockwise from +x with y up, within 1e-3°. Its labels (derived text@1 or vector@1, read
//     by their text) are 12, reading 0° to 330° in 30° steps, each centred within 5° of its ray's direction.
//   - `t`, math.table {rows: [["a", "b", "c"], ["d", "e", "f"]], row_labels: ["r1", "r2"], col_labels: ["c1", "c2",
//     "c3"], lines: inner}: 11 cells in 3 rows and 4 columns (the top-left corner empty). Its rules are the straight
//     sub-paths it draws: exactly 5 lie between rows or columns (2 between the 3 rows, 3 between the 4 columns), and
//     none lies outside the cells or encloses them (no border); a frame's own layout box, which `geometry` answers
//     whether it paints or not, is not a rule.
//   - `m`, math.matrix {entries: [["e11", "e12"], ["e21", "e22"]]}, the four entries the figure's own vector@1 items
//     of different widths (e11 60, e12 20, e21 20, e22 80 u wide, 30 u high), so a column of left- or right-aligned
//     entries fails: each entry's box centre x is within 0.5 px of its column's centre (the middle of the column's
//     entries' union box), and the matrix draws a bracket wholly left of every entry and one wholly right of every entry.
// Wrong programs: the base (no math@1); azimuth_step read as degrees (30 rays 12° apart), radians labels, a y-up turn
// (labels mirrored); a table with outer lines, or rules only between body cells; entries aligned by an edge; brackets
// drawn over the entries.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, boxOf, centre, derivedOf, docId, drawnForm, geometryOfAll, isLabelKind, mathDoc, none, notPresented, present, putSources, rectSvg,
  run, scenario, segment, sha256, subpathsOf, textOf, useBins, useFolders, vectorItem, type Box, type JsonObject, type P2, type Spec, type Sub,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];

/** Presents `doc` (its vector sources put in the evidence store first) and reads every item's geometry from the drawn
 * form: the derived items of `instance`, and the document's own `also`. */
function drawnParts(doc: JsonObject, instance: string, also: string[] = [], sources: Buffer[] = []): { derived: Record<string, JsonObject>; geo: Record<string, JsonObject> } {
  const evidence = folder(); const store = folder();
  for (const s of sources) putSources(evidence, store, s);
  const a = run(bin('deep-show'), scenario(evidence, [present(docId(1), doc)]));
  expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
  const shown = a.replies[0]!;
  expect(notPresented(shown), `${instance}'s figure is presented with no error`).toBe('');
  const derived = derivedOf(shown, instance);
  const geo = geometryOfAll(bin('deep-canvas-render'), drawnForm(doc, shown), [...Object.keys(derived), ...also], 0, store);
  return { derived, geo };
}
/** The drawn sub-paths of `ids`, less a frame@1's own layout box (its outline equal to its `box`). */
function drawnSubs(derived: Record<string, JsonObject>, geo: Record<string, JsonObject>, ids: string[]): Sub[] {
  return ids.flatMap((id) => {
    const b = boxOf(geo[id]!);
    const isLayoutBox = (s: Sub): boolean => derived[id]?.['kind'] === 'frame@1' && b !== null && s.closed
      && s.points.every((p) => (Math.abs(p[0] - b[0]) < 1e-6 || Math.abs(p[0] - b[0] - b[2]) < 1e-6) && (Math.abs(p[1] - b[1]) < 1e-6 || Math.abs(p[1] - b[1] - b[3]) < 1e-6));
    return subpathsOf(geo[id]!).filter((s) => !isLayoutBox(s));
  });
}
const key = (s: [P2, P2]): string => [...s].sort((p, q) => p[0] - q[0] || p[1] - q[1]).flat().map((v) => v.toFixed(2)).join(' ');
/** Groups numbers that lie within `tol` of each other, in order. */
function clusters(values: number[], tol: number): number[][] {
  const out: number[][] = [];
  for (const v of [...values].sort((p, q) => p - q)) { const last = out[out.length - 1]; if (last && v - last[last.length - 1]! <= tol) last.push(v); else out.push([v]); }
  return out;
}

describe(`${AC[9]} planes, tables and matrices`, () => {
  it(`${AC[9]} math.polar_plane {azimuth_units: degrees, azimuth_step: 12} draws 12 rays labelled 0° to 330° in 30° steps`, () => {
    const doc = mathDoc('A polar plane', SIZE, { pp: { kind: 'math.polar_plane@1', params: { azimuth_units: 'degrees', azimuth_step: 12 } } });
    const { derived, geo } = drawnParts(doc, 'pp');
    const shapes = Object.keys(derived).filter((id) => !isLabelKind(derived[id]!));
    const segs = [...new Map(drawnSubs(derived, geo, shapes).map(segment).filter((s): s is [P2, P2] => s !== null && Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 5).map((s) => [key(s), s])).values()];
    const ends = segs.flatMap((s) => s);
    const count = (p: P2): number => ends.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 0.5).length;
    const c = ends.reduce<P2 | null>((best, p) => (best === null || count(p) > count(best) ? p : best), null);
    expect(c, 'the polar plane draws straight lines').not.toBeNull();
    const rays = segs.filter(([a, b]) => Math.hypot(a[0] - c![0], a[1] - c![1]) <= 0.5 || Math.hypot(b[0] - c![0], b[1] - c![1]) <= 0.5);
    const angles = rays.map(([a, b]) => {
      const [from, to] = Math.hypot(a[0] - c![0], a[1] - c![1]) <= 0.5 ? [a, b] : [b, a];
      return (((Math.atan2(-(to[1] - from[1]), to[0] - from[0]) * 180) / Math.PI) + 360) % 360;
    }).sort((p, q) => p - q);
    expect(rays.length, `12 rays start at the plane's centre (${c!.map((v) => v.toFixed(2)).join(', ')}): angles ${angles.map((v) => v.toFixed(3)).join(', ')}`).toBe(12);
    const wanted = Array.from({ length: 12 }, (_, k) => 30 * k);
    const offRays = angles.flatMap((v, k) => (Math.min(Math.abs(v - wanted[k]!), 360 - Math.abs(v - wanted[k]!)) <= 1e-3 ? [] : [`ray ${k} at ${v}°, not ${wanted[k]}°`]));
    none(offRays, 'the rays at 0°, 30°, … 330° counter-clockwise from +x, y up');

    const labels = Object.entries(derived).filter(([, i]) => isLabelKind(i));
    const failures: string[] = [];
    const read: number[] = [];
    for (const [id, item] of labels) {
      const m = /^\s*(\d+(?:\.\d+)?)\s*°\s*$/.exec(textOf(item) ?? '');
      if (!m) { failures.push(`the label ${id} reads ${JSON.stringify(textOf(item))}, not degrees`); continue; }
      const deg = Number(m[1]);
      read.push(deg);
      const b = boxOf(geo[id]!);
      if (!b) { failures.push(`the label ${id} has no box`); continue; }
      const [x, y] = centre(b);
      const at = (((Math.atan2(-(y - c![1]), x - c![0]) * 180) / Math.PI) + 360) % 360;
      if (Math.min(Math.abs(at - deg), 360 - Math.abs(at - deg)) > 5) failures.push(`the label ${id} reading ${deg}° sits at ${at.toFixed(2)}° from the centre`);
    }
    expect(read.sort((p, q) => p - q), 'the labels read 0° to 330° in 30° steps').toEqual(wanted);
    none(failures, 'each label on its ray');
  }, TIMEOUT);

  it(`${AC[9]} math.table of 2 × 3 entries with row and column labels and lines: inner draws 5 inner rules and no border`, () => {
    const doc = mathDoc('A table', SIZE, {
      t: { kind: 'math.table@1', params: { rows: [['a', 'b', 'c'], ['d', 'e', 'f']], row_labels: ['r1', 'r2'], col_labels: ['c1', 'c2', 'c3'], lines: 'inner' } },
    });
    const { derived, geo } = drawnParts(doc, 't');
    const cells = Object.keys(derived).filter((id) => isLabelKind(derived[id]!)).map((id) => boxOf(geo[id]!)).filter((b): b is Box => b !== null);
    expect(cells.length, 'the table draws its 6 entries and 5 labels').toBe(11);
    const rows = clusters(cells.map((b) => centre(b)[1]), 2);
    const cols = clusters(cells.map((b) => centre(b)[0]), 2);
    expect([rows.length, cols.length], 'the cells stand in 3 rows and 4 columns').toEqual([3, 4]);
    const inRow = (r: number[]): Box[] => cells.filter((b) => r.includes(centre(b)[1]));
    const inCol = (k: number[]): Box[] => cells.filter((b) => k.includes(centre(b)[0]));
    const top = (bs: Box[]): number => Math.min(...bs.map((b) => b[1])); const bottom = (bs: Box[]): number => Math.max(...bs.map((b) => b[1] + b[3]));
    const left = (bs: Box[]): number => Math.min(...bs.map((b) => b[0])); const right = (bs: Box[]): number => Math.max(...bs.map((b) => b[0] + b[2]));
    const gapsY = rows.slice(1).map((r, k) => [bottom(inRow(rows[k]!)), top(inRow(r))] as P2);
    const gapsX = cols.slice(1).map((k, i) => [right(inCol(cols[i]!)), left(inCol(k))] as P2);
    const shapes = Object.keys(derived).filter((id) => !isLabelKind(derived[id]!));
    const subs = drawnSubs(derived, geo, shapes);
    const rules = [...new Map(subs.map(segment).filter((s): s is [P2, P2] => s !== null).map((s) => [key(s), s])).values()];
    const all: Box = [left(cells), top(cells), right(cells) - left(cells), bottom(cells) - top(cells)];
    const inner: string[] = []; const border: string[] = [];
    for (const [a, b] of rules) {
      const horizontal = Math.abs(a[1] - b[1]) <= 0.01; const vertical = Math.abs(a[0] - b[0]) <= 0.01;
      const at = horizontal ? a[1] : a[0];
      const between = (horizontal ? gapsY : vertical ? gapsX : []).some(([lo, hi]) => at > lo - 0.5 && at < hi + 0.5);
      const text = `${horizontal ? 'horizontal' : vertical ? 'vertical' : 'slanted'} rule (${a.map((v) => v.toFixed(1))}) to (${b.map((v) => v.toFixed(1))})`;
      (between ? inner : border).push(text);
    }
    for (const s of subs.filter((x) => x.closed)) {
      const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]);
      if (Math.min(...xs) <= all[0] + 0.5 && Math.max(...xs) >= all[0] + all[2] - 0.5 && Math.min(...ys) <= all[1] + 0.5 && Math.max(...ys) >= all[1] + all[3] - 0.5) border.push(`a closed outline around every cell (${s.points.length} points)`);
    }
    expect(inner.length, `5 inner rules (2 between rows, 3 between columns): ${inner.join('; ')}`).toBe(5);
    expect(inner.filter((r) => r.startsWith('horizontal')).length, 'two of them between the 3 rows').toBe(2);
    expect(border, 'no border').toEqual([]);
  }, TIMEOUT);

  it(`${AC[9]} math.matrix of 2 × 2 entries puts each entry's centre on its column's centre within 0.5 px, inside both brackets`, () => {
    const widths: Record<string, number> = { e11: 60, e12: 20, e21: 20, e22: 80 };
    const sources = Object.fromEntries(Object.entries(widths).map(([id, w]) => [id, rectSvg(w, 30)]));
    const entries: Record<string, Spec> = Object.fromEntries(Object.entries(widths).map(([id, w], k) => [id, vectorItem(sha256(sources[id]!), [w, 30], id, [100 + 100 * k, 100])]));
    const doc = mathDoc('A matrix', SIZE, { ...entries, m: { kind: 'math.matrix@1', params: { entries: [['e11', 'e12'], ['e21', 'e22']] } } });
    const { derived, geo } = drawnParts(doc, 'm', Object.keys(widths), Object.values(sources));
    const box = (id: string): Box => { const b = boxOf(geo[id]!); expect(b, `the entry ${id} has a box`).not.toBeNull(); return b!; };
    const failures: string[] = [];
    for (const col of [['e11', 'e21'], ['e12', 'e22']]) {
      const bs = col.map(box);
      const mid = (Math.min(...bs.map((b) => b[0])) + Math.max(...bs.map((b) => b[0] + b[2]))) / 2;
      col.forEach((id, i) => { const cx = centre(bs[i]!)[0]; if (Math.abs(cx - mid) > 0.5) failures.push(`${id}'s centre x ${cx.toFixed(2)} is ${Math.abs(cx - mid).toFixed(2)} px off its column's centre ${mid.toFixed(2)}`); });
    }
    none(failures, 'each entry on its column\'s centre');
    const es = Object.keys(widths).map(box);
    const l = Math.min(...es.map((b) => b[0])); const r = Math.max(...es.map((b) => b[0] + b[2]));
    const mid = (l + r) / 2;
    const points = drawnSubs(derived, geo, Object.keys(derived).filter((id) => !(id in widths))).flatMap((s) => s.points);
    const leftSide = points.filter((p) => p[0] < mid); const rightSide = points.filter((p) => p[0] >= mid);
    expect(leftSide.length > 0 && rightSide.length > 0, 'the matrix draws a bracket on each side').toBe(true);
    expect(Math.max(...leftSide.map((p) => p[0])), `the left bracket lies wholly left of every entry (their left edge ${l.toFixed(2)})`).toBeLessThan(l);
    expect(Math.min(...rightSide.map((p) => p[0])), `the right bracket lies wholly right of every entry (their right edge ${r.toFixed(2)})`).toBeGreaterThan(r);
  }, TIMEOUT);
});
