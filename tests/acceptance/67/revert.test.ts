// #67 AC2: reverting a workspace commit restores its definitions and scripts exactly: bytes and file modes, a deleted
// file back, an added one gone, what later commits did left alone, and the history kept. `deep workspace revert`
// commits as DeepBuild, in a home where git has no identity: a person never needs to set one up, or to know it's git.
import { chmodSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, cleanup, fill, git, makeWorld, newWorkspace, startHub, workspace, type Workspace } from './hub.ts';

afterAll(cleanup, 60_000);

/** Every file of the workspace but git's own: its bytes and whether it can run. */
function tree(ws: Workspace): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(ws.folder, path)] = `${statSync(path).mode & 0o111 ? 'x' : '-'} ${readFileSync(path).toString('base64')}`;
    }
  };
  walk(ws.folder);
  return out;
}

describe(`${AC2} reverting a workspace commit restores its definitions and scripts exactly`, () => {
  it(`${AC2} a commit that rewrote a definition, took a script's mode, deleted a note and added a script is undone byte for byte; a later commit stays`, async () => {
    const w = makeWorld();
    await startHub(w);
    const ws = await newWorkspace(w, 'Server upkeep');
    fill(w, ws, {
      // CRLF and no newline at the end: a program that re-renders the file changes it.
      'definitions/done.md': '# Done\r\n\r\n- backups run nightly\r\n- no failed unit',
      'scripts/rotate.sh': '#!/bin/sh\nlogrotate -f /etc/logrotate.conf\n',
      'notes/hosts.md': 'web-1 is the old box\n',
      'data/seed.bin': '\u0000\u00ff\r\n\u0000',
    });
    const before = tree(ws);

    writeFileSync(join(ws.folder, 'definitions/done.md'), '# Done\n\nnothing\n');
    chmodSync(join(ws.folder, 'scripts/rotate.sh'), 0o644);
    rmSync(join(ws.folder, 'notes/hosts.md'));
    const change = fill(w, ws, { 'scripts/added.sh': '#!/bin/sh\necho added\n' });
    const later = fill(w, ws, { 'notes/later.md': 'kept\n' });
    const want = { ...before, 'notes/later.md': tree(ws)['notes/later.md']! };

    const { commit } = await workspace(w, 'revert', ws.id, change);

    expect(tree(ws), 'the workspace holds what it held before that commit, with the later commit\'s note').toEqual(want);
    expect(git(w, ws.folder, ['rev-parse', 'HEAD']), 'the revert\'s answer is the workspace\'s head').toBe(commit);
    expect(git(w, ws.folder, ['status', '--porcelain']), 'and nothing is left uncommitted').toBe('');
    const log = git(w, ws.folder, ['log', '--format=%H']).split('\n');
    expect(log.slice(0, 3), 'the revert is a new commit on top of the history, which keeps both commits').toEqual([commit, later, change]);
  }, 120_000);
});
