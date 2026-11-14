// #2326 AC1 (#2326.3ec6f925): after the change `Cargo.lock` holds each of the eight crates at its first fixed
// version or later, and the change touches `Cargo.lock` and no manifest. Written blind from the issue, the design
// and base 1c4d1f0e2; see README.md for the mapping and what a person still reads.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { changedPaths } from '../../../scripts/lanes.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ID = '#2326.3ec6f925';

// The issue's eight, each with the first fixed version it names.
const FIXED = {
  'rustls-webpki': '0.103.16',
  tokio: '1.54.1',
  zstd: '0.13.4',
  'zstd-safe': '7.4.0',
  'crypto-bigint': '0.7.6',
  ctutils: '0.4.4',
  rustix: '1.1.6',
  rsa: '0.10.0',
};

/** Every [[package]] of a Cargo.lock: name, version and the entries it lists as dependencies. */
function packages(lock) {
  return lock.split(/^\[\[package\]\]$/m).slice(1).map((block) => ({
    name: block.match(/^name = "([^"]+)"$/m)?.[1],
    version: block.match(/^version = "([^"]+)"$/m)?.[1],
    dependencies: [...(block.match(/^dependencies = \[([\s\S]*?)^\]/m)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(([, dep]) => dep),
  }));
}

const parse = (version) => {
  const [, major, minor, patch, pre] = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  return { core: [major, minor, patch].map(Number), pre: pre ? pre.split('.') : [] };
};

/** SemVer 2 precedence: negative, zero or positive as a is below, equal to or above b. */
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Cargo's compatibility line: the leftmost non-zero part, so 1.x, 0.103.x, 0.10.x. */
const line = (version) => {
  const [major, minor, patch] = parse(version).core;
  return major ? `${major}` : minor ? `0.${minor}` : `0.0.${patch}`;
};

/**
 * The crates of FIXED a lock doesn't hold at the fixed version or later: one locked on the fixed version's
 * compatibility line below it, or none locked at the fixed version or later. A copy on another line, such as
 * rustix 0.38 beside rustix 1.x, is a different requirement and isn't one the issue names.
 */
function behind(lock) {
  const all = packages(lock);
  return Object.entries(FIXED).flatMap(([name, fixed]) => {
    const locked = all.filter((pkg) => pkg.name === name).map((pkg) => pkg.version);
    const low = locked.filter((version) => line(version) === line(fixed) && compare(version, fixed) < 0);
    if (!low.length && locked.some((version) => compare(version, fixed) >= 0)) return [];
    const dependents = all.filter((pkg) => pkg.dependencies.some((dep) => dep === name || low.some((version) => dep === `${name} ${version}`)))
      .map((pkg) => `${pkg.name} ${pkg.version}`);
    return [{ name, fixed, locked, dependents }];
  });
}

/** The change's manifests: any Cargo.toml or package.json it touches. */
const manifests = (paths) => paths.filter((path) => /(^|\/)(Cargo\.toml|package\.json)$/.test(path));

const describe = (rows) => rows.map(({ name, fixed, locked, dependents }) =>
  `${name}: locked ${locked.join(', ') || 'nowhere'}, needs ${fixed} or later; lock dependents: ${dependents.join(', ') || 'none'}`).join('\n');

test(`${ID} Cargo.lock holds each of the eight at its first fixed version or later`, () => {
  const rows = behind(readFileSync(`${ROOT}Cargo.lock`, 'utf8'));
  assert.deepEqual(rows.map(({ name }) => name), [],
    `not at the fixed version (a PR naming the dependent that holds one back is read by a person, see README):\n${describe(rows)}`);
});

test(`${ID} the change touches Cargo.lock and no manifest`, () => {
  const paths = changedPaths(ROOT);
  assert.ok(paths, 'BLOCKED: no merge base with origin/main, so the change cannot be read');
  assert.ok(paths.includes('Cargo.lock'), `the change does not touch Cargo.lock; it touches: ${paths.join(', ') || 'nothing'}`);
  assert.deepEqual(manifests(paths), [], 'the change edits a manifest');
});

// Wrong programs: the same checks on planted locks and changes must refuse each one.
const BASE = '1c4d1f0e2aaad8c6a6573848823566d04ff73d17';
const baseLock = () => execFileSync('git', ['show', `${BASE}:Cargo.lock`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 28 });
const pkg = (name, version, deps = []) =>
  `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n${deps.length ? `dependencies = [\n${deps.map((d) => ` "${d}",`).join('\n')}\n]\n` : ''}`;
const lockOf = (versions, extra = '') => `version = 4\n\n${Object.entries(versions).map(([name, v]) => pkg(name, v)).join('\n')}\n${extra}`;
const names = (lock) => behind(lock).map(({ name }) => name);

test(`${ID} wrong program: the base's lock is behind on all eight, naming each one's dependents`, () => {
  const rows = behind(baseLock());
  assert.deepEqual(rows.map(({ name }) => name), Object.keys(FIXED));
  assert.deepEqual(Object.fromEntries(rows.map(({ name, locked }) => [name, locked])), {
    'rustls-webpki': ['0.103.15'], tokio: ['1.54.0'], zstd: ['0.13.3'], 'zstd-safe': ['7.3.0'], 'crypto-bigint': ['0.7.5'],
    ctutils: ['0.4.3'], rustix: ['0.38.44', '1.1.5'], rsa: ['0.10.0-rc.18'],
  });
  for (const { name, dependents } of rows) assert.ok(dependents.length, `${name} has no dependent in the base lock`);
});

test(`${ID} boundaries: exactly the fixed versions pass, and one step below on any one fails`, () => {
  assert.deepEqual(names(lockOf(FIXED)), []);
  assert.deepEqual(names(lockOf({ ...FIXED, tokio: '1.55.0', 'rustls-webpki': '0.104.0' })), []);
  const below = { 'rustls-webpki': '0.103.15', tokio: '1.54.0', zstd: '0.13.3', 'zstd-safe': '7.3.9', 'crypto-bigint': '0.7.5',
    ctutils: '0.4.3', rustix: '1.1.5', rsa: '0.10.0-rc.19' };
  for (const [name, version] of Object.entries(below)) assert.deepEqual(names(lockOf({ ...FIXED, [name]: version })), [name], `${name} ${version}`);
});

test(`${ID} wrong programs: a crate dropped, an old copy left beside the new one, or a fixed version as a prerelease`, () => {
  const { rsa, ...noRsa } = FIXED;
  assert.deepEqual(names(lockOf(noRsa)), ['rsa'], 'a lock without rsa does not hold it at 0.10.0');
  assert.deepEqual(names(lockOf(FIXED, pkg('tokio', '1.54.0'))), ['tokio'], 'tokio 1.54.0 left beside 1.54.1');
  assert.deepEqual(names(lockOf({ ...FIXED, rustix: '1.1.6-rc.1' })), ['rustix']);
  assert.deepEqual(names(lockOf(FIXED, pkg('rustix', '0.38.44'))), [], 'rustix 0.38 is another requirement than the 1.x the issue names');
  const held = behind(lockOf({ ...FIXED, zstd: '0.13.3' }, pkg('some-dependent', '1.0.0', ['zstd'])));
  assert.deepEqual(held.map(({ name, dependents }) => [name, dependents]), [['zstd', ['some-dependent 1.0.0']]]);
});

test(`${ID} wrong programs: a change that edits a manifest, at any depth`, () => {
  assert.deepEqual(manifests(['Cargo.lock']), []);
  assert.deepEqual(manifests(['Cargo.lock', 'Cargo.toml']), ['Cargo.toml']);
  assert.deepEqual(manifests(['Cargo.lock', 'crates/deep-hook/Cargo.toml', 'docs/x.md']), ['crates/deep-hook/Cargo.toml']);
  assert.deepEqual(manifests(['packages/core/package.json', 'package-lock.json']), ['packages/core/package.json']);
});
