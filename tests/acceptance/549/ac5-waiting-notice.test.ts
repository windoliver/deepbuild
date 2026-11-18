// AC5 #549.6bf6ea62: With window 0, holding player 2's messages back for 2 s holds player 1's copy at its last step,
// with the app's notice naming player 2 shown from 0.25 s and gone once the messages arrive, and the match then plays
// on to the same full-state hashes as a run without the hold; held for 6 s, the match ends on both copies as timeout;
// and a render-back of the piece's own layer during the hold shows no notice
//
// The lockstep piece (20 Hz, window 0, delay 4, the default 5 s timeout, a full-state hash at every match step), both
// copies run by `match` over the test relay on the relay's own clock, so every time below is a match-clock time and
// none is this machine's. From match time 10 s the relay holds every message player 2 sends, for 2 s or for 6 s, then
// hands them on in order. At 20 Hz with delay 4, player 2's message for step 204 is the first one held (it is sent
// when its copy first runs step 200, at 10 s), so copy 1 runs step 203 at 10.15 s and can't run step 204 at 10.2 s:
// it waits there until the messages come at 12 s, and the app's notice shows from 0.25 s into that wait.
import { describe, expect, it } from 'vitest';
import { DOC, armyProgram, lockstepDoc, scripts } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, copiesOf, hashFailures, none, once, presented, putEvidence, rendersOf, runShow, scenario, useBuilds, useChildren, useTemp,
  type Copy, type Notice, type Render, type Wait,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 400;
const PLAYS = scripts(2, STEPS);
const NET = { relay: 'https://relay.test/549', hash_every: 1 };
const HOLD_AT = 10;
/** The step copy 1 can't run while player 2's messages are held (the comment above), give or take one. */
const WAIT_STEP = 204;
/** One match step, in seconds: the slack every time below is read with. */
const TICK = 0.05;

interface Run { copies: Copy[]; renders: Render[] }
async function play(what: string, holdFor: number | null, renderBack: { player: number; t: number }[] = []): Promise<Run> {
  const evidence = temp();
  const program = armyProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  s.present(DOC.lockstep, lockstepDoc(program, NET));
  const m = s.match(DOC.lockstep, STEPS, { plays: PLAYS, relay: { seed: 549, ...(holdFor === null ? {} : { hold: [{ player: 2, at: HOLD_AT, for: holdFor }] }) }, ...(renderBack.length ? { renderBack } : {}) });
  const r = await runShow(builds.show(), scenario({ evidence, docs: [{ id: DOC.lockstep }], calls: s.calls }), what);
  presented(r[0], `${what}: the lockstep piece`);
  return { copies: copiesOf(r[m], what), renders: renderBack.length ? rendersOf(r[m], what) : [] };
}
/** A copy's waits long enough to show a notice (0.25 s), or that never ended. */
const long = (c: Copy): Wait[] => c.waits.filter((w) => w.to === null || w.to - w.from >= 0.25);
const text = (x: Wait | Notice | undefined): string => JSON.stringify(x ?? null);

const plain = once(() => play('AC5 no hold', null));
/** Two render-backs of copy 1's piece layer while it waits with the notice up (10.45 s to 12 s). */
const held = once(() => play('AC5 a 2 s hold', 2, [{ player: 1, t: 10.8 }, { player: 1, t: 11.6 }]));

describe(`${AC[5]} a copy waits at its last step, and the app says for whom`, () => {
  it(`${AC[5]} a 2 s hold of player 2's messages holds copy 1 at its last step with the app's notice from 0.25 s, and the match plays on to the same hashes`, async () => {
    const run = await held();
    const base = await plain();
    const f: string[] = [];
    const [one, two] = [run.copies[0]!, run.copies[1]!];
    expect([one.player, two.player], 'the match has copies 1 and 2').toEqual([1, 2]);
    // Without the hold nobody waits long enough for a notice, and none shows.
    for (const c of base.copies) {
      if (long(c).length) f.push(`without a hold, copy ${c.player} waits ${text(long(c)[0])}`);
      if (c.notices.length) f.push(`without a hold, copy ${c.player} shows the notice ${text(c.notices[0])}`);
    }
    // Copy 1 waits once, for player 2, at the step it couldn't run, from about 10.2 s until the messages come at 12 s.
    const waits = long(one);
    const w = waits[0];
    if (waits.length !== 1 || !w) f.push(`copy 1 has ${waits.length} waits of 0.25 s or more, not the one the hold makes: ${JSON.stringify(waits)}`);
    else {
      if (w.player !== 2) f.push(`copy 1 waits for player ${w.player}, not player 2`);
      if (Math.abs(w.step - WAIT_STEP) > 1) f.push(`copy 1 waits to run step ${w.step}, not step ${WAIT_STEP} (the first whose message from player 2 is held)`);
      if (!(w.from >= HOLD_AT + 0.15 - TICK && w.from <= HOLD_AT + 0.2 + TICK)) f.push(`copy 1's wait starts at ${w.from} s, not about ${HOLD_AT + 0.2} s`);
      if (w.to === null || !(w.to >= HOLD_AT + 2 - 1e-9 && w.to <= HOLD_AT + 2 + 2 * TICK)) f.push(`copy 1's wait ends at ${String(w.to)} s, not when the held messages arrive at ${HOLD_AT + 2} s`);
      // Held at its last step: both render-backs taken during the wait show the step before the one it waits for.
      for (const r of run.renders) if (r.player !== 1 || r.step !== w.step - 1) f.push(`at ${r.t} s, during the hold, copy ${r.player} shows step ${r.step}, not its last step ${w.step - 1}`);
      if (run.renders.length !== 2) f.push(`${run.renders.length} render-backs came back, not the 2 asked for`);
      // The app's notice: one, naming player 2, from 0.25 s into the wait until the messages arrive.
      const n = one.notices[0];
      if (one.notices.length !== 1 || !n) f.push(`copy 1 shows ${one.notices.length} notices, not one: ${JSON.stringify(one.notices)}`);
      else {
        if (n.player !== 2) f.push(`the notice names player ${n.player}, not player 2`);
        if (!(n.from - w.from >= 0.25 - 1e-9 && n.from - w.from <= 0.25 + TICK)) f.push(`the notice shows ${(n.from - w.from).toFixed(3)} s into the wait, not from 0.25 s`);
        if (n.to === null || w.to === null || Math.abs(n.to - w.to) > TICK) f.push(`the notice is gone at ${String(n.to)} s, not when the messages arrive at ${String(w.to)} s`);
      }
      // What the app's own overlay shows at each of the two times: the notice's {player, since}.
      for (const r of run.renders) {
        if (r.notice?.player !== 2) f.push(`at ${r.t} s the app's notice is ${JSON.stringify(r.notice)}, not one naming player 2`);
        else if (Math.abs(r.notice.since - (r.t - w.from)) > TICK) f.push(`at ${r.t} s the notice says the copy has waited ${r.notice.since} s, not ${(r.t - w.from).toFixed(2)} s`);
      }
    }
    // Then the match plays on, to the hashes of the run without the hold, at every step.
    for (const c of run.copies) {
      if (c.ran !== STEPS) f.push(`copy ${c.player} ran ${c.ran} match steps after the hold, not ${STEPS}`);
      if (c.end !== null) f.push(`copy ${c.player}'s match ended as ${c.end} after a 2 s hold`);
      if (c.rollbacks !== 0) f.push(`copy ${c.player} rolled back ${c.rollbacks} times`);
    }
    f.push(...hashFailures(one, two, 'the two copies after the hold', { hashEvery: 1, atLeast: STEPS - 2 }));
    f.push(...hashFailures(one, base.copies[0]!, 'copy 1 with the hold and without', { hashEvery: 1, atLeast: STEPS - 2 }));
    f.push(...hashFailures(two, base.copies[1]!, 'copy 2 with the hold and without', { hashEvery: 1, atLeast: STEPS - 2 }));
    none(f, 'a 2 s hold of player 2\'s messages');
  }, TIMEOUT);

  it(`${AC[5]} held for 6 s, the match ends on both copies as timeout`, async () => {
    const run = await play('AC5 a 6 s hold', 6);
    const f: string[] = [];
    for (const c of run.copies) {
      if (c.end !== 'timeout') f.push(`copy ${c.player}'s match ends as ${String(c.end)}, not timeout`);
      if (c.record?.end !== 'timeout') f.push(`copy ${c.player}'s record ends as ${String(c.record?.end ?? null)}, not timeout`);
      if (c.ran >= STEPS) f.push(`copy ${c.player} ran all ${STEPS} steps though player 2's messages were held past the 5 s timeout`);
    }
    const one = run.copies[0]!;
    if (Math.abs(one.ran - WAIT_STEP) > 1) f.push(`copy 1 ran ${one.ran} match steps before the timeout, not the ${WAIT_STEP} it held every player's message for`);
    const w = long(one)[0];
    if (!w || w.player !== 2) f.push(`copy 1's wait before the timeout is ${text(w)}, not one for player 2`);
    none(f, 'a 6 s hold of player 2\'s messages, past the 5 s timeout');
  }, TIMEOUT);

  it(`${AC[5]} a render-back of the piece's own layer during the hold shows no notice`, async () => {
    const run = await held();
    const one = run.copies[0]!;
    const n = one.notices[0];
    expect(n, 'the app shows its notice during the hold (the first test reads when)').toBeDefined();
    const during = run.renders.filter((r) => r.player === 1 && r.t >= n!.from && (n!.to === null || r.t < n!.to));
    expect(during.length, `both render-backs (10.8 s and 11.6 s) fall while the notice ${text(n)} is up`).toBe(2);
    // The same copy at the same step in a run with no hold, where no notice exists: its piece layer, drawn the same way.
    const step = during[0]!.step;
    const clean = await play('AC5 no hold, the same step drawn', null, [{ player: 1, t: (step + 0.5) * TICK }]);
    expect(clean.copies[0]!.notices, 'the run without the hold shows no notice').toEqual([]);
    expect(clean.renders.map((r) => r.step), `the run without the hold is drawn at step ${step} too`).toEqual([step]);
    expect(clean.renders[0]!.notice, 'and the app shows no notice there').toBeNull();
    for (const r of during) expect(r.sha256, `the piece's own layer at ${r.t} s, while the app's notice is up, is pixel for pixel the layer without one`).toBe(clean.renders[0]!.sha256);
  }, TIMEOUT);
});
