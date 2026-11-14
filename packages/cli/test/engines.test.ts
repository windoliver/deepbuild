import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string; engines: { node: string } };
const NEEDED = pkg.engines.node.replace(/^>=\s*/, '');
const home = mkdtempSync(join(tmpdir(), 'deep-engines-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
mkdirSync(join(home, '.deepbuild'));
writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), '{}\n');

function version(preload: string, env: Record<string, string>) {
  const file = join(home, 'preload.mjs');
  writeFileSync(file, preload);
  return spawnSync(process.execPath, ['--import', file, CLI, '--version'], { env: { ...process.env, HOME: home, ...env }, encoding: 'utf8' });
}

it('deep --version orders no strings by locale, so no command loads collation data to start', () => {
  const log = join(home, 'collations.log');
  const result = version(`import { appendFileSync } from 'node:fs';
const note = (what) => appendFileSync(process.env.DEEP_TEST_COLLATIONS, what + '\\n');
const compare = String.prototype.localeCompare;
String.prototype.localeCompare = function (...args) { note('localeCompare'); return compare.apply(this, args); };
Intl.Collator = new Proxy(Intl.Collator, {
  construct(target, args) { note('Intl.Collator'); return new target(...args); },
  apply(target, self, args) { note('Intl.Collator'); return target(...args); },
});
`, { DEEP_TEST_COLLATIONS: log });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(pkg.version);
  expect(existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []).toEqual([]);
}, 60_000);

const older = (found: string) => found.localeCompare(NEEDED, undefined, { numeric: true }) < 0;
const [major, minor, patch] = NEEDED.split('.').map(Number) as [number, number, number];
const versions = [
  '0.0.1', '9.0.0', `${major - 1}.99.99`, `${major}.9.0`, `${major}.${minor - 1}.${patch + 9}`,
  NEEDED, `${NEEDED}-nightly20261111abcdef0123`, `${major}.${minor}.${patch + 1}`, `${major}.${minor + 78}.0`, `${major + 1}.0.0`, `${major + 1}.0.0-pre`, '100.0.0', '999.0.0',
];

it('the versions tried fall on both sides of the Node the CLI needs', () => {
  expect(versions.filter(older).length).toBeGreaterThanOrEqual(5);
  expect(versions.filter((v) => !older(v)).length).toBeGreaterThanOrEqual(5);
});

it.each(versions)('on Node %s deep runs, or names the Node it needs and exits 2, as the numbers order them', (found) => {
  const result = version(`Object.defineProperty(process, 'versions', { value: { ...process.versions, node: process.env.DEEP_TEST_NODE } });\n`, { DEEP_TEST_NODE: found });
  if (older(found)) {
    expect(result.stderr).toContain(`deep needs Node ${NEEDED} or newer; this is Node ${found} at ${process.execPath}.`);
    expect(result.stdout).toBe('');
    expect(result.status).toBe(2);
  } else {
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.status).toBe(0);
  }
}, 60_000);
