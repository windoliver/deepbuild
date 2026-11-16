// Ported from the upstream physics engine's crates/rapier3d/tests/parallel_path_parity.rs
// (parallel_and_sequential_builds_agree), at commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90, licensed Apache-2.0 (the
// file is the same in the rapier3d 0.36.1 crate). No upstream code is copied: the scene and the assertion are
// re-expressed here on our output, the web player's (#136).
//
// Upstream's contract: a native server build and a single-threaded wasm client built from the same source must agree
// bit for bit, so one golden hash of the broad phase, the narrow phase and every body's pose and velocity holds both,
// after a pile settles and sleeps (220 steps) and ten 12-box clusters drop onto it, one every 40 steps, with sideways
// kicks. Ours: the app's build on this Mac is the native side and its bake the golden; the web player, the canvas core
// built for wasm32 and run on one thread in headless Chrome, is the client. The scene (helpers.ts `parityDoc`) holds
// upstream's pile and clusters, each cluster released at upstream's step from a trapdoor with upstream's kick. The
// player must give the app's step hash at every step from 1 to 620, read through probe(), and the app's full-state hash
// (which covers the whole world, its contact state with it) at every checkpoint through 620, naming the first step
// that differs.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  CRITERION, DOC, FULL, PARITY_STEPS, TIMEOUT, bundleFailures, done, exportOnce, none, parityDoc, pinned, play, playerFailures, prebuildPhysics,
  useBrowsers, useShow, useTemp, webReceiptOf, worldRecord,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
prebuildPhysics();

describe(`${CRITERION} the upstream engine's parallel_path_parity, on the web player's output: the native app and the single-threaded wasm32 player agree bit for bit`, () => {
  it(`${CRITERION} the settling pile and ten kicked drops, played ${PARITY_STEPS} steps by the web player, give the app's step hash at every step and its full-state hash at every checkpoint`, async () => {
    pinned('parallel_path_parity');
    const evidence = temp();
    const { doc, track } = parityDoc(DOC.parity);
    const app = worldRecord(shows(FULL), evidence, doc, track, PARITY_STEPS, 'the parity scene');
    const out = join(temp(), 'bundle');
    const receipt = webReceiptOf(exportOnce(shows(FULL), evidence, doc, out, 'the parity scene exported to the web', { track }), 'the parity scene exported to the web');
    none(bundleFailures(out, receipt, 'its bundle'), 'the bundle holds every file its receipt names, by hash');
    const page = browsers(await play(out));
    await page.tab.mustBeReady('the parity scene');
    none(await playerFailures(page.tab, app, PARITY_STEPS, 'the web player'), 'the single-threaded web player agrees with the native app at every step and checkpoint');
    await done(page);
  }, TIMEOUT);
});
