// Ported from Rapier, crates/rapier3d/tests/simd_backend_determinism.rs (golden_state_hash_is_backend_independent), at
// commit 3406750a38286a0d3c7d0f4be2f9d53153e81d90 of https://github.com/dimforge/rapier, licensed Apache-2.0 (the file
// is the same in the rapier3d 0.36.1 crate). No upstream code is copied: the scene and the assertion are re-expressed
// here on deep-physics's output (#136).
//
// Upstream steps a 432-box pile and a four-ball joint chain 120 steps and requires one committed hash of every body's
// pose and velocity bits on every target, whichever SIMD intrinsics `wide` picks there: NEON on this Mac, SSE2 on
// x86_64, its scalar fallback on wasm32 without simd128. Here the committed golden is ours, recorded on this Mac: the
// same scene as our world document (helpers: simdScene). On wasm32 and on Linux x86_64 a bake of the scene must give the
// golden's step hash, which hashes every body's pose and velocity bits, at every step, and this Mac's whole-world bytes
// and the golden's deep hash at each checkpoint (60 and 120).
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TIMEOUT, CRITERIA, LINUX_X86, WASM32, ask, bake, checkpointsOf, none, onLane, onWasm32, portableFailures, prebuild, recordHere,
  referenceMac, simdScene,
} from './helpers.ts';

prebuild();

const N = 120;

describe(`${CRITERIA[1]} ${CRITERIA[3]} Rapier's simd_backend_determinism, on deep-physics's output: the state doesn't depend on the SIMD backend`, () => {
  it(`${CRITERIA[1]} ${CRITERIA[3]} simd_backend_determinism's pile and chain, baked ${N} steps in wasm32 and on Linux x86_64, gives the Mac's golden at every step hash and the Mac's whole-world bytes at each checkpoint`, () => {
    referenceMac();
    const w = simdScene();
    const golden = recordHere(w, N, [LINUX_X86, WASM32]);
    const call = bake(w, N, { checkpoints: true, read: [] });
    const mac = checkpointsOf(ask([call], { where: 'this Mac' })[0]!, 'this Mac\'s bake');
    expect([...mac.keys()], 'a deep checkpoint every 60 steps').toEqual([60, 120]);

    const [wasm] = onWasm32([call]);
    none(portableFailures(wasm!, golden, mac, 'wasm32'), 'in wasm32 the scene reproduces the Mac\'s golden and whole-world bytes');
    const [linux] = onLane('linux/amd64', [call]);
    none(portableFailures(linux!, golden, mac, 'Linux x86_64'), 'on Linux x86_64 the scene reproduces the Mac\'s golden and whole-world bytes');
  }, CONTAINER_TIMEOUT);
});
