// A packaged Node links libraries outside its own install (for example Homebrew's libuv and OpenSSL).
// Granting Node must let it start, without granting unrelated files or allowing an ungranted Node executable.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { seatbelt } from '@deepbuild/supervisor';

it('starts the granted Node with its linked libraries while keeping unrelated files unreadable', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-node-runtime-')));
  const cwd = join(root, 'work');
  mkdirSync(cwd);
  const outside = join(root, 'not-granted.txt');
  writeFileSync(outside, 'private fixture');
  const node = realpathSync(process.execPath);
  const code = `const fs = require('node:fs'); let denied = false;
    try { fs.readFileSync(${JSON.stringify(outside)}); } catch (e) { denied = e.code === 'EPERM' || e.code === 'EACCES'; }
    console.log(JSON.stringify({node: process.versions.node, denied}));`;
  try {
    for (const read of [[node], [dirname(dirname(node))]]) {
      const launch = await seatbelt.confine({ argv: [node, '-e', code], cwd, env: { HOME: cwd } }, { read });
      const result = spawnSync(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
      expect({ status: result.status, signal: result.signal, stderr: result.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
      expect(JSON.parse(result.stdout)).toEqual({ node: process.versions.node, denied: true });
    }
    const launch = await seatbelt.confine({ argv: [node, '-e', 'console.log("ran")'], cwd, env: { HOME: cwd } }, {});
    const denied = spawnSync(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    expect(denied.status).not.toBe(0);
    expect(denied.stdout).not.toContain('ran');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
