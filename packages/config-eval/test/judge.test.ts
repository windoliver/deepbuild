// Regression tests for the eval (#112) beyond its acceptance suite: each one failed on the program it names.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { planHash } from '@deepbuild/record';
import { runEval, type JudgeRequest } from '../src/index.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A repo of one commit, two tasks in it after the cutoff, and a plan of one repeat a side. */
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dce-')));
  roots.push(dir);
  const repo = join(dir, 'shop');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@shop.test', ...args], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Shop\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const commit = git('rev-parse', 'HEAD').trim();
  const tasks = ['t1', 't2'].map((id, i) => ({ id, at: 2_000 + i, repo, commit, prompt: `Fix ticket ${id}.` }));
  const plan = {
    id: 'p1', cutoff: 1_000, tasks: ['t1', 't2'], fitted: [], repeats: 1, rule: 'paired-mean-one-sided-95' as const,
    variants: { base: { name: 'b', files: { 'CLAUDE.md': '# Shop\nUse the kestrel style.\n' } }, change: { name: 'c', files: { 'CLAUDE.md': '# Shop\nUse the osprey style.\n' } } },
    models: { agent: 'claude-sonnet-5-5', judge: 'gpt-reserve' }, measures: [{ name: 'grade', better: 'higher' as const }], budget: { ms: 600_000, plan_share: 1 },
  };
  return { dir, tasks, plan };
}

it('grades a task as soon as its runs end, while other tasks still run', async () => {
  // Failed on an eval that graded only after every run had ended, so a long eval left its judge no time.
  const { dir, tasks, plan } = fixture();
  let judgedT1!: () => void;
  const t1Graded = new Promise<void>((resolve) => { judgedT1 = resolve; });
  const report = await runEval({
    plan, tasks, root: join(dir, 'work'), env: { PATH: process.env.PATH },
    launcher: {
      async work(run) {
        // t2's runs end only once t1 has been graded, or fail after 10 seconds.
        if (run.prompt.includes('t2')) {
          const graded = await Promise.race([t1Graded.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))]);
          if (!graded) return { ok: false };
        }
        return { ok: true, result: 'Fixed it.' };
      },
      async judge(request) {
        if (request.prompt.includes('t1')) judgedT1();
        return request.outputs.map((o) => ({ label: o.label, score: 0.5 }));
      },
    },
  });
  expect(report.runs.map((r) => `${r.task} ${r.side} ${r.ok} ${r.metrics.grade}`)).toEqual(['t1 base true 0.5', 't1 change true 0.5', 't2 base true 0.5', 't2 change true 0.5']);
}, 60_000);

it("never shows the judge a variant's instruction file, even when the agent edits it", async () => {
  // Failed on an eval that showed the judge every file the agent changed, so its edit of CLAUDE.md named the variant.
  const { dir, tasks, plan } = fixture();
  const judged: JudgeRequest[] = [];
  const report = await runEval({
    plan, tasks, root: join(dir, 'work'), env: { PATH: process.env.PATH },
    launcher: {
      async work(run) {
        appendFileSync(join(run.cwd, 'CLAUDE.md'), 'Keep the cart total in cents.\n');
        writeFileSync(join(run.cwd, 'fix.txt'), 'fixed\n');
        return { ok: true, result: 'Fixed it.' };
      },
      async judge(request) {
        judged.push(request);
        return request.outputs.map((o) => ({ label: o.label, score: 0.5 }));
      },
    },
  });
  expect(report.hash).toBe(planHash(plan));
  expect(judged.length).toBe(2);
  const shown = JSON.stringify(judged);
  expect(shown).toContain('fix.txt');
  expect(shown).not.toMatch(/kestrel|osprey|CLAUDE\.md/);
}, 60_000);
