// #3466.45462705: an approved change counts before it is committed, and reaches every worktree of the repo.
//
// One world (README): the fixture repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`,
// `typecheck` and `unit` in the `done` claim, and a second worktree of it from that commit. "stop checking lint in
// shop" goes to the box and is approved on its card; the box writes the file into the checkout, where it stays
// uncommitted. Then the next claim in that checkout, and the next claim in the second worktree, each a new session's
// first stop, are read from the record: neither has a run of `lint`, and each has a run of `typecheck` and of `unit`.
// Both claims' base commit is the repo's one commit, whose spec lists `lint`: a gate that reads the spec from the
// claim's base commit, as the merge base does, runs `lint`, and the test fails naming the check.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, must } from '../322/helpers.ts';
import { runsOf, shownClaim, type RunRead } from '../1864/helpers.ts';
import { SPEC_FILE, WORDS, approve, listedOnDone, nextClaim, openShop, specAt, specOnDisk, uncommitted, whole } from './helpers.ts';

afterEach(cleanup, 60_000);

/** Two hubs' worth of waits: a start, the approval (120 s), and for each claim its definition's lock (180 s), its hooks and its checks (900 s), on a machine other sessions load. */
const LIMIT = 3_600_000;
/** One run in words: its check, its handle, the command it ran and how it ended. */
const ran = (r: RunRead): string => `${r.check} ${r.run} (${JSON.stringify(r.started.data.command ?? null)}) ${r.outcome ?? 'unfinished'}`;

describe('#3466.45462705 with "stop checking lint in shop" approved on its card and the written file left uncommitted, the next claim in that checkout and the next claim in a second worktree each run typecheck and unit and not lint', () => {
  it('#3466.45462705 the next claim in the checkout the file was written in, and the next claim in a second worktree of the repo, each have a run of typecheck and of unit and none of lint, though each one\'s base commit holds a spec that lists lint', async () => {
    const shop = await openShop({ second: true });
    const second = shop.second!;
    await approve(shop);
    const claims = [
      { where: 'in the checkout the approved file was written in', folder: shop.w.repo, turn: 1 },
      { where: 'in a second worktree of the repo', folder: second, turn: 2 },
    ];
    for (const { where, folder, turn } of claims) {
      const next = await nextClaim(shop, folder, turn);
      // The situation: the approved file is on disk in the checkout alone, uncommitted; the second worktree's own file
      // and each claim's base commit still list lint.
      must(uncommitted(shop.w) && listedOnDone(specOnDisk(shop.w.repo))?.includes('lint') === false, `BLOCKED: the approved file must still be on disk in the checkout, uncommitted and without lint in the done claim: it holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
      must(listedOnDone(specOnDisk(second))?.includes('lint') === true, `BLOCKED: the second worktree's own ${SPEC_FILE} must still list lint, as its commit holds it, so only the revision the hub keeps can take lint out of its claim: it holds ${JSON.stringify(specOnDisk(second))}`);
      must(next.base === shop.w.base && listedOnDone(specAt(shop.w, next.base))?.includes('lint') === true, `BLOCKED: the claim's base commit must be the repo's one commit ${shop.w.base}, whose ${SPEC_FILE} lists lint: it is ${next.base}`);
      const c = next.claim;
      // A gate that reads the spec from the claim's base commit runs lint, and fails here.
      expect(runsOf(c, 'lint').map(ran), `"${WORDS}" was approved on its card and the written file is left uncommitted, so the next claim ${where} is judged on the revision you approved, which no longer lists lint in the done claim: it has no run of lint. Its base commit ${next.base.slice(0, 12)} holds a spec that lists lint, and lint ran: ${shownClaim(c)}`).toEqual([]);
      whole(c);
      for (const check of ['typecheck', 'unit'] as const) {
        expect(runsOf(c, check).length, `the revision you approved still lists ${check} in the done claim, so the next claim ${where} has a run of ${check}: ${shownClaim(c)}`).toBeGreaterThan(0);
      }
    }
  }, LIMIT);
});
