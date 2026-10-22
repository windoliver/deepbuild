// AC12 budgets, on the reference Mac in the local preflight, compared with the merge base: a patch applies
// in under 2 ms, and merging two 10,000-item documents takes under 200 ms. The merge-base comparison is the
// perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16's is; the issue's own numbers are
// judged here by the design's rule for timing results (five runs after a warm-up), and count only on a
// reference Mac in a fit state: anywhere else, or between the limit and the margin, the test fails with
// INCONCLUSIVE. It never passes on a reading it can't trust.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, CANVAS, DOC, P, REPO, fixture, judge, lines, obj, outcome, patch, read, send, set, show, str, useBinaries, useFolders, world,
  type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

const TASKS = { 'canvas-patch-apply': 'patch-apply', 'canvas-merge-10k': 'merge-10k' } as const;
interface Line { id: string; command: string[]; initialReason?: string }

describe('AC12 budgets in the local preflight, compared with the merge base', () => {
  it('AC12 the perf lane has the two canvas tasks, each a #96 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const [id, mode] of Object.entries(TASKS)) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command, `${id} runs the canvas bench in ${mode} mode`).toEqual(['node', 'benchmarks/canvas.mjs', mode]);
      expect(String(task!.initialReason), `${id} says why, naming issue #96`).toMatch(/#96/);
    }
  });

  it.each(Object.values(TASKS))('AC12 `node benchmarks/canvas.mjs %s` runs and exits 0', (mode) => {
    const r = spawnSync(process.execPath, [join(REPO, 'benchmarks/canvas.mjs'), mode], { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `benchmarks/canvas.mjs ${mode}: ${r.stderr}`).toBe(0);
  }, 600_000);
});

describe('AC12 the issue\'s numbers on the reference Mac', () => {
  it('AC12 a patch applies in under 2 ms: 200 of alpha\'s patches on a 1,000-item board, against the same run with none', () => {
    const seed = fixture('board.json');
    const all = obj(seed['items'], 'items');
    for (let i = 0; i < 500; i++) {
      all[`you.r${i}`] = { id: `you.r${i}`, kind: 'rect@1', layer: 'you-main', name: `Yours ${i}`, order: `b${i}`, params: { box: [0, 0, 8, 8], paint: { fill: { role: 'muted' } } }, at: { pos: [i % 600, 100, 0] } };
      all[`alpha.r${i}`] = { id: `alpha.r${i}`, kind: 'rect@1', layer: 'alpha-main', name: `Alpha's ${i}`, order: `b${i}`, params: { box: [0, 0, 8, 8], paint: { fill: { role: 'ink' } } }, at: { pos: [i % 600, 200, 0] } };
    }
    const N = 200;
    const patches = Array.from({ length: N }, (_, k) => send(ASALPHA, patch(P(k + 1), k, [set(`alpha.r${k}`, `items/alpha.r${k}/at/pos`, [k, 220, 0])])));
    const none = (): number => show(world(evidence(), [read()], {}, seed)).ms;
    const many = (): number => {
      const r = show(world(evidence(), [...patches, read()], {}, seed));
      for (const [k, reply] of r.replies.slice(0, N).entries()) expect(outcome(reply), `patch ${k + 1} applies`).toBe('applied');
      return r.ms;
    };
    const perPatch = (): number => (many() - none()) / N;
    console.log(`warm-up: ${perPatch().toFixed(3)} ms per patch (discarded)`);
    judge('AC12 patch apply (ms)', [1, 2, 3, 4, 5].map(perPatch), 2);
  }, 600_000);

  it('AC12 merging two 10,000-item documents takes under 200 ms', () => {
    const seed = fixture('board.json');
    const envelope: JsonObject = { ...seed, id: DOC.board.toLowerCase(), items: {} };
    const filled = (layer: string, prefix: string): JsonObject => {
      const out: JsonObject = JSON.parse(JSON.stringify(envelope)) as JsonObject;
      const its = obj(out['items'], 'items');
      for (let i = 0; i < 10_000; i++) its[`${prefix}.m${i}`] = { id: `${prefix}.m${i}`, kind: 'rect@1', layer, name: `${prefix} ${i}`, order: `a${i}`, params: { box: [i % 640, Math.floor(i / 640), 4, 4], paint: { fill: { role: 'muted' } } } };
      return out;
    };
    const line = JSON.stringify({ base: envelope, a: filled('alpha-main', 'alpha'), b: filled('bravo-main', 'bravo') });
    const timed = (n: number): number => {
      const out = lines(CANVAS, 'merge', Array.from({ length: n }, () => line));
      for (const [i, l] of out.lines.entries()) expect(str(obj(l, `merge ${i + 1}`)['outcome'], 'outcome'), `merge ${i + 1} is clean`).toBe('merged');
      return out.ms;
    };
    const perMerge = (): number => (timed(6) - timed(1)) / 5;
    console.log(`warm-up: ${perMerge().toFixed(1)} ms per merge (discarded)`);
    judge('AC12 merge of two 10,000-item documents (ms)', [1, 2, 3, 4, 5].map(perMerge), 200);
  }, 900_000);
});
