// Ported from the upstream physics engine's crates/rapier3d/tests/snapshot_portability.rs
// (snapshot_is_target_independent), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90, licensed Apache-2.0 (the file
// is the same in the rapier3d 0.36.1 crate). No upstream code is copied: the scene and the assertion are re-expressed
// here on our output, the web player's (#136).
//
// Upstream steps a mixed scene (a box pile, an impulse-joint chain, a multibody chain, a sensor and a CCD ball) 60 steps
// and requires the whole world's snapshot to be one committed size and digest on every target, wasm32 included. Here
// the committed golden is the app's on this Mac: the same scene as #2012's Oracle lane writes it (its multibody chain
// left out), as the world `lab` of a scene, baked by deep-show and deep-physics. Exported to the web and played in
// headless Chrome on WebGPU, the player (the canvas core built for wasm32, on one thread) must give the app's step hash
// at every step from 1 to 60, read through probe(), and at step 60 the full-state hash of the app's checkpoint there
// (the hash over the whole world's bytes), naming the first step that differs.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  CRITERION, DOC, FULL, PORTABILITY_STEPS, TIMEOUT, bundleFailures, done, exportOnce, none, pinned, play, playerFailures, portabilityDoc,
  prebuildPhysics, useBrowsers, useShow, useTemp, webReceiptOf, worldRecord,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
prebuildPhysics();

describe(`${CRITERION} the upstream engine's snapshot_portability, on the web player's output: the app's golden reproduced in wasm32 in Chrome`, () => {
  it(`${CRITERION} snapshot_portability's mixed scene, played ${PORTABILITY_STEPS} steps by the web player, gives the app's step hash at every step and its full-state hash at step ${PORTABILITY_STEPS}`, async () => {
    pinned('snapshot_portability');
    const evidence = temp();
    const document = portabilityDoc(DOC.portability);
    const app = worldRecord(shows(FULL), evidence, document, [], PORTABILITY_STEPS, 'the portability scene');
    const out = join(temp(), 'bundle');
    const receipt = webReceiptOf(exportOnce(shows(FULL), evidence, document, out, 'the portability scene exported to the web'), 'the portability scene exported to the web');
    none(bundleFailures(out, receipt, 'its bundle'), 'the bundle holds every file its receipt names, by hash');
    const page = browsers(await play(out));
    await page.tab.mustBeReady('the portability scene');
    none(await playerFailures(page.tab, app, PORTABILITY_STEPS, 'the web player'), 'the web player reproduces the app\'s golden at every step and its whole world at step 60');
    await done(page);
  }, TIMEOUT);
});
