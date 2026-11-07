// #1328 AC4 and AC5: disputes, through a real hub, on an attempt with real work on its branch. The disputed first draft
// expects navy, so it fails on the base at its assertion and on the work, where the widget is blue. Each redraft is a
// fresh job, and the hub runs each draft on the work and on the base itself. The guard's half runs the real guard.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BLUE, BLUE_AGAIN, checkoutOf, draftBytes, ELSEWHERE, firstDraft, gateTag, git, HOLLOW, ISSUE, LIMIT, NAVY, NEXT, once, redraft, removeTemp, runGuard, TEAL, widgetFile, withStage, type Stage, type Status,
} from './helpers.ts';

afterAll(removeTemp, 60_000);

/** The attempt's branch is still at `expected`, the work, with the first draft: no swap touched the test. */
function stood(s: Stage, status: Status, expected: string): void {
  expect(git(s.repo, 'rev-parse', `refs/heads/${status.branch}`), `the head of ${status.branch}`).toBe(expected);
  expect(s.show(expected, widgetFile(ISSUE)), 'the disputed test on the branch').toBe(draftBytes(ISSUE, NAVY));
}

/** The dispute where the redraft and the third draft both pass on the work and fail on the base: the tests below read it. */
const swapped = once(() => withStage({}, async (s) => {
  const status = await s.ready(ISSUE, NAVY);
  const first = await s.inputsOf(status.jobs[0]!);
  const work = s.work(status);
  s.plans.push(redraft(ISSUE, BLUE), redraft(ISSUE, BLUE_AGAIN));
  await s.dispute(work);
  const dispute = await s.decided();
  const settled = await s.quiet();
  const again = await s.dispute(work);
  const after = await s.quiet();
  for (const job of dispute.jobs) await s.blind(job, first);
  const head = git(s.repo, 'rev-parse', `refs/heads/${status.branch}`);
  return {
    dir: s.dir, repo: s.repo, gatesFile: s.gatesFile, gateKey: s.gateKey!, work, dispute, settled, again, after, head,
    parent: dispute.commit ? git(s.repo, 'rev-parse', `${dispute.commit}^`) : null,
    files: dispute.commit ? git(s.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', dispute.commit) : null,
    kept: dispute.commit ? s.show(dispute.commit, widgetFile(ISSUE)) : null,
  };
}));

/** A dispute whose redraft and third draft pass on the work, one of them on the base too: that swap is refused, naming the test. */
async function plantedSwap(second: string, third: string): Promise<void> {
  await withStage({}, async (s) => {
    const status = await s.ready(ISSUE, NAVY);
    const work = s.work(status);
    s.plans.push(redraft(ISSUE, second), redraft(ISSUE, third));
    await s.dispute(work);
    const dispute = await s.decided();
    const planted = dispute.jobs[second === HOLLOW ? 0 : 1];
    const refused = dispute.refused.find((r) => r.job === planted);
    expect(refused?.test, `the refusal of planted draft ${planted}: ${JSON.stringify(dispute)}`).toContain(widgetFile(ISSUE));
    expect(dispute.outcome, 'the other draft that agrees still meets the base rule').toBe('swapped');
    expect(dispute.commit, 'the swap has a commit').toBeTruthy();
    expect(s.show(dispute.commit!, widgetFile(ISSUE)), 'the test the swap kept').toBe(draftBytes(ISSUE, BLUE));
    expect((await s.quiet()).asks, 'asks raised by a refused swap with a draft to keep').toBe(0);
  });
}

describe('AC4 #1328.1533f79d a dispute where the redraft also fails on the work raises no ask and the test stands; one where it passes starts a third draft, the two that agree decide and no ask is raised; a planted swap to a draft that passes on the base is refused, naming the test', () => {
  it('AC4 a redraft that also fails on the work raises no ask, starts no third draft and the test stands; it had the same inputs and the criterion, and nothing of the work or the dispute', async () => {
    await withStage({}, async (s) => {
      const status = await s.ready(ISSUE, NAVY);
      const first = await s.inputsOf(status.jobs[0]!);
      const work = s.work(status);
      s.setBodies({ [ISSUE]: 'The issue as edited after the job read it.\n' });
      s.plans.push(redraft(ISSUE, TEAL));
      const { job } = await s.dispute(work);
      expect(job, 'the dispute starts a job').toBeTruthy();
      const dispute = await s.decided();
      expect(dispute.outcome, `the dispute's outcome: ${JSON.stringify(dispute)}`).toBe('stands');
      expect(dispute.jobs, 'the redrafts of a test whose redraft also fails on the work').toEqual([job]);
      expect(await s.quiet(), 'jobs and asks after the test stands').toEqual({ jobs: 2, asks: 0 });
      stood(s, status, work);
      await s.blind(job as string, first);
    });
  }, LIMIT);

  it('AC4 a redraft and a third draft that pass on the work decide: the hub swaps the test from the gate identity with no ask, after exactly two redrafts', async () => {
    const f = await swapped();
    expect(f.dispute.outcome, `the dispute's outcome: ${JSON.stringify(f.dispute)}`).toBe('swapped');
    expect(f.settled, 'jobs and asks after the swap: the first draft and two redrafts, no ask').toEqual({ jobs: 3, asks: 0 });
    expect([draftBytes(ISSUE, BLUE), draftBytes(ISSUE, BLUE_AGAIN)], 'the test the swap kept is a draft that agreed').toContain(f.kept);
    expect(f.files, 'what the swap commit changes').toBe(widgetFile(ISSUE));
    expect(f.parent, "the swap commit's parent is the work").toBe(f.work);
    expect(f.head, "the branch's head is the swap").toBe(f.dispute.commit);
  }, LIMIT);

  it('AC4 a redraft that passes and a third draft that fails on the work leave the two failing drafts deciding: the test stands with no ask', async () => {
    await withStage({}, async (s) => {
      const status = await s.ready(ISSUE, NAVY);
      const work = s.work(status);
      s.plans.push(redraft(ISSUE, BLUE), redraft(ISSUE, TEAL));
      await s.dispute(work);
      const dispute = await s.decided();
      expect(dispute.outcome, `the dispute's outcome: ${JSON.stringify(dispute)}`).toBe('stands');
      expect(await s.quiet(), 'jobs and asks after the third draft: the first draft and two redrafts, no ask').toEqual({ jobs: 3, asks: 0 });
      stood(s, status, work);
    });
  }, LIMIT);

  it('AC4 a planted redraft that passes on the base is refused, naming the test, and the third draft is kept', async () => {
    await plantedSwap(HOLLOW, BLUE);
  }, LIMIT);

  it('AC4 a planted third draft that passes on the base is refused, naming the test, and the redraft is kept', async () => {
    await plantedSwap(BLUE, HOLLOW);
  }, LIMIT);

  it("AC4 the guard takes the hub's swap on the gate identity, not without it, and not for a file outside the folder", async () => {
    const f = await swapped();
    const swap = f.dispute.commit!;
    const cwd = checkoutOf(f.repo, swap, 'guard');
    const gated = runGuard(cwd, f.dir, f.gatesFile);
    expect(gated.refused, `the guard on the swap, with the gate identity accepted\n${gated.text}`).toEqual([]);
    expect(gated.status, gated.text).toBe(0);
    const unknown = runGuard(cwd, f.dir, null);
    expect(unknown.refused.some((line) => line.includes(widgetFile(ISSUE))), `the guard on the swap, with no gate identity accepted, refuses ${widgetFile(ISSUE)}\n${unknown.text}`).toBe(true);
    const tag = git(cwd, 'for-each-ref', '--points-at', swap, '--format=%(refname)', 'refs/tags/').split('\n')[0]!;
    expect(tag, 'the tag the hub signed on its swap').not.toBe('');
    writeFileSync(join(cwd, 'scripts/proof-guard.mjs'), '// weakened\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', `Weaken the guard\n\nPart of #${ISSUE}`);
    gateTag(cwd, f.gateKey, tag, git(cwd, 'rev-parse', 'HEAD'), ['scripts/proof-guard.mjs']);
    const planted = runGuard(cwd, f.dir, f.gatesFile);
    expect(planted.refused.some((line) => line.startsWith('FAIL guard: scripts/proof-guard.mjs')), `the guard refuses a gate signature outside the folder\n${planted.text}`).toBe(true);
  }, LIMIT);

  it('AC4 (until #1325 lands) a hub with no gate identity makes no swap: the agreeing drafts go to one ask', async () => {
    await withStage({ gate: false }, async (s) => {
      const status = await s.ready(ISSUE, NAVY);
      const work = s.work(status);
      s.plans.push(redraft(ISSUE, BLUE), redraft(ISSUE, BLUE_AGAIN));
      await s.dispute(work);
      const dispute = await s.decided();
      expect(dispute.outcome, `the dispute's outcome: ${JSON.stringify(dispute)}`).toBe('asked');
      expect(dispute.commit, 'a swap with no gate identity').toBeNull();
      expect((await s.quiet()).asks, 'asks raised with no gate identity').toBe(1);
      stood(s, status, work);
    });
  }, LIMIT);
});

describe('AC5 #1328.3cf9c8d9 a dispute on a test already settled starts no job; when no draft meets the base rule, one ask carries the drafts, and the next ready issue runs in that slot', () => {
  it('AC5 a dispute on a test that stood starts no job and raises no ask', async () => {
    await withStage({}, async (s) => {
      const status = await s.ready(ISSUE, NAVY);
      const work = s.work(status);
      s.plans.push(redraft(ISSUE, TEAL));
      await s.dispute(work);
      await s.decided();
      const before = await s.quiet();
      const again = await s.dispute(work);
      expect(again, 'the reply to a dispute on a settled test').toEqual({ job: null, settled: true });
      expect(await s.quiet(), 'jobs and asks after a dispute on a settled test').toEqual(before);
    });
  }, LIMIT);

  it('AC5 a dispute on a test its third draft settled starts no job and raises no ask: a test is redrafted at most twice', async () => {
    const f = await swapped();
    expect(f.again, 'the reply to a dispute on a swapped test').toEqual({ job: null, settled: true });
    expect(f.after, 'jobs and asks after a dispute on a swapped test').toEqual(f.settled);
  }, LIMIT);

  it('AC5 when the agreeing drafts meet no base rule, one ask carries the drafts, the issue gives up its slot, the next ready issue runs in it, and a further dispute asks nothing again', async () => {
    await withStage({ slots: 1 }, async (s) => {
      const status = await s.ready(ISSUE, NAVY);
      const work = s.work(status);
      const queued = await s.start(NEXT);
      expect(queued, 'the next issue, with the one slot taken').toEqual({ job: null, state: 'queued' });
      expect((await s.status(NEXT)).jobs, 'the jobs of the next issue while the slot is taken').toEqual([]);
      // One draft passes on the base; the other fails there away from any assertion.
      s.plans.push(redraft(ISSUE, HOLLOW), redraft(ISSUE, ELSEWHERE), firstDraft(NEXT));
      await s.dispute(work);
      const dispute = await s.decided();
      expect(dispute.outcome, `the dispute's outcome: ${JSON.stringify(dispute)}`).toBe('asked');
      expect(dispute.commit, 'a swap with no draft that meets the base rule').toBeNull();
      stood(s, status, work);
      const next = await s.judged(NEXT);
      expect(next.result, `the next issue's result, why ${next.why}`).toBe('ready');
      const asks = await s.asks();
      expect(asks, 'the asks raised').toHaveLength(1);
      const asked = JSON.stringify(asks[0]);
      const drafts = (await s.status()).jobs;
      expect(drafts, 'the drafts of the disputed test').toHaveLength(3);
      for (const job of drafts) expect(asked, `the ask carries draft ${job}`).toContain(job);
      const started = (await s.events('job.recorded')).find((e) => e.data.job === next.jobs[0]);
      expect(started?.log_pos, "the next issue's job comes after the ask").toBeGreaterThan(asks[0]!.log_pos as number);
      const again = await s.dispute(work);
      expect(again, 'the reply to a dispute on a test already asked about').toEqual({ job: null, settled: true });
      expect((await s.quiet()).asks, 'asks after a further dispute').toBe(1);
    });
  }, LIMIT);
});
