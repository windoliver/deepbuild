// AC4 #3236.385f709f: "A fixture bar chart of 3 series by 4 quarters gives its node the three series by name with 4
// rows each, and Right lands on one series' four rows before the next series' first. A planted walk in row order, which
// changes series at every landing, fails, naming the second landing"
//
// The bar chart (fixtures.ts `barsDoc`): one set `bars` of 12 rows in quarter order, its `series` column encoded as
// `role` through the ordinal scale `colors` (North, South, West). `see`: the node's value lists North, South and West in
// the scale's order, each with 4 rows. Tab, then Right twelve times: the landings (README: The reading focus) are 12
// distinct rows, the first four North's, the next four South's, the last four West's: one series' rows whole, in the
// scale's order, before the next. The planted `reading_walk_row_order` walks the rows in row order, so its second
// landing is South's; the criterion's check fails it, naming the second landing.
// Wrong programs: a value without the categories or their counts; a walk in row order or #539's reading order across
// series; a walk in another order of the series than the scale's.
import { describe, it } from 'vitest';
import { BARS, DOC, SERIES, barsDoc, seriesOfRow } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, binOf, categoryFailures, failsNaming, fociOf, landingsOf, nodeOf, none, prebuild, presented, runShow, scenario, seenOf,
  show, useTemp, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(4);
const ROWS = 12;
const PER = 4;

/** The bar chart's value and walk: the criterion's failures; a walk failure about landing k starts `landing <k> (`. */
function walk(planted?: Planted): string[] {
  const s = new Script();
  s.present(D, barsDoc(D));
  const seen = s.see();
  const keys = [s.key('Tab'), ...Array.from({ length: ROWS }, () => s.key('ArrowRight'))];
  const r = runShow(binOf(), scenario(temp(), [D], s.calls, planted), 'AC4 the walk over the bar chart');
  presented(r[0]!, 'the bar chart');
  const f = categoryFailures(nodeOf(seenOf(r[seen]!, 'see'), BARS), BARS, SERIES, PER, 'the bar chart\'s node');
  const landings = landingsOf(fociOf(r, keys, 'the walk'), BARS);
  for (const [k, id] of landings.entries()) {
    const key = Number(id.slice(BARS.length + 1));
    const got = Number.isInteger(key) && key >= 0 && key < ROWS ? seriesOfRow(key) : `no series (${id} is no row of ${BARS})`;
    const want = SERIES[Math.floor(k / PER)];
    if (k >= ROWS) { f.push(`landing ${k + 1} (${id}): the walk lands more than ${ROWS} times over ${ROWS} rows`); break; }
    if (landings.indexOf(id) !== k) { f.push(`landing ${k + 1} (${id}) lands again on a row it landed on before`); break; }
    if (got !== want) {
      f.push(`landing ${k + 1} (${id}) is series ${got}, not ${want}: the walk should take each series' ${PER} rows whole, in the scale's order ${SERIES.join(', ')}, before the next; the landings: ${show(landings, 400)}`);
      break;
    }
  }
  if (landings.length < ROWS && !f.some((x) => x.startsWith('landing '))) f.push(`Tab and Right land ${landings.length} times, not on the ${ROWS} bars: ${show(landings, 400)}`);
  return f;
}

describe(`${AC[4]} a set with a column of categories: its value lists each with its count, and the walk takes one category whole before the next`, () => {
  it(`${AC[4]} the bar chart's node gives the three series by name with 4 rows each, and Right lands on one series' four rows before the next series' first`, () => {
    none(walk(), 'the bar chart\'s value and walk');
  }, TIMEOUT);

  it(`${AC[4]} planted reading_walk_row_order, which changes series at every landing, fails, naming the second landing`, () => {
    failsNaming(walk('reading_walk_row_order'), [/^landing 2 \(/], 'the walk in row order');
  }, TIMEOUT);
});
