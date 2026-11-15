// AC4 #542.8bfb66e0: A text control with lines one, fed 'にほん' through the input seam's test backend's input method,
// writes no entry on the Enter that confirms the candidate and one entry holding its UTF-8 bytes on the next Enter; a
// planted control that commits on the confirming Enter writes an entry mid-composition and fails, naming the control
//
// Through `deep-show run` (README: The surface under test), on the text fixture with `name` (lines one): Tab focuses
// it, the test backend's input method composes に, にほ, then にほん as marked text (README: the `ime` event), Enter
// confirms the candidate, and Enter again commits. Each input's `appended` is read. The planted
// `text_commits_on_ime_confirm` (README: Planted twins) commits on the Enter that confirms a candidate.
import { describe, expect, it } from 'vitest';
import { echoProgram } from './programs.ts';
import { textDoc } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, failsNaming, focusOf, hexOf, none, prebuild, presented, putEvidence, runShow,
  scenario, useTemp, type ShowPlanted,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(4);
const NAME = { id: 'name', label: 'Name', maxBytes: 256, lines: 'one' as const };
const WORD = 'にほん';

function judge(planted?: ShowPlanted): string[] {
  const ev = temp();
  const echo = echoProgram();
  putEvidence(ev, echo.bytes);
  const s = new Script();
  s.present(D, textDoc('name-ime', echo, NAME));
  const tab = s.key('Tab');
  const composing = ['に', 'にほ', WORD].map((m) => s.ime(m));
  const confirm = s.key('Enter');
  const commit = s.key('Enter');
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls, planted ? { planted } : {}), 'AC4 にほん composed, confirmed and committed');
  presented(r[0]!, 'the text fixture');
  expect(focusOf(r[tab]!, 'after Tab'), 'the fixture: Tab focuses the text control').toBe('name');

  const failures: string[] = [];
  const during = composing.flatMap((i) => appendedOf(r[i]!, 'the composition'));
  if (during.length) failures.push(`the composition appends ${entriesText(during)} to control name, not nothing`);
  const confirmed = appendedOf(r[confirm]!, 'the confirming Enter');
  if (confirmed.length) failures.push(`the Enter that confirms the candidate appends ${entriesText(confirmed)}: control name writes an entry mid-composition`);
  const committed = appendedOf(r[commit]!, 'the next Enter');
  const e = committed.length === 1 ? committed[0]! : null;
  const want = Buffer.from(WORD, 'utf8');
  const got = e && typeof e['value'] === 'string' ? Buffer.from(e['value'], 'utf8') : null;
  if (!e || e['control'] !== 'name' || e['writer'] !== 'you' || !got || !got.equals(want))
    failures.push(`the next Enter appends ${entriesText(committed)}, not one entry of control name holding にほん's UTF-8 bytes (${hexOf(want)})`);
  return failures;
}

describe(`${AC[4]} a text control under an input method writes nothing while composing and commits only later`, () => {
  it(`${AC[4]} にほん through the test backend's input method: no entry on the confirming Enter, one entry of its UTF-8 bytes on the next`, () => {
    none(judge(), 'にほん composed, confirmed and committed');
  }, TIMEOUT);

  it(`${AC[4]} planted text_commits_on_ime_confirm writes an entry mid-composition and fails, naming the control`, () => {
    failsNaming(judge('text_commits_on_ime_confirm'), [/confirms the candidate/, /control name/], 'the planted control that commits on the confirming Enter');
  }, TIMEOUT);
});
