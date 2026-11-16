// Oracle lane, criterion 9 (AC9 #233.5c072eb1), port: a fork of the upstream math-film library at cfd33af5aa,
// tests/unit/mobjects/test_plotting.py:395-440 (`test_a_polar_planes_lines_are_its_grid`) and
// tests/unit/mobjects/test_grid.py:85-201 (`test_matrix_cells_keep_constructor_grid_spacing`,
// `test_lines_enclose_and_separate_rows_and_columns`); and the reference project at a6d5cc02b4,
// tests/module/mobject/test_table.py:24-45 (`test_table_include_inner_lines_false` and `_true`).
//
// Each case at 1920 × 1080 u, drawn through `deep-canvas-render geometry` (README: Reading the drawing); one math@1 unit
// is 135 u.
//   - Polar planes, upstream's seven cases (radius_max, radius_step, azimuth_step, faded_line_ratio, azimuth_offset in
//     radians, upstream's default units): its rings (derived circle@1 items) have radii k × radius_step ÷ ratio units,
//     k = 1 … ⌊radius ÷ (radius_step ÷ ratio)⌋, within 1e-6 u; its rays (straight lines with one end at the plane's
//     centre) are azimuth_step × ratio, at turns offset + k·2π ÷ (azimuth_step × ratio), each within 1e-6 rad
//     (counter-clockwise, y up).
//   - Tables, the reference project's: [["A", "B"], ["C", "D"]] with outer lines and with or without inner ones
//     (`lines: outer` and `lines: both`): 2 horizontal and 2 vertical rules, or 3 and 3. And the fork's: a 2 × 3 table
//     with row and column labels, h_buff 1.3 and v_buff 0.8, `lines: both`: each inner rule bisects the gap between its
//     rows or columns, and the outer rules lie h_buff ÷ 2 (v_buff ÷ 2) outside the cells, within 0.5 px.
//   - The fork's matrix, with its entries' centres aligned (its ORIGIN corner case; math.matrix centres its entries,
//     criterion 9): a 2 × 3 matrix of rectangles (0.2 + column ÷ 5 by 0.3 + row ÷ 5 units, here vector@1 items),
//     h_buff 1.7, v_buff 0.9: each entry's centre sits column × 1.7 right and row × 0.9 down from the first entry's,
//     within 0.5 px (upstream's 1e-12, widened to where layout snaps to device pixels), and a bracket lies wholly left and
//     one wholly right of the entries.
// Not ported: the polar plane's split into main and faded lines and its radius-0 circle; the matrix's DR and UL corner
// cases (math.matrix takes no element_alignment_corner) and stretch_brackets; the table's property search, top-left
// entry, line colours and widths, and cells after scaling.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, boxOf, centre, drawnParts, isLabelKind, mathDoc, none, rectSvg, segment, sha256, subpathsOf, useBins, useFolders, vectorItem,
  type Box, type JsonObject, type P2, type Spec, type Sub,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const UNIT = 135;
const POLAR: [string, number, number, number, number, number][] = [
  ['thirds', 3, 3, 4, 3, 0], ['halves, turned', 2, 1, 8, 2, 0.3], ['quarters', 2, 0.5, 4, 4, 0], ['every line a background one', 1.5, 0.5, 2, 1, 0],
  ['thirds of two steps', 2, 1, 4, 3, 0], ['thirds of a third of a turn', 1, 1, 3, 3, 0], ['a radius between circles', 2.5, 1, 4, 1, 0],
];
/** Drawn sub-paths of `ids`, less a frame@1's own layout box. */
function subs(derived: Record<string, JsonObject>, geo: Record<string, JsonObject>, ids: string[]): Sub[] {
  return ids.flatMap((id) => {
    const b = boxOf(geo[id]!);
    return subpathsOf(geo[id]!).filter((s) => !(derived[id]?.['kind'] === 'frame@1' && b !== null && s.closed
      && s.points.every((p) => (Math.abs(p[0] - b[0]) < 1e-6 || Math.abs(p[0] - b[0] - b[2]) < 1e-6) && (Math.abs(p[1] - b[1]) < 1e-6 || Math.abs(p[1] - b[1] - b[3]) < 1e-6))));
  });
}
const segKey = (s: [P2, P2]): string => [...s].sort((p, q) => p[0] - q[0] || p[1] - q[1]).flat().map((v) => v.toFixed(2)).join(' ');
/** The table's rules: its straight lines, and the four sides of any closed axis-aligned outline. */
function rulesOf(all: Sub[]): { h: [P2, P2][]; v: [P2, P2][] } {
  const lines: [P2, P2][] = all.map(segment).filter((s): s is [P2, P2] => s !== null);
  for (const s of all.filter((x) => x.closed && x.points.length >= 4)) {
    const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (s.points.every((p) => (Math.abs(p[0] - x0) < 1e-6 || Math.abs(p[0] - x1) < 1e-6) && (Math.abs(p[1] - y0) < 1e-6 || Math.abs(p[1] - y1) < 1e-6))) {
      lines.push([[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]], [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]]);
    }
  }
  const unique = [...new Map(lines.map((l) => [segKey(l), l])).values()];
  return { h: unique.filter(([a, b]) => Math.abs(a[1] - b[1]) <= 0.01), v: unique.filter(([a, b]) => Math.abs(a[0] - b[0]) <= 0.01) };
}
function clusters(values: number[], tol: number): number[][] {
  const out: number[][] = [];
  for (const v of [...values].sort((p, q) => p - q)) { const last = out[out.length - 1]; if (last && v - last[last.length - 1]! <= tol) last.push(v); else out.push([v]); }
  return out;
}

describe(`${AC[9]} (oracle, port) polar planes' lines, tables' rules and matrices' spacing`, () => {
  for (const [name, radius, step, azimuth, ratio, offset] of POLAR) {
    it(`${AC[9]} polar plane "${name}": rings every radius_step ÷ ratio and rays every 2π ÷ (azimuth_step × ratio) from the offset`, () => {
      const doc = mathDoc(`A polar plane, ${name}`, SIZE, {
        pp: { kind: 'math.polar_plane@1', params: { radius_max: radius, radius_step: step, azimuth_step: azimuth, faded_line_ratio: ratio, azimuth_offset: offset } },
      });
      const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['pp']);
      expect(why, 'the figure is presented and drawn').toBe('');
      const fine = step / ratio;
      const wantRadii = Array.from({ length: Math.floor(radius / fine + 1e-9) }, (_, k) => (k + 1) * fine);
      const rings = Object.keys(derived).filter((id) => derived[id]!['kind'] === 'circle@1').map((id) => boxOf(geo[id]!)).filter((b): b is Box => b !== null);
      const radii = [...new Set(rings.map((b) => +(b[2] / 2 / UNIT).toFixed(9)))].sort((p, q) => p - q);
      const failures: string[] = [];
      if (radii.length !== wantRadii.length || radii.some((r, i) => Math.abs(r - wantRadii[i]!) * UNIT > 1e-6)) failures.push(`rings of radii ${radii.join(', ')}, not ${wantRadii.join(', ')}`);
      const centres = rings.map(centre);
      const c: P2 = centres.length ? centres[0]! : [960, 540];
      const shapes = Object.keys(derived).filter((id) => !isLabelKind(derived[id]!) && derived[id]!['kind'] !== 'circle@1');
      const segs = [...new Map(subs(derived, geo, shapes).map(segment).filter((s): s is [P2, P2] => s !== null).map((s) => [segKey(s), s])).values()];
      const rays = segs.filter(([a, b]) => Math.hypot(a[0] - c[0], a[1] - c[1]) <= 1e-6 || Math.hypot(b[0] - c[0], b[1] - c[1]) <= 1e-6);
      const turns = rays.map(([a, b]) => {
        const to = Math.hypot(a[0] - c[0], a[1] - c[1]) <= 1e-6 ? b : a;
        return (Math.atan2(-(to[1] - c[1]), to[0] - c[0]) + 4 * Math.PI) % (2 * Math.PI);
      }).sort((p, q) => p - q);
      const n = azimuth * ratio;
      const want = Array.from({ length: n }, (_, k) => (offset + (k * 2 * Math.PI) / n + 4 * Math.PI) % (2 * Math.PI)).sort((p, q) => p - q);
      if (turns.length !== n) failures.push(`${turns.length} rays from the centre (${c.join(', ')}), not ${n}`);
      else turns.forEach((t, k) => { const d = Math.abs(t - want[k]!); if (Math.min(d, 2 * Math.PI - d) > 1e-6) failures.push(`a ray at ${t} rad, not ${want[k]}`); });
      none(failures, `the polar plane "${name}"`);
    }, TIMEOUT);
  }

  for (const [lines, count] of [['outer', 2], ['both', 3]] as const) {
    it(`${AC[9]} a 2 × 2 table with lines: ${lines} draws ${count} horizontal and ${count} vertical rules`, () => {
      const doc = mathDoc('A table', SIZE, { t: { kind: 'math.table@1', params: { rows: [['A', 'B'], ['C', 'D']], lines } } });
      const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['t']);
      expect(why, 'the figure is presented and drawn').toBe('');
      const r = rulesOf(subs(derived, geo, Object.keys(derived).filter((id) => !isLabelKind(derived[id]!))));
      expect([r.h.length, r.v.length], `horizontal and vertical rules: ${JSON.stringify(r)}`).toEqual([count, count]);
    }, TIMEOUT);
  }

  it(`${AC[9]} a 2 × 3 table with labels and lines: both: inner rules bisect the gaps, outer rules enclose the cells at half a buff`, () => {
    const doc = mathDoc('A labelled table', SIZE, {
      t: { kind: 'math.table@1', params: { rows: [['a', 'b', 'c'], ['d', 'e', 'f']], row_labels: ['r1', 'r2'], col_labels: ['c1', 'c2', 'c3'], h_buff: 1.3, v_buff: 0.8, lines: 'both' } },
    });
    const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['t']);
    expect(why, 'the figure is presented and drawn').toBe('');
    const cells = Object.keys(derived).filter((id) => isLabelKind(derived[id]!)).map((id) => boxOf(geo[id]!)).filter((b): b is Box => b !== null);
    expect(cells.length, 'the 6 entries and 5 labels').toBe(11);
    const rows = clusters(cells.map((b) => centre(b)[1]), 2); const cols = clusters(cells.map((b) => centre(b)[0]), 2);
    const inRow = (r: number[]): Box[] => cells.filter((b) => r.includes(centre(b)[1])); const inCol = (k: number[]): Box[] => cells.filter((b) => k.includes(centre(b)[0]));
    const top = (bs: Box[]): number => Math.min(...bs.map((b) => b[1])); const bottom = (bs: Box[]): number => Math.max(...bs.map((b) => b[1] + b[3]));
    const left = (bs: Box[]): number => Math.min(...bs.map((b) => b[0])); const right = (bs: Box[]): number => Math.max(...bs.map((b) => b[0] + b[2]));
    const wantH = [top(cells) - 0.4 * UNIT, ...rows.slice(1).map((r, k) => (bottom(inRow(rows[k]!)) + top(inRow(r))) / 2), bottom(cells) + 0.4 * UNIT];
    const wantV = [left(cells) - 0.65 * UNIT, ...cols.slice(1).map((c, k) => (right(inCol(cols[k]!)) + left(inCol(c))) / 2), right(cells) + 0.65 * UNIT];
    const r = rulesOf(subs(derived, geo, Object.keys(derived).filter((id) => !isLabelKind(derived[id]!))));
    const hs = r.h.map(([a]) => a[1]).sort((p, q) => p - q); const vs = r.v.map(([a]) => a[0]).sort((p, q) => p - q);
    const failures: string[] = [];
    if (hs.length !== wantH.length) failures.push(`${hs.length} horizontal rules at ${hs.join(', ')}, not ${wantH.length} at ${wantH.join(', ')}`);
    else hs.forEach((y, k) => { if (Math.abs(y - wantH[k]!) > 0.5) failures.push(`horizontal rule ${k + 1} at y ${y}, not ${wantH[k]}`); });
    if (vs.length !== wantV.length) failures.push(`${vs.length} vertical rules at ${vs.join(', ')}, not ${wantV.length} at ${wantV.join(', ')}`);
    else vs.forEach((x, k) => { if (Math.abs(x - wantV[k]!) > 0.5) failures.push(`vertical rule ${k + 1} at x ${x}, not ${wantV[k]}`); });
    none(failures, 'rules that enclose and separate rows and columns');
  }, TIMEOUT);

  it(`${AC[9]} a 2 × 3 matrix with h_buff 1.7 and v_buff 0.9 keeps its entries' centres on that grid, inside both brackets`, () => {
    const ids = [0, 1].flatMap((row) => [0, 1, 2].map((col) => ({ id: `e${row}${col}`, row, col, w: (0.2 + col / 5) * UNIT, h: (0.3 + row / 5) * UNIT })));
    const sources = ids.map((e) => rectSvg(e.w, e.h));
    const vecs: Record<string, Spec> = Object.fromEntries(ids.map((e, k) => [e.id, vectorItem(sha256(sources[k]!), [e.w, e.h], e.id, [100 * k, 100])]));
    const doc = mathDoc('A matrix', SIZE, { ...vecs, m: { kind: 'math.matrix@1', params: { entries: [['e00', 'e01', 'e02'], ['e10', 'e11', 'e12']], h_buff: 1.7, v_buff: 0.9 } } });
    const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['m'], Object.keys(vecs), sources);
    expect(why, 'the figure is presented and drawn').toBe('');
    const box = (id: string): Box | null => boxOf(geo[id]!);
    expect(ids.every((e) => box(e.id) !== null), 'every entry has a box').toBe(true);
    const anchor = centre(box('e00')!);
    const failures: string[] = [];
    for (const e of ids) {
      const [x, y] = centre(box(e.id)!);
      const [wx, wy] = [anchor[0] + e.col * 1.7 * UNIT, anchor[1] + e.row * 0.9 * UNIT];
      if (Math.hypot(x - wx, y - wy) > 0.5) failures.push(`${e.id}'s centre (${x}, ${y}) is not (${wx}, ${wy})`);
    }
    none(failures, 'the entries keep the constructor\'s grid spacing');
    const bs = ids.map((e) => box(e.id)!);
    const l = Math.min(...bs.map((b) => b[0])); const r = Math.max(...bs.map((b) => b[0] + b[2]));
    const points = subs(derived, geo, Object.keys(derived).filter((id) => !(id in vecs))).flatMap((s) => s.points);
    const ls = points.filter((p) => p[0] < (l + r) / 2); const rs = points.filter((p) => p[0] >= (l + r) / 2);
    expect(ls.length > 0 && rs.length > 0, 'a bracket on each side').toBe(true);
    expect(Math.max(...ls.map((p) => p[0])), 'the left bracket lies left of the entries').toBeLessThan(l);
    expect(Math.min(...rs.map((p) => p[0])), 'the right bracket lies right of the entries').toBeGreaterThan(r);
  }, TIMEOUT);
});
