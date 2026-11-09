// Shared build products at a session's start (#1017): a folder with no .deepbuild/done.yaml at or above it lists no
// products, so its start runs no git for them; one with a done.yaml still reads its repo through git.
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookLine, recorded, reply, session, withHub } from './hub.js';

/** A git on PATH that notes each `rev-parse --git-common-dir` (the products' repo read) and runs the real git. */
function loggingGit(home: string): { bin: string; log: string } {
  const bin = join(home, 'bin');
  const log = join(home, 'git.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$*" in *--git-common-dir*) echo "$PWD" >> '${log}';; esac\nexec /usr/bin/git "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return { bin, log };
}
const reads = (log: string): string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);

describe("a session's start and the product store", () => {
  it('runs no git for products in a folder no done.yaml covers, and reads the repo where one does', async () => {
    let git: { bin: string; log: string } | undefined;
    await withHub(async (root, home, hub) => {
      git = loggingGit(home);
      await hub.restart({ PATH: `${git.bin}:${process.env.PATH ?? ''}` });
      const id = 'aaaaaaaa-1017-4000-8000-0000000000c1';
      const s = session(home, id);
      await reply(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4TC0', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
      await recorded(root, id, 'session.start', 1);
      expect(reads(git.log), 'no done.yaml above the folder: no git for products').toEqual([]);

      // The same folder once its repo's spec is there: the products' read of its repo runs.
      writeFileSync(join(s.work, '.gitkeep'), '');
      mkdirSync(join(s.work, '.deepbuild'), { recursive: true });
      writeFileSync(join(s.work, '.deepbuild', 'done.yaml'), 'environment: {}\n');
      await reply(join(root, 'hub.sock'), hookLine('01K74FKZVK8Q2X5R7M3N9P4TC1', 'SessionStart', s.payload('SessionStart', { source: 'resume' })));
      await recorded(root, id, 'session.start', 2);
      expect(reads(git.log).length, 'a done.yaml above the folder: its repo is read').toBeGreaterThan(0);
    });
  }, 60_000);
});
