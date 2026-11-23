// AC4 #297.ee30ab4e: With Latin fonts and no fallback for Han, typing 字 into the control is refused with a notice
// naming it; in a two-copy match, a modified copy that commits it anyway has the entry refused alike on both copies,
// naming the player; a planted check that takes it lets a copy draw a missing glyph and fails, naming the grapheme
//
// Through `deep-show run` (README: The surface under test): the nameplates piece in the look `latin-297` (the clean look
// with no fallback faces, so its texts are set in the body face, Inter, alone, and nothing draws U+5B57; fixtures.ts).
// Typing: Tab focuses `name`, 字 is typed, Enter; the notice is read from `see`, the entries from `appended`, what seat
// 1's plate shows from `eval`'s `shown`. The match: player 2's script commits "Ana", then 字 (a modified copy: a script
// entry is a commit with no typing check, README); each copy's `refused` rows, and both copies' frames 30 steps later
// (`render_back`). The planted `entry_takes_missing_glyph` (README: Planted twins) is a range check that takes it.
import { describe, it } from 'vitest';
import { DEFAULT_NAME, DELAY, NAME, latinLook, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, RATE, Script, TIMEOUT, announcementsOf, appendedOf, copiesOf, cps, failsNaming, focusOf, named, noticeNames, noticesOf, none, once, presented,
  putEvidence, rendersOf, runShow, scenario, show as text, shownOf, useShow, useTemp, valuesOf, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(5);
const HAN = '\u{5b57}';

function pieceIn(ev: string): ReturnType<typeof namesDoc> {
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  return namesDoc(seats, { look: putEvidence(ev, latinLook()) });
}

function typing(): string[] {
  const ev = temp();
  const s = new Script();
  s.present(D, pieceIn(ev));
  const tab = s.key('Tab');
  const typed = s.text(HAN);
  const typedAt = s.now;
  const enter = s.key('Enter');
  const seen = s.see();
  const frame = s.eval(D, s.now);
  const r = runShow(show(), scenario(ev, [D], s.calls), 'AC4 字 typed into name in the Latin look');
  presented(r[0]!, 'the nameplates piece in the Latin look');
  const failures: string[] = [];
  if (focusOf(r[tab]!, 'Tab') !== NAME) failures.push(`Tab focuses ${String(focusOf(r[tab]!, 'Tab'))}, not the control name`);
  const notices = noticesOf(announcementsOf(r[seen]!, 'see'), NAME, typedAt);
  if (!notices.some((a) => noticeNames(a, HAN))) failures.push(`no notice of name from the typing on names ${HAN} (${cps(HAN)}); its notices: ${text(notices, 600)}`);
  const took = valuesOf([...appendedOf(r[typed]!, 'the typing'), ...appendedOf(r[enter]!, 'Enter')]).filter((v) => v.includes(HAN));
  if (took.length) failures.push(`the control committed ${took.map(named).join(', ')}, holding ${HAN}`);
  const shown = shownOf(r[frame]!, 'the frame after Enter')['plate1'];
  if (shown !== DEFAULT_NAME) failures.push(`seat 1's plate1 shows ${shown === undefined ? 'nothing it reports' : named(shown)} after the refused typing, not the default ${named(DEFAULT_NAME)}`);
  return failures;
}

const T = (90 + 0.5) / RATE;
function match(planted?: Planted): string[] {
  const ev = temp();
  const s = new Script();
  s.present(D, pieceIn(ev));
  const plays = { 2: [{ step: 30 - DELAY, control: NAME, value: 'Ana' }, { step: 60 - DELAY, control: NAME, value: HAN }] };
  const m = s.match(D, 120, plays, [{ player: 1, t: T }, { player: 2, t: T }]);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC4 the match where player 2\'s copy commits 字');
  presented(r[0]!, 'the nameplates piece in the Latin look');
  const failures: string[] = [];
  const copies = copiesOf(r[m]!, 'the match');
  const rows = copies.map((c) => c.refused.filter((x) => x.control === NAME));
  copies.forEach((c, i) => {
    if (!rows[i]!.some((x) => x.player === 2)) failures.push(`copy ${c.player} refuses no entry of name naming player 2 (its refused: ${text(c.refused, 400)})`);
  });
  if (text(rows[0]) !== text(rows[1])) failures.push(`the copies refuse other entries: copy 1 ${text(rows[0], 300)}, copy 2 ${text(rows[1], 300)}`);
  const renders = rendersOf(r[m]!, 2, 'the match');
  for (const c of renders) {
    for (const [item, value] of Object.entries(c.shown)) {
      if (value.includes(HAN)) failures.push(`copy ${c.player}'s ${item} draws the grapheme ${HAN} (${cps(HAN)}), which no face of the text can draw (the body face, no fallback): a missing glyph`);
    }
    if (c.shown['plate2'] !== 'Ana') failures.push(`copy ${c.player}'s plate2 (seat 2) shows ${named(c.shown['plate2'] ?? '(nothing reported)')} at step ${c.step}, not seat 2's last name it took, "Ana"`);
  }
  if (renders[0]!.sha256 !== renders[1]!.sha256) failures.push(`the copies draw other pixels at ${T.toFixed(4)} s (${renders[0]!.sha256.slice(0, 12)} vs ${renders[1]!.sha256.slice(0, 12)})`);
  return failures;
}
const honestMatch = once(() => match());

describe(`${AC[4]} a control an entry text shows takes only graphemes the text's fonts can draw, on every copy`, () => {
  it(`${AC[4]} with Latin fonts and no fallback for Han, typing 字 into the control is refused with a notice naming it`, () => {
    none(typing(), 'typing 字');
  }, TIMEOUT);
  it(`${AC[4]} in a two-copy match, a modified copy that commits 字 anyway has the entry refused alike on both copies, naming the player`, () => {
    none(honestMatch(), 'the match where player 2 commits 字');
  }, TIMEOUT);
  it(`${AC[4]} the planted check that takes 字 lets a copy draw a missing glyph and fails, naming the grapheme`, () => {
    failsNaming(match('entry_takes_missing_glyph'), [/draws the grapheme 字 \(U\+5B57\)/], 'entry_takes_missing_glyph');
  }, TIMEOUT);
});
