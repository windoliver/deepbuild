// #63 AC8: budgets, on the reference Mac in the local preflight, compared with the merge base: a slice read returns
// in under 200 ms and holds at most 8,192 characters by default, and a reply cut at the cap says where to continue.
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16's, #20's and
// #237's budgets do it: the reading tasks must be there, a #63 first measurement, valid against the merge base's
// budgets, and each must run. The 200 ms is judged here by the design's timing rule (five runs after a warm-up), and
// counts only on a reference Mac in a fit state; anywhere else it is skipped as INCONCLUSIVE, never passed. The cap
// is characters, not a timing, so it is judged on any machine. Each test reads a slice first, so at the base every
// one fails on the missing `deep read` before any machine check.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedMessages } from './checks.ts';
import { fixtureCorpus, session, tag } from './corpus.ts';
import { AC, CAP, cleanup, deep, environmentProblem, judge, NODE, readAll, readSlice, REPO } from './helpers.ts';
import { openWorld, type World } from './world.ts';

const big = Array.from({ length: 4000 }, (_, i) => `word${i % 97}`).join(' ');
const s = session(8000, { project: 'docs', count: 40, size: 400, texts: { 3: `${tag(8000, 3)} ${big}` } });
const long = session(9100, { project: 'api', count: 1000, size: 300 });
let w: World;
beforeAll(async () => {
  w = await openWorld();
  await w.seed([s]);
}, 600_000);
afterAll(async () => {
  await w?.close();
  await cleanup();
});

interface Task { id: string; command: string[]; initialReason?: string }
function readingTasks(): Task[] {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
  return current.tasks.filter((t) => /#63\b/.test(String(t.initialReason)) && t.command.some((part) => part.endsWith('benchmarks/reading.mjs')));
}

describe(`AC8 ${AC[8]} budgets, compared with the merge base in the local preflight`, () => {
  it("AC8 the perf lane has the slice read's task, a #63 first measurement running benchmarks/reading.mjs, valid against the merge base's budgets", async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as unknown;
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    expect(readingTasks().length, 'budgets.json has a #63 task for the slice read').toBeGreaterThan(0);
  });

  it("AC8 each of the reading's perf-lane tasks runs and exits 0", () => {
    const tasks = readingTasks();
    expect(tasks.length, 'the reading has perf-lane tasks to run').toBeGreaterThan(0);
    for (const task of tasks) {
      const [cmd, ...args] = task.command;
      const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
      expect(r.status, `${task.id} (${task.command.join(' ')}): ${r.stderr}`).toBe(0);
    }
  }, 1_800_000);
});

describe(`AC8 ${AC[8]} the issue's numbers`, () => {
  it('AC8 by default a slice holds at most 8,192 characters, a reply cut at the cap says where to continue, and the slices joined are what the handle names', async () => {
    const m3 = `${s.handle}#m3`;
    const copy = (await storedMessages(w, s.handle)).messages;
    const stored = copy.find((m) => m.at === m3)!;
    expect(stored.text.length, 'message 3 is longer than the cap').toBeGreaterThan(2 * CAP);
    const first = readSlice(w.root, m3);
    expect(first.text.length, 'the first slice of message 3 holds at most 8,192 characters').toBeLessThanOrEqual(CAP);
    expect(first.next, 'a slice cut at the cap says where to continue').toBeDefined();
    const all = readAll(w.root, m3);
    for (const sl of all.slices) expect(sl.text.length, `${m3} --slice: at most 8,192 characters`).toBeLessThanOrEqual(CAP);
    expect(all.text, 'the slices of message 3, joined, are its redacted text, from the archived copy').toBe(stored.text);
    // The plain reply: the slice, then a last line naming the command that continues it.
    const plain = deep(['read', m3, '--slice', '--root', w.root]);
    expect(plain.status, `deep read ${m3} --slice exits 0: ${plain.stderr}`).toBe(0);
    const lines = plain.stdout.replace(/\n$/, '').split('\n');
    const last = lines.pop()!;
    expect(last, 'the cut reply ends saying where to continue').toContain(`deep read ${m3} --slice ${first.next}`);
    expect(lines.join('\n').length, 'the plain slice holds at most 8,192 characters').toBeLessThanOrEqual(CAP);
    // A whole session past the cap is cut the same way; a message under it comes back whole, with nothing to continue.
    const whole = readSlice(w.root, s.handle);
    expect(whole.text.length, 'a session slice holds at most 8,192 characters').toBeLessThanOrEqual(CAP);
    expect(whole.next, 'and says where to continue').toBeDefined();
    const small = readSlice(w.root, `${s.handle}#m1`);
    expect(small.next, 'a message under the cap is not cut').toBeUndefined();
    expect(small.text, 'and comes back whole').toBe(copy.find((m) => m.at === `${s.handle}#m1`)!.text);
  }, 600_000);

  it('AC8 a slice read returns in under 200 ms, on a record of the 212-session corpus and a 1,000-message session', async (ctx) => {
    const first = deep(['read', `${s.handle}#m1`, '--slice', '--json', '--root', w.root]);
    expect(first.status, `deep read exits 0: ${first.stderr}`).toBe(0);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
    await w.seed([...fixtureCorpus(), long]);
    const m900 = `${long.handle}#m900`;
    const cut = readSlice(w.root, long.handle);
    expect(cut.next, 'the long session is cut at the cap').toBeDefined();
    for (const [name, args] of [
      ['a message slice', ['read', m900, '--slice', '--root', w.root]],
      ['a continuation slice', ['read', long.handle, '--slice', cut.next!, '--root', w.root]],
    ] as const) {
      const once = (): number => { const r = deep(args); expect(r.status, `deep ${args.join(' ')}: ${r.stderr}`).toBe(0); return r.ms; };
      once(); // warm-up
      judge(ctx, `AC8 ${name} (ms)`, Array.from({ length: 5 }, once), 200);
    }
  }, 1_800_000);
});
