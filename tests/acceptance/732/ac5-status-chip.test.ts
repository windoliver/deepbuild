// AC5 #732.35428855: "A stage with a status chip exports the chip as a picture showing its glyph, and no editable shape on
// any slide carries a status color; a planted writer that writes the chip as a native shape fails, naming it"
//
// The status piece (helpers.ts `chipPiece`): one stage, a panel with its label, and the chip `gate_chip`, a rect whose
// fill is bound to the failed verdict in the agent's record, which the frame draws in the clean look's fail colour with
// its glyph and word (and the legend). Exported to pptx: the receipt lists `gate_chip` in a picture of the slide, with
// why; no editable shape on any slide (a text box, or any shape that isn't a picture) carries one of the look's nine
// status colours anywhere in it, fill, line, text or effect (within two code values); and in LibreOffice's render of
// the slide the chip's box shows its glyph: glyph ink there (luma at least 96 above the fail colour's) at least half the
// settled frame's, its centre within 4 px of the frame's (the frame's chip holds 20 px of ink or more). The planted
// writer `pptx_chip_as_shape` writes each status-bound item as a native shape in its status colour, its glyph as text:
// the shape check fails, naming `gate_chip` (or the export's own check refuses it, naming the chip). Wrong programs: the
// chip as a native shape, a picture of the chip without its glyph, a legend or a text run in a status colour.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Deck } from './ooxml.ts';
import {
  AC, CHIP, DOC, FULL, TIMEOUT, deckAt, deliveredOf, chipPiece, inkIn, namesItem, none, plantedFails, pptxExport, renderSlides, saysWhy, show, showRun,
  statusColorsOf, stillExport, stillOf, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function exportChip(planted?: Planted): { reply: JsonObject | undefined; still: JsonObject | undefined; frames: string; dir: string; out: string } {
  const ev = temp(); const dir = temp(); const frames = temp(); const out = join(dir, 'deck.pptx');
  const [reply, still] = showRun(shows.bin(FULL), ev, [[DOC.chip, chipPiece(ev)]], [
    pptxExport(DOC.chip, out), stillExport(DOC.chip, join(frames, CHIP.stage.marker), CHIP.stage.marker),
  ], 'the status piece', planted);
  return { reply, still, frames, dir, out };
}
/** No editable shape on any slide carries a status colour; each one that does is named as the chip, the only item a
 * status colour may come from here. */
function shapeFailures(deck: Deck): string[] {
  return deck.slides.flatMap((slide) => slide.shapes.filter((s) => s.kind !== 'picture').flatMap((s) => {
    const status = statusColorsOf(s);
    return status.length ? [`slide ${slide.n}: the editable ${s.kind === 'text' ? 'text box' : 'shape'} ${JSON.stringify(s.name)} carries the status colour ${status.join(', ')}, which only the status chip \`${CHIP.item}\` takes`] : [];
  }));
}

describe(`${AC[5]} the status chip exports as a picture with its glyph, and no editable shape carries a status colour`, () => {
  it(`${AC[5]} the chip is a picture with why, showing its glyph in LibreOffice's render, and no editable shape carries a status colour`, () => {
    const run = exportChip();
    const { slides } = deliveredOf(run.reply, "the status piece's deck");
    const failures: string[] = [];
    const pictures = slides[0]?.pictures ?? [];
    const chip = pictures.find((p) => p.items.includes(CHIP.item));
    if (!chip) failures.push(`slide 1: the receipt lists no picture holding the chip \`${CHIP.item}\`: ${show(pictures)}`);
    else if (!saysWhy(chip.why)) failures.push(`slide 1: the chip's picture says no why: ${show(chip.why ?? null)}`);
    const deck = deckAt(run.out, "the status piece's deck");
    failures.push(...shapeFailures(deck));
    expect(run.still?.['outcome'], `the stage's still is exported: ${show(run.still, 600)}`).toBe('exported');
    const frame = inkIn(stillOf(join(run.frames, CHIP.stage.marker), "the stage's still"), CHIP.box, 'fail');
    expect(frame.count, "the settled frame's chip shows its glyph (20 px of ink or more)").toBeGreaterThanOrEqual(20);
    const render = inkIn(renderSlides(deck, [1], "the status piece's deck").get(1)!, CHIP.box, 'fail');
    console.log(`${AC[5]}: glyph ink in the chip's box: ${render.count} px at (${render.at.map((v) => v.toFixed(1)).join(', ')}) rendered, ${frame.count} px at (${frame.at.map((v) => v.toFixed(1)).join(', ')}) in the frame`);
    if (render.count < frame.count / 2 || Math.hypot(render.at[0] - frame.at[0], render.at[1] - frame.at[1]) > 4) {
      failures.push(`slide 1: the chip \`${CHIP.item}\` doesn't show its glyph: ${render.count} px of glyph ink in its box, centred at (${render.at.join(', ')}), where the frame has ${frame.count} px at (${frame.at.join(', ')})`);
    }
    none(failures, 'the status chip in the deck');
  }, TIMEOUT);

  it(`${AC[5]} a planted writer that writes the chip as a native shape fails, naming the chip`, () => {
    const run = exportChip('pptx_chip_as_shape');
    plantedFails(run.reply, run.dir, run.out, shapeFailures, (s) => namesItem(s, CHIP.item), 'the deck from the planted writer');
  }, TIMEOUT);
});
