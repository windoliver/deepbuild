// AC1 to AC3: a glTF model placed through deep_show, read from the evidence store by the hash the document's
// `assets` and the item's `sha256` name, renders back: in `visible`, at the box view3d's object-ID target gives it
// (AC1); the three sample models draw three different frames, none the empty frame (AC2); and a hash the store doesn't
// hold is answered `asset_missing` at the item's `sha256`, never skipped (AC3, with the planted
// `skips_missing_mesh_asset`, which must fail naming the item).
//
// Fixture: one scene per model (helpers: MODEL_CAMERA, GREY_SKY, SUN), the model placed by `sceneAsset` (its file's
// whole scene, drawn with its own materials) and listed in the document's `assets`. Render-back is the agent's
// deep_show with `include: ['issues', 'pixels']` through `deep-show run`, and, for AC2, the `render_back` call of the
// revision it made. view3d (AC1) draws the same items as a session document, its `assets` naming the same file.
// Wrong programs: the base (deep_show's 3D frame evaluates with no asset store and skips every `mesh.asset@1`); a
// render-back that skips an item whose file is missing (the planted program).
import { describe, expect, it } from 'vitest';
import {
  ABSENT, AC, DOC, GREY_SKY, LICENSES, MODEL_CAMERA, SIZE, SUN, assetEntry, errorIssues, file, frame0, idsBox, model, none, payload, proof,
  refusalFailures, renderBackCall, requireMetal, rowsOf, runGpu, runShow, scenario, sceneAsset, seed, sessionDoc, showCall, snapshotOf,
  sub, union, useBins, useDir, view3dCall, visibleRows, writeJson, type Model, type Planted, type Scene,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();

/** The scene of sample model `m` placed as item `id` by hash `sha`, listed in `assets` with its license; or of none. */
const modelScene = (title: string, id: string | null, sha: string, m: Model = 'Duck'): Scene => ({
  title,
  items: { cam: MODEL_CAMERA, sky: GREY_SKY, sun: SUN, ...(id ? { [id]: sceneAsset(sha) } : {}) },
  ...(id ? { assets: { [id]: assetEntry(sha, 'mesh', LICENSES[m]) } } : {}),
});

describe(`${AC[1]} the Duck renders back in visible, at view3d's object-ID box`, () => {
  it(`${AC[1]} the Duck's visible box is within 1 px of view3d's object-ID box for the same document, camera and size`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const out = sub(dir(), 'out');
    const bytes = model('Duck');
    const sha = seed(store, bytes);
    const scene = modelScene('Duck', 'duck', sha);
    const [shown] = runShow(bins.show(), scenario(store, [DOC(1)], [showCall(DOC(1), payload(scene))]), 'the Duck');
    none(errorIssues(shown!).map((i) => JSON.stringify(i)), 'the Duck document is checked with no error issue');
    snapshotOf(shown!, store, 'the Duck render-back');
    const rows = visibleRows(shown!, 'the Duck render-back');
    const mine = rowsOf(rows, 'duck');
    proof('the Duck render-back: visible', rows.map((r) => ({ id: r.id, box: r.box })));
    expect(mine.length, `the Duck render-back's visible lists duck (rows: ${JSON.stringify(rows)}): nothing of duck is drawn`).toBeGreaterThan(0);

    const f = file(out, bytes);
    const [viewed] = runGpu(bins.gpu(), out, [view3dCall(writeJson(out, 'duck', sessionDoc('duck-doc', scene)), { [f.sha]: f.path }, ['ids'])], 'view3d of the Duck');
    const ids = idsBox(out, frame0(viewed!, 'view3d of the Duck'), 'duck', 'view3d of the Duck');
    expect(ids, 'view3d draws duck: its object-ID target holds its pick').not.toBeNull();
    const back = union(mine.map((r) => r.box));
    proof('the Duck: render-back box vs view3d object-ID box [x0, y0, x1, y1] px', { render_back: back, view3d: ids });
    const off = back.map((v, k) => Math.abs(v - ids![k]!));
    expect(Math.max(...off), `duck's render-back box [${back.join(', ')}] is within 1 px of view3d's object-ID box [${ids!.join(', ')}] at ${SIZE.join(' × ')} px (edges off by ${off.map((v) => v.toFixed(2)).join(', ')})`).toBeLessThanOrEqual(1);
  }, 1_800_000);
});

describe(`${AC[2]} Box, Duck and BoxTextured give three different snapshot hashes`, () => {
  it(`${AC[2]} each model's render-back differs from the others' and from the empty frame's, on deep_show and on render_back`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const models: [Model, string][] = [['Box', 'box'], ['Duck', 'duck'], ['BoxTextured', 'textured']];
    const shas = models.map(([m]) => seed(store, model(m)));
    const scenes = [...models.map(([m, id], i) => modelScene(m === 'BoxTextured' ? 'Box textured' : m, id, shas[i]!, m)), modelScene('Nothing placed', null, '')];
    const docs = scenes.map((_, i) => DOC(i + 1));
    const replies = runShow(bins.show(), scenario(store, docs, [
      ...scenes.map((s, i) => showCall(docs[i]!, payload(s))),
      ...docs.map((d) => renderBackCall(d, 1)),
    ]), 'the three models and the empty scene');
    const failures: string[] = [];
    for (const [surface, offset] of [['deep_show', 0], ['render_back', scenes.length]] as const) {
      const hashes = scenes.map((s, i) => {
        const r = replies[offset + i]!;
        if (surface === 'deep_show') none(errorIssues(r).map((x) => JSON.stringify(x)), `${s.title} is checked with no error issue`);
        return snapshotOf(r, store, `${s.title}'s ${surface}`).sha;
      });
      proof(`${surface} snapshot hashes (Box, Duck, BoxTextured, empty)`, hashes);
      const empty = hashes[3]!;
      models.forEach(([m, id], i) => {
        if (hashes[i] === empty) failures.push(`${surface}: ${m}'s snapshot ${hashes[i]} is the empty frame's: nothing of ${id} is drawn`);
        for (let j = i + 1; j < models.length; j++) if (hashes[i] === hashes[j]) failures.push(`${surface}: ${m} and ${models[j]![0]} give the same snapshot ${hashes[i]}`);
      });
    }
    none(failures, 'three different snapshot hashes, none the empty frame\'s');
  }, 1_800_000);
});

/** AC3's check: the reply to a document whose `duck` names a hash the store doesn't hold; each failure names duck. */
function missingFailures(planted?: Planted): string[] {
  const store = sub(dir(), planted ? 'store-planted' : 'store');
  seed(store, model('Box'));
  const replies = runShow(bins.show(), scenario(store, [DOC(1)], [showCall(DOC(1), payload(modelScene('A missing model', 'duck', ABSENT)))], planted), 'a model whose hash the store lacks');
  proof(`a missing model's reply${planted ? ` (planted ${planted})` : ''}`, replies[0]!);
  return refusalFailures(replies[0]!, 'asset_missing', 'items/duck/params/sha256', 'duck', 'the render-back of a model whose hash the store lacks');
}

describe(`${AC[3]} a mesh.asset@1 whose hash isn't in the store is answered asset_missing at its sha256`, () => {
  it(`${AC[3]} asset_missing at items/duck/params/sha256, nothing presented as clean; the planted skips_missing_mesh_asset fails, naming duck`, () => {
    requireMetal();
    none(missingFailures(), 'the missing model is refused at its hash');
    const planted = missingFailures('skips_missing_mesh_asset');
    expect(planted.length, 'the planted render-back that skips the missing item fails this check').toBeGreaterThan(0);
    expect(planted.some((f) => f.includes('duck')), `the planted render-back's failure names duck: ${planted.join('; ')}`).toBe(true);
  }, 1_800_000);
});
