// The issue's timing numbers, on the reference Mac in the local preflight, against the merge base (the design's budget
// rules; AC1, AC4 and AC8's "keeps up at 60 updates a second"): 600 updates of each kind, less the same run with none, per
// update, against one 60 Hz frame (1000/60 ms) for a terminal and for the session page's terminal tab, and against the
// cell grid's cost (under 5% of a core at 60 patches a second: 0.05 × 1000/60 ms) for a busy terminal's grid. The
// deterministic "no update dropped or late on the virtual display clock" halves are terminal.test.ts, cellgrid.test.ts
// and session.test.ts. The timings count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode
// off, thermal state nominal and a 1-minute load no higher than its core count; anywhere else they fail with a message
// starting `INCONCLUSIVE:`; they never pass, and never skip, on a reading they can't trust. The perf lane's tasks
// (`benchmarks/budgets.json`, the issue's proof line "terminal timings from the spike and the panel") are read too.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALPHA, BETA, REPO, SEC, SLOTS, at, judge, lineText, openCall, terminalPlugin, scenario, timed, useOut, useShow, type JsonObject, type World } from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60;
const ROWS = 36;
const N = 600;

const busy = (k: number): string => `\u001b[H${Array.from({ length: ROWS }, (_, r) => `F${k} R${r} ${lineText(k * 100 + r).slice(1, 41)}\u001b[K`).join('\r\n')}`;
const feedOf = (n: number, text: (k: number) => string): { at: number; text: string }[] => Array.from({ length: n }, (_, k) => ({ at: T0 + k * STEP, text: text(k) }));
const END = T0 + N * STEP + SEC;

type Kind = 'terminal' | 'grid' | 'tab';
function world(kind: Kind): World {
  return { evidence: out(), panels: { screen: SLOTS[0]!, page: SLOTS[1]! }, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process, terminal: { hosted: true, terminal: 'T2' } }, [BETA.id]: { thread: BETA.thread, name: BETA.name, process: BETA.process } }, ...(kind === 'tab' ? {} : { plugins: { terminals: terminalPlugin({ screen: 'T1' }) } }) };
}
/** One scenario of `n` updates of `kind`, and the same calls at the end whatever `n` is. */
function scenarioOf(kind: Kind, n: number): JsonObject {
  const lines = (k: number): string => `${lineText(k + 1)}\r\n`;
  const calls: JsonObject[] = kind === 'tab'
    ? [openCall(SEC, 'T2', { session: ALPHA.id, cols: 120, rows: ROWS, feed: feedOf(n, lines) }), at('session_page', 2 * SEC, { session: ALPHA.id, panel: 'page' }), at('updates', END, { session: ALPHA.id, tab: 'terminal' }), at('tab', END, { session: ALPHA.id, tab: 'terminal' })]
    : [openCall(SEC, 'T1', { panel: 'screen', cols: 120, rows: ROWS, feed: feedOf(n, kind === 'grid' ? busy : lines) }), at('updates', END, { terminal: 'T1' }), at('cells', END, { terminal: 'T1' })];
  return scenario(world(kind), calls);
}
const perUpdate = (kind: Kind): number => (timed(show(), scenarioOf(kind, N), `${N} ${kind} updates`) - timed(show(), scenarioOf(kind, 0), `no ${kind} updates`)) / N;

describe('the issue\'s numbers on the reference Mac', () => {
  it('AC1 a terminal keeps up at 60 updates a second: 600 updates, less the same run with none, per update, within one 60 Hz frame (16.67 ms)', () => {
    console.log(`warm-up: ${perUpdate('terminal').toFixed(3)} ms per update (discarded)`);
    judge('AC1 a terminal update (ms)', [1, 2, 3, 4, 5].map(() => perUpdate('terminal')), 1000 / 60);
  }, 1_800_000);

  it('AC4 a cell grid fed by a busy terminal keeps up at 60 updates a second: a full-screen patch costs under 5% of a core at 60 a second (0.833 ms)', () => {
    console.log(`warm-up: ${perUpdate('grid').toFixed(3)} ms per patch (discarded)`);
    judge('AC4 a busy terminal\'s patch drawn by the cell grid (ms)', [1, 2, 3, 4, 5].map(() => perUpdate('grid')), (0.05 * 1000) / 60);
  }, 1_800_000);

  it('AC8 the session page\'s terminal tab keeps up at 60 updates a second: 600 updates through the tab, less the same run with none, per update, within one 60 Hz frame', () => {
    console.log(`warm-up: ${perUpdate('tab').toFixed(3)} ms per update (discarded)`);
    judge('AC8 a terminal update drawn by the session page\'s tab (ms)', [1, 2, 3, 4, 5].map(() => perUpdate('tab')), 1000 / 60);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------
// The perf lane: the proof line's "terminal timings from the spike and the panel", against the merge base.

interface Line { id: string; command: string[]; initialReason?: string }
const TASKS = ['terminal-60hz', 'cell-grid-60hz'] as const;

describe('budgets in the local preflight, compared with the merge base', () => {
  it('AC1 the perf lane has a task for the terminal and one for the cell grid, each a #402 first measurement, valid against the merge base\'s budgets', async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    for (const id of TASKS) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command.length, `${id} names its command`).toBeGreaterThan(0);
      expect(String(task!.initialReason), `${id} says why, naming issue #402`).toMatch(/#402/);
    }
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  });
});
