// AC4 #3519.f27efbd8: "`node scripts/canvas-skill.mjs --check` finds no drift, and #508's first criterion passes
// unchanged"
//
// asserts: `node scripts/canvas-skill.mjs --check` in this checkout exits 0 and prints nothing to stderr; and
// tests/acceptance/508/ is the merge base's (no diff against `git merge-base HEAD origin/main`, nothing untracked),
// and its AC1 file, ac1-skill.test.ts, run in its own Vitest as its README runs it, passes every test it holds.
// Wrong programs: a canvas skill edited by hand or left stale after a generator change; a change that edits #508's
// suite; a canvas skill #508's AC1 refuses (a kind left out, or run records made on other skill bytes).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, blocked, git, suite } from './helpers.ts';

describe(`${AC.drift} no drift, and #508's first criterion unchanged`, () => {
  it(`${AC.drift} node scripts/canvas-skill.mjs --check finds no drift`, () => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/canvas-skill.mjs'), '--check'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect({ status: r.status, stderr: r.stderr.trim() }, `canvas-skill.mjs --check: ${r.error?.message ?? ''}`).toEqual({ status: 0, stderr: '' });
  }, TIMEOUT);

  it(`${AC.drift} #508's first criterion passes unchanged: tests/acceptance/508 is the merge base's, and every test in its ac1-skill.test.ts passes`, () => {
    const base = git('merge-base', 'HEAD', 'origin/main');
    if (base.status !== 0 || !/^[0-9a-f]{40}$/.test(base.out)) blocked(`no merge base of HEAD with origin/main: ${base.out}`);
    const diff = git('diff', '--stat', base.out, '--', 'tests/acceptance/508');
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'tests/acceptance/508');
    expect({ diff: diff.out, untracked: untracked.out }, `tests/acceptance/508 against the merge base ${base.out}`).toEqual({ diff: '', untracked: '' });
    const all = suite('tests/acceptance/508', 'ac1-skill.test.ts');
    expect(all.some((a) => a.fullName.includes('#508.9e5770bb')), `it is #508's AC1 suite: ${all.map((a) => a.fullName).join(' | ')}`).toBe(true);
    const failed = all.filter((a) => a.status !== 'passed').map((a) => `${a.status}: ${a.fullName}: ${(a.failureMessages ?? []).join(' ').slice(0, 600)}`);
    expect(failed, '#508\'s AC1 tests that did not pass').toEqual([]);
  }, TIMEOUT);
});
