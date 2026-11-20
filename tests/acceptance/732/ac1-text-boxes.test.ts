// AC1 #732.d05596c6: "A piece with four stages exports to four slides in stage order, and the independent reader finds
// on each slide one text box per text item, with the item's string, font family, size, weight and role color, its box
// within 0.5 pt of the evaluated box; a planted writer that turns a title into a picture fails, naming the item and the
// slide"
//
// The four-stage piece (helpers.ts `fourStages`) exported to pptx; `eval` at each stage's time gives the texts its frame
// draws (the title, the lede and the bound value) with their evaluated positions, boxes, sizes and weights; this
// suite's reader (ooxml.ts) reads the file. Four slides, the receipt's in stage order (s1 … s4), and on slide k one text
// box per text item stage k draws: its string; its box (`a:xfrm`) within 0.5 pt of the evaluated box on every edge (a
// document unit is a slide pixel; EMU per pixel is p:sldSz's width over 1920); each grapheme's run in its look role's
// family, its size in points, bold for weight 600 and over, in its role's colour; and no other text box. The title
// moves at each stage, so its box also tells the slides' order. The planted writer `pptx_title_as_picture` writes the
// first text item of each slide (the title, `tide_title`) as a picture: the same judge fails it, naming `tide_title` and
// a slide, or the export's own check refuses it, naming both. Wrong programs: slides out of order or one per frame, text drawn as
// outlines or pictures, a box in another unit or place, a run in the face's file name, at the frame's px as points,
// weight lost, a colour from the wrong role.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Deck } from './ooxml.ts';
import {
  AC, DOC, FOUR, FOUR_TEXTS, FULL, TIMEOUT, deckAt, deliveredOf, drawnTexts, emuPerPx, fourStages, isStage, namesItem, namesSlide, none, plantedFails,
  pptxExport, showRun, stageEval, textBoxFailures, useShow, useTemp, type Drawn, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const IDS = FOUR_TEXTS.map((t) => t.id);

interface Run { reply: JsonObject | undefined; drawn: Map<string, Drawn>[]; dir: string; out: string }
function exportFour(planted?: Planted): Run {
  const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx');
  const replies = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [
    ...FOUR.stages.map((s) => stageEval(DOC.four, s.t, IDS)),
    pptxExport(DOC.four, out),
  ], 'the four-stage piece', planted);
  const drawn = FOUR.stages.map((s, k) => drawnTexts(replies[k], IDS, `eval at stage ${s.marker}`));
  return { reply: replies[FOUR.stages.length], drawn, dir, out };
}
/** The criterion's judge: four slides, each holding one text box per text item its stage draws, as it draws it. */
function judge(deck: Deck, drawn: Map<string, Drawn>[]): string[] {
  const failures: string[] = [];
  if (deck.slides.length !== FOUR.stages.length) failures.push(`the deck has ${deck.slides.length} slides, not one per stage (${FOUR.stages.length})`);
  const emu = emuPerPx(deck, 'the deck');
  FOUR.stages.forEach((_, k) => {
    const slide = deck.slides[k];
    if (slide) failures.push(...textBoxFailures(k + 1, slide.shapes, drawn[k]!, FOUR_TEXTS, emu));
  });
  return failures;
}

describe(`${AC[1]} four stages to four slides in order, each text item a text box with its string, face, size, weight, colour and box`, () => {
  it(`${AC[1]} the four-stage piece exports to four slides in stage order, each holding one text box per text item as its stage draws it`, () => {
    const run = exportFour();
    FOUR.stages.forEach((s, k) => expect([...run.drawn[k]!.keys()].sort(), `stage ${s.marker} draws the title, the lede and the bound value`).toEqual([...IDS].sort()));
    const { slides } = deliveredOf(run.reply, "the four-stage piece's deck");
    expect(slides.length, 'the receipt lists one slide per stage').toBe(FOUR.stages.length);
    slides.forEach((s, k) => expect(isStage(s.stage, FOUR.stages[k]!.marker, k + 1), `the receipt's slide ${k + 1} is stage ${FOUR.stages[k]!.marker}, got ${JSON.stringify(s.stage)}`).toBe(true));
    none(judge(deckAt(run.out, "the four-stage piece's deck"), run.drawn), 'the text boxes, read back by the independent reader');
  }, TIMEOUT);

  it(`${AC[1]} a planted writer that turns the title into a picture fails, naming the item and the slide`, () => {
    const run = exportFour('pptx_title_as_picture');
    plantedFails(run.reply, run.dir, run.out, (deck) => judge(deck, run.drawn),
      (s) => namesItem(s, FOUR_TEXTS[0]!.id) && FOUR.stages.some((_, k) => namesSlide(s, k + 1, FOUR.stages)), 'the deck from the planted writer');
  }, TIMEOUT);
});
