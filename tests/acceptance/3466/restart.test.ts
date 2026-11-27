// #3466.13da4cdd: the revision you approved is kept past the hub's own process.
//
// One world (README): the fixture repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`,
// `typecheck` and `unit` in the `done` claim. "stop checking lint in shop" is approved on its card and the box writes
// the file into the checkout, uncommitted. No claim is made yet. The hub is stopped, and another is started on the
// same home. Then the next claim in the checkout, a new session's first stop, is read from the record: it has no run
// of `lint`, and a run of `typecheck` and of `unit`, as on the revision you approved. Its base commit is the repo's
// one commit, whose spec lists `lint`: a hub that kept the revision only in its memory has none after the start,
// judges the claim on its base commit's spec and runs `lint` again, as the merge base does, and the test fails naming
// the check.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, must } from '../322/helpers.ts';
import { runsOf, shownClaim, type RunRead } from '../1864/helpers.ts';
import { SPEC_FILE, WORDS, approve, listedOnDone, nextClaim, openShop, restart, specAt, specOnDisk, uncommitted, whole } from './helpers.ts';

afterEach(cleanup, 60_000);

/** Two hubs' starts and a stop, the approval (120 s), the definition's lock (180 s), the hooks and the claim's checks (900 s), on a machine other sessions load. */
const LIMIT = 2_400_000;
/** One run in words: its check, its handle, the command it ran and how it ended. */
const ran = (r: RunRead): string => `${r.check} ${r.run} (${JSON.stringify(r.started.data.command ?? null)}) ${r.outcome ?? 'unfinished'}`;

describe('#3466.13da4cdd after the hub is stopped and started again, the next claim is judged on the same kept revision', () => {
  it('#3466.13da4cdd with "stop checking lint in shop" approved, the hub stopped and another started on its home, the next claim has a run of typecheck and of unit and none of lint', async () => {
    const shop = await openShop();
    const approved = await approve(shop);
    const hubs = await restart(shop);
    const next = await nextClaim(shop, shop.w.repo, 1);
    // The situation: a new hub process judged the claim; the approved file is on disk, uncommitted; the claim's base commit lists lint.
    must(shop.hub.pid === hubs.started && hubs.started !== hubs.stopped, `BLOCKED: the hub that judged the claim must be the one started after the stop (pid ${hubs.started}), a new process: the stopped one had pid ${hubs.stopped}, and the claim was read from pid ${shop.hub.pid}`);
    must(uncommitted(shop.w) && specOnDisk(shop.w.repo) === approved.written, `BLOCKED: the approved file must still be on disk as written, uncommitted: it holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    must(next.base === shop.w.base && listedOnDone(specAt(shop.w, next.base))?.includes('lint') === true, `BLOCKED: the claim's base commit must be the repo's one commit ${shop.w.base}, whose ${SPEC_FILE} lists lint: it is ${next.base}`);
    const c = next.claim;
    // A hub that keeps the revision only in memory judges this claim on its base commit's spec, runs lint again, and fails here.
    expect(runsOf(c, 'lint').map(ran), `"${WORDS}" was approved before the hub (pid ${hubs.stopped}) was stopped, so the hub started after it (pid ${hubs.started}) judges the next claim on the same kept revision, which no longer lists lint in the done claim: the claim has no run of lint. Its base commit ${next.base.slice(0, 12)} holds a spec that lists lint, and lint ran again: ${shownClaim(c)}`).toEqual([]);
    whole(c);
    for (const check of ['typecheck', 'unit'] as const) {
      expect(runsOf(c, check).length, `the revision you approved still lists ${check} in the done claim, so the next claim after the hub's stop and start has a run of ${check}: ${shownClaim(c)}`).toBeGreaterThan(0);
    }
  }, LIMIT);
});
