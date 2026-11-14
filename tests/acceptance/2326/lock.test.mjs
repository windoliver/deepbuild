// Acceptance for #2326, criterion 1: the eight locked crates with a fixed release in range move to it by a
// lock update alone. Reads Cargo.lock and git only; no build, no network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url).pathname;
// The base commit this issue was drafted against; the diff criterion is read from here.
const BASE = '1c4d1f0e2aaad8c6a6573848823566d04ff73d17';

// [crate, version the advisories name, first fixed release], as the issue lists them.
const MOVES = [
  ['rustls-webpki', '0.103.15', '0.103.16'],
  ['tokio', '1.54.0', '1.54.1'],
  ['zstd', '0.13.3', '0.13.4'],
  ['zstd-safe', '7.3.0', '7.4.0'],
  ['crypto-bigint', '0.7.5', '0.7.6'],
  ['ctutils', '0.4.3', '0.4.4'],
  ['rustix', '1.1.5', '1.1.6'],
  ['rsa', '0.10.0-rc.18', '0.10.0'],
];

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v);
  assert.ok(m, `not a semver version: ${v}`);
  return { nums: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split('.') : [] };
}

// Semver precedence: a prerelease sorts below its release, so 0.10.0-rc.18 < 0.10.0.
function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// Cargo's compatible line: same major, or same minor under 0.x.
const line = (v) => { const [ma, mi] = parse(v).nums; return ma > 0 ? `${ma}` : `0.${mi}`; };

const lockText = readFileSync(`${root}Cargo.lock`, 'utf8');
const locked = lockText.split(/^\[\[package\]\]$/m).slice(1).map((block) => ({
  name: /^name = "([^"]+)"$/m.exec(block)?.[1],
  version: /^version = "([^"]+)"$/m.exec(block)?.[1],
}));

for (const [name, vulnerable, fixed] of MOVES) {
  test(`Cargo.lock holds ${name} at ${fixed} or later, a final release, in place of ${vulnerable}`, () => {
    const inLine = locked.filter((p) => p.name === name && line(p.version) === line(vulnerable)).map((p) => p.version);
    assert.ok(inLine.length, `Cargo.lock has no ${name} in the ${line(vulnerable)} line the advisory names`);
    for (const v of inLine) {
      // A crate a dependent holds back fails here; the issue lets the PR name that dependent instead, which is run
      // evidence for a person to read (README), never a pass of this check.
      assert.ok(compare(v, fixed) >= 0, `${name} is locked at ${v}, below the fixed release ${fixed}`);
      assert.equal(parse(v).pre.length, 0, `${name} is locked at prerelease ${v}, not a final fixed release`);
    }
  });
}

test('the change against the base touches Cargo.lock and no Cargo manifest', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const changed = [...git('diff', '--name-only', BASE), ...git('ls-files', '--others', '--exclude-standard')];
  assert.ok(changed.includes('Cargo.lock'), `Cargo.lock is unchanged against ${BASE}`);
  const manifests = changed.filter((f) => f === 'Cargo.toml' || f.endsWith('/Cargo.toml'));
  assert.deepEqual(manifests, [], 'the change edits Cargo manifests');
});
