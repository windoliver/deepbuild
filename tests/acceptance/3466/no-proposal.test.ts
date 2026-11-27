// #3466.8e1d6afc: the change you approved is never proposed again, while its file is uncommitted or once it is
// committed as written.
//
// One world (README): the fixture repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`,
// `typecheck` and `unit` in the `done` claim. "stop checking lint in shop" is approved on its card and the box writes
// the file into the checkout. A claim is made there while the file is uncommitted, then the file is committed as
// written and nothing else, and a second claim is made, by a session whose task starts from that commit. After each
// claim is judged, the record holds no proposal naming `.deepbuild/done.yaml` made since the approval. The merge base
// reads the claim's spec from its base commit, finds the written file differs from it and records a proposal naming
// the file: the change you approved. The test fails naming that proposal.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, listed, must, said } from '../322/helpers.ts';
import { shownClaim } from '../1864/helpers.ts';
import { SPEC_FILE, WORDS, approve, commitSpec, nextClaim, openShop, proposalsSince, specAt, specOnDisk, uncommitted } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the approval (120 s), and for each of two claims its definition's lock (180 s), its hooks and its checks (900 s), on a machine other sessions load. */
const LIMIT = 3_600_000;

describe('#3466.8e1d6afc after "stop checking lint in shop" is approved, no proposal names .deepbuild/done.yaml, before the written file is committed and after it is committed as written', () => {
  it('#3466.8e1d6afc a claim made while the approved file is uncommitted, and one made from the commit that holds it as written, each leave the record with no proposal naming .deepbuild/done.yaml since the approval', async () => {
    const shop = await openShop();
    const approved = await approve(shop);

    // Before the file is committed.
    const before = await nextClaim(shop, shop.w.repo, 1);
    must(uncommitted(shop.w) && specOnDisk(shop.w.repo) === approved.written && before.base === shop.w.base, `BLOCKED: the first claim must be made while the approved file is on disk as written and uncommitted, from the repo's one commit ${shop.w.base}: its base commit is ${before.base} and the file holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    const first = proposalsSince(before.events, approved.at);
    // A hub that proposes the change you approved fails here.
    expect(first.map(said), `you approved "${WORDS}" on its card (${approved.ask}), and the file it wrote is on disk as written, uncommitted, so nothing differs from the revision you approved: once the next claim is judged, no proposal made since the approval names ${SPEC_FILE}. The change you approved is proposed again: ${listed(first)}; the claim: ${shownClaim(before.claim)}`).toEqual([]);

    // After it is committed as written.
    const commit = commitSpec(shop, 'Stop checking lint');
    must(specAt(shop.w, commit) === approved.written.trim(), `BLOCKED: the commit ${commit} must hold ${SPEC_FILE} as the approval wrote it: it holds ${JSON.stringify(specAt(shop.w, commit))}`);
    const after = await nextClaim(shop, shop.w.repo, 2);
    must(after.base === commit && !uncommitted(shop.w), `BLOCKED: the second claim must be made from the commit ${commit} that holds the file as written, with the file on disk as committed: its base commit is ${after.base}`);
    const second = proposalsSince(after.events, approved.at);
    expect(second.map(said), `the file "${WORDS}" wrote is committed as written (${commit.slice(0, 12)}), so it equals the revision you approved in the worktree and at the claim's base commit: once the next claim is judged, no proposal made since the approval names ${SPEC_FILE}. The change you approved is proposed again: ${listed(second)}; the claim: ${shownClaim(after.claim)}`).toEqual([]);
  }, LIMIT);
});
