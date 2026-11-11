// #24.bbe12971: budgets, on the reference Mac in the local preflight, compared with the merge base: `deep inbox`
// lists 30 days of asks in under 300 ms. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #16 and #319 left it. What deep inbox lists, and its 300 ms reading, are
// redraft-1463/'s (listing.test.ts, timing.test.ts), swapped in for #1463: deep inbox puts the question first and the
// handle last.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, NODE, REPO, run } from './helpers.ts';

afterEach(cleanup, 30_000);

const TASK = 'deep-inbox-30d';

describe('#24.bbe12971 budgets, compared with the merge base in the local preflight', () => {
  it(`#24.bbe12971 the perf lane has the task ${TASK}, a #24 first measurement, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
    expect(String(task!.initialReason), `${TASK} says why, naming issue #24`).toMatch(/#24\b/);
    const [command, ...args] = task!.command;
    const r = await run(command === 'node' ? NODE : command!, args, { timeoutMs: 600_000 });
    expect(r.code, `${task!.command.join(' ')} exits 0: ${r.stderr}`).toBe(0);
  }, 600_000);
});
