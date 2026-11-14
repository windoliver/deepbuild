// #2064: a PR after cd is judged in that checkout; a failed branch lookup cannot lose the completed hook.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { gatePrBodies } from '../src/pr-commands.js';

it('matches the qualified issue to the PR working directory after cd', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pr-context-'));
  const target = join(cwd, 'shop');
  try {
    execFileSync('git', ['init', '-q', target]);
    execFileSync('git', ['-C', target, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git']);
    const gate = (body: string) => gatePrBodies(`cd shop && gh pr create --title t --body '${body}'`, cwd, async (issue) => issue === 7 ? 'R2 unproven' : undefined, async () => undefined);
    expect(await gate('Closes acme/shop#7')).toBe('R2 unproven');
    expect(await gate('Closes other/repo#7')).toBeUndefined();
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
