// AC5 #3236.9b62337c: "A series of 50,000 rows is walked in at most as many stops as it has pixel columns, each
// announced with its count and extent. A planted walk that stops on every row fails, naming the count"
//
// The series (fixtures.ts `seriesDoc`): `trace`, a `series@1` line of 50,000 rows decimated by M4 over its 400 pixel
// columns, each column holding exactly 125 rows whose least value is 200 + k and greatest 448 + k (k the column). Tab,
// then Right 401 times, each `input`'s `state.focus` read, then `see`. The walk is judged by its landings (README: The
// reading focus): at most 400 stops, and a Right at the end that moves no more; each stop announced once, in order, its
// text's integers exactly the count 125 and one column's least and greatest, the least first; no column twice, and every
// column a stop. The planted `reading_walk_every_row` stops on every row, so all 401 presses move the focus; the
// criterion's check fails it, naming the stop count.
// Wrong programs: a walk row by row; a stop without its count or extent; a stop per kept row of M4 instead of per column.
import { describe, it } from 'vitest';
import { DOC, PER_COLUMN, PIXEL_COLUMNS, TRACE, columnGreatest, columnLeast, seriesDoc } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, binOf, failsNaming, fociOf, intsOf, landingsOf, none, prebuild, presented, rowAnnouncements, runShow, scenario, seenOf,
  show, useTemp, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(5);
const PRESSES = PIXEL_COLUMNS + 1;

/** The walk over the series: the criterion's failures; one about the number of stops starts `the walk's stop count`. */
function walk(planted?: Planted): string[] {
  const s = new Script();
  s.present(D, seriesDoc(D));
  s.scope();
  const keys = [s.key('Tab'), ...Array.from({ length: PRESSES }, () => s.key('ArrowRight', 20))];
  const seen = s.see();
  const r = runShow(binOf(), scenario(temp(), [D], s.calls, planted), 'AC5 the walk over the 50,000-row series');
  presented(r[0]!, 'the 50,000-row series');
  const f: string[] = [];
  const foci = fociOf(r, keys, 'the walk');
  const landings = landingsOf(foci, TRACE);
  if (!landings.length) return [`Tab and Right never focus a stop of ${TRACE}: the focus after each key is ${show([...new Set(foci)], 300)}`];
  const last = foci[foci.length - 1];
  const moved = foci[foci.length - 2] !== last;
  if (landings.length > PIXEL_COLUMNS || moved) {
    f.push(`the walk's stop count passes the series' ${PIXEL_COLUMNS} pixel columns: ${landings.length} stops in ${PRESSES} presses of Right${moved ? ', and the last press still moved the focus' : ''}`);
  }
  const heard = rowAnnouncements(seenOf(r[seen]!, 'see after the walk'), TRACE);
  if (show(heard.map((a) => a.id)) !== show(landings)) f.push(`the series' stops are announced ${heard.length} times (${show(heard.slice(0, 4).map((a) => a.id))} …): not once for each of its ${landings.length} landings`);
  const columns = new Set<number>();
  for (const [i, a] of heard.slice(0, PRESSES + 1).entries()) {
    const ints = intsOf(a.text);
    const at = ints.indexOf(PER_COLUMN);
    if (at < 0) { f.push(`stop ${i + 1} (${a.id}) is announced as ${JSON.stringify(a.text)}: no count of ${PER_COLUMN} rows`); continue; }
    const rest = [...ints.slice(0, at), ...ints.slice(at + 1)];
    const k = (rest[0] ?? -1) - columnLeast(0);
    if (rest.length !== 2 || k < 0 || k >= PIXEL_COLUMNS || rest[0] !== columnLeast(k) || rest[1] !== columnGreatest(k)) {
      f.push(`stop ${i + 1} (${a.id}) is announced as ${JSON.stringify(a.text)}: not a pixel column's count ${PER_COLUMN} and its least and greatest value`);
      continue;
    }
    if (columns.has(k)) f.push(`stop ${i + 1} (${a.id}) announces pixel column ${k} again`);
    columns.add(k);
  }
  if (columns.size !== PIXEL_COLUMNS && f.length === 0) f.push(`the walk's stops reach ${columns.size} of the series' ${PIXEL_COLUMNS} pixel columns`);
  return f;
}

describe(`${AC[5]} a set past 1,000 drawn rows is walked by buckets: a series by its pixel columns`, () => {
  it(`${AC[5]} the 50,000-row series is walked in at most ${PIXEL_COLUMNS} stops, its pixel columns, each announced with its count and extent`, () => {
    none(walk(), 'the walk over the series');
  }, TIMEOUT);

  it(`${AC[5]} planted reading_walk_every_row fails, naming the count`, () => {
    failsNaming(walk('reading_walk_every_row'), [/^the walk's stop count passes/], 'the walk that stops on every row');
  }, TIMEOUT);
});
