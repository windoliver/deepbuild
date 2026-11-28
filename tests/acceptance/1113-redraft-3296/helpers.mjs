import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, measuredRepo, write } from '../1113/helpers.mjs';

export const ALONE_FILE = 'tests/dither-fill.test.ts';

const VITEST_CONFIG = `export default { cacheDir: '../vite-cache', test: { include: ['tests/**/*.test.ts'] } };
`;
const VITEST_TEST = `import { expect, test } from 'vitest';
test('adds', () => { expect(1 + 1).toBe(2); });
`;
const NODE_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
test('adds', () => { assert.equal(1 + 1, 2); });
`;
const CARGO = `#!/bin/sh
case "$1" in
  metadata) echo '{"packages":[]}' ;;
  test)
    for arg in "$@"; do [ "$arg" = --list ] && { echo 'adds: test'; exit 0; }; done
    printf '     Running unittests src/lib.rs (target/debug/deps/stand_in-0123456789abcdef)\\n\\nrunning 1 test\\ntest adds ... ok\\n\\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\\n' ;;
esac
exit 0
`;

export function filledRepo(box) {
  const { repo, env } = measuredRepo(box);
  write(repo, {
    'vitest.config.mjs': VITEST_CONFIG,
    'tests/unit-stand-in.test.ts': VITEST_TEST,
    [ALONE_FILE]: VITEST_TEST,
    'tests/node-stand-in.test.mjs': NODE_TEST,
  });
  appendFileSync(join(repo, '.git/info/exclude'), 'node_modules\n');
  symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'), 'dir');
  const cargo = join(box.dir, 'bin', 'cargo');
  writeFileSync(cargo, CARGO);
  chmodSync(cargo, 0o755);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'pipe' });
  git('add', '-A');
  git('commit', '-q', '--amend', '-m', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { repo, env };
}

export const filled = (child) => new Promise((done) => {
  let out = '';
  const look = (chunk) => {
    out += chunk;
    if (/^(?:PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) unit\b/m.test(out)) {
      child.stdout.off('data', look);
      done(true);
    }
  };
  child.stdout.on('data', look);
  child.on('close', () => done(false));
});
