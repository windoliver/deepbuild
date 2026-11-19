// AC5 #1992.597ff532: A document with no new field draws the castle fixture (`packs/examples/castle.json`) with the
// same pixel hash as the merge base on one machine. A planted default of `fog: true` on text dims the fixture's
// labels and fails, naming the first differing pixel.
//
// Two renderers on this machine, in this run: the checkout's `deep-gpu`, and the merge base's own (`git merge-base
// HEAD origin/main`, read when the test runs), built once per merge base and kept as one binary with that commit's
// castle, look and pack (helpers: useMergeBase; README: The merge base). Each draws its own commit's castle as #422's
// suite does (`view3d` in `castle.look.json` with the composites pack, at the castle's size, 30 fps) and the final
// target of frames 0 and 15 is kept: the orbit's first frame and half a second on.
//   1. The guard. The checkout's castle names none of this issue's fields (helpers: newFields). Its two frames have
//      the merge base's pixel hashes: the renderer's own `pixel_hash` and the suite's SHA-256 of the decoded pixels,
//      with no differing pixel. The same holds for the castle with labels: two `mark.text@1` items in world size over
//      the keep and the east tower, written with the base's fields only (README: Readings, "the fixture's labels"),
//      added to each commit's castle. Fixture: the labels draw (the merge base's frame with them is 8 codes or more
//      off its frame without on 200 or more pixels), and the frames are no blank pair (32 or more colors).
//   2. The planted default, by a real field: the checkout draws the castle with labels with `fog: true` written on
//      both. The same judge against the merge base's frame fails, its failure naming the first differing pixel, and
//      the labels are what changed: half or more of the pixels the labels' ink draws differ.
// Wrong programs: a default that fogs text; a default that changes any fogged or unfogged pixel of an old document; a
// background scaled by default; a curve whose default moved off exp2; the base, for the plant (it reads no `fog`).
import { describe, expect, it } from 'vitest';
import {
  AC, LABELS, PIXEL, REPO, castleOf, differing, drawCastle, drawnBy, failsNaming, judgeSame, labelled, newFields, none, px, requireMetal, useBin, useDir, useMergeBase,
  type Drawn,
} from './helpers.ts';

const bin = useBin();
const base = useMergeBase();
const dir = useDir();
const colors = (d: Drawn): number => { const s = new Set<string>(); for (let y = 0; y < d.image.height; y += 3) for (let x = 0; x < d.image.width; x += 3) s.add(px(d.image, x, y).join()); return s.size; };
/** The merge base's frames of its castle, without and with the labels, drawn once for the file. */
let baseFrames: { plain: Drawn[]; labels: Drawn[] } | undefined;
function mergeBaseFrames(out: string): { plain: Drawn[]; labels: Drawn[] } {
  const b = base(); const theirs = castleOf(b.root);
  return (baseFrames ??= { plain: drawCastle(b.bin, out, theirs, theirs.doc, 'base-castle'), labels: drawCastle(b.bin, out, theirs, labelled(theirs.doc), 'base-castle-labels') });
}

describe(`${AC[5]} a document with no new field draws as the merge base draws it`, () => {
  it(`${AC[5]} the castle fixture, and the castle with labels, have the merge base's pixel hash on this machine`, () => {
    requireMetal();
    const out = dir();
    const b = base();
    const mine = castleOf(REPO);
    expect(newFields(mine.doc), 'the castle fixture names none of the new fields').toEqual([]);
    console.log(`${AC[5]}: the merge base is ${b.rev.slice(0, 12)}, its deep-gpu kept at ${b.bin}`);

    const { plain: plainBase, labels: labelsBase } = mergeBaseFrames(out);
    expect(Math.min(...plainBase.map(colors)), 'the merge base\'s frames are no blank frames: 32 or more colors').toBeGreaterThanOrEqual(32);
    none(judgeSame(drawCastle(bin(), out, mine, mine.doc, 'castle'), plainBase, 'the castle fixture'), 'the castle fixture has the merge base\'s pixel hash');

    expect(newFields(labelled(mine.doc)), 'the castle with labels names none of the new fields').toEqual([]);
    const drawn = labelsBase.map((f, i) => drawnBy(f.image, plainBase[i]!.image).size);
    expect(Math.min(...drawn), `the labels ${LABELS.join(' and ')} draw 200 or more pixels of ink in each frame (${drawn.join(', ')})`).toBeGreaterThanOrEqual(200);
    none(judgeSame(drawCastle(bin(), out, mine, labelled(mine.doc), 'castle-labels'), labelsBase, 'the castle with labels'), 'the castle with labels has the merge base\'s pixel hash');
  }, 4 * 3_600_000);

  it(`${AC[5]} a planted default of fog: true on text dims the fixture's labels and fails, naming the first differing pixel`, () => {
    requireMetal();
    const out = dir();
    const mine = castleOf(REPO);
    const { plain: plainBase, labels: labelsBase } = mergeBaseFrames(out);
    const planted = drawCastle(bin(), out, mine, labelled(mine.doc, true), 'castle-labels-fog-true');
    const failures = judgeSame(planted, labelsBase, 'the castle with the planted fog: true on its labels');
    failsNaming(failures, PIXEL, 'the planted default of fog: true on text');
    expect(failures.every((f) => f.includes('the first differing pixel is')), `each failure names the first differing pixel:\n  ${failures.join('\n  ')}`).toBe(true);
    // The labels are what changed: of the pixels the labels' ink draws (8 codes or more off the castle without
    // them; the bloom around a label moves a code or two over a wide halo), half or more differ.
    planted.forEach((p, i) => {
      const label = drawnBy(labelsBase[i]!.image, plainBase[i]!.image);
      const moved = differing(p.image, labelsBase[i]!.image).filter(([x, y]) => label.has(y * p.image.width + x)).length;
      console.log(`${AC[5]}: frame ${p.frame}: the planted fog changes ${moved} of the labels' ${label.size} ink pixels`);
      expect(label.size, `frame ${p.frame}: the labels' ink draws 200 or more pixels`).toBeGreaterThanOrEqual(200);
      expect(moved / label.size, `frame ${p.frame}: the planted fog changes half or more of the labels' ink`).toBeGreaterThanOrEqual(0.5);
    });
  }, 4 * 3_600_000);
});
