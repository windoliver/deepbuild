// AC3: a start outside an approval's bounds is refused, naming the bound (README: `bound` in the refusal).
import { expect, test } from 'vitest';
import { AC, approve, mustRefuse, openWorld, sleep, standIns, start, worktrees, type Start } from './helpers.ts';

test(`${AC[3]} a start past the approval's end, or for an issue, agent or mode outside it, is refused, naming the bound`, async () => {
  const w = await openWorld();
  const until = new Date(Date.now() + 45_000);
  await approve(w, { issues: [41], agents: ['claude-code'], modes: { 'claude-code': 'default' }, atOnce: 2, planShare: 50, until });

  const outside: { what: string; start: Start; bound: string; names: string }[] = [
    { what: 'issue 42, outside its set {41}', start: { issue: 42 }, bound: 'set', names: '42' },
    { what: 'Codex, an agent outside it', start: { issue: 41, agent: 'codex' }, bound: 'agent', names: 'codex' },
    { what: "mode acceptEdits, which it doesn't name", start: { issue: 41, mode: 'acceptEdits' }, bound: 'mode', names: 'acceptEdits' },
  ];
  for (const c of outside) {
    const out = mustRefuse(await start(w, c.start), `${AC[3]}: a start for ${c.what}`);
    expect(out.bound, `${AC[3]}: a start for ${c.what} is refused naming the bound ${c.bound}: ${JSON.stringify(out)}`).toBe(c.bound);
    expect(out.reason, `${AC[3]}: the refusal says what fell outside it`).toContain(c.names);
  }

  await sleep(Math.max(0, until.getTime() - Date.now()) + 2000);
  const late = mustRefuse(await start(w, { issue: 41 }), `${AC[3]}: a start past the approval's end, ${until.toISOString()}`);
  expect(late.bound, `${AC[3]}: a start past the end is refused naming the bound end: ${JSON.stringify(late)}`).toBe('end');

  expect(standIns(w).filter((s) => !s.refused).map((s) => s.cwd), `${AC[3]}: no refused start starts an agent`).toEqual([]);
  expect(worktrees(w.repo).length, `${AC[3]}: no refused start adds a worktree`).toBe(1);
});
