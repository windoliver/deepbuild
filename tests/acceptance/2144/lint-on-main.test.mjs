// #2144 AC1: the canvas lint on this checkout exits 0, or every line it prints is one scripts/known-failures.json
// records with its issue. A line is recorded when the lint lane reads it as already failing on main: the key and count
// scripts/affected.mjs makes of it (lintFindings, classify) against the file. "With its issue": the file's entry for
// that key names an issue as `#<n>`, as the design asks of every known failure the preflight sets apart (Dogfooding:
// "Each known failure the preflight sets apart names an open issue and the date it was added"). README: AC1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify, lintFindings } from '../../../scripts/affected.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const LINT = 'scripts/canvas-lint.mjs';
const ISSUE = /#\d+\b/;

/**
 * Whether some entry of known-failures.json names `key` and carries an issue reference beside it: a property named by
 * the key whose value holds `#<n>`, or an object holding the key as a value and `#<n>` in another of its values. The
 * file's layout for lint entries is the implementer's; only the pairing of the key with an issue is read.
 */
function recordedWithIssue(node, key) {
  if (Array.isArray(node)) return node.some((item) => recordedWithIssue(item, key));
  if (!node || typeof node !== 'object') return false;
  const entries = Object.entries(node);
  for (const [name, value] of entries) {
    if (name === key && ISSUE.test(JSON.stringify(value))) return true;
    if (value === key && entries.some(([other, beside]) => other !== name && ISSUE.test(JSON.stringify(beside)))) return true;
    if (recordedWithIssue(value, key)) return true;
  }
  return false;
}

test('#2144.35365960 node scripts/canvas-lint.mjs exits 0 on main, or every line it prints is one scripts/known-failures.json records with its issue', { timeout: 90 * 60_000 }, () => {
  const run = spawnSync(process.execPath, [LINT], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...process.env },
  });
  assert.equal(run.error, undefined, `the lint could not run: ${run.error?.message}`);
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.status === 0) {
    assert.match(run.stdout, /^PASS canvas-lint: /m, `exit 0 without a PASS line:\n${output}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(join(repo, 'scripts', 'known-failures.json'), 'utf8'));
  const findings = lintFindings(repo, LINT, run.stdout, run.status);
  const { known, fresh, unsure } = classify([], findings, baseline, 0);
  // A line the lane reads as new, or as BLOCKED, INVALID or INCONCLUSIVE, is no recorded line.
  const unrecorded = [...fresh, ...unsure].map(({ id, state }) => `${state} ${id}`);
  const withoutIssue = [...new Set(known.map(({ id }) => id))].filter((key) => !recordedWithIssue(baseline, key));
  assert.ok(findings.length > 0, `exit ${run.status} with no line read:\n${output}`);
  assert.deepEqual(
    { unrecorded, withoutIssue },
    { unrecorded: [], withoutIssue: [] },
    `exit ${run.status}: ${unrecorded.length} lines known-failures.json doesn't record, and ${withoutIssue.length} recorded lines whose entry names no issue (#<n>). The lint printed:\n${output}`,
  );
});
