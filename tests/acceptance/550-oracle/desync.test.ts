// Oracle lane for #550's criterion 1 (#550.92355c66): two upstream tests, re-expressed against our copies (README:
// Sources).
//
// 1. The upstream rollback library's desync detection test (`tests/test_p2p_session.rs`, `test_desyncs_detected`, at
//    commit d8e2cf1e16abe5c761ee6b01bab2888084c5e74c; license MIT OR Apache-2.0, as the oracle repo's pins record it):
//    two peers with desync detection every 100 frames run 110 frames on inputs i, then one peer's game state is messed
//    up while the inputs hold steady; both peers report one desync at frame 200, each with its own checksum and the
//    other's, which differ. Ours: the stub game of #549's Oracle lane, a match with a full-state hash every 100 steps
//    and no input delay, a change to `game.state` in copy 1 right after it runs step 110, caught at the hash for 200.
// 2. The upstream engine's rewind tests (its headless physics tests' rewind file, `RewindTest_ResimInSync` and
//    `RewindTest_ResimDesyncAfterChangingMass`, at commit 396c9f059903aed5fec78ecd3d437a40c6415368; license as the
//    oracle repo's pins record it): with the same inputs every resimulated step stays in sync; a force changed during
//    the resimulation desyncs it from that step on; and the desync names the one particle that differs. Ours: the
//    paddle piece's match, whose locator steps each copy again from its checkpoint: with no plant every hash of the two
//    copies agrees to the end; with a one-unit push to the ball's x velocity at step 310 the first step that differs is
//    310, the copies stay apart at 360, and net.desync names one field, the ball's x velocity.
// No upstream code is copied or run; each case is our document and our `match` call, judged on what our copies report.
import { describe, it } from 'vitest';
import {
  AC, BALL_VX_FIELD, DOC, FULL, Script, TIMEOUT, UNIT_SHIFT, hashFailures, matchCall, namedFailures, netCopiesOf, none, play, playedOnFailures, players, presented, putEvidence,
  rally, runShow, scenario, stubDoc, stubProgram, useBuilds, useChildren, useTemp,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();

describe(`${AC[1]} the upstream desync tests, on our copies`, () => {
  it(`${AC[1]} a state messed up after step 110 is caught by both copies at the hash for step 200, every 100 steps, each with its own hash and the other's differing`, async () => {
    const evidence = temp();
    const program = stubProgram();
    putEvidence(evidence, program.bytes);
    // Upstream: 110 frames on input i from both, then 100 frames on steady inputs, 0 and 1. Ours plays the steady
    // inputs on to step 400, so a copy that missed the hash for 200 would hash again at 300.
    const inputs = (steady: number) => Array.from({ length: 400 }, (_, i) => ({ step: i, control: 'inp', value: i < 110 ? i : steady }));
    const s = new Script();
    s.present(DOC.stub, stubDoc(program, { relay: 'https://relay.test/550', delay: 0, hash_every: 100 }));
    const m = s.add(matchCall(DOC.stub, 400, { plays: { '1': inputs(0), '2': inputs(1) }, plant: { player: 1, step: 110, field: 'game.state', add: 1 } }));
    const r = await runShow(builds.show(), scenario(evidence, [DOC.stub], s.calls), 'the oracle: a state messed up from step 110');
    presented(r[0], 'the oracle: the stub game');
    const [one, two] = players(netCopiesOf(r[m], 'the oracle'), 2, 'the oracle');
    const f: string[] = [];
    const at = (c: typeof one, step: number): string | undefined => c.hashes.find((h) => h.step === step)?.hash;
    for (const step of [0, 100]) if (at(one, step) === undefined || at(one, step) !== at(two, step)) f.push(`no desync is expected before frame 200, but the copies' hashes at step ${step} are ${String(at(one, step))} and ${String(at(two, step))}`);
    if (at(one, 200) === undefined || at(two, 200) === undefined || at(one, 200) === at(two, 200)) f.push(`both copies must report differing hashes at step 200: ${String(at(one, 200))} and ${String(at(two, 200))}`);
    for (const c of [one, two]) {
      if (c.end !== 'desync') f.push(`copy ${c.player} doesn't report the desync: its match ended ${String(c.end)}`);
      if (c.hashes.some((h) => h.step > 200)) f.push(`copy ${c.player} hashed past step 200, so the desync wasn't caught at its first interval after the change`);
    }
    none(f, 'a desync is caught at the next hash interval, on both copies');
  }, TIMEOUT);

  it(`${AC[1]} with the same inputs every hash stays in sync, and a push to the ball at step 310 desyncs the copies from that step on, naming the one field that differs`, async () => {
    const plays = rally(2, 600);
    const same = await play(builds.show(), temp(), 'the oracle: the same inputs', { steps: 600, plays });
    const [a, b] = players(same.copies, 2, 'the oracle: the same inputs');
    const f = [...playedOnFailures(same.copies, 600, 'the same inputs'), ...hashFailures(a, b, 'the same inputs', 9)];
    const pushed = await play(builds.show(), temp(), 'the oracle: a push at step 310', { steps: 600, plays, plant: UNIT_SHIFT });
    const [one, two] = players(pushed.copies, 2, 'the oracle: a push at step 310');
    for (const c of [one, two]) f.push(...namedFailures(c, 'a push at step 310', { step: 310, module: 'logic', field: BALL_VX_FIELD }));
    const at = (c: typeof one): string | undefined => c.hashes.find((h) => h.step === 360)?.hash;
    if (at(one) === undefined || at(one) === at(two)) f.push(`after the push the copies stay apart from step 310 on, but their hashes at step 360 are ${String(at(one))} and ${String(at(two))}`);
    none(f, 'the same inputs stay in sync, and a change desyncs from its step, naming its one field');
  }, TIMEOUT);
});
