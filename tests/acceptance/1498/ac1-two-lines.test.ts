// AC1: a drag across two lines of one text copies the exact substring; a line mixing Arabic and Latin copies in
// logical order; a planted copy in drawn order fails, naming the offset (README, AC1).
import { describe, expect, it } from 'vitest';
import { carets, copyFailure, doc, graphemes, Replica, SESSION, TAG, textOf, useDrive } from './helpers.ts';

useDrive();

const NOTE = doc('note');
const TEXT = textOf(NOTE, 'dd-note');
// Two lines, mid-line at both ends: from "rose" on the first line to the end of "held" on the second.
const TWO_FROM = TEXT.indexOf('rose');
const TWO_TO = TEXT.indexOf('held') + 'held'.length;
// The third line whole: Latin, then an Arabic run drawn right to left, then Latin again.
const MIXED_FROM = TEXT.lastIndexOf('\n') + 1;
const MIXED_TO = TEXT.length;
const MIXED = TEXT.slice(MIXED_FROM, MIXED_TO);
const ARABIC_AT = MIXED.indexOf('ر');

/** A replica showing the note on its session's page. */
async function onNote(plant?: string): Promise<Replica> {
  const r = await Replica.launch(plant);
  await r.show(SESSION.note, NOTE);
  await r.openSession(SESSION.note);
  await r.visible({ item: 'dd-note' }, 'the note');
  return r;
}

/** Your ⌥-drag from grapheme `from` to grapheme `to` of the note, then your ⌘C: what the clipboard holds. */
async function copyRange(r: Replica, from: number, to: number, marker: string): Promise<string | null> {
  const at = await carets(r, 'dd-note', from, 'dd-note', to);
  await r.mark(marker);
  await r.drag(at.from, at.to, 'hid', ['alt']);
  return r.copy('hid', marker);
}

describe(`${TAG.ac1} AC1: two lines of one text, and a line mixing Arabic and Latin, copy in logical order`, () => {
  it('a drag across two lines then ⌘C gives the exact substring, and the mixed line copies in logical order', async () => {
    expect(graphemes(TEXT), 'the fixture holds one grapheme per string offset').toBe(TEXT.length);
    expect(TEXT.slice(TWO_FROM, TWO_TO).split('\n'), 'the fixture\'s range crosses exactly one line break').toHaveLength(2);
    expect(ARABIC_AT, 'the fixture\'s third line holds Arabic after Latin').toBeGreaterThan(0);
    const r = await onNote();
    const failures: string[] = [];
    const two = await copyRange(r, TWO_FROM, TWO_TO, 'dd1498-ac1-two-lines');
    const twoFailure = copyFailure(`⌥-drag from grapheme ${TWO_FROM} to ${TWO_TO} of the note, then ⌘C`, TEXT.slice(TWO_FROM, TWO_TO), two, TWO_FROM);
    if (twoFailure) failures.push(twoFailure);
    const mixed = await copyRange(r, MIXED_FROM, MIXED_TO, 'dd1498-ac1-mixed-line');
    const mixedFailure = copyFailure('⌥-drag across the line mixing Arabic and Latin, then ⌘C', MIXED, mixed, MIXED_FROM);
    if (mixedFailure) failures.push(mixedFailure);
    expect(failures).toEqual([]);
  });

  it('a planted copy in drawn order fails, naming the offset', async () => {
    const r = await onNote('copies-drawn-order');
    const copied = await copyRange(r, MIXED_FROM, MIXED_TO, 'dd1498-ac1-planted');
    const failure = copyFailure('⌥-drag across the line mixing Arabic and Latin, then ⌘C', MIXED, copied, MIXED_FROM);
    expect(failure, 'the judge fails the planted copy').not.toBeNull();
    expect(failure, 'the failure names the offset where the Arabic run starts, the first one drawn order changes').toContain(`at offset ${ARABIC_AT} `);
    expect([...(copied ?? '')].sort().join(''), 'the planted copy holds the line\'s graphemes, in another order').toBe([...MIXED].sort().join(''));
  });
});
