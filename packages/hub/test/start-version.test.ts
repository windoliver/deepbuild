// A start on a Claude Code version its facts don't list (#1884): refused before any worktree, in deep doctor's words,
// whether the version lies between two listed ones or above them all. Nothing says "past".
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { deep, withHub } from './hub.js';

const LISTED = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../adapters/claude-code.facts.json', import.meta.url)), 'utf8')) as { versions: string[] }).versions;

it('refuses a start on a version between two listed and one above them all, naming the version and the listed ones', async () => {
  expect(LISTED, 'the shipped facts list a version on each side of 2.1.300').toEqual(expect.arrayContaining(['2.1.299', '2.1.304']));
  expect(LISTED.filter((v) => v === '2.1.300' || v === '2.1.400'), 'the shipped facts list neither version tried').toEqual([]);
  await withHub(async (root, home, hub) => {
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const loginPath = [bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    writeFileSync(join(root, 'config.json'), JSON.stringify({ runner: { login_path: loginPath } }));
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    const repo = join(home, 'shop');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { env: { ...process.env, HOME: home } });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'the sample');
    await hub.restart({ DEEP_HUB_TEST_CONFIRM: join(home, 'confirm'), DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' });

    const approved = await deep(home, home, ['start', 'approve', '--repo', repo, '--issues', '1', '--agents', 'claude-code', '--home', `claude-code=${join(home, '.claude')}`, '--at-once', '1', '--plan-share', '100', '--json']);
    expect(approved.code, approved.stderr).toBe(0);
    const ask = (JSON.parse(approved.stdout) as { ask: string }).ask;
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    const created = db.prepare("SELECT data FROM events WHERE kind = 'ask.created' ORDER BY log_pos DESC LIMIT 1").get() as { data: string };
    db.close();
    const yes = (JSON.parse(created.data) as { options: { id: string; decision?: string }[] }).options.find((o) => o.decision === 'allow')!;
    const answered = await deep(home, home, ['inbox', 'answer', ask, yes.id]);
    expect(answered.code, answered.stderr).toBe(0);

    for (const version of ['2.1.300', '2.1.400']) {
      writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "${version} (Claude Code)"\n`, { mode: 0o755 });
      const r = await deep(home, home, ['start', '--repo', repo, '--issue', '1', '--agent', 'claude-code', '--prompt', 'go', '--json']);
      const out = JSON.parse(r.stdout) as { status: string; reason: string; worktree?: string };
      expect([out.status, out.worktree], `${version}: ${r.stdout}${r.stderr}`).toEqual(['refused', undefined]);
      expect(out.reason).toBe(`claude-code ${version} is not a version its facts cover (${LISTED.join(', ')}), so its hooks would be watch-only; it doesn't start.`);
    }
  });
}, 120_000);
