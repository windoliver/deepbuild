// AC5: a `mesh.sequence@1` whose asset is in the evidence store renders back with the item in `visible`; one whose
// asset hash isn't in the store is answered `asset_missing` at the item.
//
// Fixture: the sequence in the per-frame glTF form the base's `mesh.sequence@1` reads (#419's: `frames: [sha256]`,
// `frame_rate`), one frame, a JSON glTF of a 1 m box made here (helpers: boxGltf) and put into the store, in a grey
// material, drawn at t = 0; its twin names a hash no store holds. Render-back is the agent's deep_show with pixels.
// Wrong programs: the base (deep_show's 3D frame evaluates with no asset store and skips every `mesh.sequence@1`,
// with no issue); one that reads the frames but presents a missing one as nothing.
import { describe, it } from 'vitest';
import {
  ABSENT, AC, DOC, GREY_SKY, SUN, assetEntry, boxGltf, camera, errorIssues, material, none, payload, proof, refusalFailures, requireMetal,
  rowsOf, runShow, scenario, seed, showCall, snapshotOf, sub, useBins, useDir, visibleRows, type Scene,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();

/** A one-frame sequence `seq` whose frame is the file `sha` names. */
const sequenceScene = (title: string, sha: string): Scene => ({
  title,
  items: {
    cam: camera([0, 1.5, 5], [0, 0.5, 0]), sky: GREY_SKY, sun: SUN,
    clay: material({ base_color: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.5 }),
    seq: { kind: 'mesh.sequence@1', params: { frames: [sha], frame_rate: 24 }, at: { pos: [0, 0.5, 0] }, material: 'clay' },
  },
  assets: { seq: assetEntry(sha, 'mesh') },
});

describe(`${AC[5]} a mesh.sequence@1 reads its frames from the store`, () => {
  it(`${AC[5]} in visible when its asset is in the store; asset_missing at the item when it isn't`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const frame = seed(store, boxGltf([1, 1, 1]));
    const [held, missing] = runShow(bins.show(), scenario(store, [DOC(1), DOC(2)], [
      showCall(DOC(1), payload(sequenceScene('A sequence in the store', frame))),
      showCall(DOC(2), payload(sequenceScene('A sequence the store lacks', ABSENT))),
    ]), 'a sequence in the store and one it lacks');
    const failures: string[] = [];
    none(errorIssues(held!).map((x) => JSON.stringify(x)), 'the sequence in the store is checked with no error issue');
    snapshotOf(held!, store, 'the sequence in the store');
    const rows = visibleRows(held!, 'the sequence in the store');
    proof('the sequence in the store: visible', rows.map((r) => ({ id: r.id, box: r.box })));
    if (rowsOf(rows, 'seq').length === 0) failures.push(`the sequence whose asset is in the store renders back with nothing of seq in visible (rows: ${JSON.stringify(rows)})`);
    proof('the missing sequence\'s reply', missing!);
    failures.push(...refusalFailures(missing!, 'asset_missing', 'items/seq/', 'seq', 'the render-back of a sequence whose asset the store lacks'));
    none(failures, 'the sequence reads its frames from the store');
  }, 1_800_000);
});
