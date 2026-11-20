// AC7 #732.87ae4836: "Editing a title's string with the independent reader and rendering the slide again shows the new
// string in place, with the slide's other pixels unchanged outside the title's box"
//
// The four-stage piece and its twin, the same piece whose title says FOUR.edited ("Tide Stone", the title's letters in
// another order, so no embedded face needs a glyph the deck lacks), exported in one run. This suite's reader edits the
// title's text box on slide 1 to say FOUR.edited (ooxml.ts `withText`: only the string changes), and LibreOffice renders
// slide 1 of the deck, of the edited deck and of the twin's deck. Outside the title's box (its text box's box, grown by
// 1 px for the box's own rounding to pixels) every pixel of the edited render equals the original's; inside it the
// edited render differs from the original (100 px or more) and matches the twin's, which shows the new string set in
// place as the writer sets it, within export.fidelity's floor. Wrong programs: a title that is also drawn into a picture
// under its text box (the old string still shows), a text box that moves or re-wraps when its string changes, a slide
// whose other pixels depend on the title's string.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeck, withText } from './ooxml.ts';
import {
  AC, DOC, FOUR, FULL, TIMEOUT, deckAt, deliveredOf, differing, emuPerPx, fidelity, fourStages, grow, meets, pptxExport, pxBox, renderSlides, showRun, shown, useShow,
  useTemp, type Image,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

describe(`${AC[7]} a title edited with the independent reader renders with the new string in place and nothing else changed`, () => {
  it(`${AC[7]} slide 1 with its title's string edited renders the new string in the title's box, as the writer sets it, and every other pixel as before`, () => {
    const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx'); const twinOut = join(dir, 'twin.pptx');
    const [reply, twinReply] = showRun(shows.bin(FULL), ev, [
      [DOC.four, fourStages(ev)], [DOC.twin, fourStages(ev, { id: 'four-stages-twin', title: FOUR.edited })],
    ], [pptxExport(DOC.four, out), pptxExport(DOC.twin, twinOut)], 'the four-stage piece and its twin');
    deliveredOf(reply, "the four-stage piece's deck");
    deliveredOf(twinReply, "the twin's deck");
    const deck = deckAt(out, "the four-stage piece's deck");
    const twin = deckAt(twinOut, "the twin's deck");
    const title = deck.slides[0]?.shapes.find((s) => s.kind === 'text' && s.text === FOUR.title);
    expect(title?.box, `slide 1 holds a text box saying ${JSON.stringify(FOUR.title)} with a box of its own`).toBeTruthy();
    const edited = readDeck(withText(deck, 1, FOUR.title, FOUR.edited));
    expect(edited.slides[0]?.shapes.some((s) => s.kind === 'text' && s.text === FOUR.edited), 'the reader reads the edited title back').toBe(true);
    const box = grow(pxBox(title!.box!, emuPerPx(deck, 'the deck')), 1);
    const [before, after, made] = ([[deck, 'the deck'], [edited, 'the edited deck'], [twin, "the twin's deck"]] as const).map(([d, what]) => renderSlides(d, [1], what).get(1)!) as [Image, Image, Image];
    const outside = differing(before, after, box, false);
    const inside = differing(before, after, box, true);
    const set = fidelity(made, after, [], box);
    console.log(`${AC[7]}: outside the title's box ${outside} px changed; inside it ${inside} px changed; against the twin inside it: ${shown(set)}`);
    expect(outside, "every pixel outside the title's box is unchanged by the edit").toBe(0);
    expect(inside, "the edit changes the title's box (the old string no longer shows)").toBeGreaterThanOrEqual(100);
    expect(meets(set), `inside the title's box the edited slide shows the new string as the writer sets it: ${shown(set)}`).toBe(true);
  }, TIMEOUT);
});
