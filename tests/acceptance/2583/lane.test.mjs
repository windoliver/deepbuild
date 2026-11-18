// #2583 AC1, its lane half: the catalogue drift lane, on main's docs and the open issues, names `brief.uncited` nowhere.
// The lane is the entry of scripts/lanes.mjs's `checks` named "catalogue drift", run alone through runLanes, the call
// scripts/checks.mjs makes over every lane: through the machine's throttle and the lease, in this checkout, whose docs
// are main's (the issue changes none), with the caller's own gh reading the open issues of windoliver/deepbuild live.
//
// The lane fails on main for other names too, so its verdict can't say; the test reads its output. It passes only when
// the lane ran its check, ending PASS, or FAIL with its list of uncatalogued kinds, and its output names
// `brief.uncited` nowhere. With gh not signed in, or a lane that couldn't read the open issues, got no throttle grant
// or didn't finish in the test's limit, the test skips with a message starting INCONCLUSIVE: and never passes. Any
// other end fails, with the lane's output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LANE = 'catalogue drift';
const KIND = 'brief.uncited';
// runLanes waits up to 30 minutes for the throttle's build grant; once granted, the lane reads two docs and the issues.
const LIMIT = 40 * 60_000;

test(`#2583.8f145f1b AC1 the catalogue drift lane, on main's docs and the open issues, names \`${KIND}\` nowhere`, { timeout: LIMIT + 5 * 60_000 }, (t) => {
  // The caller's own environment, HOME and gh; the repository named for a gh that can't read it from git; no cached issues.
  const env = { ...process.env, GH_REPO: process.env.GH_REPO ?? 'windoliver/deepbuild' };
  delete env.DEEP_OPEN_ISSUES;
  // Only its exit status is reported: its own words can name the signed-in account.
  const auth = spawnSync('gh', ['auth', 'status'], { env, encoding: 'utf8' });
  if (auth.status !== 0) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't reach GitHub (gh auth status: ${auth.error?.code ?? `exit ${auth.status ?? auth.signal}`}), so the lane can't read the open issues`);
    return;
  }

  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'lanes.mjs')).href)});
const lanes = checks.filter((lane) => lane.name === ${JSON.stringify(LANE)});
if (lanes.length !== 1) {
  console.log('NO LANE: scripts/lanes.mjs has ' + lanes.length + ' checks named ${LANE}');
  process.exit(3);
}
process.exitCode = runLanes(lanes);
`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: ROOT, env, encoding: 'utf8', timeout: LIMIT, maxBuffer: 1 << 28 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.replaceAll(ROOT, '<checkout>/');
  if (run.signal) {
    t.diagnostic(output);
    t.skip(`INCONCLUSIVE: the ${LANE} lane didn't finish in ${LIMIT / 60_000} minutes and was stopped (${run.signal}), so it has no verdict`);
    return;
  }
  const verdict = output.split('\n').find((line) => new RegExp(`^(?:PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) ${LANE}\\b`).test(line));
  if (!verdict) assert.fail(`the ${LANE} lane gave no verdict (exit ${run.status}):\n${output}`);

  const state = verdict.split(' ')[0];
  if (state === 'INCONCLUSIVE') {
    t.skip(`INCONCLUSIVE: the ${LANE} lane couldn't read all it checks, so whether it names ${KIND} is unknown: ${verdict}`);
    return;
  }
  // PASS: the docs and the open issues name only catalogued kinds. FAIL: the lane lists each one they name that isn't.
  const drift = output.split('\n').find((line) => /^FAIL \d+ event kinds? named in backticks (?:is|are) not in the catalogue: /.test(line));
  assert.ok(state === 'PASS' || (state === 'FAIL' && drift), `the ${LANE} lane ended ${state} without checking the docs and the open issues:\n${output}`);
  // The issue's Proof: the lane on the live tracker.
  t.diagnostic(drift ?? verdict);
  const naming = output.split('\n').filter((line) => line.includes(KIND));
  assert.deepEqual(naming, [], `the ${LANE} lane names ${KIND}`);
});
