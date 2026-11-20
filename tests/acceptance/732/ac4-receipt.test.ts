// AC4 #732.9492d8fd: "The receipt lists every item that became a picture with why, and an export whose receipt lists fewer
// items than the slides' pictures hold fails"
//
// The four-stage piece exported to pptx. What becomes a picture comes from the issue's scope (README: what becomes a
// picture): there, the image `checker` on every stage and the noise-filled panel `grain_panel` from stage 2, where its
// opacity becomes 1. On each slide the receipt (`slides[k].pictures: [{items, why}]`) must list each of them in a picture
// whose `why` says something (a non-empty string, or a list of them), and list as many pictures as the slide holds
// (this suite's reader counts `p:pic` and picture-filled shapes). The planted writer `pptx_receipt_lists_fewer` writes
// every picture as the right writer does, but each slide's receipt entry leaves out the last item of its last picture:
// the judge fails, naming the item left out (or the export's own check refuses it, naming it). Wrong programs: a receipt
// with no `why`, one that lists only the first item of a picture, or one that misses a slide's pictures.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { Deck } from './ooxml.ts';
import {
  AC, DOC, FOUR, FULL, TIMEOUT, deckAt, deliveredOf, fourStages, namesItem, none, plantedFails, pptxExport, saysWhy, show, showRun, useShow, useTemp,
  type JsonObject, type Planted, type ReceiptSlide,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function exportFour(planted?: Planted): { reply: JsonObject | undefined; dir: string; out: string } {
  const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx');
  const [reply] = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [pptxExport(DOC.four, out)], 'the four-stage piece', planted);
  return { reply, dir, out };
}
/** The criterion's judge: each slide's receipt lists every item its pictures hold, each picture with why, one entry per
 * picture the slide holds. */
function judge(slides: ReceiptSlide[], deck: Deck): string[] {
  const failures: string[] = [];
  FOUR.stages.forEach((stage, k) => {
    const entry = slides[k];
    const n = k + 1;
    if (!entry) { failures.push(`slide ${n}: the receipt has no entry for it`); return; }
    const listed = entry.pictures.flatMap((p) => p.items);
    for (const id of FOUR.pictures[stage.marker] ?? []) if (!listed.includes(id)) failures.push(`slide ${n}: the receipt lists no picture holding \`${id}\`, which stage ${stage.marker} draws as a picture; it lists ${show(entry.pictures)}`);
    entry.pictures.forEach((p, j) => { if (!saysWhy(p.why)) failures.push(`slide ${n}: the receipt's picture ${j + 1} (${JSON.stringify(p.items)}) says no why: ${show(p.why ?? null)}`); });
    const held = deck.slides[k]?.shapes.filter((s) => s.kind === 'picture').length ?? 0;
    if (held !== entry.pictures.length) failures.push(`slide ${n}: the receipt lists ${entry.pictures.length} pictures, and the slide holds ${held}`);
  });
  return failures;
}

describe(`${AC[4]} the receipt lists every item that became a picture, with why`, () => {
  it(`${AC[4]} on each slide the receipt lists the image, and from slide 2 the noise panel, each in a picture with why, one entry per picture`, () => {
    const run = exportFour();
    const { slides } = deliveredOf(run.reply, "the four-stage piece's deck");
    none(judge(slides, deckAt(run.out, "the four-stage piece's deck")), 'the receipt against the slides');
  }, TIMEOUT);

  it(`${AC[4]} an export whose receipt lists fewer items than the slides' pictures hold fails, naming the item left out`, () => {
    const run = exportFour('pptx_receipt_lists_fewer');
    const what = 'the export from the planted writer';
    plantedFails(run.reply, run.dir, run.out, (deck) => judge(deliveredOf(run.reply, what).slides, deck),
      (s) => Object.values(FOUR.pictures).flat().some((id) => namesItem(s, id)), what);
  }, TIMEOUT);
});
