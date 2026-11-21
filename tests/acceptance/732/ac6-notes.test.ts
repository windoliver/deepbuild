// AC6 #732.a31af211: "A stage's notes are the slide's speaker notes; a bound value shows as its text on the slide, with its
// source and as-of time in the notes"
//
// The four-stage piece exported to pptx with `pptx.notes: true`: each slide's speaker notes (its notes slide's body, read
// by this suite's reader) hold its stage's `notes` and no other stage's. The bound value `price_now` (the agent's reading
// 42, as of 2026-11-12T09:30:00Z) shows on every stage: each slide holds a text box saying its text, as `eval` says the
// frame draws it, and each slide's notes hold its source, the reading's handle, and its as-of time, written as the
// record's number (ms since the epoch) or as that date and time (README: readings). White space is collapsed before
// reading. Wrong programs: notes left out, put on the wrong slide or on every slide, drawn on the slide; a bound value
// written as a picture, or with no source or as-of time in the notes.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AS_OF, DOC, FOUR, FULL, READING, READING_VALUE, TIMEOUT, deckAt, deliveredOf, drawnTexts, fourStages, none, pptxExport, showRun, stageEval, useShow,
  useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
const asOf = new Date(AS_OF).toISOString();
/** The as-of time as the notes may write it: the record's number, or its date and time in UTC. */
const saysAsOf = (notes: string): boolean => notes.includes(String(AS_OF)) || new RegExp(`${asOf.slice(0, 10)}[T ]${asOf.slice(11, 16)}`).test(notes);

describe(`${AC[6]} each stage's notes are its slide's speaker notes; the bound value shows as its text with its source and as-of time in the notes`, () => {
  it(`${AC[6]} each slide's notes are its stage's, and the bound value's text is on each slide with its source and as-of time in the notes`, () => {
    const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx');
    const item = FOUR.bound.item;
    const replies = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [
      ...FOUR.stages.map((s) => stageEval(DOC.four, s.t, [item])),
      pptxExport(DOC.four, out, { notes: true }),
    ], 'the four-stage piece');
    const texts = FOUR.stages.map((s, k) => drawnTexts(replies[k], [item], `eval at stage ${s.marker}`).get(item)?.text);
    texts.forEach((t, k) => expect(t, `stage ${FOUR.stages[k]!.marker} draws the bound value's text, holding the reading ${READING_VALUE}`).toContain(String(READING_VALUE)));
    deliveredOf(replies[FOUR.stages.length], "the four-stage piece's deck");
    const deck = deckAt(out, "the four-stage piece's deck");
    expect(deck.slides.length, 'one slide per stage').toBe(FOUR.stages.length);
    const failures: string[] = [];
    deck.slides.forEach((slide, k) => {
      const n = k + 1;
      if (slide.notes === null) { failures.push(`slide ${n} has no notes slide`); return; }
      const notes = flat(slide.notes);
      FOUR.stages.forEach((s, j) => {
        const has = notes.includes(flat(s.notes));
        if (j === k && !has) failures.push(`slide ${n}'s notes lack stage ${s.marker}'s notes ${JSON.stringify(s.notes)}: they say ${JSON.stringify(notes.slice(0, 300))}`);
        if (j !== k && has) failures.push(`slide ${n}'s notes hold stage ${s.marker}'s notes`);
      });
      if (!slide.shapes.some((s) => s.kind === 'text' && s.text === texts[k])) failures.push(`slide ${n} has no text box saying the bound value's text ${JSON.stringify(texts[k])}`);
      if (!notes.includes(READING)) failures.push(`slide ${n}'s notes lack the bound value's source ${READING}`);
      if (!saysAsOf(notes)) failures.push(`slide ${n}'s notes lack the bound value's as-of time (${AS_OF}, ${asOf})`);
    });
    none(failures, "the slides' speaker notes and the bound value");
  }, TIMEOUT);
});
