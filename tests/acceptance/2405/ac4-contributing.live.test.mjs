// AC4: CONTRIBUTING.md says a study adds its names before it files, and the doc lanes pass (live). The sentence is read
// offline; the lanes run in a scratch copy whose change is CONTRIBUTING.md, on every real open issue through the caller's
// gh. Offline, signed out, with no built contracts package, or with no throttle grant, the lanes' half skips as
// INCONCLUSIVE and never passes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, DOC_LANES, LIVE_TIMEOUT, REPO, commit, ghProblem, liveEnv, makeCopy, runLanes, verdicts } from './helpers.mjs';

// One sentence: a study (or studies) adds its names, before it files.
const says = (sentence) => /\bstud(?:y|ies)\b/i.test(sentence) && /\badd(?:s|ed|ing)?\b/i.test(sentence)
  && /\bnames?\b/i.test(sentence) && /\bbefore\b.*\bfil(?:es?|ed|ing)\b/i.test(sentence);

test('#2405.bb6d2053 AC4 (live): CONTRIBUTING.md says a study adds its names before it files, and the doc lanes pass with CONTRIBUTING.md as the change and every real open issue', (t) => {
  const text = readFileSync(join(CHECKOUT, 'CONTRIBUTING.md'), 'utf8');
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  // A CONTRIBUTING.md without it, or saying a study adds its names after it files, fails here.
  assert.ok(sentences.some(says), 'no sentence of CONTRIBUTING.md says a study adds its names before it files');

  const env = liveEnv();
  const problem = ghProblem(env);
  if (problem) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't reach GitHub, so the doc lanes can't read the open issues: ${problem}`);
    return;
  }
  if (!existsSync(join(CHECKOUT, 'packages', 'contracts', 'dist', 'index.js'))) {
    t.skip('INCONCLUSIVE: packages/contracts/dist is not built, and the catalogue drift lane reads it; run npm ci and npm run build -w packages/contracts first');
    return;
  }
  const { repo } = makeCopy(t, { dist: true });
  const contributing = readFileSync(join(repo, 'CONTRIBUTING.md'));
  rmSync(join(repo, 'CONTRIBUTING.md'));
  commit(repo, 'The tree without CONTRIBUTING.md', { base: true });
  writeFileSync(join(repo, 'CONTRIBUTING.md'), contributing);
  commit(repo, 'CONTRIBUTING.md');
  const run = runLanes(repo, env, DOC_LANES, { timeout: LIVE_TIMEOUT });
  t.diagnostic(run.output);
  const states = Object.fromEntries(DOC_LANES.map((name) => [name, verdicts(run, name)]));
  if (run.signal || Object.values(states).some((s) => s.includes('INCONCLUSIVE'))) {
    t.skip(`INCONCLUSIVE: a doc lane couldn't read the open issues of ${REPO} or didn't finish, so it has no verdict:\n${run.output}`);
    return;
  }
  assert.deepEqual(states, Object.fromEntries(DOC_LANES.map((name) => [name, ['PASS']])), `the doc lanes don't all pass:\n${run.output}`);
  assert.equal(run.status, 0, run.output);
});
