// #356.c8728339 budgets, on the reference Mac in the local preflight, compared with the merge base: building the wiki from 30
// days of history takes under 5% of a 5-hour plan window, and the start slice stays under 4,000 tokens. The merge-base
// comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #63's. The plan share counts only on a
// reference Mac in a fit state (INCONCLUSIVE elsewhere, never a pass). The start slice is a size, judged anywhere; a token is
// characters / 4 (nothing in the base defines one).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { corpus } from './history.ts';
import { environmentProblem } from './machine.ts';
import { cleanup, hubJobs, NODE, onMac, REPO, rootOf, setupWithWindows, shown, WINDOW_TOKENS, world } from './helpers.ts';

afterAll(cleanup);
interface Task { id: string; command: string[]; initialReason?: string }
const tasks = (): Task[] => (JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] }).tasks
  .filter((t) => /#356\b/.test(String(t.initialReason)) && t.command.some((p) => p.endsWith('benchmarks/wiki.mjs')));
export const tokens = (texts: string[]): number => Math.ceil(texts.join('').length / 4);

describe('#356.c8728339 budgets', () => {
  it('#356.c8728339 the perf lane has a #356 task running benchmarks/wiki.mjs, valid against the merge base\'s budgets, and it runs', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')), JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    expect(tasks().length, 'budgets.json has a #356 task for building the wiki').toBeGreaterThan(0);
    for (const t of tasks()) {
      const [cmd, ...args] = t.command;
      const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 1_800_000 });
      expect(r.status, `${t.id} (${t.command.join(' ')}): ${r.stderr}`).toBe(0);
    }
  }, 3_600_000);

  it('#356.c8728339 the token count of a start slice is characters / 4, and a slice that pastes the pages is over 4,000 (the check itself)', () => {
    expect(tokens(['x'.repeat(3999)])).toBe(1000);
    expect(tokens(['y'.repeat(16_001)])).toBeGreaterThan(4000);
  });

  it('#356.c8728339 building the wiki from 30 days of history (212 sessions) takes under 5% of a 5-hour plan window; the start slice stays under 4,000 tokens', async (ctx) => {
    onMac();
    const w = world({ sessions: corpus('/tmp/dh356-corpus') });
    const t0 = performance.now();
    const r = await setupWithWindows(w);
    const seconds = (performance.now() - t0) / 1000;
    expect(r.run.code, `deep setup exits 0: ${shown(r.run)}`).toBe(0);
    expect(r.tokens, 'the reading jobs ran and spent tokens through the runner (the build read the history)').toBeGreaterThan(0);
    // The start slice: stop the hub by PID, open the record, start a session in api and read its slice.
    for (const j of hubJobs(w.h.home)) if (j.pid) try { process.kill(j.pid, 'SIGTERM'); } catch { /* gone */ }
    await new Promise((res) => setTimeout(res, 1500));
    const { openRecord } = await import('../../../packages/record/src/index.ts');
    const record = await openRecord({ path: join(rootOf(w.h.home), 'ledger.db'), now: Date.now });
    const id = 'f356aaaa1111'; const at = Date.now();
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session: id, project: 'api', agent: 'claude-code' }, { v: 1, id: `01J${String(at).padStart(13, '0')}ZZZZZZZZZZZZZ`.slice(0, 26), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: w.fx.repos.api, branch: 'main', thread: id } });
    const slice = await record.startSlice(`session:${id}`);
    await record.close();
    const size = tokens(slice.map((e) => e.text));
    expect(size, `the start slice holds ${size} tokens (characters / 4), under 4,000`).toBeLessThan(4000);
    const share = (100 * r.tokens) / WINDOW_TOKENS;
    console.log(`build ${seconds.toFixed(0)} s, ${r.tokens} tokens = ${share.toFixed(2)}% of a window`);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (plan share ${share.toFixed(2)}% not judged: ${problem})`);
    expect(share, `the build spent ${share.toFixed(2)}% of a 5-hour window, under 5%`).toBeLessThan(5);
  }, 3_600_000);
});
