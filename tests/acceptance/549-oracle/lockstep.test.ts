// Oracle lane for #549's criteria 4 (#549.a6b30a32) and 5 (#549.6bf6ea62): the upstream lockstep tests, re-expressed
// against our copies (README: Sources).
//
// Upstream: a rollback networking library's `tests/test_p2p_session.rs`, lines 755 to 1026, with the stub game of its
// `tests/stubs.rs`, lines 173 to 191, at commit d8e2cf1e16abe5c761ee6b01bab2888084c5e74c (license: MIT OR Apache-2.0,
// as the oracle repo's pins record it). No upstream code is copied or run. Its lockstep tests (a prediction window of
// 0) check that a peer doesn't advance without the remote's input, with no input delay and with one; that two peers
// advance 20 frames with no delay and with a delay of 1; and that they recover after repeated stalls. Its stub game:
// each frame, the state gains 2 when the two players' inputs sum to an even number and loses 1 otherwise, and the frame
// count gains 1; both players give input i on iteration i, so 20 frames leave state 40.
//
// Ours: the same game as a logic item (`stubProgram`, ../549/fixtures.ts) reading a slider, in a `net@1` match with
// window 0 at 20 Hz and upstream's input delay, both copies run by `match` over the test relay on its own clock.
// "The remote's input hasn't arrived" is the relay holding player 2's messages; "an attempt to advance" is one step
// time of the match clock. Left out (README): the bounded wait helper's test, which is that library's own call.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, Script, TIMEOUT, copiesOf, lastArray, none, presented, putEvidence, rendersOf, runShow, scenario, stubDoc, stubProgram, useBuilds, useChildren, useTemp,
  type Copy, type Plays, type Render,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
/** Upstream's 20 repetitions, and one step time of our 20 Hz match. */
const FRAMES = 20;
const TICK = 0.05;

/** Upstream's inputs: both players give i on iteration i. With an input delay d the entry lands d steps later, so only
 * the iterations that land inside the 20 frames are made. */
function inputs(delay: number): Plays {
  const each = Array.from({ length: FRAMES - delay }, (_, i) => ({ step: i, control: 'inp', value: i }));
  return { '1': each, '2': each };
}
interface Run { copies: Copy[]; renders: Render[] }
/** One match of the stub game: `delay` steps of input delay, player 2's messages held from the start for `hold` s. */
async function play(what: string, delay: number, hold: number, renderBack: { player: number; t: number }[] = []): Promise<Run> {
  const evidence = temp();
  const program = stubProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  // A 60 s timeout, so a 10 s hold stalls the match and doesn't end it.
  s.present(DOC.stub, stubDoc(program, { relay: 'https://relay.test/549', delay, hash_every: 1, timeout: 60 }));
  const m = s.match(DOC.stub, FRAMES, { plays: inputs(delay), relay: { seed: 549, ...(hold > 0 ? { hold: [{ player: 2, at: 0, for: hold }] } : {}) }, ...(renderBack.length ? { renderBack } : {}) });
  const r = await runShow(builds.show(), scenario({ evidence, docs: [{ id: DOC.stub }], calls: s.calls }), what);
  presented(r[0], `${what}: the stub game`);
  return { copies: copiesOf(r[m], what), renders: renderBack.length ? rendersOf(r[m], what) : [] };
}
/** Both copies advanced all 20 frames to upstream's state: frame 20, state 40. */
function advanced(run: Run, what: string): string[] {
  const f: string[] = [];
  for (const c of run.copies) {
    if (c.ran !== FRAMES) f.push(`${what}: copy ${c.player} advanced ${c.ran} frames, not ${FRAMES}`);
    const frame = lastArray(c, 'game.frame', `${what}: copy ${c.player}`);
    const state = lastArray(c, 'game.state', `${what}: copy ${c.player}`);
    if (JSON.stringify(frame) !== `[${FRAMES}]` || JSON.stringify(state) !== `[${2 * FRAMES}]`) f.push(`${what}: copy ${c.player} holds frame ${JSON.stringify(frame)} and state ${JSON.stringify(state)}, not frame ${FRAMES} and state ${2 * FRAMES}`);
    if (c.rollbacks !== 0) f.push(`${what}: copy ${c.player} rolled back ${c.rollbacks} times`);
  }
  return f;
}

describe(`${AC[4]} ${AC[5]} the upstream lockstep tests, on our copies`, () => {
  it(`${AC[4]} ${AC[5]} a copy doesn't advance without the remote's input, with no input delay and with a delay of 3`, async () => {
    const f: string[] = [];
    // Upstream: one attempt with no delay; 200 attempts with a delay of 3. Ours: player 2 silent for 200 step times.
    for (const delay of [0, 3]) {
      const silent = 200 * TICK;
      const run = await play(`the oracle: no remote input, delay ${delay}`, delay, silent, [{ player: 1, t: TICK }, { player: 1, t: silent / 2 }, { player: 1, t: silent - TICK }]);
      const one = run.copies[0]!;
      expect(one.player, 'copy 1 is first').toBe(1);
      const w = one.waits[0];
      if (!w || w.step !== 0 || w.player !== 2) f.push(`delay ${delay}: copy 1's first wait is ${JSON.stringify(w ?? null)}, not at step 0 for player 2`);
      else {
        if (w.from > TICK) f.push(`delay ${delay}: copy 1 starts waiting at ${w.from} s, not from the start`);
        if (w.to === null || w.to < silent - 1e-9 || w.to > silent + 2 * TICK) f.push(`delay ${delay}: copy 1's wait ends at ${String(w.to)} s, not when player 2's messages arrive at ${silent} s`);
      }
      // No frame is advanced while the remote is silent: the game stays before its first step.
      for (const r of run.renders) if (r.step !== -1) f.push(`delay ${delay}: at ${r.t} s, with no remote input, copy 1 shows step ${r.step}: it advanced`);
      if (run.renders.length !== 3) f.push(`delay ${delay}: ${run.renders.length} render-backs came back, not 3`);
      if (one.ranAt && one.ranAt.length && one.ranAt[0]! < silent - 1e-9) f.push(`delay ${delay}: copy 1 ran step 0 at ${one.ranAt[0]} s, before player 2's messages arrived`);
      // Once the input arrives the game plays, to upstream's state.
      f.push(...advanced(run, `delay ${delay}, once the remote's input arrived`));
    }
    none(f, 'lockstep stalls without the remote\'s input');
  }, TIMEOUT);

  it(`${AC[4]} ${AC[5]} two copies advance 20 frames with no delay and with a delay of 1, and recover after repeated stalls`, async () => {
    const f: string[] = [];
    f.push(...advanced(await play('the oracle: zero latency, zero delay', 0, 0), 'zero latency and zero delay'));
    f.push(...advanced(await play('the oracle: an input delay of 1', 1, 0), 'an input delay of 1'));
    // Upstream: both peers spin 12 attempts (the delay of 2 plus 10) with nothing crossing, then both advance.
    const stalled = 12 * TICK;
    const run = await play('the oracle: repeated stalls, delay 2', 2, stalled);
    const w = run.copies[0]!.waits[0];
    if (!w || w.step !== 0 || w.player !== 2 || w.to === null || w.to < stalled - 1e-9) f.push(`after 12 stalled step times, copy 1's first wait is ${JSON.stringify(w ?? null)}, not at step 0 for player 2 until ${stalled} s`);
    f.push(...advanced(run, 'after repeated stalls'));
    none(f, 'lockstep advances once both inputs arrive');
  }, TIMEOUT);
});
