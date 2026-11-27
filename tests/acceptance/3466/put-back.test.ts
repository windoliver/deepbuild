// #3466.e6689637: once a revision is kept, neither the worktree's file nor a commit changes a check.
//
// One world (README): the fixture repo `shop`, trusted, whose one commit holds `.deepbuild/done.yaml` with `lint`,
// `typecheck` and `unit` in the `done` claim. "stop checking lint in shop" is approved on its card, and the file the
// box wrote is committed as written, so the checkout's head holds the revision you approved.
// - The write: the spec on disk is put back to the first commit's bytes, which list `lint`, with no hook fired for it,
//   as a command's child writes. The next claim, by a session whose task starts from the commit that holds the
//   approved file, has no run of `lint`, and one proposal names `.deepbuild/done.yaml`. Only the worktree's file lists
//   `lint` here: a gate that takes the worktree's file once a revision is kept runs it.
// - The commit: that file is committed as the disk holds it. The next claim, by a session whose task starts from that
//   commit, has no run of `lint` either, and still one proposal names the file: the commit holds the difference the
//   write made. This claim's base commit lists `lint`: a gate that takes the base commit's file, as the merge base
//   does, runs it.
// Each failure names the check.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, listed, must } from '../322/helpers.ts';
import { runsOf, shownClaim, type ClaimRead, type RunRead } from '../1864/helpers.ts';
import { COMMITTED, SPEC_FILE, WORDS, approve, commitSpec, listedOnDone, nextClaim, openShop, proposalsOnceOne, proposalsSince, specAt, specOnDisk, uncommitted, whole, writeBehindHooks } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the approval (120 s), for each of two claims its definition's lock (180 s), its hooks and its checks (900 s), and the proposal (60 s), on a machine other sessions load. */
const LIMIT = 3_600_000;
/** One run in words: its check, its handle, the command it ran and how it ended. */
const ran = (r: RunRead): string => `${r.check} ${r.run} (${JSON.stringify(r.started.data.command ?? null)}) ${r.outcome ?? 'unfinished'}`;
/** The claim is judged on the revision you approved: no run of lint, and a run of typecheck and of unit. `why` says where lint is listed again. */
function judgedOnKept(c: ClaimRead, why: string): void {
  expect(runsOf(c, 'lint').map(ran), `${why}, which changes no check: the claim is judged on the revision you approved with "${WORDS}", which doesn't list lint in the done claim, so it has no run of lint. Lint ran: ${shownClaim(c)}`).toEqual([]);
  whole(c);
  for (const check of ['typecheck', 'unit'] as const) {
    expect(runsOf(c, check).length, `the revision you approved still lists ${check} in the done claim, so the claim has a run of ${check}: ${shownClaim(c)}`).toBeGreaterThan(0);
  }
}

describe('#3466.e6689637 with a revision kept, a write the guard did not recognize that puts lint back in the file on disk, and a later commit that does the same, each leave the next claim with no run of lint, and one proposal names the file', () => {
  it('#3466.e6689637 after lint is put back in .deepbuild/done.yaml on disk by a write no hook saw, and after that file is committed, the next claim has no run of lint and a run of typecheck and of unit, and one proposal names .deepbuild/done.yaml', async () => {
    const shop = await openShop();
    const approved = await approve(shop);
    const kept = commitSpec(shop, 'Stop checking lint');
    must(specAt(shop.w, kept) === approved.written.trim() && listedOnDone(specAt(shop.w, kept))?.includes('lint') === false, `BLOCKED: the commit ${kept} must hold ${SPEC_FILE} as the approval wrote it, without lint in the done claim: it holds ${JSON.stringify(specAt(shop.w, kept))}`);

    // The write the guard didn't recognize: lint is back in the file on disk, and nowhere else.
    writeBehindHooks(shop, COMMITTED);
    must(listedOnDone(specOnDisk(shop.w.repo))?.includes('lint') === true && uncommitted(shop.w), `BLOCKED: the write must put lint back in the done claim of ${SPEC_FILE} on disk, uncommitted: it holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    const written = await nextClaim(shop, shop.w.repo, 1);
    must(written.base === kept && specOnDisk(shop.w.repo) === COMMITTED && uncommitted(shop.w), `BLOCKED: the claim after the write must start from the commit ${kept} that holds the approved file, with lint back on disk alone: its base commit is ${written.base} and the file holds ${JSON.stringify(specOnDisk(shop.w.repo))}`);
    // A gate that takes the worktree's file once a revision is kept runs lint, and fails here.
    judgedOnKept(written.claim, `a write the guard didn't recognize put lint back in ${SPEC_FILE} on disk`);
    const afterWrite = await proposalsOnceOne(shop, approved.at);
    expect(afterWrite.length, `the file on disk differs from the revision you approved, and the difference becomes a proposal naming ${SPEC_FILE}, once: one proposal made since the approval names the file. They are ${listed(afterWrite)}`).toBe(1);

    // The later commit that does the same: lint is back at the next claim's base commit too.
    const back = commitSpec(shop, 'Check lint again');
    must(listedOnDone(specAt(shop.w, back))?.includes('lint') === true, `BLOCKED: the commit ${back} must hold ${SPEC_FILE} with lint back in the done claim: it holds ${JSON.stringify(specAt(shop.w, back))}`);
    const committed = await nextClaim(shop, shop.w.repo, 2);
    must(committed.base === back, `BLOCKED: the claim after the commit must start from that commit, ${back}, which lists lint: its base commit is ${committed.base}`);
    // A gate that takes the base commit's file once a revision is kept runs lint, and fails here.
    judgedOnKept(committed.claim, `the commit ${back.slice(0, 12)} put lint back in ${SPEC_FILE} at the claim's base commit, as the write did on disk`);
    const afterCommit = proposalsSince(committed.events, approved.at);
    expect(afterCommit.length, `the commit holds the same difference from the revision you approved as the write made, which is proposed once: one proposal made since the approval names ${SPEC_FILE}. They are ${listed(afterCommit)}`).toBe(1);
  }, LIMIT);
});
