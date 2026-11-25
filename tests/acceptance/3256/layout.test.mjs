// #3256 criteria 1 to 6: a struct the renderer writes and a shader reads has one layout.
// Run: node --test tests/acceptance/3256/layout.test.mjs   (README.md beside this file)
//
// Every test judges one run of the three crates' unit lanes, the lane's tests alone, as cargo runs them:
//   cargo test --locked -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render --lib --bins --tests --no-fail-fast -- shader_layout --show-output
// read as the lanes read cargo (scripts/lanes.mjs, cargoResults), with the lines the lane prints and each failed
// test's own message taken from the same output (helpers.mjs, read). A test passes where the shipped pairs agree and
// the lane says so. On a wrong program its criterion names (README.md: The wrong programs) it fails, and its failure
// carries the lane's own message, which it first holds to what the criterion says that message names. At the base no
// test of the three crates has shader_layout in its name, and each test fails on that.
import test from 'node:test';
import { MINUTE, declarations, hostStructs, judgeAo, judgeCoverage, judgeFrame, judgeListing, judgeOffsets, judgePlanted, judgeSolid, lane, plantedLane, ran, twinShaders, uniformStructs } from './helpers.mjs';

// deadline: each test's own cargo runs are bounded in helpers.mjs; this only turns a hang into a failure
const BOUND = { timeout: 90 * MINUTE };

test('AC1 #3256.b135fea1 every pair passes, every #[repr(C)] struct of the three crates is a pair or on the host-only list, and the lane prints the pairs it compared', BOUND, (t) => {
  // The second arm of the criterion's first sentence, the pull request's list of the pairs that differed on the merge
  // base, is the Proof's (README.md: Not asserted). What a test holds of it: after the fixes, no pair differs.
  const found = judgeListing(lane(), hostStructs());
  t.diagnostic(`${found.structs} #[repr(C)] structs in the three crates' src/: ${found.compared} compared, ${found.hostOnly} host-only; the lane printed ${found.pairs} pairs and ${found.records} records`);
});

test('AC2 #3256.7baa6339 FrameUniform and scene3d.wgsl\'s Frame agree at sky_top 144 and sky_low 160 in 352 bytes; with the two swapped in the shader, which naga validates at that size, the lane fails naming the pair, both fields and their offsets', BOUND, () => {
  const run = lane();
  // The lane's absence is the base's failure, before this suite's own Rust target is asked for.
  ran(run);
  judgeFrame(run, twinShaders());
});

test('AC3 #3256.3bfcdd46 AoUniform and the shader\'s Ao agree at opts 144 in 208 bytes; with opts typed [f32; 4] the lane fails naming the field and both types, and with one more field at its end naming both sizes', BOUND, () => {
  judgeAo(lane());
});

test('AC4 #3256.d9954e62 the offsets compared are the shader\'s own: [f32; 3] then f32 passes at 0 and 12, [f32; 3] then [f32; 3] against two vec3<f32> fails at the second field, 12 against 16, and a planted comparison that sums host sizes fails this test', BOUND, () => {
  const declared = (name) => declarations('deep-groups-render', name);
  judgeOffsets(lane(), declared);
  // The planted comparison, in its own build: the same lane, and the same judge, which must fail there.
  judgePlanted(plantedLane(), declared);
});

test('AC5 #3256.6145ab27 SolidRecord is held against its attribute list SOLID and the shader\'s inputs; with base and surface swapped in the record the lane fails naming locations 10 and 11 and both names', BOUND, () => {
  judgeSolid(lane());
});

test('AC6 #3256.57afe6d0 a #[repr(C)] struct with neither a pair nor a reason fails the lane, naming it, and so does a var<uniform> struct no host struct names; none is left in the three crates', BOUND, (t) => {
  const found = judgeCoverage(lane(), hostStructs(), uniformStructs());
  t.diagnostic(`${found.structs} #[repr(C)] structs and ${found.uniforms} var<uniform> structs in the three crates' src/, each compared or listed with its reason; ${found.gpuOnly} on the gpu-only list`);
});
