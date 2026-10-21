// AC8 and the command-line halves of AC7 and the preflight criteria: the conformance suite ships as its own
// package other tools can run (a workspace package with a bin), `deep run` exits 3 on a result that carries a
// code no enum lists, and the local preflight's lint lane runs the conformance lint script.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorkspaces, fixturePath, node, REPO } from './helpers.ts';

// scripts/lanes.d.mts types only the test paths; the lanes themselves are read as data.
interface Lane { name: string; commands: string[][]; fix: string }
const { checks } = (await import('../../../scripts/lanes.mjs')) as unknown as { checks: Lane[] };

const PACKAGE = join(REPO, 'packages', 'conformance');
const manifest = (): { name: string; bin?: Record<string, string> | string; exports?: unknown } => JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as { name: string; bin?: Record<string, string> | string };
const binPath = (): string => {
  const bin = manifest().bin;
  const relative = typeof bin === 'string' ? bin : bin?.['deep-conformance'];
  expect(relative, 'package.json names a deep-conformance bin').toBeDefined();
  return join(PACKAGE, relative!);
};
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');
const LINT = 'scripts/conformance-lint.mjs';

beforeAll(() => { buildWorkspaces(); }, 600_000);

describe('AC8 the conformance suite ships as its own package that other tools can run', () => {
  it('AC8 packages/conformance is a workspace package named @deepbuild/conformance with a public entry and a bin', () => {
    expect(existsSync(join(PACKAGE, 'package.json'))).toBe(true);
    expect(manifest().name).toBe('@deepbuild/conformance');
    expect(existsSync(join(PACKAGE, 'src', 'index.ts'))).toBe(true);
    const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { workspaces: string[] };
    expect(root.workspaces.some((w) => w === 'packages/*' || w === 'packages/conformance')).toBe(true);
    expect(existsSync(binPath()), `the bin ${binPath()} is built`).toBe(true);
  });

  it('AC8 the bin prints its usage and exits 0 on --help, and 2 on a command it does not know', () => {
    const help = node([binPath(), '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('run');
    expect(help.stdout).toContain('--fill');
    expect(node([binPath(), 'frobnicate']).status).toBe(2);
  });

  it('AC8 another tool runs the kit on a fill module: the clean fill passes with exit 0, one line per case', () => {
    const ran = node([binPath(), 'run', '--fill', fixturePath('fills', 'clean.mjs')]);
    expect(ran.status, ran.out).toBe(0);
    const lines = ran.stdout.trim().split('\n').filter((l) => /^(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) /.test(l));
    expect(lines.length, 'one line per case').toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith('PASS ')), ran.stdout).toBe(true);
  });

  it('AC8 the same run on the duplicate-ID fake exits 1 and prints a FAIL line carrying its message', () => {
    const ran = node([binPath(), 'run', '--fill', fixturePath('fills', 'duplicate-id.mjs')]);
    expect(ran.status, ran.out).toBe(1);
    expect(ran.stdout.split('\n').some((l) => l.startsWith('FAIL ') && l.includes('duplicate event ID')), ran.stdout).toBe(true);
  });

  it('AC8 a fill module that does not exist is a usage error: exit 2, nothing ran', () => {
    const ran = node([binPath(), 'run', '--fill', fixturePath('fills', 'missing.mjs')]);
    expect(ran.status).toBe(2);
    expect(ran.stdout).not.toMatch(/^PASS /m);
  });
});

describe('AC7 deep run exits by the one exit-code table, 3 on a result that carries a code no enum lists', () => {
  it('AC7 deep run --result on a run result whose outcome is the planted flaky_maybe prints INVALID naming the code, never PASS, and exits 3', () => {
    const ran = node([CLI, 'run', '--result', fixturePath('run-results', 'flaky-maybe.json')]);
    expect(ran.status, ran.out).toBe(3);
    expect(ran.out).toContain('INVALID');
    expect(ran.out).toContain('flaky_maybe');
    expect(ran.out).not.toMatch(/\bPASS\b/);
  });

  it('AC7 deep run exits 0 on a passed result, 1 on a failed one and 3 on one that ran nothing', () => {
    expect(node([CLI, 'run', '--result', fixturePath('run-results', 'passed.json')]).status).toBe(0);
    expect(node([CLI, 'run', '--result', fixturePath('run-results', 'failed.json')]).status).toBe(1);
    const blocked = node([CLI, 'run', '--result', fixturePath('run-results', 'blocked.json')]);
    expect(blocked.status).toBe(3);
    expect(blocked.out).not.toMatch(/\bPASS\b/);
  });

  it('AC7 deep run with no result is a usage error, exit 2, and deep --help lists run', () => {
    expect(node([CLI, 'run']).status).toBe(2);
    expect(node([CLI, 'run', '--result', fixturePath('run-results', 'missing.json')]).status).toBe(2);
    const help = node([CLI, '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('run');
  });
});

describe('the local preflight runs the conformance lint: enum closures, code mappings, rule fakes and planted codes', () => {
  it('the lint lane\'s commands include scripts/conformance-lint.mjs', () => {
    const lint = checks.find((lane) => lane.name === 'lint');
    expect(lint, 'a lint lane').toBeDefined();
    expect(lint!.commands.some((command) => command.includes(LINT)), `the lint lane runs ${LINT}: ${JSON.stringify(lint!.commands)}`).toBe(true);
  });

  it('the conformance lint passes on the checkout, printing one PASS line per check and no FAIL, INVALID or BLOCKED', () => {
    expect(existsSync(join(REPO, LINT))).toBe(true);
    const ran = node([join(REPO, LINT)]);
    expect(ran.status, ran.out).toBe(0);
    const lines = ran.stdout.trim().split('\n');
    expect(lines.filter((l) => /^PASS /.test(l)).length).toBeGreaterThan(0);
    expect(lines.filter((l) => /^(FAIL|INVALID|BLOCKED|INCONCLUSIVE) /.test(l))).toEqual([]);
  });
});
