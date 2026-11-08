// AC3 #427.dff2871f: Lights and cameras, bounds and the UV checker draw no status color and leave the document's
// revision and the live view's frame count unchanged, and a claim that cites one of their snapshots as evidence is
// refused, naming the snapshot.
//
// helpers.ts `quietProblems`: `deep-show run` draws the three modes (no pixel of a snapshot within 2 per channel of the
// clean look's pass, fail, invalid or running color); `deep-show live`, with the app showing the scene at revision 1,
// draws them again between two `presented` reads (the revision the window shows, its frames presented, its frame
// callbacks and its meter rung the same after as before, each reply at rev 1); and a claim whose three requirements
// each cite one snapshot (`{kind: render.contrast, snapshot}`, #464's form) gets a `verdict` whose rows are not PASS and
// each carry `display_only` with the snapshot's hash. The scene paints in grey roles only, so a status color in a
// snapshot can only come from the mode. At the base no 3D mode draws (module_missing), and #411's bounds snapshot
// isn't held as display only, so a claim citing it isn't refused.
import { describe, it } from 'vitest';
import { AC, box, camera, gltf, meshAsset, mode, none, plate, quietProblems, requireMetal, scene, seed, sun, useBuilds, useDir } from './helpers.ts';

const ID = AC[3];
const bin = useBuilds(['deep-show']);
const dir = useDir();

describe(`${ID} lights and cameras, bounds and the UV checker are display only and touch nothing`, () => {
  it(`${ID} no status color, the revision and the live view's frames, callbacks and rung unchanged, and a claim citing a snapshot refused naming it`, () => {
    requireMetal();
    const evidence = dir();
    const plateSha = seed(evidence, gltf(plate(2, 1, 2, 1)));
    const doc = scene('Quiet modes', {
      cam: camera([0, 0, 0], 10),
      cube: box([0, 0, 0]),
      spot: { kind: 'light.spot@1', params: { power: 800, inner: 15, outer: 30 }, at: { pos: [0, 2, 0], rot: [-90, 0, 0] } },
      plate: meshAsset(plateSha, [0, -2, 0]),
      key: sun(),
    });
    none(quietProblems(bin, evidence, doc, ['lights_cameras', 'bounds', 'uv_checker'].map((m) => mode(m))), 'the three modes');
  }, 1_800_000);
});
