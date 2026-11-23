// #2693.821f46f4: tests/acceptance/488/ and tests/acceptance/532/ pass unchanged. The first test proves
// "unchanged": neither folder differs from the merge base with origin/main. The other two run each suite
// with its README's own command and require every test file and every test to pass, none skipped. They take
// long (488 builds three deep-show feature sets; 532 builds deep-logic for this Mac and in Docker for Linux,
// and drives headless Chrome), and a missing host makes 532's own tests fail BLOCKED, which fails this one.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO } from './helpers.ts';

const SUITES = ['tests/acceptance/488', 'tests/acceptance/532'] as const;

function git(args: string[]): { status: number | null; out: string } {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

interface Suite { status: number | null; signal: string | null; files: { passed: number; failed: number; skipped: number }; tests: { passed: number; failed: number; skipped: number }; tail: string }

function runSuite(root: string, extra: string[], env: Record<string, string>): Suite {
  const r = spawnSync('npx', ['vitest', 'run', '--root', root, '--no-file-parallelism', '--reporter', 'verbose', ...extra], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 3 * 3_600_000, killSignal: 'SIGKILL',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env },
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const counts = (label: string): Suite['files'] => {
    const line = out.split('\n').find((l) => l.trim().startsWith(label)) ?? '';
    const n = (word: string): number => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
    return { passed: n('passed'), failed: n('failed'), skipped: n('skipped') };
  };
  return { status: r.status, signal: r.signal, files: counts('Test Files'), tests: counts('Tests'), tail: out.split(REPO).join('<repo>').slice(-6000) };
}

function expectPassed(s: Suite, root: string): void {
  expect(s.status, `${root} exits 0 (signal ${s.signal ?? 'none'}):\n${s.tail}`).toBe(0);
  expect(s.files.failed, `${root}: no test file fails`).toBe(0);
  expect(s.tests.failed, `${root}: no test fails`).toBe(0);
  expect(s.tests.skipped, `${root}: no test is skipped`).toBe(0);
  expect(s.tests.passed, `${root}: tests ran and passed`).toBeGreaterThan(0);
}

describe('#2693.821f46f4 tests/acceptance/488/ and tests/acceptance/532/ pass unchanged', () => {
  it('#2693.821f46f4 tests/acceptance/488/ and tests/acceptance/532/ are unchanged from the merge base', () => {
    const base = git(['merge-base', 'HEAD', 'origin/main']);
    expect(base.status, `the merge base with origin/main is found: ${base.out}`).toBe(0);
    const diff = git(['diff', '--name-status', base.out.trim(), '--', ...SUITES]);
    expect(diff.status, `git diff runs: ${diff.out}`).toBe(0);
    expect(diff.out.trim(), 'neither suite differs from the merge base').toBe('');
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...SUITES]);
    expect(untracked.out.trim(), 'neither suite has an untracked file').toBe('');
  });

  it('#2693.821f46f4 tests/acceptance/488/ passes', () => {
    expectPassed(runSuite('tests/acceptance/488', [], {}), 'tests/acceptance/488');
  }, 3 * 3_600_000);

  it('#2693.821f46f4 tests/acceptance/532/ passes', () => {
    expectPassed(runSuite('tests/acceptance/532', ['--testTimeout=600000'], { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }), 'tests/acceptance/532');
  }, 3 * 3_600_000);
});
