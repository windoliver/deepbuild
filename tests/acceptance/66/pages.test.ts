// AC17: a page with one malformed item takes in the others and counts one skipped; a planted reader that repeats its
// next cursor, or returns an item from another project, makes the run INCONCLUSIVE naming the cause, and fails the
// work.item@1 kit if taken as a complete read. On the tracker, issue 3 of five has no title, which no work.item@1
// reading can have. The planted readers are fixtures/tracker with probe.json's `repeat-cursor` (every page's next
// cursor is `2`) and `foreign-item` (its first page holds `acme/other#7`).
import { describe, expect, it } from 'vitest';
import { AC17, at, MINUTE, runNow, runsOf, step, tasksOf } from './helpers.ts';
import { REPO_WEB } from './providers.ts';
import { TRACKER_SOURCE, trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const id = (n: number) => `${REPO_WEB}#${n}`;
const KIT = { scope: REPO_WEB, items: [1, 2, 3, 4, 5].map(id), roles: { you: 'owner' as const } };
const fiveIssues = (tr: Awaited<ReturnType<typeof trackerWorld>>['tr']) => {
  for (let n = 1; n <= 5; n++) tr.add({ n, created: T0 + MINUTE, updated: T0 + MINUTE + n * 1000 });
};

describe(`${AC17} A page with one malformed item takes in the others and counts one skipped; a planted reader that repeats its next cursor, or returns an item from another project, makes the run INCONCLUSIVE naming the cause, and fails the \`work.item@1\` kit if taken as a complete read`, () => {
  it('AC17 the malformed issue 3 is skipped and counted; the other four are taken in; the clean reader passes the kit', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0);
    fiveIssues(tr);
    tr.issues.get(3)!.title = null;
    await step(h, c, T0 + MINUTE, T0 + 10 * MINUTE);
    expect((await tasksOf(h, handle)).map((t) => t.id).sort()).toEqual([1, 2, 4, 5].map(id));
    expect((await h.workPage(handle)).skipped, 'one skipped, counted on the source\'s page').toBe(1);
    expect((await runsOf(h, handle)).filter((r) => r.verdict === 'INCONCLUSIVE' || r.verdict === 'FAIL'), 'a malformed item fails no run').toEqual([]);
    tr.issues.get(3)!.title = 'Issue 3';
    expect(await h.workKit(TRACKER_SOURCE, KIT)).toEqual({ verdict: 'PASS', failures: [] });
  }, 300_000);

  it('AC17 (wrong program) the reader that repeats its next cursor: the run is INCONCLUSIVE naming the cursor, and the kit fails', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { probe: { plant: 'repeat-cursor' } });
    fiveIssues(tr);
    c.set(T0 + 2 * MINUTE);
    await runNow(h, handle);
    const last = (await runsOf(h, handle)).at(-1);
    expect(last?.verdict, `the run: ${JSON.stringify(last)}`).toBe('INCONCLUSIVE');
    expect(last?.cause).toMatch(/cursor/i);
    const kit = await h.workKit(TRACKER_SOURCE, KIT);
    expect(kit.verdict).toBe('FAIL');
    expect(kit.failures.join('\n')).toMatch(/cursor/i);
  }, 300_000);

  it('AC17 (wrong program) the reader that returns an item from another project: the run is INCONCLUSIVE naming it, no task from it, and the kit fails', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { probe: { plant: 'foreign-item' } });
    fiveIssues(tr);
    tr.add({ n: 7, repo: 'acme/other', created: T0 + MINUTE, updated: T0 + MINUTE });
    c.set(T0 + 2 * MINUTE);
    await runNow(h, handle);
    const last = (await runsOf(h, handle)).at(-1);
    expect(last?.verdict, `the run: ${JSON.stringify(last)}`).toBe('INCONCLUSIVE');
    expect(last?.cause).toContain('acme/other#7');
    expect((await h.workTasks()).map((t) => t.id)).not.toContain('acme/other#7');
    const kit = await h.workKit(TRACKER_SOURCE, KIT);
    expect(kit.verdict).toBe('FAIL');
    expect(kit.failures.join('\n')).toContain('acme/other#7');
  }, 300_000);
});
