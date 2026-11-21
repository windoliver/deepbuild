// AC10 #297.597888a6: With fonts that draw both scripts, seat 1 commits 'Coco' in Latin letters and seat 2 commits the
// same look in Cyrillic letters (U+0421 U+043E U+0441 U+043E). Both copies show the first as 'Coco (1)' and the second
// with ' (2)', before and after a seek. 'Coco' beside 'Cocoa' gains no number. A planted compare by code points leaves
// the pair unnumbered and fails, naming both seats. A box that fits `widest` alone and not `widest` with ' (2)' fails
// the fit check, naming the item
//
// Through `deep-show run` (README: The surface under test): the nameplates piece in the shipped look (its body face,
// Inter, draws Latin and Cyrillic). The match: player 1's script commits 'Coco' (lands at step 20), player 2's U+0421
// U+043E U+0441 U+043E (step 40); both copies' frames at step 60 (`render_back`'s `shown`). After the match each copy's recorded track is
// played in a second run (`eval`'s own `track`): step 100, then the seek back to step 50. 'Coco' beside 'Cocoa': a
// recorded track loaded (`track`'s `load`), `eval` at step 30. The fit: the piece with `plate1`'s box at 105 u, which
// fits `widest` (six W, 94.6 u at 16 u) alone and not with ' (2)' (120.5 u), beside the same piece at 158 u. The planted
// `entry_compare_code_points` (README: Planted twins) compares entries by code points, not by their UTS #39 skeletons.
import { describe, it } from 'vitest';
import { DELAY, NAME, NARROW, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, RATE, Script, TIMEOUT, at, commit, copiesOf, errorsOf, failsNaming, named, namedIn, namesItem, none, once, presented, putEvidence, rendersOf,
  runShow, scenario, show as text, shownOf, trackOf, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const [D, WIDE, TIGHT] = [DOC(17), DOC(18), DOC(19)];
const LATIN = 'Coco';
const CYRILLIC = '\u{0421}\u{043e}\u{0441}\u{043e}';
const WANT = { plate1: `${LATIN} (1)`, plate2: `${CYRILLIC} (2)` };

/** Both seats' plates against the numbered pair. */
function numbered(shown: Record<string, string>, where: string): string[] {
  const off = (['plate1', 'plate2'] as const).filter((item) => shown[item] !== WANT[item]);
  if (!off.length) return [];
  return [`${where}: seat 1's plate1 shows ${named(shown['plate1'] ?? '(nothing reported)')} and seat 2's plate2 shows ${named(shown['plate2'] ?? '(nothing reported)')}, not ${named(WANT.plate1)} and ${named(WANT.plate2)}`];
}

function judge(planted?: Planted): string[] {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const doc = namesDoc(seats);
  const s = new Script();
  s.present(D, doc);
  const plays = { 1: [{ step: 20 - DELAY, control: NAME, value: LATIN }], 2: [{ step: 40 - DELAY, control: NAME, value: CYRILLIC }] };
  const T = (60 + 0.5) / RATE;
  const m = s.match(D, 120, plays, [{ player: 1, t: T }, { player: 2, t: T }]);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC10 the match: Coco in Latin and in Cyrillic');
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  const renders = rendersOf(r[m]!, 2, 'the match');
  for (const c of renders) failures.push(...numbered(c.shown, `copy ${c.player} in the match (its step ${c.step})`));
  if (renders[0]!.sha256 !== renders[1]!.sha256) failures.push(`the copies draw other pixels at ${T.toFixed(4)} s`);

  // After the match: each copy's recorded track, played at step 100 and then seeked back to step 50.
  const copies = copiesOf(r[m]!, 'the match');
  const s2 = new Script();
  s2.present(D, doc);
  const evals = copies.flatMap((c) => [100, 50].map((k) => ({ c: c.player, k, i: s2.eval(D, at(k), { track: c.track }) })));
  const r2 = runShow(show(), scenario(ev, [D], s2.calls, planted), 'AC10 each copy\'s recorded track, played and seeked');
  presented(r2[0]!, 'the nameplates piece');
  for (const e of evals) failures.push(...numbered(shownOf(r2[e.i]!, `copy ${e.c}'s track at step ${e.k}`), `copy ${e.c}'s recorded track at step ${e.k}${e.k === 50 ? ', after the seek' : ''}`));
  return failures;
}
const honest = once(() => judge());

describe(`${AC[10]} two seats whose names share a skeleton are each shown with their number`, () => {
  it(`${AC[10]} both copies show 'Coco (1)' and the Cyrillic look-alike with ' (2)', before and after a seek`, () => {
    none(honest(), 'the look-alike pair');
  }, TIMEOUT);
  it(`${AC[10]} 'Coco' beside 'Cocoa' gains no number`, () => {
    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const s = new Script();
    s.present(D, namesDoc(seats));
    s.track(D, trackOf([commit(10, 1, LATIN), commit(20, 2, 'Cocoa')]));
    const frame = s.eval(D, at(30));
    const r = runShow(show(), scenario(ev, [D], s.calls), 'AC10 Coco beside Cocoa');
    presented(r[0]!, 'the nameplates piece');
    const shown = shownOf(r[frame]!, 'the frame at step 30');
    const f: string[] = [];
    if (shown['plate1'] !== LATIN || shown['plate2'] !== 'Cocoa') f.push(`seat 1's plate1 shows ${named(shown['plate1'] ?? '(nothing reported)')} and seat 2's plate2 ${named(shown['plate2'] ?? '(nothing reported)')}, not "Coco" and "Cocoa" with no number`);
    none(f, 'Coco beside Cocoa');
  }, TIMEOUT);
  it(`${AC[10]} the planted compare by code points leaves the pair unnumbered and fails, naming both seats`, () => {
    failsNaming(judge('entry_compare_code_points'), [new RegExp(`seat 1's plate1 shows "${LATIN}" .* and seat 2's plate2 shows "${CYRILLIC}"`)], 'entry_compare_code_points');
  }, TIMEOUT);
  it(`${AC[10]} a box that fits widest alone and not widest with ' (2)' fails the fit check, naming the item`, () => {
    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const s = new Script();
    const wide = s.present(WIDE, namesDoc(seats));
    const tight = s.present(TIGHT, namesDoc(seats, { w1: NARROW }));
    const r = runShow(show(), scenario(ev, [WIDE, TIGHT], s.calls), 'AC10 the nameplates at 158 u and with plate1 at 105 u');
    presented(r[wide]!, 'the nameplates piece, each box 158 u');
    const reply: JsonObject = r[tight]!;
    const f: string[] = [];
    const errors = errorsOf(reply);
    if (reply['outcome'] === 'presented') f.push('the piece whose plate1 box fits widest alone (105 u) is presented: the fit check takes it');
    else if (!errors.some((i) => namesItem(i, 'plate1'))) f.push(`the piece whose plate1 box fits widest alone is refused, but no error names plate1: ${text(errors.map(namedIn), 1200)}`);
    else if (errors.some((i) => namesItem(i, 'plate2'))) f.push(`an error names plate2, whose box (158 u) fits widest with its number: ${text(errors.map(namedIn), 1200)}`);
    none(f, 'the fit check with the number');
  }, TIMEOUT);
});
