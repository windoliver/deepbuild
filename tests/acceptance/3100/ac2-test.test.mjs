// #3100 #3100.40d22871: `cargo test --workspace --locked --no-fail-fast` on main leaves no failure the unit lane reads
// as FAIL, apart from those `scripts/known-failures.json` lists with an open issue.
// Run: node --test tests/acceptance/3100/ac2-test.test.mjs   (README.md beside this file; it builds and tests the whole
// workspace, from 15 minutes to hours, after waiting for the machine's build grant)
//
// The issue's command at the checkout's root, with the checkout's toolchain, as the unit lane runs it: a build grant of
// the throttle, the lease script, nice 10. Its output is read by the unit lane's reader (`cargoResults` with `crates()`,
// scripts/lanes.mjs), and every ID it reads as FAIL fails the test unless scripts/known-failures.json lists that ID
// under `failures` with a note naming its issue, `(#<issue>, added <YYYY-MM-DD>)` (the file's form, which
// scripts/known-failures-check.mjs holds it to), and that issue is open on GitHub now. A FAIL of a test the run reached
// fails the test whatever else happened; a run the machine stopped or kept from starting reads INCONCLUSIVE. IDs read
// BLOCKED, INVALID or INCONCLUSIVE aren't FAIL: the test names each, and they stay unproven in the lane.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC2, MINUTE, ROOT, WORKSPACE_TEST, cameToItsEnd, childEnv, inconclusive, machineMark, readCargo, rustupBin, shown, workspaceCargo } from './helpers.mjs';

const NAMED = /\(#(\d+), added \d{4}-\d{2}-\d{2}\)$/;

/** Each FAIL, as known-failures.json excuses it: by a listing whose issue is open, not at all, or unknown (no answer). */
function excuses(fails) {
  const listed = JSON.parse(readFileSync(join(ROOT, 'scripts/known-failures.json'), 'utf8')).failures ?? {};
  const issues = new Map();
  const state = (issue) => {
    if (!issues.has(issue)) {
      const gh = spawnSync('gh', ['issue', 'view', issue, '--json', 'state', '-q', '.state'], { cwd: ROOT, encoding: 'utf8' });
      issues.set(issue, gh.status === 0 ? gh.stdout.trim() : null);
    }
    return issues.get(issue);
  };
  return fails.map((failure) => {
    if (!Object.hasOwn(listed, failure.id)) return { ...failure, excuse: 'no', why: 'not listed' };
    const issue = listed[failure.id].match(NAMED)?.[1];
    if (!issue) return { ...failure, excuse: 'no', why: 'listed, naming no issue' };
    const now = state(issue);
    if (now === null) return { ...failure, excuse: 'unknown', why: `listed for #${issue}, which gh couldn't read` };
    return now === 'OPEN' ? { ...failure, excuse: 'yes', why: `listed for #${issue}, open` } : { ...failure, excuse: 'no', why: `listed for #${issue}, which is ${now.toLowerCase()}` };
  });
}

test(`${AC2} cargo test --workspace --locked --no-fail-fast on main leaves no failure the unit lane reads as FAIL, apart from those scripts/known-failures.json lists with an open issue`, { timeout: WORKSPACE_TEST }, async (t) => {
  const env = childEnv(rustupBin());
  const ran = workspaceCargo('ac2-cargo-test', ['cargo', 'test', '--workspace', '--locked', '--no-fail-fast'], env);
  cameToItsEnd('cargo test --workspace --locked --no-fail-fast', ran);
  const mark = machineMark(ran);

  const { failures, passed, skips = [] } = await readCargo(ROOT, ran.out, ran.status, env).catch((error) => (mark ? inconclusive(`cargo couldn't run here (${mark}): ${error.message}`) : Promise.reject(error)));
  t.diagnostic(`cargo test exited ${ran.status} after ${(ran.ms / MINUTE).toFixed(1)} min: the reader reads ${passed.length} PASS, ${failures.length} not, ${skips.length} ignored; output in target/acceptance-3100/ac2-cargo-test.log`);
  for (const { id, state, message } of failures.filter(({ state }) => state !== 'FAIL')) t.diagnostic(`${state} ${id}${message ? `: ${message}` : ''}`);
  const read = excuses(failures.filter(({ state }) => state === 'FAIL'));
  for (const { id, why } of read.filter(({ excuse }) => excuse === 'yes')) t.diagnostic(`LISTED ${id}: ${why}`);

  const left = read.filter(({ excuse }) => excuse === 'no');
  // Only target-level failures, on output the machine marked, are the machine's: INCONCLUSIVE.
  if (mark && !left.some(({ id }) => id.includes(' › '))) inconclusive(`cargo test couldn't run here (${mark}). ${shown(ran)}`);
  assert.deepEqual(left.map(({ id }) => id), [], `cargo test --workspace --locked --no-fail-fast leaves ${left.length} failures the unit lane reads as FAIL that no listing with an open issue excuses:\n${left.map(({ id, message, why }) => `FAIL ${id} (${why})${message ? `: ${message}` : ''}`).join('\n')}\n${shown(ran)}`);
  const unknown = read.filter(({ excuse }) => excuse === 'unknown');
  if (unknown.length) inconclusive(`whether known-failures.json's listings excuse these failures turns on issues gh couldn't read: ${unknown.map(({ id, why }) => `${id} (${why})`).join('; ')}`);
});
