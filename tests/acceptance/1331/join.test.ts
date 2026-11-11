// AC6: a PR from before the run joins as its issue's attempt, and no run starts a second attempt beside it.
import { describe, expect, it } from 'vitest';
import { AC, checkFile, draftFor, must, mustFail, requirement, World } from './helpers.ts';

type Task = { issue: number; attempts?: { pr?: number }[] };
async function scenario(plant?: string): Promise<{ w: World; mine: { issue: number; pr: number }; json: { tasks?: Task[]; stale?: { pr: number }[] } | null; code: number | null; stderr: string; stale: number; fresh: number }> {
  const w = await World.open({ drafts: [draftFor(100, [requirement('R1', 'x1 works', checkFile('own1'))])], ...(plant ? { plant } : {}) });
  // A PR from before the run, linking the issue in the set.
  const mine = await w.change('before-the-run', { 'src/x1.ts': "export const v = 'one';\n" });
  // Two PRs that link issues outside the set: idle 8 days, and idle 6 days.
  const stale = await w.change('stale', { 'src/x2.ts': "export const v = 'two';\n" });
  const fresh = await w.change('fresh', { 'src/x3.ts': "export const v = 'three';\n" });
  w.forge.pulls.get(stale.pr)!.updated = Date.now() - 8 * 86_400_000;
  w.forge.pulls.get(fresh.pr)!.updated = Date.now() - 6 * 86_400_000;
  const ran = await w.workOnce([mine.issue]);
  return { w, mine, json: ran.json as never, code: ran.code, stderr: ran.stderr, stale: stale.pr, fresh: fresh.pr };
}
function judge(s: Awaited<ReturnType<typeof scenario>>): void {
  const task = s.json?.tasks?.find((t) => t.issue === s.mine.issue);
  must(task !== undefined, `the run must list issue #${s.mine.issue}; \`deep work\` exited ${s.code} and printed ${JSON.stringify(s.json)} ${s.stderr.slice(0, 400)}`);
  must(task.attempts?.length === 1 && task.attempts[0]!.pr === s.mine.pr, `PR #${s.mine.pr} from before the run must be issue #${s.mine.issue}'s one attempt, and no run starts a second beside it; its attempts are ${JSON.stringify(task.attempts)}`);
  const started = s.w.claudeStarts();
  must(started === '', `an agent was started for issue #${s.mine.issue} beside PR #${s.mine.pr}: ${started.trim()}`);
}

describe(`${AC[6]} a PR from before the run joins as its issue's attempt, and no run starts a second attempt beside it`, () => {
  it('joins the earlier PR as the one attempt; lists a PR idle past 7 days and never closes one; a run that starts a second attempt fails, naming the issue', async () => {
    const s = await scenario();
    judge(s);
    const listed = (s.json?.stale ?? []).map((p) => p.pr);
    expect(listed, `a pull request idle 8 days (PR #${s.stale}) is listed on the run's page`).toContain(s.stale);
    expect(listed, `a pull request idle 6 days (PR #${s.fresh}) is not past 7 days`).not.toContain(s.fresh);
    expect(s.w.forge.calls.filter((c) => c.method === 'PATCH' && /\/pulls\/\d+$/.test(c.path)), 'DeepBuild never closes a pull request').toEqual([]);
    const planted = await scenario('second-attempt-beside-pr');
    await mustFail('a run that starts a second attempt beside the earlier PR', () => judge(planted), [`#${planted.mine.issue}`]);
  }, 30 * 60_000);
});
