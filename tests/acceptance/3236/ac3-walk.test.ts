// AC3 #3236.b282e6d3: "In a replica, Tab reaches the scatter, Right moves the reading focus across the 11 drawn rows in
// order, and each landing adds one announcement with that row's x and y and their units. The missing row is never
// landed on. The document's input track gains no entry. A planted walk that writes a pick entry fails, naming the
// entry"
//
// The replica is `deep-show run` on the scope's virtual clock (#539's suite's form). The fixture scatter with no
// control: Tab, then Right eleven times, each `input`'s `state.focus` read; then `see` and the `track` call. Tab reaches
// the scatter: the focus is the set (`scatter`) or its first row. The landings (each key after which the focus is a row
// `scatter#<key>` it wasn't on) are the drawn rows in order, 0 to 4 and 6 to 11 (key, x and #539's reading order agree:
// fixtures.ts); row 5, whose y is missing, is never focused or announced. The announcements of the scatter's rows are
// one per landing, in order, each naming its row by ID, its text's integers exactly that row's x then y, with `seconds`
// before `metres`. No key appends an entry and the track is empty. The planted `reading_walk_writes_entry` appends a
// pick entry at each landing; the criterion's check fails it, naming the entry.
// Wrong programs: no reading focus; a Tab stop per row; a walk onto the missing row; an announcement without the units
// or with another row's values; a walk that writes an entry.
import { describe, it } from 'vitest';
import { DOC, DRAWN, MISSING, SCATTER, XS, YS, rowId, scatterDoc } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, binOf, entryFailures, failsNaming, fociOf, intsOf, landingsOf, none, prebuild, presented, rowAnnouncements, runShow,
  scenario, seenOf, show, useTemp, wordAt, type Planted,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(3);

/** The walk over the scatter: the criterion's failures. */
function walk(planted?: Planted): string[] {
  const s = new Script();
  s.present(D, scatterDoc(D));
  s.scope();
  const keys = [s.key('Tab'), ...DRAWN.map(() => s.key('ArrowRight'))];
  const seen = s.see();
  const track = s.track(D);
  const r = runShow(binOf(), scenario(temp(), [D], s.calls, planted), 'AC3 the walk over the scatter');
  presented(r[0]!, 'the fixture scatter');
  const f: string[] = [];
  const foci = fociOf(r, keys, 'the walk');
  if (foci[0] !== SCATTER && !(foci[0] ?? '').startsWith(`${SCATTER}#`)) f.push(`Tab doesn't reach the scatter: the focus after Tab is ${foci[0] ?? 'nothing'}`);
  const landings = landingsOf(foci, SCATTER);
  const want = DRAWN.map((k) => rowId(SCATTER, k));
  if (show(landings) !== show(want)) f.push(`Tab and Right land on ${show(landings, 600)}, not the 11 drawn rows in order ${show(want, 600)}`);
  if (foci.includes(rowId(SCATTER, MISSING))) f.push(`the walk lands on ${rowId(SCATTER, MISSING)}, the row whose y is missing`);
  const heard = rowAnnouncements(seenOf(r[seen]!, 'see after the walk'), SCATTER);
  if (show(heard.map((a) => a.id)) !== show(landings)) f.push(`the scatter's rows are announced as ${show(heard.map((a) => a.id), 600)}: not one announcement for each landing ${show(landings, 600)}`);
  if (heard.some((a) => a.id === rowId(SCATTER, MISSING))) f.push(`${rowId(SCATTER, MISSING)}, the row whose y is missing, is announced`);
  for (const a of heard) {
    const key = Number(a.id.slice(SCATTER.length + 1));
    if (!DRAWN.includes(key)) continue;
    const want = [XS[key]!, YS[key]!];
    if (show(intsOf(a.text)) !== show(want)) f.push(`${a.id} is announced as ${JSON.stringify(a.text)}: its numbers ${show(intsOf(a.text))}, not x ${want[0]} and y ${want[1]}`);
    const [sec, met] = [wordAt(a.text, 'seconds'), wordAt(a.text, 'metres')];
    if (sec < 0 || met < 0 || sec > met) f.push(`${a.id} is announced as ${JSON.stringify(a.text)}, not with x's unit seconds and then y's unit metres`);
  }
  f.push(...entryFailures(r, keys, track, 'the walk'));
  return f;
}

describe(`${AC[3]} a mark set with no pick control takes a reading focus: one Tab stop, Right over its drawn rows, each announced`, () => {
  it(`${AC[3]} Tab reaches the scatter, Right lands on the 11 drawn rows in order, each announced with its x and y and their units, never the missing row, and the input track gains no entry`, () => {
    none(walk(), 'the reading walk over the scatter');
  }, TIMEOUT);

  it(`${AC[3]} planted reading_walk_writes_entry fails, naming the entry`, () => {
    failsNaming(walk('reading_walk_writes_entry'), [/wrote entry \{/], 'the walk that writes a pick entry');
  }, TIMEOUT);
});
