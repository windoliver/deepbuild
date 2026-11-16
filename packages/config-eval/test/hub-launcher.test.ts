// #2077 production wiring: a real eval uses its supervised replay/probe/judge callbacks, never unmanaged CLIs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runEval } from '@deepbuild/config-eval';

it('hands both variants to supervised execute and the probe/judge to isolated read without changing the comparison', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eval-hub-')));
  try {
    const repo = join(root, 'repo'), home = join(root, 'home'), bin = join(root, 'bin');
    for (const dir of [repo, home, bin]) mkdirSync(dir);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    writeFileSync(join(repo, 'AGENTS.md'), '- rule\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '.'); git('commit', '-qm', 'tasks');
    const commit = git('rev-parse', 'HEAD'), calls: string[] = [], seen: string[] = [];
    const report = await runEval({ root: join(root, 'work'), env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
      plan: { id: 'supervised', cutoff: 1, tasks: ['t1', 't2'], fitted: [], variants: { base: { name: 'base', files: { 'AGENTS.md': '- rule\n' } }, change: { name: 'change', files: { 'AGENTS.md': '' } } }, models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, repeats: 1, measures: [{ name: 'grade', better: 'higher' }], rule: 'paired-mean-one-sided-95', budget: { ms: 60_000, plan_share: 0.5 } },
      tasks: ['t1', 't2'].map((id) => ({ id, at: 2, repo, commit, prompt: `Fix ${id}.` })),
      checkpoint: async (agent) => { calls.push(`gate:${agent}`); },
      execute: async (launch, grant, prompt) => {
        calls.push('execute'); seen.push(readFileSync(join(launch.cwd, 'AGENTS.md'), 'utf8'));
        expect(prompt).toMatch(/^Fix t[12]\.$/);
        expect(grant.write).toContain(launch.cwd);
        expect(launch.env.HOME).not.toBe(home);
        expect(launch.argv[0]).toBe(join(bin, 'claude'));
        return [{ type: 'result', subtype: 'success', is_error: false, result: seen.at(-1) ? 'quality=0.2' : 'quality=0.8' }];
      },
      read: async (agent, _model, prompt) => {
        calls.push(`read:${agent}`);
        if (agent === 'claude-code') return [{ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.05, resetsAt: 4102444800 } }];
        const grades = [...prompt.matchAll(/=== Output ([A-Z]) ===\nFinal reply:\nquality=(0\.[28])/g)].map((m) => ({ label: m[1]!, score: Number(m[2]) }));
        expect(grades).toHaveLength(2);
        return [{ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ grades }) } }, { type: 'turn.completed' }];
      },
    });
    expect(report.after.outcome, report.after.reason).toBe('adopt');
    expect(seen.sort()).toEqual(['', '', '- rule\n', '- rule\n']);
    expect(calls.filter((c) => c === 'read:claude-code')).toHaveLength(1);
    expect(calls.filter((c) => c === 'read:codex')).toHaveLength(2);
    expect(calls.filter((c) => c === 'gate:claude-code')).toHaveLength(5);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
