// AC3 #297.d2e288d8: A box sized for 10 of the widest glyph ellipsizes a 16-letter name at a grapheme boundary, and an
// entry text with no `widest` is refused at check, naming it; a planted fit check that skips entry texts passes the
// second and fails, naming the item
//
// Through `deep-show run` (README: The surface under test): the fit piece, whose `long` shows seat 1's name in a box of
// 10 advances of W at 16 u (fixtures.ts `TEN_W`) with `widest` "WWWWWW"; seat 1 commits the 16-letter name "W" × 16 at
// step 10 (`track`'s `load`), and `eval` at step 20 reads what `long` shows. The same piece with `long`'s `widest` left
// out is shown beside it, in a panel of its own. The planted `fit_skips_entries` (README: Planted twins) is a fit check
// that skips entry texts.
import { describe, it } from 'vitest';
import { fitDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, at, commit, errorsOf, failsNaming, graphemes, named, namedIn, namesField, namesItem, none, once, presented, putEvidence,
  runShow, scenario, shownOf, show as text, trackOf, useShow, useTemp, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const [WITH, WITHOUT] = [DOC(3), DOC(4)];
/** The 16-letter name: sixteen of the widest glyph. */
const LONG_NAME = 'W'.repeat(16);
const ELLIPSIS = '\u{2026}';

interface Judged { ellipsis: string[]; widest: string[] }
function judge(planted?: Planted): Judged {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(WITH, fitDoc(seats, 'WWWWWW'));
  s.track(WITH, trackOf([commit(10, 1, LONG_NAME)]));
  const frame = s.eval(WITH, at(20));
  const without = s.present(WITHOUT, fitDoc(seats, null));
  const r = runShow(show(), scenario(ev, [WITH, WITHOUT], s.calls, planted), 'AC3 the 16-letter name, and the piece with no widest');
  presented(r[0]!, 'the fit piece with its widest');

  const ellipsis: string[] = [];
  const shown = shownOf(r[frame]!, 'the frame at step 20')['long'];
  const parts = graphemes(LONG_NAME.normalize('NFC'));
  if (shown === undefined) ellipsis.push('long reports no shown string at step 20');
  else if (!shown.endsWith(ELLIPSIS)) ellipsis.push(`long shows ${named(shown)} at step 20, not the name cut with an ellipsis (U+2026)`);
  else {
    const kept = shown.slice(0, -ELLIPSIS.length).trimEnd();
    const k = parts.findIndex((_, n) => parts.slice(0, n + 1).join('') === kept);
    if (k < 0 || k + 1 >= parts.length) ellipsis.push(`long shows ${named(shown)} at step 20: ${named(kept)} before the ellipsis is not the first 1 to 15 of the name's 16 graphemes`);
  }

  const widest: string[] = [];
  const refused = r[without]!;
  const named0 = errorsOf(refused).filter((i) => namesItem(i, 'long') && (namesField(i, 'widest') || namedIn(i).includes('widest')));
  if (refused['outcome'] === 'presented') widest.push('item long, an entry text with no widest, is presented: the check takes it');
  else if (!named0.length) widest.push(`the piece whose item long has no widest is refused, but no error names long and widest: ${text(errorsOf(refused).map(namedIn), 1200)}`);
  return { ellipsis, widest };
}
const honest = once(() => judge());

describe(`${AC[3]} an entry text ellipsizes at a grapheme boundary and needs its widest, which the fit check reads`, () => {
  it(`${AC[3]} a box sized for 10 of the widest glyph ellipsizes the 16-letter name at a grapheme boundary`, () => {
    none(honest().ellipsis, 'the 16-letter name in the box of 10 W');
  }, TIMEOUT);
  it(`${AC[3]} an entry text with no widest is refused at check, naming it`, () => {
    none(honest().widest, 'the entry text with no widest');
  }, TIMEOUT);
  it(`${AC[3]} the planted fit check that skips entry texts passes the piece with no widest and fails, naming the item`, () => {
    failsNaming(judge('fit_skips_entries').widest, [/item long, an entry text with no widest, is presented/], 'fit_skips_entries');
  }, TIMEOUT);
});
