// #879 acceptance, AC1: every package and crate in this checkout has its card, and the lint
// rules (`node scripts/repo-rules.mjs`, run read-only here) pass the card check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { root, rules, show } from '../246/helpers.mjs';
import { HEADINGS } from './helpers.mjs';

// The failing lines `node scripts/repo-rules.mjs` already prints on this checkout at the base
// 69013e61, before any card: other checks' findings, which #879 doesn't own (README: "Readings", 7).
// A run may still print these, or fewer; it may print no other failure.
const BASE_FAILURES = [
  'FAIL secrets: tests/acceptance/331/BASE-FAILURE-AC9.txt:20:14: home path',
  'FAIL secrets: tests/acceptance/356/redraft/BASE-FAILURE.txt:4:14: home path',
  'FAIL secrets: tests/acceptance/572/BASE-FAILURE.txt:11:14: home path',
  'FAIL deps: packages/extension-host/package.json dependencies @deepbuild/evidence 0.0.0 is not in scripts/repo-rules.json',
  'FAIL deps: crates/deep-app/Cargo.toml dependencies sha2 ^0.10 is not in scripts/repo-rules.json',
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Each folder directly under packages/ or crates/ that holds a file git lists (tracked, or new and not ignored).
function folders() {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'packages', 'crates'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const found = new Set();
  for (const path of listed.split('\0').filter(Boolean)) {
    const parts = path.split('/');
    if (parts.length > 2) found.add(`${parts[0]}/${parts[1]}`);
  }
  return [...found].sort();
}

test('AC1: every folder under packages/ and crates/ has a README.md card with the four headings', () => {
  const all = folders();
  assert.ok(all.some((dir) => dir.startsWith('packages/')) && all.some((dir) => dir.startsWith('crates/')), `expected folders under both roots, found ${all.join(', ')}`);
  const problems = [];
  for (const dir of all) {
    const path = join(root, dir, 'README.md');
    if (!existsSync(path)) {
      problems.push(`${dir}: no README.md`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    for (const heading of HEADINGS)
      if (!new RegExp(`^#{2,6}[ \\t]+${escape(heading)}`, 'im').test(text)) problems.push(`${dir}/README.md: no "## ${heading}" heading`);
  }
  assert.deepEqual(problems, [], `${problems.length} of ${all.length} folders lack a full card:\n${problems.join('\n')}`);
});

test('AC1: the lint rules pass the card check on this checkout, add no failure the base lacks, and leave git status unchanged', () => {
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const before = status();
  const result = rules(root);
  assert.equal(status(), before, 'repo-rules changed git status --porcelain');
  const cards = result.stdout.split('\n').filter((line) => /^[A-Z]+ cards:/.test(line));
  assert.ok(cards.some((line) => line.startsWith('PASS cards: ')), `no PASS cards line\n${show(result)}`);
  assert.deepEqual(cards.filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line)), [], show(result));
  const failures = result.stdout.split('\n').filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line));
  assert.deepEqual(failures.filter((line) => !BASE_FAILURES.includes(line)), [], `failures the base doesn't print\n${show(result)}`);
  assert.equal(result.status, failures.length ? 1 : 0, show(result));
});
