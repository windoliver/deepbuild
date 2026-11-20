// AC6 #297.cd44d20a: An entry typed as "e" followed by U+0301 shows as "é" while the input track keeps the typed bytes by
// hash; a planted text that normalizes the entry changes the track's hash and fails, naming the entry
//
// Through `deep-show run` (README: The surface under test): the nameplates piece; Tab focuses `name`, "e" and U+0301
// are typed as two events, Enter commits. `track` gives the input track and its hash right after the commit; `eval`
// then draws the frame (`pixels`) and reads what seat 1's plate shows (`shown`); `track` again gives the track and its
// hash after the entry text has shown the entry. The planted `entry_normalizes_track` (README: Planted twins) is a text
// that normalizes the entry it shows.
import { describe, it } from 'vitest';
import { NAME, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, failsNaming, hexOf, named, none, once, presented, putEvidence, runShow, scenario, shownOf, trackOfReply,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(7);
const TYPED = 'e\u{0301}';
const TYPED_BYTES = Buffer.from(TYPED, 'utf8');
const SHOWN = '\u{00e9}';

const entryName = (e: JsonObject): string => `{control: ${String(e['control'])}, t: ${String(e['t'])}}`;
const bytesOf = (e: JsonObject | undefined): Buffer | null => (e && typeof e['value'] === 'string' ? Buffer.from(e['value'], 'utf8') : null);

function judge(planted?: Planted): string[] {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(D, namesDoc(seats));
  s.key('Tab');
  s.text('e');
  s.text('\u{0301}');
  const enter = s.key('Enter');
  const before = s.track(D);
  const frame = s.eval(D, s.now, { pixels: true });
  const after = s.track(D);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC6 e then U+0301 typed, committed and shown');
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  const committed = appendedOf(r[enter]!, 'Enter').filter((e) => e['control'] === NAME);
  const entry = committed[0];
  if (committed.length !== 1 || !bytesOf(entry)?.equals(TYPED_BYTES)) {
    failures.push(`Enter commits ${committed.map((e) => `${entryName(e)} holding ${hexOf(bytesOf(e) ?? '')}`).join(', ') || 'nothing'}, not one entry of name holding the typed ${hexOf(TYPED_BYTES)}`);
  }
  const shown = shownOf(r[frame]!, 'the frame after the commit')['plate1'];
  if (shown !== SHOWN) failures.push(`seat 1's plate1 shows ${shown === undefined ? 'nothing it reports' : named(shown)}, not ${named(SHOWN)}, the entry's NFC form`);
  const [t0, t1] = [trackOfReply(r[before]!, 'the track after the commit'), trackOfReply(r[after]!, 'the track after the frame')];
  const kept = t1.entries.filter((e) => e['control'] === NAME);
  const which = entry ? entryName(entry) : '{control: name}';
  if (t1.hash !== t0.hash) failures.push(`the entry ${which}: the input track's hash is ${t0.hash} after the commit and ${t1.hash} after the text showed it; the text changed the track`);
  if (kept.length !== 1 || !bytesOf(kept[0])?.equals(TYPED_BYTES)) failures.push(`the entry ${which}: the track holds ${kept.map((e) => hexOf(bytesOf(e) ?? '')).join(', ') || 'no entry of name'} after the text showed it, not the typed ${hexOf(TYPED_BYTES)}`);
  return failures;
}
const honest = once(() => judge());

describe(`${AC[6]} an entry text shows the NFC form while the entry keeps its bytes as typed`, () => {
  it(`${AC[6]} an entry typed as "e" followed by U+0301 shows as "é" while the input track keeps the typed bytes by hash`, () => {
    none(honest(), 'the entry typed as e and U+0301');
  }, TIMEOUT);
  it(`${AC[6]} the planted text that normalizes the entry changes the track's hash and fails, naming the entry`, () => {
    failsNaming(judge('entry_normalizes_track'), [/the entry \{control: name, t: \d+\}: the (input track's hash is|track holds)/], 'entry_normalizes_track');
  }, TIMEOUT);
});
