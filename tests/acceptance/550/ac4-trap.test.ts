// AC4 #550.64a33e1a: A planted two-player piece whose logic traps with kind unreachable at match step 400 on every copy
// alike, so every full-state hash still agrees, ends the match on both copies at step 400 with net.fault naming the
// item, the step and the kind, and both records end faulted; a planted copy that plays on past the trap because the
// hashes agree fails, naming step 400
//
// The planted piece is the paddle piece whose program `courtProgram({trapAt: 400})` runs `unreachable` when it runs step
// 400, on every copy (fixtures.ts). Both copies play an honest rally of 600 steps by `match` over the test relay. The
// planted copy is `net_plays_on_past_trap` (README: Planted twins), judged by the same function. Wrong programs it
// fails: the merge base (no net.fault); a copy that ends the match healthy because every hash agrees (the planted
// copy); a fault that names another step, item or kind; a record that ends otherwise.
import { describe, it } from 'vitest';
import { LOGIC, TRAP_STEP, courtProgram, rally } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, hashFailures, none, play, players, useBuilds, useChildren, useTemp, type NetCopy } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const plays = rally(2, STEPS);

/** The criterion's judge: both copies end faulted at step 400 with net.fault {item, step, kind}, records too, every
 * full-state hash agreeing up to it. */
function faultFailures(copies: NetCopy[], what: string): string[] {
  const [one, two] = players(copies, 2, what);
  const f: string[] = [...hashFailures(one, two, what, Math.floor(TRAP_STEP / 60) - 1)];
  for (const c of [one, two]) {
    if (c.end !== 'faulted') f.push(`${what}: copy ${c.player}'s match ended ${String(c.end)}, not faulted, though its logic trapped at step ${TRAP_STEP}`);
    if (c.record?.end !== 'faulted') f.push(`${what}: copy ${c.player}'s record ends ${String(c.record?.end)}, not faulted`);
    if (c.ran > TRAP_STEP + 1) f.push(`${what}: copy ${c.player} played on past the trap at step ${TRAP_STEP}, to step ${c.ran}`);
    if (c.ran < TRAP_STEP) f.push(`${what}: copy ${c.player} stopped at step ${c.ran}, before the trap at step ${TRAP_STEP}`);
    if (c.fault === undefined) f.push(`${what}: copy ${c.player}'s report has no fault (README: A copy's report): it holds ${Object.keys(c.raw).join(', ')}`);
    else if (c.fault === null) f.push(`${what}: copy ${c.player} reports no net.fault for the trap at step ${TRAP_STEP}`);
    else if (c.fault.step !== TRAP_STEP || c.fault.item !== LOGIC || c.fault.kind !== 'unreachable') f.push(`${what}: copy ${c.player}'s net.fault is ${JSON.stringify(c.fault.raw)}, not step ${TRAP_STEP}, item ${LOGIC}, kind unreachable`);
    if (c.desync) f.push(`${what}: copy ${c.player} reports net.desync ${JSON.stringify(c.desync.raw)}, though every copy trapped alike`);
  }
  return f;
}

describe(`${AC[4]} a trap every copy makes alike ends the match as faulted`, () => {
  it(`${AC[4]} both copies end at step 400 with net.fault naming court, step 400 and unreachable, and both records end faulted`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC4 the trapping piece', { steps: STEPS, plays, program: courtProgram({ trapAt: TRAP_STEP }) });
    none(faultFailures(copies, 'AC4'), 'a trap ends the match as faulted on every copy');
  }, TIMEOUT);

  it(`${AC[4]} a planted copy that plays on past the trap because the hashes agree fails, naming step 400`, async () => {
    const { copies } = await play(builds.show(), temp(), 'AC4 the copy that plays on', { steps: STEPS, plays, program: courtProgram({ trapAt: TRAP_STEP }), planted: 'net_plays_on_past_trap' });
    failsNaming(faultFailures(copies, 'AC4 planted'), [/step 400/], 'the copy that plays on past the trap');
  }, TIMEOUT);
});
