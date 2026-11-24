// #2327 acceptance, criterion 2 (#2327.07f9ccee): the repository's private reporting is on, read
// through the forge's API. The test only reads; it changes no setting. Anything but `enabled: true`
// is BLOCKED, never a pass and never a skip (README: Verdicts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { REPOSITORY } from './helpers.mjs';

const ENDPOINT = `repos/${REPOSITORY}/private-vulnerability-reporting`;
const first = (text) => `${text ?? ''}`.trim().split('\n')[0].slice(0, 300);

test(`#2327.07f9ccee gh api ${ENDPOINT} answers enabled: true`, (t) => {
  const result = spawnSync('gh', ['api', ENDPOINT], { encoding: 'utf8', timeout: 60_000 });
  assert.ok(!result.error, `BLOCKED: gh could not run (${result.error?.code ?? result.error?.message}); install gh and sign in, then run this again`);
  assert.equal(result.status, 0, `BLOCKED: gh api ${ENDPOINT} exited ${result.status} (${first(result.stderr) || first(result.stdout)}); without the API's answer this criterion is not judged`);
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    assert.fail(`BLOCKED: gh api ${ENDPOINT} answered no JSON: ${first(result.stdout)}`);
  }
  t.diagnostic(`gh api ${ENDPOINT} answered ${JSON.stringify(answer)}`);
  assert.equal(answer?.enabled, true, `BLOCKED: gh api ${ENDPOINT} answered ${JSON.stringify(answer)}; until the owner turns private reporting on this criterion is BLOCKED, never PASS`);
});
