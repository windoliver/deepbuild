// AC4: a `sky@1` whose `environment.from` names a Radiance file in the evidence store renders back lit by it: its
// snapshot hash differs from the same document's with an all-black file of the same size in its place; with the file
// absent from the store, the reply carries `asset_missing` at `items/sky/params/environment/from` and nothing is
// presented as clean.
//
// Fixture: a 64 × 32 px flat Radiance HDR of linear radiance 1 everywhere and its all-black twin (helpers: WHITE_HDR,
// BLACK_HDR), each put into the store and listed in the document's `assets`; a sky of black gradient and no ambient
// light, so only its environment lights; a 1 m box in a grey physically based material on it. Render-back is the
// agent's deep_show with pixels, and the `render_back` call of each revision it made.
// Wrong programs: the base (deep_show's 3D frame evaluates with no asset store, so every environment named by hash
// draws as the renderer's black 2 × 1 fallback, with no issue); one that lights by the file but presents a missing
// one under black.
import { describe, it } from 'vitest';
import {
  ABSENT, AC, BLACK_HDR, DOC, WHITE_HDR, assetEntry, camera, errorIssues, material, none, payload, proof, refusalFailures, renderBackCall,
  requireMetal, runShow, scenario, seed, showCall, snapshotOf, sub, useBins, useDir, type Scene,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();

/** The box under a sky whose environment is the HDR `from` names. */
const litScene = (title: string, from: string): Scene => ({
  title,
  items: {
    cam: camera([0, 1.5, 5], [0, 0.5, 0]),
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from } } },
    clay: material({ base_color: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.5 }),
    block: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0.5, 0] }, material: 'clay' },
  },
  assets: { environment: assetEntry(from, 'image') },
});

describe(`${AC[4]} a sky@1 environment named by hash renders back lit by the file in the store`, () => {
  it(`${AC[4]} lit by the Radiance file, unlike its all-black twin; asset_missing at items/sky/params/environment/from when the store lacks it`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const lit = seed(store, WHITE_HDR());
    const black = seed(store, BLACK_HDR());
    const scenes = [litScene('Lit by its sky', lit), litScene('Under a black sky', black), litScene('Under a missing sky', ABSENT)];
    const docs = scenes.map((_, i) => DOC(i + 1));
    const replies = runShow(bins.show(), scenario(store, docs, [
      ...scenes.map((s, i) => showCall(docs[i]!, payload(s))),
      renderBackCall(docs[0]!, 1), renderBackCall(docs[1]!, 1),
    ]), 'a sky lit by an HDR, by a black one, and by a missing one');
    const failures: string[] = [];
    for (const i of [0, 1]) none(errorIssues(replies[i]!).map((x) => JSON.stringify(x)), `${scenes[i]!.title} is checked with no error issue`);
    for (const [surface, a, b] of [['deep_show', 0, 1], ['render_back', 3, 4]] as const) {
      const shaLit = snapshotOf(replies[a]!, store, `the lit sky's ${surface}`).sha;
      const shaBlack = snapshotOf(replies[b]!, store, `the black sky's ${surface}`).sha;
      proof(`${surface} snapshot hashes (lit, black)`, [shaLit, shaBlack]);
      if (shaLit === shaBlack) failures.push(`${surface}: the sky lit by the Radiance file ${lit.slice(0, 12)}… renders back as ${shaLit}, the same as with the all-black file in its place: items/sky/params/environment/from isn't read from the store`);
    }
    proof('the missing sky\'s reply', replies[2]!);
    failures.push(...refusalFailures(replies[2]!, 'asset_missing', 'items/sky/params/environment/from', 'sky', 'the render-back of a sky whose environment file the store lacks'));
    none(failures, 'the environment is read from the store, and a missing one is refused');
  }, 1_800_000);
});
