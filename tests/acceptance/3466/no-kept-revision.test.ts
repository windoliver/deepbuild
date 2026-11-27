// #3466.dc3e4e56: in a repo with no kept revision, the revision its claim's base commit holds still stands in.
//
// The criterion's own proof is #1864's three tests and #33's bootstrap criterion, run unchanged beside this suite
// (README, Criteria to tests). This test holds the same rule in this suite's fixture, where the kept revision could
// break it: the repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`, `typecheck` and
// `unit` in the `done` claim, and nothing approved, so the hub keeps no revision for it. The file on disk loses `lint`
// from the `done` claim by a write no hook saw, the file state criterion 1 reaches by your approval, here with nobody's.
// The next claim still has a run of `lint`, of `typecheck` and of `unit`, as its base commit's spec lists them, and a
// proposal names `.deepbuild/done.yaml`. It passes on the merge base. The wrong program (README, The wrong programs):
// a gate that, while a repo has no kept revision, takes the file in the claim's folder runs no `lint`, and the test
// fails naming the check.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, lastPos, listed, must } from '../322/helpers.ts';
import { runsOf, shownClaim } from '../1864/helpers.ts';
import { SPEC_FILE, WITHOUT_LINT, listedOnDone, nextClaim, openShop, proposalsOnceOne, specAt, specOnDisk, uncommitted, whole, writeBehindHooks } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the definition's lock (180 s), the hooks, the claim's checks (900 s) and the proposal (60 s), on a machine other sessions load. */
const LIMIT = 2_400_000;

describe('#3466.dc3e4e56 in a repo with no kept revision, the revision the claim\'s base commit holds stands in, as #1864 has it', () => {
  it('#3466.dc3e4e56 with nothing approved and lint taken out of .deepbuild/done.yaml on disk by a write no hook saw, the next claim still has a run of lint, of typecheck and of unit, and a proposal names .deepbuild/done.yaml', async () => {
    const shop = await openShop();
    const wrote = await lastPos(shop.hub);
    // Nothing is said to the box and nothing approved: the hub keeps no revision for this repo.
    writeBehindHooks(shop, WITHOUT_LINT);
    must(listedOnDone(specOnDisk(shop.w.repo))?.join() === 'typecheck,unit' && uncommitted(shop.w), `BLOCKED: the write must take lint out of the done claim of ${SPEC_FILE} on disk, uncommitted: it holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    const next = await nextClaim(shop, shop.w.repo, 1);
    must(next.base === shop.w.base && listedOnDone(specAt(shop.w, next.base))?.join() === 'lint,typecheck,unit', `BLOCKED: the claim's base commit must be the repo's one commit ${shop.w.base}, whose ${SPEC_FILE} lists lint, typecheck and unit: it is ${next.base}`);
    const c = next.claim;
    const missing = (['lint', 'typecheck', 'unit'] as const).filter((check) => runsOf(c, check).length === 0);
    // A check with no run was left out only on a claim that passed; on any other it may not have started.
    if (missing.length) whole(c);
    // A gate that takes the worktree's file while the repo has no kept revision runs no lint, and fails here.
    expect(missing, `nothing was approved in this repo, so the hub keeps no revision for it and the one its claim's base commit ${next.base.slice(0, 12)} holds stands in: the next claim has a run of lint, of typecheck and of unit, whatever the file holds on disk, where a write the guard didn't recognize took lint out. No run of ${missing.join(', ')}: ${shownClaim(c)}`).toEqual([]);
    const proposed = await proposalsOnceOne(shop, wrote);
    expect(proposed.length, `the file on disk differs from the revision the base commit holds, and the difference becomes a proposal naming ${SPEC_FILE}, as #1864 has it: the proposals naming the file since the write are ${listed(proposed)}`).toBeGreaterThan(0);
  }, LIMIT);
});
