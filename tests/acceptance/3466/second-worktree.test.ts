// #3466.8e1d6afc: the change you approved is never proposed again, in a second worktree of the repo either.
//
// Added on this suite's redraft (README, Readings): the repository's owner settled that after the approval the claim
// in the second worktree leaves no proposal naming `.deepbuild/done.yaml` either. That worktree's own file still
// lists `lint`, as its commit holds it: it is the change you approved waiting for its commit to arrive, never a
// difference to propose again.
//
// One world (README): the fixture repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`,
// `typecheck` and `unit` in the `done` claim, and a second worktree of it from that commit. "stop checking lint in
// shop" is approved on its card and the box writes the file into the checkout, where it stays uncommitted. Then the
// next claim in the second worktree, a new session's first stop, is read from the record once judged: no proposal
// made since the approval names `.deepbuild/done.yaml`. That absence counts only on a claim the hub judged on the
// revision you approved, as criterion 1 reads it (it passed with no run of `lint` and a run of `typecheck` and of
// `unit`): a hub that keeps no revision judges the claim on its base commit's spec, which the worktree's file equals,
// so it has nothing to propose there, and the test is BLOCKED on it, never a pass. The merge base is such a hub. The
// wrong program is a planted twin (README, The wrong programs): a hub that keeps the revision and proposes every
// worktree file that differs from it records a proposal here, and the test fails naming it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, listed, must, said } from '../322/helpers.ts';
import { runsOf, shownClaim, type RunRead } from '../1864/helpers.ts';
import { COMMITTED, SPEC_FILE, WORDS, approve, listedOnDone, nextClaim, openShop, proposalsSince, specAt, specOnDisk, uncommitted, whole } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the approval (120 s), the definition's lock (180 s), the hooks and the claim's checks (900 s), on a machine other sessions load. */
const LIMIT = 2_400_000;
/** One run in words: its check, its handle, the command it ran and how it ended. */
const ran = (r: RunRead): string => `${r.check} ${r.run} (${JSON.stringify(r.started.data.command ?? null)}) ${r.outcome ?? 'unfinished'}`;

describe('#3466.8e1d6afc after "stop checking lint in shop" is approved, the next claim in a second worktree of the repo, whose own file still lists lint, leaves no proposal naming .deepbuild/done.yaml either', () => {
  it('#3466.8e1d6afc with the approved file uncommitted in the checkout, the next claim in a second worktree is judged on the revision you approved, and the record holds no proposal naming .deepbuild/done.yaml since the approval', async () => {
    const shop = await openShop({ second: true });
    const second = shop.second!;
    const approved = await approve(shop);
    const next = await nextClaim(shop, second, 1);
    // The situation: the approved file is on disk in the checkout alone, as written and uncommitted; the second
    // worktree's own file is the committed spec, which lists lint, and so is its claim's base commit's.
    must(uncommitted(shop.w) && specOnDisk(shop.w.repo) === approved.written, `BLOCKED: the approved file must still be on disk in the checkout as written, uncommitted: it holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    must(specOnDisk(second) === COMMITTED && listedOnDone(specOnDisk(second))?.includes('lint') === true, `BLOCKED: the second worktree's own ${SPEC_FILE} must still be the committed spec, which lists lint: the change you approved hasn't reached its commit. It holds ${JSON.stringify(specOnDisk(second))}`);
    must(next.base === shop.w.base && specAt(shop.w, next.base) === COMMITTED.trim(), `BLOCKED: the claim's base commit must be the repo's one commit ${shop.w.base}, which holds the committed spec: it is ${next.base}`);
    const c = next.claim;
    const proposed = proposalsSince(next.events, approved.at);
    // A hub that proposes every worktree file that differs from the kept revision fails here.
    expect(proposed.map(said), `you approved "${WORDS}" on its card (${approved.ask}). The second worktree's own ${SPEC_FILE} still lists lint, as its commit holds it: it is the change you approved waiting for its commit to arrive, not a difference from the revision you approved. So once the next claim there is judged, no proposal made since the approval names ${SPEC_FILE}. The change you approved is proposed again: ${listed(proposed)}; the claim: ${shownClaim(c)}`).toEqual([]);
    // No proposal says so only where the hub judged this claim on the revision you approved, which the worktree's file
    // differs from. On a hub that judged it on its base commit's spec, which the file equals, nothing could be proposed.
    const lint = runsOf(c, 'lint');
    must(lint.length === 0, `BLOCKED: no proposal names ${SPEC_FILE} since the approval, but the claim in the second worktree was not judged on the revision you approved, which doesn't list lint: lint ran (${lint.map(ran).join(', ')}). A hub that judges the claim on its base commit's spec, which the worktree's own file equals, has no difference to propose there, so the absence proves nothing: ${shownClaim(c)}`);
    whole(c);
    const missing = (['typecheck', 'unit'] as const).filter((check) => runsOf(c, check).length === 0);
    must(missing.length === 0, `BLOCKED: no proposal names ${SPEC_FILE} since the approval, but the claim in the second worktree was not judged on the revision you approved, which lists typecheck and unit: it has no run of ${missing.join(', ')}, so the absence proves nothing: ${shownClaim(c)}`);
  }, LIMIT);
});
