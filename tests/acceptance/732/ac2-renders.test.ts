// AC2 #732.3c7fee5e: "Each slide, rendered by the pinned LibreOffice at 1920×1080, matches the stage's settled frame within
// the export.fidelity floor outside the text boxes' boxes; a planted writer that drops a picture fails, naming the first
// slide it shows on"
//
// The four-stage piece exported to pptx in one run with each stage's `still {marker}` export, its settled frame at
// 1920 × 1080. LibreOffice renders each slide at 1920 × 1080 (helpers.ts `renderSlides`), and each render is held to
// its stage's still on luma outside the slide's text boxes' boxes (each grown by 2 px, for anti-aliasing at their
// edges) by export.fidelity's floor at the default quality: PSNR-Y ≥ 40 dB or SSIM ≥ 0.98. Every slide's reading is
// logged. The planted writer `pptx_drops_picture` leaves out every picture that holds a noise fill: the panel
// `grain_panel` first shows at stage 2 (its opacity is 0 at stage 1), so the judge must pass slide 1 and its first failure must name
// slide 2; or the export's own check refuses it with an issue naming slide 2 and none naming slide 1. Wrong programs: a
// slide that drops, moves or recolours a picture or a shape, draws them over the text's place, renders at another size,
// or is another stage's frame.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Deck } from './ooxml.ts';
import {
  AC, DOC, FOUR, FULL, TIMEOUT, deckAt, deliveredOf, emuPerPx, fidelity, fourStages, grow, meets, namesSlide, plantedFails, pptxExport, renderSlides, show,
  showRun, shown, stillExport, stillOf, textBoxes, useShow, useTemp, type Image, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

interface Run { reply: JsonObject | undefined; stills: Image[]; dir: string; out: string }
function exportWithStills(planted?: Planted): Run {
  const ev = temp(); const dir = temp(); const frames = temp(); const out = join(dir, 'deck.pptx');
  const replies = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [
    pptxExport(DOC.four, out),
    ...FOUR.stages.map((s) => stillExport(DOC.four, join(frames, s.marker), s.marker)),
  ], 'the four-stage piece and its stages\' stills', planted);
  const stills = FOUR.stages.map((s, k) => {
    expect(replies[k + 1]?.['outcome'], `stage ${s.marker}'s still is exported: ${show(replies[k + 1], 800)}`).toBe('exported');
    return stillOf(join(frames, s.marker), `stage ${s.marker}'s still`);
  });
  return { reply: replies[0], stills, dir, out };
}
/** The criterion's judge: each slide's LibreOffice render against its stage's still, outside its text boxes. */
function judge(deck: Deck, stills: Image[], what: string): string[] {
  const failures: string[] = [];
  if (deck.slides.length !== FOUR.stages.length) failures.push(`the deck has ${deck.slides.length} slides, not one per stage (${FOUR.stages.length})`);
  const emu = emuPerPx(deck, what);
  const ns = deck.slides.slice(0, FOUR.stages.length).map((s) => s.n);
  const renders = renderSlides(deck, ns, what);
  for (const n of ns) {
    const f = fidelity(stills[n - 1]!, renders.get(n)!, textBoxes(deck.slides[n - 1]!.shapes, emu).map((b) => grow(b, 2)));
    console.log(`${what}: slide ${n} against stage ${FOUR.stages[n - 1]!.marker}'s settled frame, outside its text boxes: ${shown(f)}`);
    if (!meets(f)) failures.push(`slide ${n}: LibreOffice's render isn't stage ${FOUR.stages[n - 1]!.marker}'s settled frame outside the text boxes: ${shown(f)}`);
  }
  return failures;
}

describe(`${AC[2]} each slide, rendered by LibreOffice, matches its stage's settled frame outside the text boxes`, () => {
  it(`${AC[2]} each of the four slides, rendered at 1920 × 1080, meets the export.fidelity floor against its stage's still outside its text boxes`, () => {
    const run = exportWithStills();
    deliveredOf(run.reply, "the four-stage piece's deck");
    const failures = judge(deckAt(run.out, "the four-stage piece's deck"), run.stills, 'the deck');
    expect(failures, `the slides against the settled frames:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} a planted writer that drops the noise panel's picture fails, naming slide 2, the first slide it shows on`, () => {
    const run = exportWithStills('pptx_drops_picture');
    const what = 'the deck from the planted writer';
    if (run.reply?.['outcome'] === 'exported') {
      const failures = judge(deckAt(run.out, what), run.stills, what);
      expect(failures.length, `${what}: the judge fails it`).toBeGreaterThan(0);
      expect(failures.filter((f) => f.startsWith('slide 1:')), `${what}: slide 1, where the panel doesn't show, still passes`).toEqual([]);
      expect(failures[0], `${what}: the first failure names slide 2, the first slide the dropped picture shows on`).toMatch(/^slide 2:/);
      return;
    }
    const issues = Array.isArray(run.reply?.['issues']) ? run.reply['issues'] : [];
    plantedFails(run.reply, run.dir, run.out, () => [],
      (s) => namesSlide(s, 2, FOUR.stages) && !issues.some((i) => namesSlide(JSON.stringify(i), 1, FOUR.stages)), what);
  }, TIMEOUT);
});
