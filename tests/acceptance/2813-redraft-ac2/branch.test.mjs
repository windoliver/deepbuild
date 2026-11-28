// #2813 AC2: on #1831's branch (PR #2802), `node scripts/proof.mjs before trace` no longer reports spine.test.mjs or
// #1831's other fast node files as `the run was stopped after 20 minutes`.
// Runs this checkout's proof tooling (its scripts/ laid over the branch's) in a scratch repository at PR #2802's head,
// with origin/main at the branch's base. By hand: it builds the branch's binaries and takes an hour or more (README).
// Run: node --test tests/acceptance/2813-redraft-ac2/branch.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ISSUES = fileURLToPath(new URL('./issues/', import.meta.url)); // #1831's body, as gh gave it on Nov 27, 2026
const HEAD = '3d2115ea6936d36617ac9bbd4a2ef933dbc172ed'; // refs/pull/2802/head
const BASE = 'd4cef00fbd02632188a161c94c19a9660a3ee6ba'; // PR #2802's base, main as it stood then
const STOPPED = 'the run was stopped after 20 minutes';
const FOLDER = 'tests/acceptance/1831';
// #1831's node test files that build nothing (its README: "no build, a few seconds", "no build, under a minute"):
// neither can reach the 20-minute cap of a run of its own.
const SPINE = `${FOLDER}/spine.test.mjs`;
const FAST = [SPINE, `${FOLDER}/harness.test.mjs`];
// The two that build deep-show and deep-gpu (canvas.test.mjs a release deep-show too): a run of their own may read
// the cap, as the issue keeps for a file stopped at it.
const BUILDING = [`${FOLDER}/canvas.test.mjs`, `${FOLDER}/deep-show.test.mjs`];
const AC2_1831 = '#1831.2e170a8b'; // spine.test.mjs's tag
const PROOF_CAP_MS = 5 * 3_600_000;

function git(cwd, args, options = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'advice.detachedHead=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.status !== 0) throw Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.error?.message}`);
  return result.stdout;
}
const has = (cwd, sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd }).status === 0;

/**
 * A scratch repository at PR #2802's head whose origin/main is its base. Its objects are read from this checkout's
 * repository, never written there; what it lacks is fetched from origin into the scratch repository alone.
 */
function branchRepository(directory) {
  const repo = join(directory, 'repo');
  const common = realpathSync(resolve(CHECKOUT, git(CHECKOUT, ['rev-parse', '--git-common-dir']).trim()));
  git(directory, ['init', '-q', '--template=', repo]);
  mkdirSync(join(repo, '.git/objects/info'), { recursive: true });
  writeFileSync(join(repo, '.git/objects/info/alternates'), `${join(common, 'objects')}\n`);
  const url = git(CHECKOUT, ['remote', 'get-url', 'origin']).trim();
  git(repo, ['remote', 'add', 'origin', url]);
  if (!has(repo, HEAD)) git(repo, ['fetch', '-q', '--no-tags', 'origin', 'refs/pull/2802/head']);
  if (!has(repo, BASE)) git(repo, ['fetch', '-q', '--no-tags', 'origin', BASE]);
  assert.ok(has(repo, HEAD) && has(repo, BASE), `origin gave neither PR #2802's head ${HEAD} nor its base ${BASE}`);
  git(repo, ['update-ref', 'refs/remotes/origin/main', BASE]);
  git(repo, ['checkout', '-q', '-b', 'pr-2802', HEAD]);
  assert.equal(git(repo, ['merge-base', 'HEAD', 'origin/main']).trim(), BASE, 'the scratch branch forks from its base');
  return repo;
}

/** Lays this checkout's scripts/ (what git lists there, edits and new files included) in place of the branch's. */
function layScripts(repo) {
  rmSync(join(repo, 'scripts'), { recursive: true, force: true });
  const paths = git(CHECKOUT, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'scripts']).split('\0').filter(Boolean);
  for (const path of new Set(paths)) {
    const from = join(CHECKOUT, path), to = join(repo, path);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (!stat || stat.isDirectory()) continue; // deleted in the worktree
    mkdirSync(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
}

test(`#2813.60c058b2 on #1831's branch (PR #2802), \`node scripts/proof.mjs before trace\` reports none of #1831's fast node files as ${STOPPED}, and spine.test.mjs gets a verdict of its own`, { timeout: PROOF_CAP_MS + 30 * 60_000 }, async (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2813-ac2-')));
  const log = `${directory}.log`;
  let child = null;
  t.after(() => {
    // Only the process group this test started, by its PID.
    if (child && child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(directory, { recursive: true, force: true });
    console.log(`#2813 AC2: the run's output is kept in ${log}`);
  });
  console.log(`#2813 AC2: the run's output goes to ${log}`);

  const repo = branchRepository(directory);
  layScripts(repo);
  // proof.mjs imports typescript; the scratch repository has no packages of its own, so it finds this checkout's
  // one folder up, outside the repository, where no lane lists it as a file of the change.
  assert.ok(existsSync(join(CHECKOUT, 'node_modules/typescript')), 'run npm ci in this checkout first: proof.mjs imports typescript');
  symlinkSync(join(CHECKOUT, 'node_modules'), join(directory, 'node_modules'));

  // The machine's own HOME, throttle table and bays, as any proof run here uses them; #1831's body from this suite.
  const env = { ...process.env, DEEP_PROOF_ISSUES: ISSUES };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PERF_LOCK', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS']) delete env[name];

  const out = createWriteStream(log);
  const scripts = `${git(CHECKOUT, ['rev-parse', 'HEAD']).trim()}${git(CHECKOUT, ['status', '--porcelain', '--', 'scripts']).trim() ? ' with uncommitted edits' : ''}`;
  out.write(`#2813 AC2 by hand\nbranch: PR #2802 head ${HEAD}, origin/main ${BASE}\nscripts/: this checkout's (${CHECKOUT} at ${scripts})\nrun: DEEP_PROOF_ISSUES=${ISSUES} node scripts/proof.mjs before trace (in ${repo})\nstarted: ${new Date().toISOString()} on ${process.platform}-${process.arch}\n\n`);
  child = spawn(process.execPath, ['scripts/proof.mjs', 'before', 'trace'], { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; out.write(chunk); });
  child.stderr.on('data', (chunk) => out.write(chunk));
  let capped = false;
  const cap = setTimeout(() => { capped = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, PROOF_CAP_MS);
  const [status, signal] = await new Promise((done) => child.on('close', (...ended) => done(ended)));
  clearTimeout(cap);
  out.write(`\nended: ${new Date().toISOString()}, exit ${status}${signal ? ` (${signal})` : ''}\n`);
  await new Promise((done) => out.end(done));

  const where = `(the whole run: ${log})`;
  assert.ok(!capped, `the proof ran past ${PROOF_CAP_MS / 3_600_000} hours and was stopped ${where}`);
  const lines = stdout.split('\n');
  assert.ok(lines.some((line) => line.startsWith('proof: wall time')), `proof.mjs did not finish its run ${where}`);
  const lane = lines.filter((line) => /^(?:PASS|FAIL|BLOCKED|INCONCLUSIVE) (?:before|trace): /.test(line));
  const ours = lane.filter((line) => line.includes(`${FOLDER}/`));
  t.diagnostic(`#1831's lines:\n${ours.join('\n') || '(none)'}`);
  const stopped = lane.filter((line) => line.includes(STOPPED));
  const capReached = BUILDING.filter((file) => stopped.some((line) => line.includes(file)));
  t.diagnostic(capReached.length ? `stopped at their own cap: ${capReached.join(', ')}` : `no #1831 file reached the 20-minute cap in this run, so it can't tell the fix from the base's single run ${where}`);

  for (const file of FAST) assert.deepEqual(stopped.filter((line) => line.includes(file)), [], `${file} builds nothing, yet reads ${STOPPED} ${where}`);
  const verdict = new RegExp(`^(?:PASS|FAIL) before: ${SPINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} › .*${AC2_1831.replace('.', '\\.')}`);
  assert.ok(lines.some((line) => verdict.test(line)), `${SPINE}'s tagged test ${AC2_1831} gets no PASS or FAIL of its own in the before lane; its lines:\n${lane.filter((line) => line.includes(SPINE)).join('\n') || '(none)'}\n${where}`);
});
