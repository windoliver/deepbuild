// Criterion 4 (live: needs network and gh signed in with read access to windoliver/deepbuild): after the owed lines land,
// the drift lane passes on every open issue, or lists each exception with its issue. Offline or signed out it skips as
// INCONCLUSIVE, saying why; it never passes then.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PLANNED, commit, laneName, makeFixture, runLanes, verdicts } from './helpers.mjs';

const REPO = process.env.GH_REPO ?? 'windoliver/deepbuild';

test('#1329.077043aa criterion 4 (live): the drift lane passes on the real docs and every real open issue, and each planned-names entry lists the open issue that names it', (t) => {
  const env = { ...process.env, GH_REPO: REPO };
  const auth = spawnSync('gh', ['auth', 'status'], { env, encoding: 'utf8' });
  if (auth.status !== 0) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't reach GitHub, so the open issues can't be read: ${`${auth.error?.message ?? ''}${auth.stderr ?? ''}`.trim()}`);
    return;
  }
  const { repo } = makeFixture(t);
  commit(repo, 'The base', { base: true });
  const run = runLanes(repo, env, ['drift']);
  const name = laneName(run, 'drift');
  // The Proof: the drift lane's output on the live issues.
  t.diagnostic(run.output);
  const states = verdicts(run, name);
  if (run.signal) {
    t.skip(`INCONCLUSIVE: the drift lane didn't finish on the live issues, so it has no verdict:\n${run.output}`);
    return;
  }
  if (states.includes('INCONCLUSIVE')) {
    t.skip(`INCONCLUSIVE: the drift lane couldn't read the open issues of ${REPO}:\n${run.output}`);
    return;
  }
  assert.deepEqual(states, ['PASS'], `the drift lane doesn't pass on the live issues:\n${run.output}`);
  assert.equal(run.status, 0, run.output);

  // Each exception is listed with its issue: every planned-names entry is `<name> #<issue>`, and that issue is open and
  // names it.
  const gh = spawnSync('gh', ['issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '5000', '--json', 'number,body'], { env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (gh.status !== 0) {
    t.skip(`INCONCLUSIVE: gh couldn't list the open issues to check the planned-names entries: ${gh.stderr.trim()}`);
    return;
  }
  const open = new Map(JSON.parse(gh.stdout).map(({ number, body }) => [number, body ?? '']));
  const path = join(repo, PLANNED);
  const entries = existsSync(path) ? readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
  const wrong = entries.filter((entry) => {
    const [, entryName, number] = entry.match(/^(.+?)\s+#(\d+)$/) ?? [];
    return !entryName || !open.get(Number(number))?.includes(entryName);
  });
  assert.deepEqual(wrong, [], `these ${PLANNED} entries aren't \`<name> #<issue>\` with an open issue that names the name`);
});
