// AC6 #542.748790f7: Typing "ab" and clicking elsewhere writes one entry "ab", and Esc writes none
//
// Through `deep-show run` (README: The surface under test), on the text fixture with `name` (lines one): Tab focuses
// the field and "a" and "b" are typed; then a click (a press and its release) on `elsewhere`, a rect in the page's
// bottom right corner that no control covers, or, in a second run, Esc. Every input's `appended` is read: together they
// are the entries the run wrote. Esc writing none counts only beside the first run, where the same typing writes "ab".
import { describe, expect, it } from 'vitest';
import { echoProgram } from './programs.ts';
import { ELSEWHERE_AT, textDoc } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, focusOf, none, once, prebuild, presented, putEvidence, runShow, scenario, scopeView,
  toPanel, useTemp, type JsonObject,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(6);
const NAME = { id: 'name', label: 'Name', maxBytes: 256, lines: 'one' as const };

/** "ab" typed into the focused field, then `leave`; every entry the run's inputs appended, in order. */
function typedThen(leave: 'a click elsewhere' | 'Esc'): JsonObject[] {
  const ev = temp();
  const echo = echoProgram();
  putEvidence(ev, echo.bytes);
  const doc = textDoc('name-leave', echo, NAME);
  const view = scopeView(binOf('deep-show'), ev, D, doc, {}, 'AC6 the text fixture');
  const s = new Script();
  s.present(D, doc);
  const tab = s.key('Tab');
  const inputs = [tab, s.text('a'), s.text('b'), ...(leave === 'Esc' ? [s.key('Escape')] : s.click(toPanel(view, ELSEWHERE_AT)))];
  const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls), `AC6 "ab" typed, then ${leave}`);
  presented(r[0]!, 'the text fixture');
  expect(focusOf(r[tab]!, 'after Tab'), 'the fixture: Tab focuses the text control').toBe('name');
  return inputs.flatMap((i) => appendedOf(r[i]!, `input ${i}`));
}
const left = once(() => typedThen('a click elsewhere'));
const leftFailures = (): string[] => {
  const all = left();
  const ok = all.length === 1 && all[0]!['control'] === 'name' && all[0]!['value'] === 'ab' && all[0]!['writer'] === 'you';
  return ok ? [] : [`"ab" typed and a click elsewhere write ${entriesText(all)}, not one entry "ab" of name`];
};

describe(`${AC[6]} leaving a text field commits it, and only Esc discards`, () => {
  it(`${AC[6]} typing "ab" and clicking elsewhere writes one entry "ab"`, () => {
    none(leftFailures(), 'leaving the field by a click elsewhere');
  }, TIMEOUT);

  it(`${AC[6]} typing "ab" and pressing Esc writes none, where the same typing left by a click writes "ab"`, () => {
    const all = typedThen('Esc');
    none([...leftFailures(), ...(all.length ? [`"ab" typed and Esc write ${entriesText(all)}, not nothing`] : [])], 'Esc in the field');
  }, TIMEOUT);
});
