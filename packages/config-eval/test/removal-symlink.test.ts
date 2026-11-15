// #2077: replay preparation must not follow a historical instruction-file symlink into a user's file.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runEval } from '@deepbuild/config-eval';

it('a historical rule symlink never lets either variant overwrite its outside target', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'removal-links-')));
  try {
    const repo = join(root, 'repo'), victim = join(root, 'person.txt');
    mkdirSync(repo);
    writeFileSync(victim, 'person-owned bytes\n');
    symlinkSync(victim, join(repo, 'AGENTS.md'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'linked rule');
    const report = await runEval({ root: join(root, 'runs'), env: {},
      tasks: [{ id: 't', at: 2, repo, commit: git('rev-parse', 'HEAD'), prompt: 'Fix a cart.' }],
      plan: { id: 'links', cutoff: 1, tasks: ['t'], fitted: [], models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, repeats: 1, measures: [{ name: 'grade', better: 'higher' }], rule: 'paired-mean-one-sided-95', budget: { ms: 60_000, plan_share: 0.5 }, variants: { base: { name: 'base', files: { 'AGENTS.md': '- rule\n' } }, change: { name: 'change', files: { 'AGENTS.md': '' } } } },
      launcher: { work: async () => ({ ok: true, result: 'done' }), judge: async ({ outputs }) => outputs.map(({ label }) => ({ label, score: 1 })) },
    });
    expect(readFileSync(victim, 'utf8')).toBe('person-owned bytes\n');
    expect(report.runs.every((r) => !r.ok)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
