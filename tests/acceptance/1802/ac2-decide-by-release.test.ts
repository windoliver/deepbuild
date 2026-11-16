// #1802.cca13350: "In a fixture release that is an entry's `decide_by`, the preflight fails, naming the entry, until it
// is stable, removed or extended. A planted preflight that only warns fails this test"
//
// asserts: deep.trial is a preview since R1 whose `decide_by` is R3, in the fixture releases R1 and R2. With R3 the
// candidate the preflight's contract step fails, and a FAIL line names deep.trial. The same candidate passes with
// deep.trial promoted to stable (a shipped piece calls it), with deep.trial removed, and with deep.trial extended to R5
// by an extension on record (README: contracts/extensions.json). The planted preflight (plants/reports-only.mjs: the
// same step, which turns each failure into a warning and exits 0) names deep.trial in a warning, passes R3 as it
// stands, and fails this criterion's check, naming deep.trial.
// Wrong programs: `reports-only`; the merge base, whose step reads no `decide_by` and passes R3 as it stands.

import { expect, it } from 'vitest';
import {
  REPORTS_ONLY, STEP, TRIAL, check, extensionOnRecord, failedNaming, failsNaming, fork, none, passed, promote, removeApi, shown, trialTree, type Tree,
} from './helpers.ts';

/** The three ways the criterion gives to settle an entry at its `decide_by`. */
const SETTLED: readonly (readonly [string, (t: Tree) => void])[] = [
  ['promoted to stable', (t) => promote(t, TRIAL)],
  ['removed', (t) => removeApi(t, TRIAL)],
  ['extended to R5 by an extension on record', (t) => extensionOnRecord(t, TRIAL, { from: 'R3', to: 'R5', reason: 'Its replacement lands in R5.', ask: 'ask:01JD1802A00000000000000001' })],
];

/** The criterion's check on a preflight: in R3 it fails naming deep.trial, until deep.trial is stable, removed or extended. */
function decideByReleaseFailures(program: string): string[] {
  const failures: string[] = [];
  const t = trialTree();
  const due = check(t, 'R3', program);
  if (!failedNaming(due, TRIAL)) failures.push(`in R3, which is ${TRIAL}'s decide_by, the preflight doesn't fail naming ${TRIAL} while it is still a preview and not extended: ${shown(due)}`);
  for (const [how, settle] of SETTLED) {
    const settled = fork(t);
    settle(settled);
    const after = check(settled, 'R3', program);
    if (!passed(after)) failures.push(`in R3, with ${TRIAL} ${how}, the preflight doesn't pass: ${shown(after)}`);
  }
  return failures;
}

it('#1802.cca13350 in the fixture release that is its decide_by the preflight fails, naming the entry, until it is stable, removed or extended', () => {
  none(decideByReleaseFailures(STEP), 'the preflight in R3, deep.trial\'s decide_by');
}, 300_000);

it('#1802.cca13350 a planted preflight that only warns passes the release that is the entry\'s decide_by, and this test fails it', () => {
  none(decideByReleaseFailures(STEP), 'the shipped preflight, held to the same check first');
  const warned = check(trialTree(), 'R3', REPORTS_ONLY);
  expect(warned.code, `the planted preflight exits 0 in R3\n${shown(warned)}`).toBe(0);
  expect(warned.out.split('\n').filter((l) => l.startsWith('WARN contracts:') && l.includes(TRIAL)).length, `and only warns, naming ${TRIAL}\n${shown(warned)}`).toBeGreaterThan(0);
  failsNaming(decideByReleaseFailures(REPORTS_ONLY), [TRIAL], 'a preflight that only warns');
}, 300_000);
