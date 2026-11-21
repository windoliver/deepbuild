// AC7 #297.855382ad: A `player` bound to an f64 array, or to a column whose source can't narrow to an integer, is
// refused at check, naming it; and a logic item that declares the control as a read gets its bytes as #187 gives them,
// unchanged
//
// Through `deep-show run` (README: The surface under test). The bindings: four pieces, each in a panel of its own: an
// entry text whose `player` is `seats.spot[0]` (an f64 array) and one whose `player` is `seats.who[0]` (i32); the
// nameplate mark set whose player column reads `seats.spot` as f64 and the same reading `seats.who` as u8. The read: the
// nameplates piece with `echo`, a logic item that declares `name` as a read; "Zoe" and U+0308 are typed, Enter commits,
// and #539's `logic` steps the piece on its track, `echo.head` holding the read region's first 24 bytes at each step
// (fixtures.ts). The read region is #542's (#187's part): the commit's u32 length, its bytes, then zero bytes to the next
// multiple of 8. Neither half names a planted program; the wrong program is the merge base.
import { describe, it } from 'vitest';
import { NAME, bindingDoc, echoDoc, echoProgram, seatsProgram, wordsToBytes, type Binding } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, errorsOf, hexOf, logicStepsOf, namedIn, namesField, namesItem, none, presented, putEvidence, runShow, scenario,
  show as text, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();

describe(`${AC[7]} an entry text's player is an integer, and the control's bytes reach logic as typed`, () => {
  it(`${AC[7]} a player bound to an f64 array, or to a column whose source can't narrow to an integer, is refused at check, naming it`, () => {
    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const kinds: Binding[] = ['i32_item', 'f64_item', 'i32_column', 'f64_column'];
    const ids = kinds.map((_, n) => DOC(10 + n));
    const s = new Script();
    const shows = kinds.map((b, n) => s.present(ids[n]!, bindingDoc(seats, b)));
    const r = runShow(show(), scenario(ev, ids, s.calls), 'AC7 the four bindings');
    const failures: string[] = [];
    const at = (b: Binding): JsonObject => r[shows[kinds.indexOf(b)]!]!;
    presented(at('i32_item'), 'the entry text whose player reads seats.who[0] (i32)');
    presented(at('i32_column'), 'the mark set whose player column reads seats.who as u8');
    const refusal = (b: Binding, item: string, fields: string[], what: string): void => {
      const reply = at(b);
      const errors = errorsOf(reply);
      const naming = errors.filter((i) => namesItem(i, item) && (fields.some((f) => namesField(i, f)) || fields.includes(String(i['column']))));
      if (reply['outcome'] === 'presented') failures.push(`${what} is presented: the check takes it`);
      else if (!naming.length) failures.push(`${what} is refused, but no error names ${item} and its ${fields.join(' or ')}: ${text(errors.map(namedIn), 1200)}`);
    };
    refusal('f64_item', 'bound', ['player'], 'item bound, whose player reads seats.spot[0] (f64)');
    refusal('f64_column', 'plates', ['player', 'seat'], 'mark set plates, whose player column seat reads seats.spot as f64');
    none(failures, 'the refused bindings');
  }, TIMEOUT);

  it(`${AC[7]} a logic item that declares the control as a read gets its bytes as #187 gives them, unchanged`, () => {
    const ev = temp();
    const [seats, echo] = [seatsProgram(), echoProgram()];
    putEvidence(ev, seats.bytes);
    putEvidence(ev, echo.bytes);
    const D = DOC(14);
    const s = new Script();
    s.present(D, echoDoc(seats, echo));
    s.key('Tab');
    s.text('Zoe');
    s.text('\u{0308}');
    const enter = s.key('Enter');
    const logic = s.logic(D, 120);
    const r = runShow(show(), scenario(ev, [D], s.calls), 'AC7 "Zoe" and U+0308 committed and read by echo');
    presented(r[0]!, 'the nameplates piece with echo');
    const failures: string[] = [];
    const typed = Buffer.from('Zoe\u{0308}', 'utf8');
    const committed = appendedOf(r[enter]!, 'Enter').filter((e) => e['control'] === NAME);
    if (committed.length !== 1 || committed[0]!['value'] !== 'Zoe\u{0308}') failures.push(`Enter commits ${text(committed, 400)}, not one entry of name holding ${hexOf(typed)}`);
    const steps = logicStepsOf(r[logic]!, 'the logic run');
    const read = steps.map((st) => ({ step: st.step, head: st.arrays['echo.head'] })).filter((x) => Array.isArray(x.head) && typeof x.head[0] === 'number' && x.head[0] !== 0);
    // u32 5, the five bytes as typed, then zero bytes to the next multiple of 8 from the length's start (16).
    const want = Buffer.concat([Buffer.from([5, 0, 0, 0]), typed, Buffer.alloc(7)]);
    if (read.length !== 1) failures.push(`${read.length} steps read a commit of name (steps ${read.map((x) => x.step).slice(0, 8).join(', ')}); the one commit is read by one step`);
    else {
      const got = wordsToBytes(read[0]!.head!.map(Number)).subarray(0, 16);
      if (!got.equals(want)) failures.push(`step ${read[0]!.step} reads its region's first 16 bytes as ${hexOf(got)}, not u32 5, the typed bytes and 7 zero bytes (${hexOf(want)})`);
    }
    none(failures, 'echo\'s read of name');
  }, TIMEOUT);
});
