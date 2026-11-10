// Ported from Rapier, crates/rapier3d/tests/snapshot_portability.rs (snapshot_is_target_independent), at commit
// 3406750a38286a0d3c7d0f4be2f9d53153e81d90 of https://github.com/dimforge/rapier, licensed Apache-2.0 (the file is the
// same in the rapier3d 0.36.1 crate). No upstream code is copied: the scene and the assertion are re-expressed here on
// deep-physics's output (#136).
//
// Upstream steps a mixed scene (a box pile, an impulse-joint chain, a multibody chain, a sensor and a CCD ball) 60 steps
// and requires the whole world's bincode snapshot to be one committed size and FNV-1a digest on every target, wasm32
// included. Here the committed golden is ours, recorded on this Mac: the same scene as our world document (helpers:
// portabilityScene, its multibody chain left out), whose deep checkpoint at step 60 is the backend's whole-world bincode
// bytes. On wasm32 (`node scripts/physics-wasm32.mjs`) and on Linux x86_64 (the #1983 lane's pinned image as
// linux/amd64) a bake of the scene must give the golden's step hash at every step and, at step 60, this Mac's bytes
// exactly: the same size and the same bytes, naming the first byte that differs, and the deep hash the golden recorded.
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TIMEOUT, CRITERIA, LINUX_X86, WASM32, ask, bake, checkpointsOf, none, onLane, onWasm32, portabilityScene, portableFailures, prebuild,
  recordHere, referenceMac,
} from './helpers.ts';

prebuild();

const N = 60;

describe(`${CRITERIA[1]} ${CRITERIA[3]} Rapier's snapshot_portability, on deep-physics's output: a golden recorded on the Mac is reproduced on Linux x86_64 and in wasm32, whole-world bytes and all`, () => {
  it(`${CRITERIA[1]} ${CRITERIA[3]} snapshot_portability's mixed scene, baked ${N} steps in wasm32 and on Linux x86_64, gives the Mac's golden at every step hash and the Mac's whole-world bytes at step ${N}`, () => {
    referenceMac();
    const w = portabilityScene();
    const golden = recordHere(w, N, [LINUX_X86, WASM32]);
    const call = bake(w, N, { checkpoints: true, read: [] });
    const mac = checkpointsOf(ask([call], { where: 'this Mac' })[0]!, 'this Mac\'s bake');
    expect([...mac.keys()], `a deep checkpoint at step ${N}`).toEqual([N]);

    const [wasm] = onWasm32([call]);
    none(portableFailures(wasm!, golden, mac, 'wasm32'), 'in wasm32 the scene reproduces the Mac\'s golden and whole-world bytes');
    const [linux] = onLane('linux/amd64', [call]);
    none(portableFailures(linux!, golden, mac, 'Linux x86_64'), 'on Linux x86_64 the scene reproduces the Mac\'s golden and whole-world bytes');
  }, CONTAINER_TIMEOUT);
});
