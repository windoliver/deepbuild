import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ISSUES = fileURLToPath(new URL('./issues/', import.meta.url));
const HEAD = '3d2115ea6936d36617ac9bbd4a2ef933dbc172ed';
const BASE = 'd4cef00fbd02632188a161c94c19a9660a3ee6ba';
const STOPPED = 'the run was stopped after 20 minutes';
const FOLDER = 'tests/acceptance/1831';
const SPINE = `${FOLDER}/spine.test.mjs`;
const FAST = [SPINE, `${FOLDER}/harness.test.mjs`];
const BUILDING = [`${FOLDER}/canvas.test.mjs`, `${FOLDER}/deep-show.test.mjs`];
const PROOF_CAP_MS = 5 * 3_600_000;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function criteria(issue) {
  const body = readFileSync(join(ISSUES, `${issue}.md`), 'utf8');
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text]) => ({ text: text.trim(), id: `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}` }));
}
const spineCriterion = () => {
  const found = criteria(1831).filter(({ text }) => text.includes('node scripts/spine.mjs list'));
  assert.equal(found.length, 1, `issues/1831.md holds one criterion on \`node scripts/spine.mjs list\`: ${JSON.stringify(found)}`);
  return found[0].id;
};

function git(cwd, args, options = {}) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'advice.detachedHead=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.status !== 0) throw Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.error?.message}`);
  return result.stdout;
}
const has = (cwd, sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd }).status === 0;

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

function layScripts(repo) {
  rmSync(join(repo, 'scripts'), { recursive: true, force: true });
  const paths = git(CHECKOUT, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'scripts']).split('\0').filter(Boolean);
  for (const path of new Set(paths)) {
    const from = join(CHECKOUT, path), to = join(repo, path);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (!stat || stat.isDirectory()) continue;
    mkdirSync(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
}

test(`#2813.60c058b2 on #1831's branch (PR #2802), \`node scripts/proof.mjs before trace\` reports none of #1831's fast node files as ${STOPPED}, and spine.test.mjs gets a verdict of its own`, { timeout: PROOF_CAP_MS + 30 * 60_000 }, async (t) => {
  const spineTag = spineCriterion();
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2813-ac2-')));
  const log = `${directory}.log`;
  let child = null;
  t.after(() => {
    if (child && child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(directory, { recursive: true, force: true });
    console.log(`#2813 AC2: the run's output is kept in ${log}`);
  });
  console.log(`#2813 AC2: the run's output goes to ${log}`);

  const repo = branchRepository(directory);
  layScripts(repo);
  assert.ok(existsSync(join(CHECKOUT, 'node_modules/typescript')), 'run npm ci in this checkout first: proof.mjs imports typescript');
  symlinkSync(join(CHECKOUT, 'node_modules'), join(directory, 'node_modules'));

  const env = { ...process.env, DEEP_PROOF_ISSUES: ISSUES };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PERF_LOCK', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS']) delete env[name];

  const out = createWriteStream(log);
  const scripts = `${git(CHECKOUT, ['rev-parse', 'HEAD']).trim()}${git(CHECKOUT, ['status', '--porcelain', '--', 'scripts']).trim() ? ' with uncommitted edits' : ''}`;
  out.write(`#2813 AC2 by hand\nbranch: PR #2802 head ${HEAD}, origin/main ${BASE}\nscripts/: this checkout's (${CHECKOUT} at ${scripts})\nrun: DEEP_PROOF_ISSUES=${ISSUES} node scripts/proof.mjs before trace (in ${repo})\nstarted: ${new Date().toISOString()} on ${process.platform}-${process.arch}\n\n`);
  child = spawn(process.execPath, ['scripts/proof.mjs', 'before', 'trace'], { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; out.write(chunk); });
  child.stderr.on('data', (chunk) => out.write(chunk));
  let capped = false;
  const cap = setTimeout(() => { capped = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, PROOF_CAP_MS); // deadline: bounds the proof run, which ends on its own long before
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
  const verdict = new RegExp(`^(?:PASS|FAIL) before: ${escape(SPINE)} › .*${escape(spineTag)}`);
  assert.ok(lines.some((line) => verdict.test(line)), `${SPINE}'s tagged test ${spineTag} gets no PASS or FAIL of its own in the before lane; its lines:\n${lane.filter((line) => line.includes(SPINE)).join('\n') || '(none)'}\n${where}`);
});
