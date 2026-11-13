// #1980.dbc0f471: "The GCC 16 evaluation's 688 failures resolve to one cause, raising one ask to that merge's owner whose
// `ask.created` carries its key, owner, 14-day deadline, fallback and default; inherited failures each make one fix task
// per cause. A planted router that asks per job raises 688 and fails this test, naming the evaluation"
//
// The replay of the kept snapshot runs once per replay below, into a fresh record through the real asks core, on the
// virtual clock (helpers.ts, useReplay). The snapshot is read back from the evidence store by its hash.
// asserts:
// 1. gcc16Check: the snapshot holds one evaluation where one merge broke 688 jobs; the record holds exactly one ask
//    the router raised pinned to that merge's commit; its ask.created is to the merge's owner as the snapshot gives it,
//    and carries a key (64 hex), a deadline 14 days after it was raised, a fallback and a default that is one of its
//    options.
// 2. fixTaskCheck: the snapshot holds inherited failures; the record holds exactly one task.created per build an
//    inherited failure inherits from (its subject `ev:<SNAPSHOT>#<build>`), and none for anything else.
// 3. Under `router-asks-per-job`, 688 asks pinned to that merge are raised, and gcc16Check fails naming the evaluation.
// Wrong program: the merge base, where packages/routing-replay doesn't exist; and the planted router.

import { describe, expect, it } from 'vitest';
import { SNAPSHOT, failsNaming, fixTaskCheck, gcc16Check, kept, none, useReplay } from './helpers.ts';

describe('the replay', () => {
  const world = useReplay();

  it("#1980.dbc0f471 the GCC 16 evaluation's 688 failures resolve to one cause, raising one ask to that merge's owner whose ask.created carries its key, owner, 14-day deadline, fallback and default", async () => {
    const w = world();
    const { snapshot } = await kept(w, SNAPSHOT);
    none(gcc16Check(snapshot, w.events).failures, 'the GCC 16 evaluation raised one ask to its merge\'s owner');
  });

  it('#1980.dbc0f471 inherited failures each make one fix task per cause', async () => {
    const w = world();
    const { snapshot } = await kept(w, SNAPSHOT);
    none(fixTaskCheck(snapshot, w.events), 'one fix task per cause of the inherited failures');
  });
});

describe('the replay under a planted router that asks per job', () => {
  const world = useReplay('router-asks-per-job');

  it('#1980.dbc0f471 a planted router that asks per job (router-asks-per-job) raises 688 and fails this test, naming the evaluation', async () => {
    const w = world();
    const { snapshot } = await kept(w, SNAPSHOT);
    const { evaluation, asks, failures } = gcc16Check(snapshot, w.events);
    expect(evaluation, 'the snapshot holds the evaluation where one merge broke 688 jobs').toBeDefined();
    expect(asks.length, `the planted router raises 688 asks for evaluation ${evaluation}`).toBe(688);
    failsNaming(failures, [`evaluation ${evaluation}`], 'the planted router that asks per job');
  });
});
