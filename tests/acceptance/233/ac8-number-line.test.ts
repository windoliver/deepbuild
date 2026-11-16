// AC8 #233.1fb6242f: "`math.number_line {x_range: [−3, 3, 1], include_tip: true, include_numbers: true,
// numbers_to_exclude: [0]}` draws 7 ticks, 6 labels with none at 0 and each label's centre within 0.5 px of its tick's
// x, and an arrow end at +3; a planted expansion that drops `numbers_to_exclude` fails, naming it"
//
// The figure (1920 × 1080 u): `nl`, math.number_line with the criterion's params. `deep show` presents it; the drawn form
// goes to `deep-canvas-render geometry` (README: Reading the drawing). The judge `lineFailures`:
//   - ticks: the derived axis@1's shown ticks (opacity > 0) are 7, at −3 … 3, and it draws 7 tick marks across its line;
//   - labels: the derived text@1 and vector@1 items are 6; each one's box centre is within 0.5 px of a tick mark's x,
//     the six at six different ticks, and none at the tick of 0 (a label there fails, naming numbers_to_exclude);
//   - the arrow end: some drawn sub-path other than a straight line has a point within 0.5 px of the tick of +3's x on
//     the line, every other point of it to the left of that x and off the line (an arrowhead pointing right, its apex
//     at +3), and nothing the number line draws reaches further right than that apex by more than 0.5 px.
// The second test presents the figure under `planted: math_number_line_drops_excluded` (README: The planted
// programs): the judge fails, and a failure names numbers_to_exclude.
// Wrong programs: the base (no math@1); numbers_to_exclude dropped (7 labels, one at 0); labels placed by their left
// edge; no tip, or a tip past +3; ticks from a mark set.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, boxOf, centre, derivedOf, docId, drawnForm, geometryOfAll, isLabelKind, mathDoc, none, notPresented, present, run, scenario, segment,
  subpathsOf, tickMarks, ticksOf, useBins, useFolders, type P2, type Planted,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const doc = mathDoc('A number line', SIZE, {
  nl: { kind: 'math.number_line@1', params: { x_range: [-3, 3, 1], include_tip: true, include_numbers: true, numbers_to_exclude: [0] } },
});

function lineFailures(planted?: Planted): string[] {
  const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)], planted ? { planted } : {}));
  expect(a.ok, `deep-show run accepts the scenario${planted ? ` with planted ${planted}` : ''}: ${a.why}`).toBe(true);
  const shown = a.replies[0]!;
  expect(notPresented(shown), `the number line is presented with no error${planted ? ` (planted ${planted})` : ''}`).toBe('');
  const derived = derivedOf(shown, 'nl');
  const geo = geometryOfAll(bin('deep-canvas-render'), drawnForm(doc, shown), Object.keys(derived));
  const out: string[] = [];
  const axes = Object.entries(derived).filter(([, i]) => i['kind'] === 'axis@1');
  if (axes.length !== 1) return [`math.number_line expands to ${axes.length} axis@1, not one`];
  const [axisId] = axes[0]!;
  const values = ticksOf(geo[axisId]!).filter((t) => t.opacity > 0).map((t) => t.value).sort((p, q) => p - q);
  const marks = tickMarks(geo[axisId]!, true);
  if (JSON.stringify(values) !== JSON.stringify([-3, -2, -1, 0, 1, 2, 3])) out.push(`the axis shows ticks at ${values.join(', ')}, not −3 … 3`);
  if (marks.length !== 7) out.push(`the axis draws ${marks.length} tick marks, not 7`);
  const tickAt = new Map(marks.map((x, i) => [values[i] ?? NaN, x]));
  const labels = Object.entries(derived).filter(([, i]) => isLabelKind(i));
  if (labels.length !== 6) out.push(`${labels.length} labels are drawn, not 6`);
  const used = new Set<number>();
  for (const [id] of labels) {
    const b = boxOf(geo[id]!);
    if (!b) { out.push(`the label ${id} has no box`); continue; }
    const cx = centre(b)[0];
    const near = [...tickAt].sort((p, q) => Math.abs(p[1] - cx) - Math.abs(q[1] - cx))[0];
    if (!near || Math.abs(near[1] - cx) > 0.5) { out.push(`the label ${id}'s centre x ${cx.toFixed(2)} is not within 0.5 px of any tick's x`); continue; }
    if (near[0] === 0) out.push(`the label ${id} sits at the tick of 0, which numbers_to_exclude [0] leaves out`);
    if (used.has(near[0])) out.push(`two labels sit at the tick of ${near[0]}`);
    used.add(near[0]);
  }
  const x3 = tickAt.get(3);
  if (x3 === undefined) return [...out, 'no tick at +3 to find the arrow end at'];
  const subs = Object.values(geo).flatMap((g) => subpathsOf(g));
  const lineY = subs.map(segment).filter((s): s is [P2, P2] => s !== null && Math.abs(s[0][1] - s[1][1]) <= 0.01)
    .sort((p, q) => Math.abs(q[1][0] - q[0][0]) - Math.abs(p[1][0] - p[0][0]))[0]?.[0][1];
  if (lineY === undefined) return [...out, 'no line is drawn'];
  const arrow = subs.filter((s) => segment(s) === null || s.closed).find((s) => {
    const apex = s.points.filter((p) => Math.abs(p[0] - x3) <= 0.5 && Math.abs(p[1] - lineY) <= 0.5);
    const rest = s.points.filter((p) => !(Math.abs(p[0] - x3) <= 0.5 && Math.abs(p[1] - lineY) <= 0.5));
    return apex.length > 0 && rest.length > 0 && rest.every((p) => p[0] < x3 - 0.5) && rest.some((p) => Math.abs(p[1] - lineY) > 1);
  });
  if (!arrow) out.push(`no arrowhead has its apex at +3 (x ${x3.toFixed(2)}, y ${lineY.toFixed(2)})`);
  const right = Math.max(...subs.flatMap((s) => s.points.map((p) => p[0])));
  if (right > x3 + 0.5) out.push(`the number line draws to x ${right.toFixed(2)}, past its arrow end at +3 (${x3.toFixed(2)})`);
  return out;
}

describe(`${AC[8]} the number line's ticks, labels and tip`, () => {
  it(`${AC[8]} 7 ticks, 6 labels with none at 0, each centred within 0.5 px on its tick, and an arrow end at +3`, () => {
    none(lineFailures(), 'the number line');
  }, TIMEOUT);

  it(`${AC[8]} a planted expansion that drops numbers_to_exclude fails, naming it`, () => {
    const failures = lineFailures('math_number_line_drops_excluded');
    console.log(`${AC[8]} the plant's failures: ${failures.join('; ')}`);
    expect(failures.length, 'the judge fails the plant').toBeGreaterThan(0);
    expect(failures.some((f) => f.includes('numbers_to_exclude')), `a failure names numbers_to_exclude: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
