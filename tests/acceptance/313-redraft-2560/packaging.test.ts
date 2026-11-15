// #313, the wiring row of suite 313's README ("the local preflight runs the conformance lint"), which the criteria that
// name the local preflight rest on: AC4 ("With the stop-cause enum's closure removed, the local preflight fails, naming
// the enum; …"), AC12 ("… with the fake for a clock stepped back removed, the local preflight fails, naming the rule"),
// AC13 ("… a closure without the mark fails the preflight, naming the enum") and AC16 ("… a planted code no entry
// raises fails the preflight, naming the code, …").
// #2560, second criterion: "A lint that fails still fails the packaging test, and a mutation with the wrong code still
// fails AC15"
//
// Blind redraft of one test of tests/acceptance/313/packaging.test.ts after #2560 (REDRAFT.md). The scenario, every
// assertion and every message are the original's. One thing changes: the test carries a timeout of its own, 600_000 ms,
// the budget suite 313 gives its heavy steps (this file's workspace build, the neighbouring AC15 test), instead of
// vitest's default 5 s. What the original got from the rest of its file is set up here as it was there: the workspaces
// built with 313's buildWorkspaces in a beforeAll with the original's 600_000 ms, since the lint reads the built
// packages. The beforeAll sits in the redrafted test's describe; the wrong programs, which need no build, have their own.
//
// asserts: scripts/conformance-lint.mjs exists and, run from the checkout, exits 0, prints at least one PASS line and
// no FAIL, INVALID, BLOCKED or INCONCLUSIVE line. The same assertion fails planted lints, scripts written to a temp
// folder: one that exits 1 printing a FAIL line, ones that exit 0 but print a FAIL, INVALID or BLOCKED line, and one
// that exits 0 printing no PASS line.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorkspaces, node, REPO } from '../313/helpers.ts';

const LINT = 'scripts/conformance-lint.mjs';

/** The original test's assertions, word for word, on a lint script: the checkout's, or a planted wrong one. */
function expectLintPasses(lint: string): void {
  expect(existsSync(lint)).toBe(true);
  const ran = node([lint]);
  expect(ran.status, ran.out).toBe(0);
  const lines = ran.stdout.trim().split('\n');
  expect(lines.filter((l) => /^PASS /.test(l)).length).toBeGreaterThan(0);
  expect(lines.filter((l) => /^(FAIL|INVALID|BLOCKED|INCONCLUSIVE) /.test(l))).toEqual([]);
}

/** Where the planted lints go: a temp folder, removed after the file. No repo file is written. */
const PLANTED = mkdtempSync(join(tmpdir(), 'lint-2560-'));
afterAll(() => rmSync(PLANTED, { recursive: true, force: true }));

/** A planted lint: a script that prints these lines, one per check in the lint's own form, and exits with this code. */
function plantedLint(name: string, lines: readonly string[], exit: number): string {
  const path = join(PLANTED, `${name}.mjs`);
  writeFileSync(path, `${lines.map((line) => `console.log(${JSON.stringify(line)});`).join('\n')}\nprocess.exitCode = ${exit};\n`);
  return path;
}

/** What the assertion throws on a wrong input; a wrong input it lets through fails here. */
function thrownBy(run: () => void): string {
  try { run(); } catch (error) { return String((error as Error).message); }
  throw Error('the assertion let a wrong program through');
}

describe('the local preflight runs the conformance lint: enum closures, code mappings, rule fakes and planted codes', () => {
  // What the original got from its file: the workspaces built first, since the lint reads the built packages.
  beforeAll(() => { buildWorkspaces(); }, 600_000);

  it('the conformance lint passes on the checkout, printing one PASS line per check and no FAIL, INVALID or BLOCKED (redraft 2560)', () => {
    expectLintPasses(join(REPO, LINT));
  }, 600_000);
});

// The planted lints need no build, so they sit outside the build's describe and run whatever the build does.
describe('(wrong program) a lint that fails still fails the lint case (redraft 2560)', () => {
  it('(wrong program) a lint that exits 1 printing a FAIL line fails this test, with its output in the message (redraft 2560)', () => {
    const message = thrownBy(() => expectLintPasses(plantedLint('exit-1-fail', ['PASS kits: no problem', 'FAIL codes: exit 4 unmapped'], 1)));
    expect(message).toContain('expected 1 to be +0');
    expect(message).toContain('FAIL codes: exit 4 unmapped');
  }, 600_000);

  it('(wrong program) a lint that exits 0 but prints a FAIL, INVALID or BLOCKED line fails this test, naming the line (redraft 2560)', () => {
    for (const line of ['FAIL codes: exit 4 unmapped', 'INVALID kits: no case', 'BLOCKED env: ps timed out']) {
      const message = thrownBy(() => expectLintPasses(plantedLint(`exit-0-${line.split(' ')[0]!.toLowerCase()}`, ['PASS kits: no problem', line], 0)));
      expect(message).toContain(line);
      expect(message).toContain('to deeply equal []');
    }
  }, 600_000);

  it('(wrong program) a lint that exits 0 printing no PASS line fails this test (redraft 2560)', () => {
    const message = thrownBy(() => expectLintPasses(plantedLint('exit-0-no-pass', ['conformance lint: nothing checked'], 0)));
    expect(message).toContain('expected 0 to be greater than 0');
  }, 600_000);
});
