// AC5 #1992.597ff532: A document with no new field draws the castle fixture (`packs/examples/castle.json`) with the
// same pixel hash as the merge base on one machine. A planted default of `fog: true` on text dims the fixture's labels
// and fails, naming the first differing pixel.
//
// Two renderers draw on this machine in this run: this checkout's `deep-gpu`, and the merge base's, built from an
// export of that commit and shown by cargo's build messages to be compiled there (README: The merge base and how its
// build is shown to be its own). Each draws its own commit's castle, in its own look with its own pack, through
// `view3d` at the castle's size: the final target at the four quarter-turns of its orbit, frames 0, 180, 360 and 540
// at 30 fps (t = 0, 6, 12 and 18 s), each frame's `pixel_hash` and its PNG's pixels.
// The castle holds no label, so the tests add three to each commit's castle, with fields the base has (`mark.text@1`:
// `text`, `size`, `size_space: world`, `paint`): the guard would otherwise be blind to the wrong default the
// criterion names (README: Readings).
// The guard: the castle as committed names no field #1992 adds; drawn alone and with the labels (which name none
// either), every frame has the merge base's `pixel_hash` and no pixel differs.
// The planted program: the labelled castle with `fog: true` written on each label, what a default of `fog: true` on
// text draws, goes to the same judge against the merge base's labelled frames. The judge fails at every sampled
// frame, naming its first differing pixel, and each label is dimmed: its contrast against the sky behind it falls.
// Wrong programs: a renderer that changes any pixel of a castle that names no new field; a default of `fog: true` on
// text (the guard's labelled frames differ); `fog` on a text mark not read at all, as on the base (the planted
// program then draws what the merge base does, and the second test fails).
import { describe, expect, it } from 'vitest';
import { AC5, LABELS, REPO, castleOf, contrast, draw, judge, labelled, newFields, none, useRenderers, type Frame } from './helpers.ts';

const renderers = useRenderers();
type Doc = 'castle' | 'castle-labelled' | 'castle-labelled-fogged';
// Each document is drawn once by each renderer that draws it, and both tests read those frames.
const drawn = new Map<string, Frame[]>();
function frames(which: 'mine' | 'base', name: Doc): Frame[] {
  const key = `${which}/${name}`;
  let f = drawn.get(key);
  if (f === undefined) {
    const r = which === 'mine' ? renderers.mine() : renderers.base();
    const c = castleOf(r.root);
    f = draw(r, c, name, name === 'castle' ? c.doc : labelled(c.doc, name === 'castle-labelled-fogged' ? true : undefined), renderers.out());
    drawn.set(key, f);
  }
  return f;
}

describe(`${AC5} the castle keeps the merge base's pixels, and fogged labels don't`, () => {
  it(`${AC5} the castle as committed names no new field, and its frames at the four quarter-turns of its orbit, alone and with labels that name none either, have the merge base renderer's pixel hash on this machine with no pixel differing`, () => {
    const mine = castleOf(REPO);
    none(newFields(mine.doc), 'packs/examples/castle.json names no field #1992 adds, but it names');
    none(newFields(labelled(mine.doc)), 'the labelled castle names no field #1992 adds, but it names');

    // The fixture's own facts, read from the merge base's frames: each label is drawn at each sampled time, on the sky.
    const plain = frames('base', 'castle');
    const withLabels = frames('base', 'castle-labelled');
    expect(plain.map((f) => f.frame), 'the sampled frames are the castle\'s four quarter-turns').toEqual(mine.frames);
    const misplaced: string[] = [];
    for (const [k, f] of withLabels.entries()) for (const label of Object.keys(LABELS)) {
      const seen = contrast(label, f, f, plain[k]!);
      if (seen.pixels === 0) misplaced.push(`frame ${f.frame}: ${label} covers no pixel`);
      else if (!seen.onSky) misplaced.push(`frame ${f.frame}: ${label} covers a pixel where the castle as committed draws an item, not the sky`);
    }
    none(misplaced, 'each label is drawn against the sky at each sampled time');

    none([
      ...judge('the castle as committed', plain, frames('mine', 'castle')),
      ...judge('the castle with labels', withLabels, frames('mine', 'castle-labelled')),
    ], 'this checkout draws the castle with the merge base renderer\'s pixel hash, no pixel differing');
  });

  it(`${AC5} a planted default of fog: true on text, drawn as the labelled castle with fog: true written on each label, fails the same judge at every sampled frame, naming its first differing pixel, and dims each label against the sky behind it`, () => {
    const base = frames('base', 'castle-labelled');
    const planted = frames('mine', 'castle-labelled-fogged');
    const failures = judge('the castle with fog: true on its labels', base, planted);
    for (const line of failures) console.log(`${AC5} (planted): ${line}`);
    expect(failures.length, 'the planted fog: true on the castle\'s labels fails the guard\'s judge, but the judge found no differing pixel: this renderer draws the labels as the merge base does').toBeGreaterThan(0);
    for (const f of base) {
      expect(failures.some((line) => line.includes(`frame ${f.frame} (t = ${f.t})`) && /the first differing pixel is \(\d+, \d+\)/.test(line)),
        `the planted fog: true fails at frame ${f.frame}, naming its first differing pixel; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
    }

    const behind = frames('base', 'castle');
    const undimmed: string[] = [];
    for (const [k, f] of base.entries()) for (const label of Object.keys(LABELS)) {
      const before = contrast(label, f, f, behind[k]!);
      const after = contrast(label, f, planted[k]!, behind[k]!);
      const line = `frame ${f.frame}: ${label} (${before.pixels} px) stands ${before.contrast.toFixed(2)} codes a channel off the sky as the merge base draws it, ${after.contrast.toFixed(2)} with fog: true`;
      console.log(`${AC5} (planted): ${line}`);
      if (!(after.contrast < before.contrast)) undimmed.push(line);
    }
    none(undimmed, 'fog: true dims each label at each sampled time (its contrast against the sky behind it falls)');
  });
});
