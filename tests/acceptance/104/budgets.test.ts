// AC4: budgets, on the reference Mac in the local preflight, compared with the merge base: a hosted terminal keeps up at
// 60 updates a second under 5% of a core, and 10 terminals stay under 300 MB.
//
// - CPU: a terminal the agent-terminals plug-in hosts runs a program that writes one numbered line every 1/60 s for 10 s
//   (600 updates). The hosting's CPU is every process the supervisor tracked for the terminal's run except the program
//   itself (what holds the PTY and carries its output), plus this process's own (the hub side: the extension host and
//   supervisor run here), over the 10 s; less the same with a program that keeps the same schedule and writes nothing;
//   as a share of one core. It keeps up when all 600 lines are in the terminal's output, in order, within 250 ms of the
//   last one's write. Five runs after a warm-up, each against 0.05 of a core.
// - Memory: 10 terminals, each with a program that wrote 10,000 lines of scrollback and then idles: the resident memory
//   of every process the supervisor tracked for their runs except the programs, plus what this process grew by while
//   they opened and filled. Five runs, each against 300 MB.
// Both count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state nominal and
// a 1-minute load no higher than its core count; anywhere else they fail with a message starting `INCONCLUSIVE:`. They
// never pass, and never skip, on a reading they can't trust. The perf lane's tasks for both are read against the merge
// base's budgets (`scripts/benchmark.mjs`'s validateBudgets), as #402's are.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, RUN_AS_YOU, YOU, cpuSeconds, installAndLoad, judge, numberIn, openHost, openTerminal, openWorld, outputOf, pidsIn, pkg, proc, program, quit, rssBytes,
  sleep, tempDir, trackedPids, waitFor,
} from './helpers.ts';

const ID = 'test/agent-terminals';
const OPEN = 'ext.agent-terminals.open';
const RATE = 60;
const LINES = 600;
const lineNumbers = (text: string): number[] => [...text.matchAll(/L(\d{8}) paced line/g)].map((m) => Number(m[1]));

/** CPU seconds the hosting used while one terminal's program ran its 10 s schedule, writing (or, `quiet`, not). */
async function hostingCpu(quiet: boolean): Promise<number> {
  const w = await openWorld();
  const h = await openHost(w);
  try {
    const p = await installAndLoad(h, await pkg('agent-terminals'), { approve: true });
    const notes = tempDir('paced');
    const { opened, refused } = await openTerminal(h, p, OPEN, program(notes, 'paced', String(LINES), String(RATE), quiet ? 'quiet' : 'loud'), notes, 'paced');
    if (!opened) throw Error(`the approved piece's command was refused: ${refused}`);
    proc((await pidsIn(notes, ['pid'])).pid!);
    const hosting = (await waitFor(() => trackedPids(w, [opened.run]), (v) => v.includes(opened.pid), 5000)).filter((pid) => pid !== opened.pid);
    const start = numberIn(join(notes, 'start'));
    await sleep(Math.max(0, start - Date.now()));
    const cpu0 = cpuSeconds(hosting);
    const own0 = process.cpuUsage();
    await waitFor(() => numberIn(join(notes, 'done')), (t) => t > 0, 20_000, 10);
    const own = process.cpuUsage(own0);
    const used = cpuSeconds(hosting) - cpu0 + (own.user + own.system) / 1e6;
    if (!quiet) {
      await sleep(250);
      const seen = lineNumbers(await outputOf(h, p, opened.terminal));
      const bad = seen.findIndex((n, i) => n !== i + 1);
      if (seen.length !== LINES || bad >= 0) throw Error(`the terminal didn't keep up: 250 ms after its program's last line its output holds ${seen.length} of ${LINES} lines${bad >= 0 ? `, line ${bad + 1} out of order (${seen[bad]})` : ''}`);
    }
    return used;
  } finally {
    await h.revoke(YOU, ID, RUN_AS_YOU).catch(() => undefined);
    await quit(h, w);
  }
}
const cpuShare = async (): Promise<number> => ((await hostingCpu(false)) - (await hostingCpu(true))) / (LINES / RATE);

/** Bytes of memory 10 hosted terminals take, each holding 10,000 lines of scrollback. */
async function tenTerminals(): Promise<number> {
  const w = await openWorld();
  const h = await openHost(w);
  try {
    const p = await installAndLoad(h, await pkg('agent-terminals'), { approve: true });
    const rss0 = process.memoryUsage().rss;
    const opened: { run: string; pid: number; notes: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const notes = tempDir('filler');
      const o = await openTerminal(h, p, OPEN, program(notes, 'filler', '10000'), notes, `filler ${i}`);
      if (!o.opened) throw Error(`the approved piece's command was refused: ${o.refused}`);
      opened.push({ run: o.opened.run, pid: o.opened.pid, notes });
      proc((await pidsIn(notes, ['pid'])).pid!);
    }
    for (const o of opened) await waitFor(() => numberIn(join(o.notes, 'done')), (t) => t > 0, 30_000);
    await sleep(1000);
    const programs = new Set(opened.map((o) => o.pid));
    const hosting = (await trackedPids(w, opened.map((o) => o.run))).filter((pid) => !programs.has(pid));
    const bytes = rssBytes(hosting) + Math.max(0, process.memoryUsage().rss - rss0);
    return bytes;
  } finally {
    await h.revoke(YOU, ID, RUN_AS_YOU).catch(() => undefined);
    await quit(h, w);
  }
}

describe('AC4 the issue\'s numbers on the reference Mac', () => {
  it('AC4 a hosted terminal keeps up at 60 updates a second under 5% of a core: 600 lines at 60 a second, the hosting\'s CPU less the same with none, as a share of one core', async () => {
    console.log(`warm-up: ${(await cpuShare()).toFixed(4)} of a core (discarded)`);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await cpuShare());
    judge('AC4 a hosted terminal at 60 updates a second (share of one core)', runs, 0.05);
  }, 900_000);

  it('AC4 10 hosted terminals, each with 10,000 lines of scrollback, stay under 300 MB', async () => {
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push((await tenTerminals()) / 2 ** 20);
    judge('AC4 10 hosted terminals (MiB)', runs, 300);
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------
// The perf lane, against the merge base.

interface Line { id: string; command: string[]; initialReason?: string }
const TASKS = ['hosted-terminal-60hz', 'hosted-terminals-10'] as const;

describe('AC4 budgets in the local preflight, compared with the merge base', () => {
  it('AC4 the perf lane has a task for a hosted terminal at 60 updates a second and one for 10 hosted terminals, each a #104 first measurement, valid against the merge base\'s budgets', async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    for (const id of TASKS) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command.length, `${id} names its command`).toBeGreaterThan(0);
      expect(String(task!.initialReason), `${id} says why, naming issue #104`).toMatch(/#104/);
    }
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  });
});
