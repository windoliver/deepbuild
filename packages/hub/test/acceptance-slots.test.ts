// #1328: the blind job's slot after the first draft, which the issue's acceptance suite leaves out. An issue keeps its
// slot through its attempt and gives it up when the attempt ends (`acceptance.ended`), and your answer to a dispute's
// ask goes in: a draft you take is swapped onto the branch unsigned, for you to approve, and the issue takes the next
// free slot unless you held it. Same scene as tests/acceptance/1328: a real hub, repo, sandbox and asks; a stand-in agent.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  BLUE, BLUE_AGAIN, draftBytes, firstDraft, git, ISSUE, LIMIT, NAVY, NEXT, redraft, removeTemp, widgetFile, withStage, type Stage,
} from '../../../tests/acceptance/1328/helpers.ts';

afterAll(removeTemp, 60_000);

const link = (n: number): string => `https://github.com/fixture/widgets/issues/${n}`;

/** A ready issue whose dispute two passing drafts agree on, asked of you because the hub holds no gate identity. */
async function asked(s: Stage): Promise<{ work: string; ask: string; drafts: string[]; branch: string }> {
  const status = await s.ready(ISSUE, NAVY);
  const work = s.work(status);
  s.plans.push(redraft(ISSUE, BLUE), redraft(ISSUE, BLUE_AGAIN));
  await s.dispute(work);
  const dispute = await s.decided();
  expect(dispute.outcome, `the dispute before your answer: ${JSON.stringify(dispute)}`).toBe('asked');
  const asks = await s.asks();
  expect(asks, 'the asks raised').toHaveLength(1);
  return { work, ask: `ask:${String(asks[0]!.id)}`, drafts: dispute.jobs, branch: status.branch! };
}

/** Your answer, from the CLI, with the OS prompt standing in as confirmed. */
function confirmed(): void {
  const file = join(mkdtempSync(join(tmpdir(), 'dh1328-confirm-')), 'confirm');
  writeFileSync(file, 'confirmed\n');
  process.env.DEEP_HUB_TEST_CONFIRM = file;
}

/** Waits until `probe` holds, or fails naming `what`. */
async function until(probe: () => Promise<boolean>, what: string): Promise<void> {
  for (const end = Date.now() + 60_000; Date.now() < end; await new Promise((done) => setTimeout(done, 200))) if (await probe()) return;
  expect.fail(`${what} never happened`);
}

it("an issue keeps its slot through its attempt, and the attempt's end hands it to the next that waits", async () => {
  await withStage({ slots: 1 }, async (s) => {
    await s.ready(ISSUE);
    expect(await s.start(NEXT), 'the next issue while the attempt holds the one slot').toEqual({ job: null, state: 'queued' });
    await s.quiet();
    expect((await s.status(NEXT)).jobs, 'jobs of the next issue while the attempt runs').toEqual([]);
    s.plans.push(firstDraft(NEXT));
    expect(await s.answered('acceptance.ended', { issue: link(ISSUE) }), 'the reply to the end of the attempt').toEqual({ ended: true });
    const next = await s.judged(NEXT);
    expect(next.result, `the next issue's result once the slot is free, why ${next.why}`).toBe('ready');
  });
}, LIMIT);

it('a draft you take from the ask goes onto the branch unsigned, the dispute reads swapped, and the issue takes the slot back', async () => {
  confirmed();
  await withStage({ slots: 1, gate: false }, async (s) => {
    const { work, ask, drafts, branch } = await asked(s);
    await s.answered('ask.answer', { ask, option: drafts[0] });
    await until(async () => (await s.status()).disputes[0]?.outcome === 'swapped', 'the swap after your answer');
    const dispute = (await s.status()).disputes[0]!;
    const head = git(s.repo, 'rev-parse', `refs/heads/${branch}`);
    expect(dispute.commit, 'the commit of the swap you took').toBe(head);
    expect(git(s.repo, 'rev-parse', `${head}^`), 'the parent of the swap').toBe(work);
    expect(s.show(head, widgetFile(ISSUE)), 'the test the swap holds').toBe(draftBytes(ISSUE, BLUE));
    expect(git(s.repo, 'tag', '--points-at', head), 'tags on a swap only you can sign').toBe('');
    expect(await s.start(NEXT), 'the next issue, with the slot back with the answered issue').toEqual({ job: null, state: 'queued' });
    await s.quiet();
    expect((await s.status(NEXT)).jobs, 'jobs of the next issue while the answered issue holds the slot').toEqual([]);
  });
}, LIMIT);

it('holding the issue keeps the test as it stands and leaves the slot to the next issue', async () => {
  confirmed();
  await withStage({ slots: 1, gate: false }, async (s) => {
    const { work, ask, branch } = await asked(s);
    await s.answered('ask.answer', { ask, option: 'hold' });
    await until(async () => (await s.status()).disputes[0]?.outcome === 'stands', 'the test standing after your answer');
    expect(git(s.repo, 'rev-parse', `refs/heads/${branch}`), 'the branch after you held the issue').toBe(work);
    s.plans.push(firstDraft(NEXT));
    await s.start(NEXT);
    const next = await s.judged(NEXT);
    expect(next.result, `the next issue's result in the slot the held issue left, why ${next.why}`).toBe('ready');
  });
}, LIMIT);
