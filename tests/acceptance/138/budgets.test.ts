// #138.4c95cab8: budgets, on the reference Mac in the local preflight, compared with the merge base: the kit
// runs in the quick lane in under 5 minutes for the R2 canvas modules, with no GPU, and adds nothing at run
// time. The quick lane is a check in scripts/lanes.mjs that runs `node scripts/canvas-kit.mjs`, which runs the
// default kit over the shipped build on Vello CPU and noop and exits 0 only on PASS (README: The surface). The
// merge-base comparison is the perf lane's (`canvas-kit` in benchmarks/budgets.json, as #96's tasks are); the
// issue's 5 minutes is judged here by the design's rule (five runs after a warm-up). Off a fit reference Mac
// the timed test skips as INCONCLUSIVE and never passes by skipping. At the base there is no lane, script,
// task or `kit` call.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, KIT_BUDGET_MS, REPO, arr, environmentProblem, judge, num, obj, report, run, scenario, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();
const problem = environmentProblem();

interface Line { id: string; command: string[]; initialReason?: string }

describe('#138.4c95cab8 the kit in the quick lane, compared with the merge base', () => {
  it('#138.4c95cab8 a quick lane of the local preflight runs scripts/canvas-kit.mjs, never on push or pull request', async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const lane = checks.find((c) => c.commands.some((cmd) => cmd.some((part) => part.endsWith('scripts/canvas-kit.mjs'))));
    expect(lane, 'a lane in scripts/lanes.mjs runs scripts/canvas-kit.mjs').toBeDefined();
    const workflows = spawnSync('git', ['ls-files', '.github/workflows'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
    expect(workflows.split('\n').filter(Boolean).filter((f) => readFileSync(join(REPO, f), 'utf8').includes('canvas-kit')), 'no workflow runs the kit on push or pull request').toEqual([]);
  }, 600_000);

  it('#138.4c95cab8 the perf lane has a canvas-kit task, a #138 first measurement, valid against the merge base\'s budgets, and its command exits 0', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === 'canvas-kit');
    expect(task, 'budgets.json has a task canvas-kit').toBeDefined();
    expect(task!.command, 'it runs the canvas bench in kit mode').toEqual(['node', 'benchmarks/canvas.mjs', 'kit']);
    expect(String(task!.initialReason), 'it says why, naming issue #138').toMatch(/#138/);
    const r = spawnSync(process.execPath, [join(REPO, 'benchmarks/canvas.mjs'), 'kit'], { cwd: REPO, encoding: 'utf8', timeout: 1_800_000 });
    expect(r.status, `benchmarks/canvas.mjs kit: ${r.stderr}`).toBe(0);
  }, 1_800_000);

  it('#138.4c95cab8 on the reference Mac the quick lane\'s kit passes over the R2 modules with no GPU in under 5 minutes (five runs after a warm-up), and a shipped frame still runs no operator after the first and allocates nothing after warm-up', (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    // What the script runs, read from the kit call itself: Vello CPU and noop, no GPU lease, PASS.
    const [reply] = run(builds.bin(FULL), scenario(evidence(), [{ call: 'kit' }]));
    const r = report(reply!);
    expect(r.verdict, 'the kit passes over the R2 modules').toBe('PASS');
    expect(r.backends.includes('gpu'), 'no GPU backend in the quick lane').toBe(false);
    expect(r.lease['gpu'], 'no GPU lease taken').toBe(false);
    const once = (): number => {
      const began = performance.now();
      const s = spawnSync(process.execPath, [join(REPO, 'scripts/canvas-kit.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 3 * KIT_BUDGET_MS });
      const ms = performance.now() - began;
      expect(s.status, `scripts/canvas-kit.mjs exits 0 on a PASS: ${s.stdout.slice(-1500)} ${s.stderr.slice(-1500)}`).toBe(0);
      return ms;
    };
    console.log(`warm-up: ${(once() / 1000).toFixed(1)} s (discarded)`);
    judge(ctx, '#138.4c95cab8 the quick lane\'s kit over the R2 modules (ms)', [1, 2, 3, 4, 5].map(once), KIT_BUDGET_MS);

    // Adds nothing at run time: with every module's fixtures and sidecars registered, a shipped frame of a still
    // board runs no operator after the first and allocates nothing after warm-up (#387's numbers).
    const items: JsonObject = {};
    for (let i = 0; i < 200; i++) items[`r${i}`] = { id: `r${i}`, kind: 'rect@1', name: `Box ${i}`, order: `a${String(i).padStart(3, '0')}`, params: { box: [(i % 20) * 16, Math.floor(i / 20) * 16, 12, 12], paint: { fill: { role: 'muted' } } } };
    const board: JsonObject = { format: 1, profile: 'board', title: 'Still board', description: 'Two hundred boxes that never move.', size: [320, 200], items };
    const calls: JsonObject[] = [
      { call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: board, include: ['issues'] },
      { call: 'frames', doc: DOC.a, count: 40 },
    ];
    const [, frames] = run(builds.bin(FULL), scenario(evidence(), calls));
    for (const [i, f] of arr(frames!['frames'], 'frames').map((x) => obj(x, 'frame')).entries()) {
      if (i >= 1) expect(num(f['ran'], 'ran'), `frame ${i} runs no operator`).toBe(0);
      if (i >= 10) expect(num(f['allocs'], 'allocs'), `frame ${i} allocates nothing`).toBe(0);
    }
  }, 6 * 3_600_000);
});
