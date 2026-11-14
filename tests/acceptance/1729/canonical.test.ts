// AC6: the GPU layer's canonical render of the Duck document (the `live` call's `canonical` event, purpose
// `render_back`) has a pixel hash different from the same document without the item.
//
// Fixture: the Duck scene of models.test.ts (helpers: MODEL_CAMERA, GREY_SKY, SUN, sceneAsset), and the same scene
// without `duck`, each opened as a live session (#379) by its own writer; the call's `assets` names the Duck's file by
// hash, as view3d's does. At frame 2 a canonical event asks each session's render-back of frame 2 at 320 × 240 px.
// Wrong programs: the base (a canonical render evaluates through `Frames` with no asset reader and drops the call's
// `assets`, so the Duck isn't drawn and both hashes are the empty frame's).
import { describe, expect, it } from 'vitest';
import {
  AC, GREY_SKY, LICENSES, MODEL_CAMERA, OTHER_WRITER, SIZE, SUN, WRITER, assetEntry, canonicalHash, file, liveCall, model, payload, proof, requireMetal,
  runGpu, sceneAsset, sub, useBins, useDir, writeJson,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();
const AT = 2;

describe(`${AC[6]} the GPU layer's canonical render_back draws the Duck`, () => {
  it(`${AC[6]} the live call's canonical render of the Duck document differs from the same document without the item`, () => {
    requireMetal();
    const out = sub(dir(), 'out');
    const f = file(out, model('Duck'));
    const items = { cam: MODEL_CAMERA, sky: GREY_SKY, sun: SUN };
    const withDuck = writeJson(out, 'duck', payload({ title: 'Duck', items: { ...items, duck: sceneAsset(f.sha) }, assets: { duck: assetEntry(f.sha, 'mesh', LICENSES.Duck) } }));
    const without = writeJson(out, 'empty', payload({ title: 'Nothing placed', items }));
    const sessions = [{ session: 's-duck', writer: WRITER, doc: withDuck, size: SIZE }, { session: 's-empty', writer: OTHER_WRITER, doc: without, size: SIZE }];
    const events = sessions.map((s) => ({ frame: AT, canonical: { session: s.session, purpose: 'render_back', frame: AT, size: SIZE } }));
    const [reply] = runGpu(bins.gpu(), out, [liveCall(AT + 1, sessions, events, { [f.sha]: f.path })], 'live sessions of the Duck and of the empty scene');
    const duck = canonicalHash(reply!, 's-duck', 'the live call');
    const empty = canonicalHash(reply!, 's-empty', 'the live call');
    proof('canonical render_back pixel hashes (Duck, without the item)', [duck, empty]);
    expect(duck, `the canonical render_back of the Duck document has the pixel hash of the same document without duck (${empty}): duck isn't drawn`).not.toBe(empty);
  }, 1_800_000);
});
