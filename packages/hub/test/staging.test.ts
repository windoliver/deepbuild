// A discard is staged only when every file it would lose was copied (#1294): one copy that fails stands, whatever the
// copies still running beside it do.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Holds } from '../src/holds.js';
import { Staging } from '../src/staging.js';
import type { HookMeta } from '../src/wire.js';

it('does not stage a discard when one file can\'t be copied and other copies end after it', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-staging-')));
  const repo = join(home, 'repo');
  // Forty edited files, eight copied at once: the first one's copy fails while the rest are still being made.
  const files = Array.from({ length: 40 }, (_, k) => join(repo, `f${String(k).padStart(2, '0')}`));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'pipe' });
  try {
    mkdirSync(repo);
    git('init', '-q');
    for (const f of files) writeFileSync(f, 'base\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    for (const f of files) writeFileSync(f, 'an uncommitted edit\n');
    // deep-hook can't clone a file it can't read.
    chmodSync(files[0]!, 0o000);
    const recorded: unknown[] = [];
    const staging = new Staging({
      root: join(home, 'root'), raw: async () => [], now: () => Date.now(), plant: undefined,
      append: async (_connection, input) => { recorded.push(input); },
      connection: () => ({}) as never,
      holds: { keyOf: () => 'key' } as unknown as Holds,
    });
    const meta: HookMeta = { id: 'h1', agent: 'claude-code', event: 'PreToolUse', session: 's1', cwd: repo, transcript: '', pid: 1, ppid: 1, matched: [] };
    const out = await staging.gate(meta, { label: 'git checkout -- .', classes: [], stage: { edits: [repo] } }, false);
    expect(recorded, 'no staging is recorded with a file it holds no copy of').toEqual([]);
    expect(out.deny).toContain('can\'t be staged first');
    expect(out.deny).toContain('Permission denied');
  } finally {
    chmodSync(files[0]!, 0o644);
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
