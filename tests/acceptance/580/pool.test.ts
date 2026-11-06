// #580 AC7: with stack.slot at 2, worktree A's session idle with a warm stack and no pending claim, and worktree B's stack
// running a journey, a journey pending in worktree C reclaims A's stack and starts; a journey then pending in worktree D
// waits, its expected time counting the wait, until B's verdict lands and B's stack is reclaimed. No agent is asked
// which stack to stop, and a pool that reclaims B's stack while its journey runs fails this test, naming B. C's journey
// is held too, so its stack, not an idle warm one, is what D finds beside B's. A reclaim tears a stack down as AC6 reads
// it: its containers gone before its port leases end.
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, containers, exists, failureOf, portLease, sleep, type Ev, type Pending, type Served } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const J_MS = 300_000;
const slotsHeld = (events: readonly Ev[]): number => {
  let held = 0;
  let most = 0;
  for (const e of events) {
    if (e.data?.resource?.kind !== 'stack.slot') continue;
    if (e.kind === 'lease.acquired') most = Math.max(most, ++held);
    if (e.kind === 'lease.released') held--;
  }
  return most;
};
const namingB = (b: Bench, served: Served): string => `worktree B (${b.w.tmp}/wt-b, stack ${served.stack})`;

async function scenario(plant?: string): Promise<void> {
  const b = bench = await Bench.open({ slot: 2, worktrees: ['wt-a', 'wt-b', 'wt-c', 'wt-d'], ...(plant ? { plant } : {}) });
  const [a, wb, c, d] = await Promise.all(['wt-a', 'wt-b', 'wt-c', 'wt-d'].map((w) => b.session(w)));

  // A: a warm stack, its session idle, no pending claim.
  const onA = await b.whole(a!);
  expect(onA.finished.outcome, `A's journey passed (${JSON.stringify(onA.finished.findings).slice(0, 500)})`).toBe('passed');
  const aIds = containers(onA.served.project);
  expect(aIds.length, 'A\'s stack stays warm').toBeGreaterThan(0);

  // B: running, held at /go.
  b.hold('wt-b');
  const onB = await b.claim(wb!);
  const servedB = await b.served(onB);
  const bIds = containers(servedB.project);

  // C: pending; the pool is full; it reclaims A's stack and starts.
  b.hold('wt-c');
  const asksBefore = (await b.events()).filter((e) => e.kind === 'ask.created').length;
  const onC = await b.claim(c!);
  const servedC = await b.served(onC);
  expect(bIds.filter(exists), `${namingB(b, servedB)} was reclaimed while its journey ran`).toEqual(bIds);
  expect(aIds.filter(exists), 'C reclaimed A\'s stack: its containers are gone').toEqual([]);
  await b.until(async () => portLease(await b.events(), 'lease.released', onA.served.ports.web!).length > 0, 30_000, 'A\'s port lease to end');

  // D: pending with both slots running; it waits, its expected time counting the wait.
  const pos = await b.pos();
  await b.ask(d!);
  await d!.editCart(pos);
  const stopD = await d!.stop('Done.');
  const waiting = await b.until(async () => (await b.events()).find((e) => e.kind === 'stack.waiting' && e.log_pos > pos), 60_000, 'D\'s journey to wait for a slot (stack.waiting)');
  const expected = waiting.data.expected_ms as number;
  const wait = waiting.data.wait_ms as number;
  expect(wait, `D's wait is counted (${JSON.stringify(waiting.data)})`).toBeGreaterThan(0);
  expect(expected, 'its expected time is the journey\'s and the wait').toBeGreaterThanOrEqual(J_MS + wait);
  await sleep(5000);
  const during = await b.events();
  expect(during.filter((e) => e.kind === 'stack.served' && e.log_pos > pos).map((e) => e.data.run), 'D waits: no stack served it').toEqual([]);
  expect(bIds.filter(exists), `${namingB(b, servedB)} was reclaimed while its journey ran`).toEqual(bIds);
  expect(containers(servedC.project).length, 'C\'s stack stands').toBeGreaterThan(0);

  // B's verdict lands: its stack is reclaimed and D starts.
  b.release('wt-b');
  const finishedB = await b.finished(onB);
  expect(finishedB.outcome, `${namingB(b, servedB)}'s journey ended on its own stack (${JSON.stringify(finishedB.findings).slice(0, 500)})`).toBe('passed');
  const onD: Pending = await b.running(d!, pos, stopD);
  await b.served(onD);
  expect(bIds.filter(exists), 'D reclaimed B\'s stack').toEqual([]);
  b.release('wt-c');
  await b.finished(onD);
  await b.finished(onC);

  const events = await b.events();
  expect(events.filter((e) => e.kind === 'ask.created').length, 'no agent, and nobody, was asked which stack to stop').toBe(asksBefore);
  expect(slotsHeld(events), 'never more than 2 stack.slot leases at once').toBeLessThanOrEqual(2);
  expect(events.filter((e) => e.kind === 'lease.acquired' && e.data?.resource?.kind === 'stack.slot').length, 'each of the four stacks held a stack.slot').toBeGreaterThanOrEqual(4);
}

describe('AC7 #580 a full pool reclaims a warm stack with no pending claim, an idle session\'s first, and otherwise a check waits', () => {
  it('AC7 with stack.slot at 2, C reclaims idle A\'s stack and starts, D waits with the wait in its expected time until B\'s verdict lands and B\'s stack is reclaimed, and nobody is asked', async () => {
    await scenario();
  }, 2_400_000);

  it('AC7 (wrong program) a pool that reclaims B\'s stack while its journey runs (DEEP_HUB_PLANT=pool-reclaims-running) fails this test, naming B', async () => {
    const failure = await failureOf(() => scenario('pool-reclaims-running'));
    expect(failure, 'the planted pool passed').not.toBeNull();
    expect(failure, 'naming B').toContain('worktree B');
  }, 2_400_000);
});
