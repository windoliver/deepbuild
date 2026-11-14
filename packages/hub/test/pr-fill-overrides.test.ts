// #2064: --body overrides filled description, not a single commit's filled title.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { gatePrBodies } from '../src/pr-commands.js';

it('still judges the filled closing subject with an explicit body or body file unless the title is also replaced', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pr-fill-override-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { stdio: 'pipe' });
  try {
    git('init', '-q', '-b', 'main');
    await writeFile(join(cwd, 'value'), 'base'); git('add', '.'); git('commit', '-qm', 'Base');
    git('checkout', '-qb', 'b');
    await writeFile(join(cwd, 'value'), 'fix'); git('add', '.'); git('commit', '-qm', 'Fixes #7');
    await writeFile(join(cwd, 'pr.md'), 'Part of #7\nR2');
    const gate = (command: string) => gatePrBodies(command, cwd, async (n) => n === 7 ? 'R2 unproven' : undefined, async () => undefined);
    for (const option of ['--body "Part of #7 R2"', '--body-file pr.md']) {
      expect(await gate(`gh pr create --fill ${option}`), option).toBe('R2 unproven');
      expect(await gate(`gh pr create --fill --title "Partial fix" ${option}`), option).toBeUndefined();
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 30_000);
