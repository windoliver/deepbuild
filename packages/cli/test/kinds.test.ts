import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

describe('deep kinds with no canvas core built (#2176)', () => {
  // A copy of the built CLI with no canvas core beside it: the hub looks for one beside its own module and under the
  // target/ of the checkout it sits in, so the copy reads the same whether or not this checkout has built one.
  let copy: string;
  beforeAll(() => {
    copy = realpathSync(mkdtempSync(join(tmpdir(), 'deep-cli-kinds-')));
    const packages = readdirSync(join(repo, 'packages')).filter((name) => existsSync(join(repo, 'packages', name, 'package.json')));
    for (const name of packages)
      cpSync(join(repo, 'packages', name), join(copy, 'packages', name), { recursive: true, filter: (from) => !['node_modules', 'test'].includes(basename(from)) });
    mkdirSync(join(copy, 'node_modules', '@deepbuild'), { recursive: true });
    for (const name of readdirSync(join(repo, 'node_modules')))
      if (name !== '@deepbuild' && name !== '.bin') symlinkSync(join(repo, 'node_modules', name), join(copy, 'node_modules', name));
    for (const name of packages) symlinkSync(join(copy, 'packages', name), join(copy, 'node_modules', '@deepbuild', name));
  });
  afterAll(() => rmSync(copy, { recursive: true, force: true }));

  it.each([['--dump', 'out'], ['--diff', 'a.json', 'b.json']])('says so in one line and exits 3: kinds %s', (...args) => {
    const result = spawnSync(process.execPath, [join(copy, 'packages', 'cli', 'dist', 'main.js'), 'kinds', ...args], { encoding: 'utf8', cwd: copy, timeout: 60_000 });
    expect(result.stderr).toBe(`deep kinds: No canvas core is built under ${join(copy, 'target')}; run cargo build --bin deep-show first.\n`);
    expect(result.stdout).toBe('');
    expect(result.status).toBe(3);
  });
});
