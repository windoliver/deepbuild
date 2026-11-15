// AC7 #542.36e8999e: Typing "abc", then ⌘Z twice, then Enter writes "a", and the track holds no entry for the steps
// between
//
// Through `deep-show run` (README: The surface under test), on the text fixture with `name` (lines one): Tab focuses
// the field, "a", "b" and "c" are typed one at a time, Cmd+Z is pressed twice and Enter commits. Each input's `appended`
// is read, and the track itself from #539's `logic` call (the track the document's logic items read).
import { describe, expect, it } from 'vitest';
import { echoProgram } from './programs.ts';
import { textDoc } from './fixtures.ts';
import {
  AC, DOC, Script, TIMEOUT, appendedOf, binOf, entriesText, focusOf, logicOf, none, prebuild, presented, putEvidence, runShow, scenario, useTemp,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(7);
const NAME = { id: 'name', label: 'Name', maxBytes: 256, lines: 'one' as const };

describe(`${AC[7]} the field's undo stack is viewer state: only the commit reaches the track`, () => {
  it(`${AC[7]} typing "abc", then Cmd+Z twice, then Enter writes "a", and the track holds no entry for the steps between`, () => {
    const ev = temp();
    const echo = echoProgram();
    putEvidence(ev, echo.bytes);
    const s = new Script();
    s.present(D, textDoc('name-undo', echo, NAME));
    const tab = s.key('Tab');
    const between = [s.text('a'), s.text('b'), s.text('c'), s.key('z', ['cmd']), s.key('z', ['cmd'])];
    const enter = s.key('Enter');
    const logic = s.logic(D, 120);
    const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls), 'AC7 "abc", Cmd+Z twice, Enter');
    presented(r[0]!, 'the text fixture');
    expect(focusOf(r[tab]!, 'after Tab'), 'the fixture: Tab focuses the text control').toBe('name');

    const failures: string[] = [];
    const early = [tab, ...between].flatMap((i) => appendedOf(r[i]!, `input ${i}`));
    if (early.length) failures.push(`typing and Cmd+Z append ${entriesText(early)}; the steps between write nothing`);
    const committed = appendedOf(r[enter]!, 'Enter');
    const e = committed.length === 1 ? committed[0]! : null;
    if (!e || e['control'] !== 'name' || e['value'] !== 'a' || e['writer'] !== 'you') failures.push(`Enter appends ${entriesText(committed)}, not one entry "a" of name`);
    const track = logicOf(r[logic]!, 'the logic run').track.filter((x) => x['control'] === 'name');
    if (track.length !== 1 || track[0]!['value'] !== 'a' || (e && track[0]!['t'] !== e['t'])) failures.push(`the track holds ${entriesText(track)} of name, not the one entry "a" Enter wrote`);
    none(failures, '"abc", Cmd+Z twice, Enter');
  }, TIMEOUT);
});
