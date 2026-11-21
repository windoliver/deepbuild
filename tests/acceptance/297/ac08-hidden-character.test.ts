// AC8 #297.8d736efc: Typing 'Ana', then U+202E, then 'xyz' into the name control is refused at U+202E with
// `hidden_character`, naming the code point, and the text keeps the seat's last committed name. In a two-copy match, a
// modified copy that commits it anyway has the entry refused alike on both copies, naming the player. A planted control
// that takes it shows the entry and fails
//
// Through `deep-show run` (README: The surface under test): the nameplates piece. Typing: Tab focuses `name`; 'Ana',
// U+202E and 'xyz' are typed as three events, then Enter; the notice is read from `see`, the entries from `appended`
// and the track (`track`), what seat 1's plate shows from `eval`'s `shown`. The match: player 2's script commits "Ana",
// then 'Ana' U+202E 'xyz' (a modified copy's commit, README); each copy's `refused` rows and both copies' frames 30 steps
// later (`render_back`). The planted `control_takes_hidden` (README: Planted twins) is a control that takes it.
import { describe, it } from 'vitest';
import { DEFAULT_NAME, DELAY, NAME, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, RATE, Script, TIMEOUT, announcementsOf, appendedOf, copiesOf, failsNaming, focusOf, named, noticeNames, noticesOf, none, once, presented,
  putEvidence, rendersOf, runShow, scenario, show as text, shownOf, trackOfReply, useShow, useTemp, valuesOf, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(15);
const RLO = '\u{202e}';
const SPOOF = `Ana${RLO}xyz`;

function pieceIn(ev: string): ReturnType<typeof namesDoc> {
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  return namesDoc(seats);
}

function typing(planted?: Planted): string[] {
  const ev = temp();
  const s = new Script();
  s.present(D, pieceIn(ev));
  const tab = s.key('Tab');
  const events = [s.text('Ana'), s.text(RLO)];
  const rloAt = s.now;
  events.push(s.text('xyz'), s.key('Enter'));
  const seen = s.see();
  const track = s.track(D);
  const frame = s.eval(D, s.now);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC8 Ana, U+202E and xyz typed into name');
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  if (focusOf(r[tab]!, 'Tab') !== NAME) failures.push(`Tab focuses ${String(focusOf(r[tab]!, 'Tab'))}, not the control name`);
  const notices = noticesOf(announcementsOf(r[seen]!, 'see'), NAME, rloAt);
  if (!notices.some((a) => a.reason === 'hidden_character' && noticeNames(a, RLO))) failures.push(`no notice of name from U+202E on gives the reason hidden_character and names U+202E; its notices: ${text(notices, 600)}`);
  const took = valuesOf(events.flatMap((i) => appendedOf(r[i]!, `call ${i}`))).filter((v) => v.includes(RLO));
  if (took.length) failures.push(`the control committed ${took.map(named).join(', ')}, holding U+202E`);
  // The seat's last committed name: the last entry of name on the track, or the default before one.
  const last = valuesOf(trackOfReply(r[track]!, 'the track').entries).pop();
  const want = (last ?? DEFAULT_NAME).normalize('NFC');
  const shown = shownOf(r[frame]!, 'the frame after Enter')['plate1'];
  if (shown !== want || shown.includes(RLO)) failures.push(`seat 1's plate1 shows ${shown === undefined ? 'nothing it reports' : named(shown)}, not ${named(want)}, the seat's last committed name with no U+202E`);
  return failures;
}

const T = (90 + 0.5) / RATE;
function match(): string[] {
  const ev = temp();
  const s = new Script();
  s.present(D, pieceIn(ev));
  const plays = { 2: [{ step: 30 - DELAY, control: NAME, value: 'Ana' }, { step: 60 - DELAY, control: NAME, value: SPOOF }] };
  const m = s.match(D, 120, plays, [{ player: 1, t: T }, { player: 2, t: T }]);
  const r = runShow(show(), scenario(ev, [D], s.calls), 'AC8 the match where player 2\'s copy commits Ana U+202E xyz');
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  const copies = copiesOf(r[m]!, 'the match');
  const rows = copies.map((c) => c.refused.filter((x) => x.control === NAME));
  copies.forEach((c, i) => {
    if (!rows[i]!.some((x) => x.player === 2 && x.reason === 'hidden_character')) failures.push(`copy ${c.player} refuses no entry of name naming player 2 with the reason hidden_character (its refused: ${text(c.refused, 400)})`);
  });
  if (text(rows[0]) !== text(rows[1])) failures.push(`the copies refuse other entries: copy 1 ${text(rows[0], 300)}, copy 2 ${text(rows[1], 300)}`);
  const renders = rendersOf(r[m]!, 2, 'the match');
  for (const c of renders) {
    if (c.shown['plate2'] !== 'Ana') failures.push(`copy ${c.player}'s plate2 (seat 2) shows ${named(c.shown['plate2'] ?? '(nothing reported)')} at step ${c.step}, not seat 2's last name it took, "Ana"`);
  }
  if (renders[0]!.sha256 !== renders[1]!.sha256) failures.push(`the copies draw other pixels at ${T.toFixed(4)} s`);
  return failures;
}

const honest = once(() => typing());
describe(`${AC[8]} a direction control is a hidden character, refused as typed and on every copy`, () => {
  it(`${AC[8]} typing Ana, U+202E, xyz is refused at U+202E with hidden_character, naming the code point, and the text keeps the seat's last committed name`, () => {
    none(honest(), 'typing Ana U+202E xyz');
  }, TIMEOUT);
  it(`${AC[8]} in a two-copy match, a modified copy that commits it anyway has the entry refused alike on both copies, naming the player`, () => {
    none(match(), 'the match where player 2 commits Ana U+202E xyz');
  }, TIMEOUT);
  it(`${AC[8]} the planted control that takes U+202E shows the entry and fails`, () => {
    failsNaming(typing('control_takes_hidden'), [/(plate1 shows|the control committed) "Ana\\u\{202e\}xyz" \(U\+0041 U\+006E U\+0061 U\+202E/], 'control_takes_hidden');
  }, TIMEOUT);
});
