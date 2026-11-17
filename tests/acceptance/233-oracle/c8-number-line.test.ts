// Oracle lane, criterion 8 (AC8 #233.1fb6242f), port: a fork of the upstream math-film library at cfd33af5aa,
// tests/unit/mobjects/test_plotting.py:94-122 (`test_ticks_and_numbers_added_later_follow_the_lines_attributes`), and
// the reference project at a6d5cc02b4, tests/module/mobject/graphing/test_number_line.py:62-105 (`test_add_labels`,
// `test_number_to_point`).
//
// Each case a math.number_line at 1920 × 1080 u, drawn through `deep-canvas-render geometry` (README: Reading the
// drawing):
//   - the fork's: x_range (0, 3, 1), numbers_to_exclude [0], numbers_with_elongated_ticks [1], include_numbers: one tick
//     per step (4, at 0 … 3), three numbers reading 1, 2 and 3 and none at 0, each centred within 0.5 px on its tick's x
//     and below the line (upstream's default label direction is DOWN); the tick at 1 twice as long as each other, which
//     are equal (upstream: heights 0.4, 0.8, 0.4, 0.4 at tick_size 0.2), within 1e-6 of the ratio.
//   - `test_add_labels`: x_range [−4, 4] with `labels` mapping −3 … 2 to six vectors of ours (the upstream's Integers −1
//     … 4, here vector@1 items of different widths): six labels, each centred within 0.5 px on its value's tick.
//   - `test_number_to_point`: the default line (upstream's x_range [−8, 8, 1], one unit a step) puts 1 … 5 at (1 … 5, 0)
//     units: its ticks at those values sit at x = 960 + 135·v u and on y = 540, within 0.01 u (upstream rounds to 4
//     decimals of a unit, 0.0135 u).
// Not ported: numbers and ticks added after construction, font_size and label_direction (upstream calls and params the
// issue doesn't list for math.number_line), the DecimalNumber class.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, boxOf, centre, drawnParts, isLabelKind, mathDoc, none, rectSvg, segment, sha256, subpathsOf, textOf, ticksOf, useBins,
  useFolders, vectorItem, type JsonObject, type P2, type Spec,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];

/** The one derived axis@1's shown tick values and its tick marks across a horizontal line (their x, from and to y). */
function ticks(derived: Record<string, JsonObject>, geo: Record<string, JsonObject>): { values: number[]; marks: { x: number; y0: number; y1: number }[]; why: string } {
  const axes = Object.keys(derived).filter((id) => derived[id]!['kind'] === 'axis@1');
  if (axes.length !== 1) return { values: [], marks: [], why: `${axes.length} derived axis@1, not one` };
  const g = geo[axes[0]!]!;
  const values = ticksOf(g).filter((t) => t.opacity > 0).map((t) => t.value).sort((p, q) => p - q);
  const marks = subpathsOf(g).map(segment).filter((s): s is [P2, P2] => s !== null && Math.abs(s[0][0] - s[1][0]) <= 0.01 && Math.abs(s[0][1] - s[1][1]) > 0)
    .map(([a, b]) => ({ x: (a[0] + b[0]) / 2, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) })).sort((p, q) => p.x - q.x);
  return { values, marks, why: values.length === marks.length ? '' : `${values.length} shown ticks but ${marks.length} tick marks` };
}

describe(`${AC[8]} (oracle, port) a number line's ticks, numbers and labels`, () => {
  it(`${AC[8]} (0, 3, 1) excluding 0 with 1 elongated: one tick per step, numbers 1, 2 and 3 below their ticks and none at 0, the tick at 1 twice as long`, () => {
    const doc = mathDoc('A number line', SIZE, { nl: { kind: 'math.number_line@1', params: { x_range: [0, 3, 1], numbers_to_exclude: [0], numbers_with_elongated_ticks: [1], include_numbers: true } } });
    const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['nl']);
    expect(why, 'the figure is presented and drawn').toBe('');
    const t = ticks(derived, geo);
    expect(t.why, 'one mark per shown tick').toBe('');
    expect(t.values, 'one tick per step, at 0 … 3').toEqual([0, 1, 2, 3]);
    // The line: the longest horizontal straight line the number line draws.
    const lineY = Object.values(geo).flatMap((g) => subpathsOf(g).map(segment).filter((x): x is [P2, P2] => x !== null && Math.abs(x[0][1] - x[1][1]) <= 0.01))
      .sort((p, q) => Math.abs(q[1][0] - q[0][0]) - Math.abs(p[1][0] - p[0][0]))[0]?.[0][1];
    expect(lineY, 'the line is drawn').toBeDefined();
    const failures: string[] = [];
    const labels = Object.entries(derived).filter(([, i]) => isLabelKind(i));
    const read = labels.map(([, i]) => textOf(i)?.trim()).sort();
    expect(read, 'the numbers read 1, 2 and 3, none 0').toEqual(['1', '2', '3']);
    for (const [id, item] of labels) {
      const v = Number(textOf(item));
      const b = boxOf(geo[id]!);
      const x = t.marks[t.values.indexOf(v)]?.x;
      if (!b || x === undefined) { failures.push(`${id} (${v}): no box or no tick`); continue; }
      if (Math.abs(centre(b)[0] - x) > 0.5) failures.push(`${id} (${v}) is centred at x ${centre(b)[0]}, its tick at ${x}`);
      if (b[1] <= lineY!) failures.push(`${id} (${v})'s top ${b[1]} is not below the line at y ${lineY}`);
    }
    const len = t.marks.map((m) => m.y1 - m.y0);
    const others = len.filter((_, i) => t.values[i] !== 1);
    if (others.some((l) => Math.abs(l - others[0]!) > 1e-6)) failures.push(`the ticks other than 1 differ in length: ${len.join(', ')}`);
    const at1 = len[t.values.indexOf(1)]!;
    if (Math.abs(at1 / others[0]! - 2) > 1e-6) failures.push(`the tick at 1 is ${at1} u long, ${at1 / others[0]!} times the others' ${others[0]}`);
    none(failures, 'the numbers and the elongated tick');
  }, TIMEOUT);

  it(`${AC[8]} add_labels: x_range [−4, 4] with six labels by value, each at its value's tick`, () => {
    const values = [-3, -2, -1, 0, 1, 2];
    const sources = values.map((_, k) => rectSvg(16 + 10 * k, 24));
    const vecs: Record<string, Spec> = Object.fromEntries(values.map((v, k) => [`lab${k}`, vectorItem(sha256(sources[k]!), [16 + 10 * k, 24], String(v + 2), [50 * k, 50])]));
    const doc = mathDoc('A number line labelled by value', SIZE, {
      ...vecs,
      nl: { kind: 'math.number_line@1', params: { x_range: [-4, 4, 1], labels: Object.fromEntries(values.map((v, k) => [String(v), `lab${k}`])) } },
    });
    const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['nl'], Object.keys(vecs), sources);
    expect(why, 'the figure is presented and drawn').toBe('');
    const t = ticks(derived, geo);
    expect(t.why, 'one mark per shown tick').toBe('');
    const failures: string[] = [];
    values.forEach((v, k) => {
      const b = boxOf(geo[`lab${k}`]!);
      const x = t.marks[t.values.indexOf(v)]?.x;
      if (!b || x === undefined) failures.push(`the label for ${v}: no box or no tick`);
      else if (Math.abs(centre(b)[0] - x) > 0.5) failures.push(`the label for ${v} is centred at x ${centre(b)[0]}, its tick at ${x}`);
    });
    none(failures, 'six labels, each at its value');
  }, TIMEOUT);

  it(`${AC[8]} number_to_point: the default line puts 1 … 5 at (1 … 5, 0) units`, () => {
    const doc = mathDoc('The default number line', SIZE, { nl: { kind: 'math.number_line@1', params: {} } });
    const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['nl']);
    expect(why, 'the figure is presented and drawn').toBe('');
    const t = ticks(derived, geo);
    expect(t.why, 'one mark per shown tick').toBe('');
    const failures: string[] = [];
    for (const v of [1, 2, 3, 4, 5]) {
      const m = t.marks[t.values.indexOf(v)];
      if (!m) { failures.push(`no tick at ${v}`); continue; }
      if (Math.abs(m.x - (960 + 135 * v)) > 0.01) failures.push(`the tick at ${v} is at x ${m.x}, not ${960 + 135 * v}`);
      if (!(m.y0 - 0.01 <= 540 && 540 <= m.y1 + 0.01)) failures.push(`the tick at ${v} spans y ${m.y0} to ${m.y1}, off the line at y 540`);
    }
    none(failures, 'number_to_point');
  }, TIMEOUT);
});
