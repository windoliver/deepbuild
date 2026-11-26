// #3033.88aca207: "With `waves` left as it is, #166's and #968's suites hash the same as on the merge base"
//
// Drawn on this machine's Metal GPU; without one the test reads BLOCKED, and on another machine than the one the merge
// base's hashes were read on, INCONCLUSIVE: a pixel hash holds on one machine. Never PASS either way.
//
// The fixtures (neighbours.ts): the water documents those two suites' tests hash, each with `waves` as that suite
// wrote it (a list of four waves, a wind, or absent), in every variant, look, size and frame their tests draw them at:
// #166's harbour of seek.test.ts, defaults.test.ts, foam.test.ts and taste.test.ts and the pond of mirror.test.ts, and
// #968's channel of channel.test.ts and the channel and river of taste.test.ts; 21 documents, 59 frames. One
// `deep-gpu run` draws them all, each frame opened by a seek at 30 fps, and reads each frame's `pixel_hash`, those
// suites' own measure, and for #166's pond the `reflection` target's hash, which its mirror test compares.
//
// The merge base's hashes are fixtures/base/unchanged.json: the file this test's own run on the unchanged base
// (c7dc0edc) kept, with the commit, the machine and the binary that made it (README: The merge base's readings). Every
// run keeps its own as target/acceptance/3033/unchanged.json before anything is judged. Each hash must equal the merge
// base's; a difference is a failure naming the document and the frame.
//
// This is a no-change criterion: it holds on the merge base by construction, and a change that leaves `waves`'s list
// and wind forms as they are keeps it. A wrong program is one whose four-wave water draws differently: a wind table
// read another way, a vertex stage or a normal that sums its four waves in another order or precision.
import { describe, expect, it } from 'vitest';
import { AC, type JsonObject, frameAt, framesOf, keep, mergeBase, none, obj, requireGpu, runGpu, str, useGpu, useOut, view3d, writeJson } from './helpers.ts';
import { neighbourFixtures } from './neighbours.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC[5]} water whose waves are left as they are draws as on the merge base`, () => {
  it(`${AC[5]} with waves left as it is, every water document #166's and #968's suites hash has the merge base's hash at every frame they hash`, () => {
    requireGpu();
    const dir = out();
    const asked = neighbourFixtures().flatMap((f) => {
      const doc = writeJson(dir, f.name.replace('/', '-'), f.doc);
      return f.frames.map((frame) => ({ f, frame, call: view3d({ doc, look: f.look, size: f.size, from: frame, frames: 1, fps: 30, ...(f.reflection ? { capture: [frame], targets: ['reflection'] } : {}) }) }));
    });
    const replies = runGpu(bin(), dir, asked.map((a) => a.call));
    const hashes: JsonObject = {};
    asked.forEach(({ f, frame }, i) => {
      const what = `${f.name} frame ${frame}`;
      const row = frameAt(framesOf(replies[i]!, what), frame, what);
      hashes[`${f.name}@${frame}`] = row.pixel_hash;
      if (f.reflection) hashes[`${f.name}@${frame} reflection`] = str(row.raw['reflection'], `${what}: its reflection target`);
    });
    console.log(`${AC[5]}: ${Object.keys(hashes).length} hashes of ${asked.length} frames of ${neighbourFixtures().length} documents; kept as ${keep('unchanged', { hashes })}`);

    const base = obj(mergeBase('unchanged')['hashes'], 'the merge base\'s hashes');
    expect(Object.keys(base).sort(), 'the merge base\'s reading holds these frames\' hashes and no other').toEqual(Object.keys(hashes).sort());
    const failures = Object.keys(hashes).flatMap((k) => (hashes[k] === base[k] ? [] : [`${k}: its hash ${String(hashes[k]).slice(0, 12)} differs from the merge base's ${String(base[k]).slice(0, 12)}`]));
    none(failures, 'each frame hashes the same as on the merge base');
  });
});
