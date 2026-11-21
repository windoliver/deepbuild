// AC9 #297.a18ed59e: Three U+200B alone are refused as `blank`. 'a' with 5 combining acute accents (U+0301) is refused
// as `mark_stack`, and with 4 it is accepted. A family emoji joined by U+200D that the fixture font draws is accepted as
// one grapheme. A planted control with no mark limit takes the 5-mark stack and fails, naming the grapheme
//
// Through `deep-show run` (README: The surface under test): the nameplates piece in the shipped look, whose fallback
// faces include the emoji face (Noto Emoji, which draws U+1F468 U+200D U+1F466, family: man, boy, as one ligature glyph;
// 11 bytes, inside `max_bytes` 16). Each case is its own run: Tab focuses `name`, the case's text is typed as one event,
// Enter; the notice is read from `see`, the entries from `appended`, what seat 1's plate shows from `eval`'s `shown`. The
// planted `control_no_mark_limit` (README: Planted twins) is a control with no mark limit.
import { describe, it } from 'vitest';
import { DEFAULT_NAME, NAME, namesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, announcementsOf, appendedOf, cps, failsNaming, focusOf, graphemes, named, noticeNames, noticesOf, none, presented,
  putEvidence, runShow, scenario, show as text, shownOf, useShow, useTemp, valuesOf, type Announcement, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(16);
const ZWSP3 = '\u{200b}'.repeat(3);
const ACUTE = '\u{0301}';
const FIVE = `a${ACUTE.repeat(5)}`;
const FOUR = `a${ACUTE.repeat(4)}`;
const FAMILY = '\u{1f468}\u{200d}\u{1f466}';

interface Typed { committed: string[]; notices: Announcement[]; shown: string | undefined; failures: string[] }
/** `value` typed into `name` as one event, then Enter. */
function typed(value: string, what: string, planted?: Planted): Typed {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(D, namesDoc(seats));
  const tab = s.key('Tab');
  const from = s.now;
  const events = [s.text(value), s.key('Enter')];
  const seen = s.see();
  const frame = s.eval(D, s.now);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), `AC9 ${what} typed into name`);
  presented(r[0]!, 'the nameplates piece');
  const failures: string[] = [];
  if (focusOf(r[tab]!, 'Tab') !== NAME) failures.push(`Tab focuses ${String(focusOf(r[tab]!, 'Tab'))}, not the control name`);
  return {
    committed: valuesOf(events.flatMap((i) => appendedOf(r[i]!, `call ${i}`))),
    notices: noticesOf(announcementsOf(r[seen]!, 'see'), NAME, from),
    shown: shownOf(r[frame]!, 'the frame after Enter')['plate1'],
    failures,
  };
}
const shows = (shown: string | undefined): string => (shown === undefined ? 'nothing it reports' : named(shown));

/** A refused case: a notice with the reason (naming `grapheme` where given), no entry holding it, the plate unchanged. */
function refused(t: Typed, value: string, reason: string, grapheme?: string): string[] {
  const f = [...t.failures];
  if (!t.notices.some((a) => a.reason === reason && (grapheme === undefined || noticeNames(a, grapheme)))) {
    f.push(`no notice of name gives the reason ${reason}${grapheme ? ` naming the grapheme ${named(grapheme)}` : ''}; its notices: ${text(t.notices, 600)}`);
  }
  const took = t.committed.filter((v) => v.includes(value));
  if (took.length) f.push(`the control took the grapheme ${named(grapheme ?? value)}: it committed ${took.map(named).join(', ')}`);
  if (t.shown !== DEFAULT_NAME) f.push(`seat 1's plate1 shows ${shows(t.shown)}, not the default ${named(DEFAULT_NAME)}`);
  return f;
}
/** An accepted case: one entry holding exactly what was typed, no notice, the plate showing its NFC form. */
function accepted(t: Typed, value: string): string[] {
  const f = [...t.failures];
  if (t.committed.length !== 1 || t.committed[0] !== value) f.push(`the control commits ${t.committed.map(named).join(', ') || 'nothing'}, not one entry holding ${named(value)} as typed`);
  if (t.notices.length) f.push(`the control gives notices: ${text(t.notices, 600)}`);
  if (t.shown !== value.normalize('NFC')) f.push(`seat 1's plate1 shows ${shows(t.shown)}, not ${named(value.normalize('NFC'))}`);
  return f;
}

describe(`${AC[9]} blank entries and stacks past 4 marks are refused, and a joiner inside a drawn grapheme is accepted`, () => {
  it(`${AC[9]} three U+200B alone are refused as blank`, () => {
    none(refused(typed(ZWSP3, 'three U+200B'), ZWSP3, 'blank'), 'three U+200B');
  }, TIMEOUT);
  it(`${AC[9]} 'a' with 5 combining acute accents is refused as mark_stack, and with 4 it is accepted`, () => {
    none([...refused(typed(FIVE, 'a with 5 U+0301'), FIVE, 'mark_stack', FIVE), ...accepted(typed(FOUR, 'a with 4 U+0301'), FOUR)], 'the stacks of 5 and 4 marks');
  }, TIMEOUT);
  it(`${AC[9]} a family emoji joined by U+200D that the fixture font draws is accepted as one grapheme`, () => {
    const f = accepted(typed(FAMILY, 'the family emoji'), FAMILY);
    if (graphemes(FAMILY).length !== 1) f.push(`the fixture's ${cps(FAMILY)} is ${graphemes(FAMILY).length} graphemes by the platform's segmenter, not 1`);
    none(f, 'the family emoji');
  }, TIMEOUT);
  it(`${AC[9]} the planted control with no mark limit takes the 5-mark stack and fails, naming the grapheme`, () => {
    failsNaming(refused(typed(FIVE, 'a with 5 U+0301', 'control_no_mark_limit'), FIVE, 'mark_stack', FIVE), [/the control took the grapheme "[^"]+" \(U\+0061 U\+0301 U\+0301 U\+0301 U\+0301 U\+0301\)/], 'control_no_mark_limit');
  }, TIMEOUT);
});
