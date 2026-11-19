// AC8 #549.c5b39b72: Through the test relay at 5% frame drops for 1,200 match steps, both copies reach equal full-state
// hashes at every confirmed step, since each frame repeats its messages after the lowest step its peers confirmed; a
// planted backend that resends nothing stalls and fails, naming the lost step
//
// The lockstep piece (fixtures.ts: 300 units at 20 Hz, window 0, delay 4, a full-state hash at every match step), both
// copies run by `match` in one process over the test relay, on the relay's own clock, each player making one entry a
// match step. The relay drops 5% of the frames by its seed and reports every frame it carried (README: `match`). The
// criterion's check is this file's `stalls`: a copy that stops short of the 1,200 steps fails it, naming the step
// whose message never arrived. The planted `net_resends_nothing` is a network backend whose frames carry each message
// once, so a dropped frame's message is gone.
import { describe, expect, it } from 'vitest';
import { DELAY, DOC, LOGIC, armyAfter, armyProgram, lockstepDoc, scripts } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, copiesOf, expectedTrack, failsNaming, hashFailures, lastArray, merged, none, once, presented, putEvidence, relayOf, runShow, scenario,
  useBuilds, useChildren, useTemp, type CarriedFrame, type Copy, type Planted, type RelayAsk, type RelayReport,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1200;
const PLAYS = scripts(2, STEPS);
/** No copy joins anything here: `match` runs the copies over the test relay, and the declared relay is never reached. */
const NET = { relay: 'https://relay.test/549', hash_every: 1 };

interface Run { copies: Copy[]; relay: RelayReport }
async function play(what: string, relay: RelayAsk, planted?: Planted): Promise<Run> {
  const evidence = temp();
  const program = armyProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  s.present(DOC.lockstep, lockstepDoc(program, NET));
  const m = s.match(DOC.lockstep, STEPS, { plays: PLAYS, relay });
  const r = await runShow(builds.show(), scenario({ evidence, docs: [{ id: DOC.lockstep }], calls: s.calls, ...(planted ? { planted } : {}) }), what);
  presented(r[0], `${what}: the lockstep piece`);
  return { copies: copiesOf(r[m], what), relay: relayOf(r[m], what) };
}

/** The lowest step of `player` that no delivered frame carried, among the steps its frames carried at all. */
function lostStep(log: readonly CarriedFrame[], player: number): number | null {
  const sent = new Set<number>();
  const arrived = new Set<number>();
  for (const f of log.filter((x) => x.player === player)) for (let k = f.first; k < f.first + f.count; k++) { sent.add(k); if (f.delivered !== null) arrived.add(k); }
  const lost = [...sent].filter((k) => !arrived.has(k)).sort((a, b) => a - b);
  return lost.length ? lost[0]! : null;
}
/** The criterion's check: every copy runs all the match's steps. A copy that stalls fails it, naming the step it
 * waited for and whether the relay's own log shows that step's message lost. */
function stalls(run: Run): string[] {
  const f: string[] = [];
  for (const c of run.copies) {
    if (c.ran >= STEPS) continue;
    const w = c.waits[c.waits.length - 1];
    if (!w) { f.push(`copy ${c.player} ran ${c.ran} of ${STEPS} match steps and reports no wait`); continue; }
    const lost = lostStep(run.relay.log, w.player);
    f.push(`copy ${c.player} stalled after ${c.ran} of ${STEPS} match steps, waiting for player ${w.player}'s message for step ${w.step}; the relay's log shows player ${w.player}'s lost step ${lost === null ? 'none' : lost}`);
  }
  return f;
}

const clean = once(() => play('AC8 no drops', { seed: 549, log: true }));
const dropped = once(() => play('AC8 5% drops', { seed: 549, drop: 0.05, log: true }));

describe(`${AC[8]} a dropped frame's messages come again in the next one`, () => {
  it(`${AC[8]} at 5% frame drops over 1,200 match steps both copies reach equal full-state hashes at every confirmed step`, async () => {
    const run = await dropped();
    const base = await clean();
    const f: string[] = [];
    // The relay did drop: about 5% of at least one frame a player a match step.
    const share = run.relay.dropped / run.relay.frames;
    if (run.relay.frames < 2 * (STEPS - DELAY)) f.push(`the test relay carried ${run.relay.frames} frames, fewer than one a player a match step`);
    if (!(share >= 0.03 && share <= 0.07)) f.push(`the test relay dropped ${run.relay.dropped} of ${run.relay.frames} frames (${(share * 100).toFixed(2)}%), not about 5%`);
    if (run.relay.log.filter((x) => x.delivered === null).length !== run.relay.dropped) f.push(`the relay's log marks ${run.relay.log.filter((x) => x.delivered === null).length} frames dropped, its count says ${run.relay.dropped}`);
    if (base.relay.dropped !== 0) f.push(`the run without drops lost ${base.relay.dropped} frames`);
    // Each frame repeats its messages: every step a dropped frame carried is carried again by a later frame that arrives.
    for (const player of [1, 2]) {
      const lost = lostStep(run.relay.log, player);
      if (lost !== null && lost < STEPS - 1) f.push(`player ${player}'s message for step ${lost} was in dropped frames only: no later frame repeated it`);
    }
    if (!run.relay.log.some((x) => x.count > 1)) f.push('no frame carries more than one step\'s message, so none repeats a message');
    f.push(...stalls(run));
    expect(run.copies.map((c) => c.player), 'the match has copies 1 and 2').toEqual([1, 2]);
    const [one, two] = [run.copies[0]!, run.copies[1]!];
    for (const c of run.copies) {
      if (c.ran !== STEPS) f.push(`copy ${c.player} ran ${c.ran} match steps, not ${STEPS}`);
      if (c.rollbacks !== 0) f.push(`copy ${c.player} rolled back ${c.rollbacks} times in lockstep`);
      if (c.end !== null) f.push(`copy ${c.player}'s match ended as ${c.end}`);
    }
    f.push(...hashFailures(one, two, 'the two copies under drops', { hashEvery: 1, atLeast: STEPS - 2 }));
    f.push(...hashFailures(one, base.copies[0]!, 'copy 1 under drops and without', { hashEvery: 1, atLeast: STEPS - 2 }));
    f.push(...hashFailures(two, base.copies[1]!, 'copy 2 under drops and without', { hashEvery: 1, atLeast: STEPS - 2 }));
    // What every copy must hold: this suite's own mirror of the program on both players' entries, each at its step.
    const want = armyAfter(PLAYS, STEPS);
    for (const c of [...run.copies, ...base.copies]) {
      if (JSON.stringify(lastArray(c, `${LOGIC}.pos`, `copy ${c.player}`)) !== JSON.stringify(want.pos)) f.push(`copy ${c.player}'s ${LOGIC}.pos after ${STEPS} steps isn't what both players' entries give at their steps`);
      if (JSON.stringify(lastArray(c, `${LOGIC}.vel`, `copy ${c.player}`)) !== JSON.stringify(want.vel)) f.push(`copy ${c.player}'s ${LOGIC}.vel after ${STEPS} steps isn't what both players' entries give at their steps`);
    }
    // The merged track every copy records: each entry at its step with its player, a peer's with the writer peer.
    const before = STEPS - 1;
    for (const c of run.copies) {
      if (!c.record) { f.push(`copy ${c.player} has no record`); continue; }
      if (JSON.stringify(merged(c.record.track, before)) !== JSON.stringify(expectedTrack(PLAYS, DELAY, before))) f.push(`copy ${c.player}'s recorded track isn't both players' entries, each ${DELAY} steps after it was made, in step, player and seq order`);
      const wrong = c.record.track.filter((e) => (e.player !== c.player) !== (e.writer === 'peer'));
      if (wrong.length) f.push(`copy ${c.player}'s record holds ${wrong.length} entries whose writer is peer for its own player, or isn't for another's (the first: player ${wrong[0]!.player}, writer ${wrong[0]!.writer})`);
    }
    none(f, 'the match through the test relay at 5% frame drops');
  }, TIMEOUT);

  it(`${AC[8]} planted net_resends_nothing stalls and fails, naming the lost step`, async () => {
    none(stalls(await dropped()), 'the criterion\'s check passes the backend that repeats its messages');
    const run = await play('AC8 5% drops', { seed: 549, drop: 0.05, log: true }, 'net_resends_nothing');
    // The first message the relay's own log shows lost, whoever sent it.
    const lost = [1, 2].map((player) => ({ player, step: lostStep(run.relay.log, player) })).filter((x): x is { player: number; step: number } => x.step !== null).sort((a, b) => a.step - b.step)[0];
    expect(lost, 'under the planted backend the relay\'s log shows a message that was in dropped frames only').toBeDefined();
    const waiting = run.copies.find((c) => c.player !== lost!.player)!;
    const w = waiting.waits[waiting.waits.length - 1];
    expect(waiting.ran, `copy ${waiting.player} stalls: it ran the steps before the lost step ${lost!.step} and no more`).toBe(lost!.step);
    expect(w && { step: w.step, player: w.player, to: w.to }, `copy ${waiting.player}'s last wait names the lost step and its player, and never ends`).toEqual({ step: lost!.step, player: lost!.player, to: null });
    for (const c of run.copies) expect(c.end, `copy ${c.player}'s match ends as timeout once the stall passes the net item's timeout`).toBe('timeout');
    failsNaming(stalls(run), [new RegExp(`copy ${waiting.player} stalled`), new RegExp(`message for step ${lost!.step};`), new RegExp(`lost step ${lost!.step}$`)], 'the planted net_resends_nothing');
  }, TIMEOUT);
});
