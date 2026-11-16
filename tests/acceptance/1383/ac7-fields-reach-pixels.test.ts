// #1383.12eb8d92: "Each new field set away from its default changes at least one pixel of the fixture"
//
// Fixture (helpers: fixtureDoc with `defaults`; README: Fixtures): the fixture document with every field this issue adds
// at its default (no `projection`, so `auto`; no `where.aspect`; no `where.curvature`; no `modify`), drawn at 5 s
// (frame 20 at 4 frames a second) at 480 × 270 from each of its three shots. Then the same document with one field set
// away from its default, drawn from the shot that sees that field's plate:
// - `projection: uv` and `projection: triplanar` on the cliff's checker (the cliff: a 70° face, where `auto` samples
//   triplanar, on ground corrugated to 23°, where it samples uv0);
// - `where.aspect` (`{direction: 0, min: 0.4}`) and `where.curvature` (`{min: 0}`) on the massifs' second snow entry,
//   whose line then lies 120 m under the first's (the snow shot);
// - `modify: [{kind: wet, amount: 1}]` and `modify: [{kind: dust, amount: 1}]` on the field's soil (the field shot).
//
// Expected: each such frame differs from its shot's frame at the defaults in at least one pixel (its `pixel_hash` and its
// final target's pixels), and every frame compared passes #1399's guard, so a blank frame can't stand in for either.
// Catches: the base (no cover); a field that is read but changes nothing drawn.
import { describe, it } from 'vitest';
import {
  AC, SHOT_OF, TIMEOUT, blankness, checkerAsset, finalOf, fixtureDoc, framesOf, hashOf, none, requireMetal, runGpu, useGpu, useOut, view3d, writeJson,
  type FieldSet, type Image, type JsonObject, type Shot,
} from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 270];
const FRAME = 20;
const SHOTS: Shot[] = ['cliff', 'snow', 'field'];
const FIELDS = Object.keys(SHOT_OF) as FieldSet[];

describe(`${AC[7]} each new field set away from its default reaches a pixel of the fixture`, () => {
  it(`${AC[7]} projection uv and triplanar, where.aspect, where.curvature and modify wet and dust each change at least one pixel`, () => {
    requireMetal();
    const dir = out();
    const assets = checkerAsset(dir);
    const call = (name: string, doc: JsonObject): JsonObject => view3d({ doc: writeJson(dir, name, doc), size: SIZE, from: FRAME, capture: [FRAME], assets });
    const replies = runGpu(gpu(), dir, [
      ...SHOTS.map((shot) => call(`defaults-${shot}`, fixtureDoc({ shot, size: SIZE, defaults: true }))),
      ...FIELDS.map((set, i) => call(`set-${i}`, fixtureDoc({ shot: SHOT_OF[set], size: SIZE, defaults: true, set }))),
    ]);
    const frameOf = (k: number, what: string): { hash: string; im: Image } => {
      const f = framesOf(replies[k]!, what)[0]!;
      return { hash: hashOf(f, what), im: finalOf(dir, f, what) };
    };
    const failures: string[] = [];
    const base = new Map(SHOTS.map((shot, k) => [shot, frameOf(k, `the ${shot} shot at the defaults`)]));
    for (const [shot, f] of base) { const why = blankness(f.im); if (why) failures.push(`the ${shot} shot at the defaults is blank by #1399's guard: ${why}`); }
    FIELDS.forEach((set, i) => {
      const what = `the ${SHOT_OF[set]} shot with ${set}`;
      const f = frameOf(SHOTS.length + i, what);
      const ref = base.get(SHOT_OF[set])!;
      const why = blankness(f.im);
      if (why) failures.push(`${what} is blank by #1399's guard: ${why}`);
      let changed = 0;
      for (let p = 0; p < f.im.width * f.im.height; p++) if ([0, 1, 2].some((c) => f.im.rgba[4 * p + c] !== ref.im.rgba[4 * p + c])) changed++;
      console.log(`${AC[7]}: ${set}: ${changed} of ${f.im.width * f.im.height} pixels of the ${SHOT_OF[set]} shot change`);
      if (f.hash === ref.hash || changed === 0) failures.push(`${set}: the ${SHOT_OF[set]} shot's frame at 5 s is the defaults' (pixel hash ${f.hash}, ${changed} pixels differ)`);
    });
    none(failures, 'each new field set away from its default changes a pixel of the fixture');
  }, TIMEOUT);
});
