// #2146 AC1: `node scripts/conformance-lint.mjs` exits 0 on main. The lint's own run is the proof the issue names,
// so these tests run the real script once, in the checkout, over the built packages (it exits 3 when they aren't
// built; a build is the runner's to make, as it is for the lint).
import { beforeAll, describe, expect, it } from 'vitest';
import { unmappedCodes } from '../../../packages/conformance/src/index.ts';
import { LINT_TIMEOUT_MS, runLint } from './helpers.ts';
import type { Lint } from './helpers.ts';

// The one machine reading set apart, narrowly: the environment@1 slot kit reads the machine's listening ports with
// lsof, and on a machine where that read fails its planted proofs read BLOCKED, which the lint prints as a FAIL
// line. That line says nothing about a code mapping or a digest, the two defects #2146 names, and nothing in the
// repo decides it. The first test below allows FAIL lines of exactly this shape and no other; the second allows
// none, so a run with one is never read as the criterion's plain exit 0.
const MACHINE_BLOCKED = /^FAIL slot kit environment@1: .* BLOCKED "the environment's listening ports can't be read \(lsof failed\)/;

describe('#2146.9d5eea71 AC1: `node scripts/conformance-lint.mjs` exits 0 on main', () => {
  let lint: Lint;
  beforeAll(() => { lint = runLint(); }, LINT_TIMEOUT_MS);

  it('#2146.9d5eea71 AC1: `node scripts/conformance-lint.mjs` exits 0 on main: its code mappings check passes, no line reads "maps to no verdict", and nothing but a machine\'s unreadable ports fails it', () => {
    expect(lint.signal, lint.stderr).toBeNull();
    const unmapped = lint.lines.filter((line) => line.includes('maps to no verdict'));
    expect(unmapped).toEqual([]);
    // The lint reads the built package; the source it was built from names the same codes: none.
    expect(unmappedCodes().map((u) => `${u.family} ${u.code}`)).toEqual([]);
    expect(lint.lines).toContain('PASS code mappings: every family code maps to a verdict');
    const failing = lint.lines.filter((line) => !line.startsWith('PASS '));
    expect(failing.filter((line) => !MACHINE_BLOCKED.test(line))).toEqual([]);
    expect(lint.status, lint.stderr).toBe(failing.length ? 1 : 0);
  });

  it('#2146.9d5eea71 AC1: `node scripts/conformance-lint.mjs` exits 0 on main: exit code 0, every line a PASS', () => {
    expect(lint.lines.filter((line) => !line.startsWith('PASS '))).toEqual([]);
    expect(lint.lines.length).toBeGreaterThan(0);
    expect({ status: lint.status, signal: lint.signal }, lint.stderr).toEqual({ status: 0, signal: null });
  });
});
