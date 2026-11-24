// #1864: the gate runs each claim's spec checks from the approved revision of `.deepbuild/done.yaml`, never from the
// file the session's worktree holds. Until a repo has an approved revision, the one its claim's base commit holds
// stands in. A write no guard recognized, such as one a command's child makes, changes no check: the next claim is
// judged on the kept revision, and the difference becomes a proposal naming the file, as a drafted check's does.
//
// Each test is one world of #322's (README): a trusted fixture repo whose base commit holds the spec, the real hub and
// a Claude Code session through the real deep-hook. The session works through its hooks; then `.deepbuild/done.yaml`
// is changed on disk with no hook fired, and the session stops. The claim that stop makes is read from the record: its
// runs, its verdicts, and the proposals made after the write. The merge base reads the file from the worktree, so it
// is the wrong program for all three: it runs the rewritten line, runs no spec check once the file is gone, and moves
// the check the added `outside` entry names out of the sandbox after running the entry's build.
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, listed, verdict } from '../322/helpers.ts';
import {
  DELETED, FLAG_AND_FIX, FLAG_ONLY, RUN_TO_TRUE, SPEC_FILE, TYPECHECK_RUN, UNIT_AND_TYPECHECK, UNIT_ONLY, UNIT_RUN, claimAfter, deniedAfter, endedOf, outsideAdded, outsideFolder,
  proposedAfter, proposedBefore, runsOf, shownClaim, unitTestReaching,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the definition's lock (180 s), the hooks, the claim's checks (900 s) and the proposal (60 s) on a machine other sessions load. */
const LIMIT = 2_400_000;

describe('#1864.c1fc5bdd a unit check whose run line a write the guard did not recognize changed to true still fails on the next claim, and a proposal names .deepbuild/done.yaml', () => {
  it('#1864.c1fc5bdd with unit failing and its run line rewritten on disk to "true" by a write no hook saw, the next claim\'s run of unit ends failed, and a proposal names .deepbuild/done.yaml', async (ctx) => verdict(ctx, async () => {
    const r = await claimAfter({ spec: UNIT_ONLY, edits: FLAG_ONLY, write: RUN_TO_TRUE, waitsFor: ['unit'] });
    expect(proposedBefore(r).length, `a proposal comes from a difference: before the write ${SPEC_FILE} is on disk as its base commit holds it, so no proposal names it yet: ${listed(proposedBefore(r))}`).toBe(0);
    const ended = endedOf(r.claim, 'unit');
    expect(ended.length, `the base commit's ${SPEC_FILE} names unit on the done claim, so unit runs on the next claim whatever the file holds on disk: ${shownClaim(r.claim)}`).toBeGreaterThan(0);
    // A gate that reads done.yaml from the worktree runs `true` as unit, which doesn't fail, and fails here.
    expect(ended.filter((outcome) => outcome !== 'failed'), `unit's run line was rewritten on disk to "true" by a write the guard didn't recognize, which changes no check: every run of unit on the next claim runs the line the base commit holds, \`${UNIT_RUN}\`, whose test fails while checkToken takes a token whose exp has passed, so each ends failed: ${shownClaim(r.claim)}`).toEqual([]);
    expect(r.claim.verdicts.map((v) => String(v.data.outcome)), `unit fails on the next claim, so no verdict on it is PASS: ${shownClaim(r.claim)}`).not.toContain('PASS');
    const proposed = await proposedAfter(r);
    expect(proposed.naming.length, `the difference between ${SPEC_FILE} on disk and the kept revision becomes a proposal naming ${SPEC_FILE}, as a drafted check's does: the proposals since the write are ${listed(proposed.all)}`).toBeGreaterThan(0);
  }), LIMIT);
});

describe('#1864.0771441b with done.yaml deleted by the same kind of write, the next claim\'s spec checks run from the kept revision, and a proposal names the file', () => {
  it('#1864.0771441b with .deepbuild/done.yaml deleted on disk by a write no hook saw, unit and typecheck still run on the next claim from the revision its base commit holds and pass, and a proposal names .deepbuild/done.yaml', async (ctx) => verdict(ctx, async () => {
    const r = await claimAfter({ spec: UNIT_AND_TYPECHECK, edits: FLAG_AND_FIX, write: DELETED, waitsFor: ['unit', 'typecheck'] });
    expect(proposedBefore(r).length, `a proposal comes from a difference: before the write ${SPEC_FILE} is on disk as its base commit holds it, so no proposal names it yet: ${listed(proposedBefore(r))}`).toBe(0);
    // A gate that reads the file on disk finds no spec, runs no spec check, and fails here.
    for (const [check, run] of [['unit', UNIT_RUN], ['typecheck', TYPECHECK_RUN]] as const) {
      expect(runsOf(r.claim, check).length, `${SPEC_FILE} was deleted on disk by a write the guard didn't recognize, which changes no check: the revision the base commit holds names ${check} on the done claim (\`${run}\`), so ${check} still runs on the next claim: ${shownClaim(r.claim)}`).toBeGreaterThan(0);
    }
    for (const check of ['unit', 'typecheck'] as const) {
      const ended = endedOf(r.claim, check);
      expect(ended.length, `${check}'s run on the next claim ends: ${shownClaim(r.claim)}`).toBeGreaterThan(0);
      expect(ended.filter((outcome) => outcome !== 'passed'), `${check} runs the line the kept revision gives it, whose test passes on the session's fix, so each of its runs ends passed: ${shownClaim(r.claim)}`).toEqual([]);
    }
    const proposed = await proposedAfter(r);
    expect(proposed.naming.length, `the deleted ${SPEC_FILE} differs from the kept revision, and the difference becomes a proposal naming ${SPEC_FILE}: the proposals since the write are ${listed(proposed.all)}`).toBeGreaterThan(0);
  }), LIMIT);
});

describe('#1864.5912e17b an outside entry added to done.yaml by the same kind of write moves no check out of the sandbox and runs no build', () => {
  it('#1864.5912e17b with an outside entry naming unit, with a build, added on disk to .deepbuild/done.yaml by a write no hook saw, no build runs, and the next claim\'s run of unit stays in the sandbox, which refuses its write outside the checkout and records it', async (ctx) => verdict(ctx, async () => {
    const o = outsideFolder();
    const r = await claimAfter({ spec: UNIT_ONLY, files: { 'tests/unit.test.js': unitTestReaching(o) }, edits: FLAG_AND_FIX, write: outsideAdded(o), waitsFor: ['unit'] });
    const unit = runsOf(r.claim, 'unit');
    // A gate that reads the outside block from the worktree runs the entry's build, then unit outside the sandbox, and fails here.
    expect(existsSync(o.built), `the outside entry was added on disk to ${SPEC_FILE} by a write the guard didn't recognize, which changes no check: the revision the base commit holds has no outside block, so no build runs for the next claim; the entry's build ran and wrote ${o.built}: ${shownClaim(r.claim)}`).toBe(false);
    expect(endedOf(r.claim, 'unit').length, `the base commit's ${SPEC_FILE} names unit on the done claim, so unit runs on the next claim whatever the file holds on disk: ${shownClaim(r.claim)}`).toBeGreaterThan(0);
    expect(existsSync(o.reached), `the added outside entry names unit, and moves no check out of the sandbox: unit's run stays in the sandbox, which refuses a write outside its checkout; unit's test wrote ${o.reached}, so unit ran outside the sandbox: ${shownClaim(r.claim)}`).toBe(false);
    expect(unit.filter((run) => ((run.started.data.withheld ?? []) as unknown[]).includes('outside')).map((run) => `${run.run} withheld ${JSON.stringify(run.started.data.withheld)}`), `no run of unit on the next claim is recorded as started outside the sandbox (run.started, withheld): ${shownClaim(r.claim)}`).toEqual([]);
    expect(endedOf(r.claim, 'unit').filter((outcome) => outcome !== 'passed'), `unit runs the line the kept revision gives it in the sandbox, where its test's write outside the checkout is refused and checkToken rejects an expired token after the session's fix, so each of its runs ends passed: ${shownClaim(r.claim)}`).toEqual([]);
    // The run records the sandbox it ran in: the supervisor records what the sandbox refused it.
    const denied = await deniedAfter(r, unit, o.reached);
    expect(denied.naming.length, `unit's run records the sandbox it ran in: a sandbox.denied of one of its runs (${unit.map((run) => run.run).join(', ')}) names ${o.reached}, the write the sandbox refused it; the sandbox.denied events of its runs are ${listed(denied.all)}`).toBeGreaterThan(0);
  }), LIMIT);
});
