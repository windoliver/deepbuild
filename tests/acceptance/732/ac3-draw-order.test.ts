// AC3 #732.c0dd433b: "A stage that draws a 3D inset, then a caption, then a pass over both exports as a picture, a text box
// and a picture in that order; a planted writer that flattens every non-native item into one background picture puts the
// caption under the pass and fails, naming the caption"
//
// The inset piece (helpers.ts `insetPiece`): one stage that draws a 3D display whose screen carries an inset (the 3D
// layer draws first), then the caption `wall_caption` (text), then the group `veil_pass` running the shipped blur pass
// over a translucent band that lies across both. Exported to pptx, its slide's pictures and text boxes in z-order (this
// suite's reader) must be exactly a picture, the caption's text box, and a picture whose box overlaps the caption's (the
// pass over it). The planted writer `pptx_flattens_behind_text` draws every non-native item of a slide into one picture
// behind every native shape and text box: the caption ends over the pass, and the judge fails, naming `wall_caption`; or
// the export's own check refuses it, naming the caption. Wrong programs: the inset and the pass in one picture, either
// left out, the caption drawn as part of a picture, or the pictures' order swapped around it.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { Deck, Shape } from './ooxml.ts';
import {
  AC, DOC, FULL, INSET, TIMEOUT, deckAt, deliveredOf, insetPiece, namesItem, none, plantedFails, pptxExport, showRun, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function exportInset(planted?: Planted): { reply: JsonObject | undefined; dir: string; out: string } {
  const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx');
  const [reply] = showRun(shows.bin(FULL), ev, [[DOC.inset, insetPiece(ev)]], [pptxExport(DOC.inset, out)], 'the inset piece', planted);
  return { reply, dir, out };
}
const overlaps = (a: Shape['box'], b: Shape['box']): boolean =>
  a !== null && b !== null && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
/** The criterion's judge: the slide's pictures and text boxes, in z-order, are a picture, the caption, a picture over it. */
function judge(deck: Deck): string[] {
  const slide = deck.slides[0];
  if (!slide || deck.slides.length !== 1) return [`the deck has ${deck.slides.length} slides, not the one stage's`];
  const drawn = slide.shapes.filter((s) => s.kind === 'picture' || s.kind === 'text');
  const order = drawn.map((s) => (s.kind === 'text' ? `text box ${JSON.stringify(s.text)}` : 'picture'));
  const at = drawn.findIndex((s) => s.kind === 'text' && s.text === INSET.captionText);
  const where = `slide 1: the caption \`${INSET.caption}\``;
  if (at < 0) return [`${where} has no text box; the slide's pictures and text boxes are ${JSON.stringify(order)}`];
  const failures: string[] = [];
  if (JSON.stringify(drawn.map((s) => s.kind)) !== JSON.stringify(['picture', 'text', 'picture'])) {
    failures.push(`${where}: the slide's pictures and text boxes are ${JSON.stringify(order)}, not a picture (the 3D inset), the caption and a picture (the pass)`);
  }
  if (!drawn.slice(at + 1).some((s) => s.kind === 'picture' && overlaps(s.box, drawn[at]!.box))) failures.push(`${where} has no picture over it: the pass drawn after it is under it or gone`);
  return failures;
}

describe(`${AC[3]} a 3D inset, a caption and a pass over both export as a picture, a text box and a picture, in that order`, () => {
  it(`${AC[3]} the stage exports as a picture, the caption's text box and a picture over it, in that order`, () => {
    const run = exportInset();
    deliveredOf(run.reply, "the inset piece's deck");
    none(judge(deckAt(run.out, "the inset piece's deck")), "the slide's z-order");
  }, TIMEOUT);

  it(`${AC[3]} a planted writer that flattens every non-native item into one background picture puts the caption over the pass and fails, naming the caption`, () => {
    const run = exportInset('pptx_flattens_behind_text');
    plantedFails(run.reply, run.dir, run.out, judge, (s) => namesItem(s, INSET.caption), 'the deck from the planted writer');
  }, TIMEOUT);
});
