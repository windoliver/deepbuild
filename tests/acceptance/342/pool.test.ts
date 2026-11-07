// #342 AC5: when the stack pool is full, an idle session's stack with no pending claim is reclaimed by rule, and no agent asks
// which stack to stop. The pool is #580's `stack.slot`, read on #580's sample and bench, at 1: B's session is idle on a warm
// stack with no pending claim, and C's claim finds the pool full. B's stack goes, its volumes with it, C's journey is served,
// and nothing asks. A pool that asks which stack to stop fails this test. #580's AC7 covers a stack whose journey runs and
// the wait for a slot (`pool-reclaims-running`); this one reads the reclaim's volumes and the asking. Neither journey's
// outcome is read: the rule doesn't depend on it, and on a Node the check sandbox can't load no journey can pass.
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, containers, exists, failureOf, volumes, type Ev } from '../580/helpers.ts';
import { AC5, volumeId } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const SERVED_MS = 420_000;
const ASKED = 'an ask about the stack pool was raised';

async function scenario(plant?: string): Promise<void> {
  const b = bench = await Bench.open({ slot: 1, worktrees: ['wt-b', 'wt-c'], ...(plant ? { plant } : {}) });
  const [wb, c] = await Promise.all(['wt-b', 'wt-c'].map((where) => b.session(where)));

  const onB = await b.whole(wb!);
  const bIds = containers(onB.served.project);
  const bVolumes = volumes(onB.served.project).map(volumeId);
  expect(bIds.length, 'B\'s stack stays warm').toBeGreaterThan(0);
  expect(bVolumes.length, 'B\'s warm stack has volumes').toBeGreaterThan(0);

  const before = await b.pos();
  const onC = await b.claim(c!);
  const served = await b.until(async () => {
    const events: readonly Ev[] = await b.events();
    const raised = events.filter((e) => e.kind === 'ask.created' && e.log_pos > before);
    if (raised.length) throw Error(`${ASKED}: ${raised.map((e) => String(e.data.question)).join('; ')}`);
    return events.find((e) => e.kind === 'stack.served' && e.data.run === onC.run);
  }, SERVED_MS, 'C\'s journey to be served on the reclaimed slot');
  expect(served.data.stack, 'C has a stack of its own').not.toBe(onB.served.stack);
  expect(bIds.filter(exists), 'idle B\'s stack was reclaimed: its containers are gone').toEqual([]);
  // C can lease B's project name again, so its volumes can carry the same names: a volume is B's by its name and creation.
  const standing = new Set(bVolumes.map((id) => id.split(' ')[0]!).map(volumeId));
  expect(bVolumes.filter((id) => standing.has(id)), 'idle B\'s stack was reclaimed: its volumes are gone').toEqual([]);
  await b.finished(onC);
  expect((await b.events()).filter((e) => e.kind === 'ask.created' && e.log_pos > before).map((e) => e.data.question), 'nobody was asked which stack to stop').toEqual([]);
}

describe(`${AC5} a full stack pool reclaims an idle session's stack with no pending claim by rule`, () => {
  it('AC5 with the pool full, idle B\'s stack and volumes go, C\'s journey is served, and no ask is raised', async () => {
    await scenario();
  }, 900_000);

  it('AC5 (wrong program) a pool that asks which stack to stop (DEEP_HUB_PLANT=pool-asks-which-stack) fails this test', async () => {
    const failure = await failureOf(() => scenario('pool-asks-which-stack'));
    expect(failure, 'the planted pool passed').not.toBeNull();
    expect(failure, 'by the ask it raised').toContain(ASKED);
  }, 900_000);
});
