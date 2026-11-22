// Helpers for #3019's acceptance tests: a sandboxed HOME (so bays are <HOME>/deepbuild-bays/<k>/, the build cache is
// <HOME>/deepbuild-bays/cache/ and the throttle table is <HOME>/.deepbuild/throttle/, never the real ones), "the
// machine's repository" as a fixture git repository with worktrees whose change has one twin, a workspace build that
// logs every run of itself outside the bays, and readers for the proof's lines. Nothing here imports the code under
// test: the proof is reached only by running `node scripts/proof.mjs before` (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const TIMEOUT = { timeout: 1_800_000 };

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', '-c', 'merge.ff=false'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The planted issue the fixture's change names. Its tags are built here from its criteria's text, as
// scripts/proof-change.mjs builds a criterion's ID, so no file of this suite carries a tag of it.
export const ISSUE = 9301;
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const VALUE = 'The built value is two';
const LABEL = 'The built label is w';
export const C1 = criterionId(ISSUE, VALUE);
export const C2 = criterionId(ISSUE, LABEL);
export const TWIN = 'wrong-label';

/** The cache's folder under a sandbox HOME (README: The surface). */
export const cacheOf = (box) => join(box.home, 'deepbuild-bays', 'cache');

// The fixture's one workspace package's build: it hashes every file of src/ (the marker), writes dist/index.mjs (the
// source of src/value.mjs and the marker) and dist/blob.bin ($FIXTURE_BLOB_BYTES bytes, default 1024, of the marker
// repeated), and appends one JSON line per run of itself to $FIXTURE_BUILD_LOG, outside every bay and cache.
const BUILD = `import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
const hash = createHash('sha256');
for (const name of readdirSync('src').sort()) hash.update(name + '\\0').update(readFileSync('src/' + name)).update('\\0');
const marker = hash.digest('hex');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.mjs', readFileSync('src/value.mjs', 'utf8') + "export const marker = '" + marker + "';\\n");
writeFileSync('dist/blob.bin', Buffer.alloc(Number(process.env.FIXTURE_BLOB_BYTES || 1024), marker));
if (process.env.FIXTURE_BUILD_LOG) appendFileSync(process.env.FIXTURE_BUILD_LOG, JSON.stringify({ marker, cwd: realpathSync('.'), pid: process.pid, at: Date.now() }) + '\\n');
`;

/** What the build writes for a src/ folder given as name to text: its marker, dist/index.mjs and dist/blob.bin. */
export function built(src, blobBytes = 1024) {
  const hash = createHash('sha256');
  for (const name of Object.keys(src).sort()) hash.update(`${name}\0`).update(src[name]).update('\0');
  const marker = hash.digest('hex');
  return { marker, index: Buffer.from(`${src['value.mjs']}export const marker = '${marker}';\n`), blob: Buffer.alloc(blobBytes, marker) };
}

/** packages/w/src/ at a commit, as name to text. */
export function srcAt(cwd, rev) {
  const found = {};
  for (const name of git(cwd, 'ls-tree', '--name-only', `${rev}:packages/w/src`).split('\n').filter(Boolean)) found[name] = git(cwd, 'show', `${rev}:packages/w/src/${name}`);
  return found;
}

export const pkg = (version) => `{\n  "name": "cache-fixture",\n  "version": "${version}",\n  "private": true,\n  "workspaces": [\n    "packages/*"\n  ]\n}\n`;
export const lock = (version) => `{\n  "name": "cache-fixture",\n  "version": "${version}",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "cache-fixture",\n      "version": "${version}",\n      "workspaces": [\n        "packages/*"\n      ]\n    },\n    "node_modules/w": {\n      "resolved": "packages/w",\n      "link": true\n    },\n    "packages/w": {\n      "version": "0.0.0"\n    }\n  }\n}\n`;

const BASE_VALUE = "export const value = 1;\nexport const label = 'w';\n";
const CHANGE_VALUE = "export const value = 2;\nexport const label = 'w';\n";
const TWIN_VALUE = "export const value = 2;\nexport const label = 'x';\n";

// The merge base: an npm workspace (its lock links the one package, so npm ci needs no network) whose package's build
// is the one above, and src/note.txt, which main edits when it moves.
const BASE = {
  '.gitignore': 'node_modules\ndist\n.claude\n*.log\n',
  'package.json': pkg('0.0.0'),
  'package-lock.json': lock('0.0.0'),
  'packages/w/package.json': '{\n  "name": "w",\n  "version": "0.0.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "build": "node build.mjs"\n  }\n}\n',
  'packages/w/build.mjs': BUILD,
  'packages/w/src/value.mjs': BASE_VALUE,
  'packages/w/src/note.txt': 'main at its first commit\n',
};

// The change's tagged tests: both read the built package. C1 fails on the merge base (value 1) at its assertion; C2
// passes there (label w), so the before lane runs its twin, whose label is x, and it fails there at its assertion.
const TAGGED = `import assert from 'node:assert/strict';
import test from 'node:test';

const built = () => import(new URL('../../../packages/w/dist/index.mjs', import.meta.url));

test('${C1} the built value is two', async () => {
  const { value } = await built();
  assert.equal(value, 2);
});

test('${C2} the built label is w', async () => {
  const { label } = await built();
  assert.equal(label, 'w');
});
`;

/** A sandbox removed after the test, with its own HOME; every proof it started is stopped, by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3019-')));
  const home = join(dir, 'home');
  for (const folder of [home, join(dir, 'builds'), join(dir, 'issues')]) mkdirSync(folder);
  writeFileSync(join(dir, 'issues', `${ISSUE}.md`), `Planted for the #3019 acceptance tests.\n\n### Acceptance criteria\n- [ ] ${VALUE}\n- [ ] ${LABEL}\n\n### Proof\nNone.\n`);
  const env = {
    ...process.env,
    HOME: home,
    PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
    // The fixture's one package is a folder of its own, so npm needs no network; offline makes sure.
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    DEEP_PROOF_ISSUES: join(dir, 'issues'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'DEEP_PERF_LOCK', 'CARGO_TARGET_DIR', 'NODE_TEST_CONTEXT', 'CARGO_BUILD_TARGET_DIR', 'DEEP_BIN_DIR', 'DEEP_APPROVERS', '__STRYKER_ACTIVE_MUTANT__', 'DEEP_BUILD_CACHE_BYTES', 'FIXTURE_BLOB_BYTES', 'FIXTURE_BUILD_LOG']) delete env[name];
  for (const name of Object.keys(env)) if (/^npm_(?!config_offline$|config_update_notifier$)/i.test(name)) delete env[name];
  const box = { dir, home, env, children: [], runs: 0 };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

export const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
};

/**
 * The machine's repository (README: The fixture): <HOME>/deepbuild, holding this checkout's scripts/ and the merge base
 * above, with origin at this project's URL and origin/main pinned at the base by update-ref (never fetched), and a
 * worktree <HOME>/deepbuild/.claude/worktrees/w whose change is one commit naming the planted issue.
 */
export function machineRepo(box) {
  const main = join(box.home, 'deepbuild');
  mkdirSync(main);
  cpSync(join(CHECKOUT, 'scripts'), join(main, 'scripts'), { recursive: true });
  write(main, BASE);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The scripts' own packages (proof-change.mjs imports typescript), where node finds them from a worktree.
  symlinkSync(join(CHECKOUT, 'node_modules'), join(main, 'node_modules'));
  const fixture = { main, worktrees: {} };
  fixture.worktree = worktree(fixture, 'w');
  return fixture;
}

/**
 * A worktree of the machine's repository at origin/main, <main>/.claude/worktrees/<name>, whose change is one commit
 * naming the planted issue: src/value.mjs's value is 2, the tagged tests, and the twin of C2 (src/value.mjs with label
 * x) named in tests/acceptance/<issue>/twins.json; `extra` adds files to the commit.
 */
export function worktree(fixture, name, extra = {}) {
  const path = join(fixture.main, '.claude', 'worktrees', name);
  git(fixture.main, 'worktree', 'add', '-q', '-b', `work-${name}`, path, 'origin/main');
  const dir = `tests/acceptance/${ISSUE}`;
  write(path, {
    'packages/w/src/value.mjs': CHANGE_VALUE,
    [`${dir}/a.test.mjs`]: TAGGED,
    [`${dir}/twins.json`]: `${JSON.stringify({ [C2]: [TWIN] }, null, 2)}\n`,
    [`${dir}/twins/${TWIN}/packages/w/src/value.mjs`]: TWIN_VALUE,
    ...extra,
  });
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', `The change\n\nPart of #${ISSUE}`);
  fixture.worktrees[name] = path;
  return path;
}

/** Commits `files` on main, moves origin/main there (as a fetch would) and merges it into the worktree's branch. */
export function mainMoves(fixture, files, message) {
  write(fixture.main, files);
  git(fixture.main, 'add', '-A');
  git(fixture.main, 'commit', '-q', '-m', message);
  git(fixture.main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(fixture.worktree, 'merge', '-q', '--no-edit', '-m', `Merge main: ${message}`, 'origin/main');
}

/** The worktree's merge base with origin/main, and its git tree hash. */
export function mergeBase(cwd) {
  const commit = git(cwd, 'merge-base', 'HEAD', 'origin/main').trim();
  return { commit, tree: git(cwd, 'rev-parse', `${commit}^{tree}`).trim() };
}

/** What each of the worktree's three builds writes: the merge base's, the change's and its twin's. */
export function builds(cwd, blobBytes) {
  const change = srcAt(cwd, 'HEAD');
  return {
    base: built(srcAt(cwd, mergeBase(cwd).commit), blobBytes),
    change: built(change, blobBytes),
    twin: built({ ...change, 'value.mjs': git(cwd, 'show', `HEAD:tests/acceptance/${ISSUE}/twins/${TWIN}/packages/w/src/value.mjs`) }, blobBytes),
  };
}

/**
 * Another node than the one running the tests, for a run on another toolchain: a different version installed beside
 * this one (nvm's versions/node/<v>/bin/node), of the same major first. Null when the machine has none.
 */
export function otherNode() {
  const versions = dirname(dirname(dirname(process.execPath)));
  if (basename(versions) !== 'node') return null;
  const major = (version) => Number(version.replace(/^v/, '').split('.')[0]);
  const found = readdirSync(versions).filter((version) => /^v\d+\.\d+\.\d+$/.test(version) && version !== process.version && major(version) >= 22 && existsSync(join(versions, version, 'bin', 'node')))
    .sort((a, b) => (major(b) === major(process.version)) - (major(a) === major(process.version)) || major(b) - major(a));
  return found.length ? join(versions, found[0], 'bin', 'node') : null;
}

/**
 * Runs `node scripts/proof.mjs before` in `cwd` (the fixture's worktree by default), its own process group, with the
 * build logging to builds/<run>.jsonl. `env` adds to the sandbox's environment; `node` runs the proof with another
 * node, put first on PATH too. Returns its status, output, the builds that ran, its verdict lines and BUILD lines.
 */
export async function proof(box, fixture, { cwd = fixture.worktree, env = {}, node = process.execPath, ms = 900_000 } = {}) {
  const run = `run-${++box.runs}`;
  const log = join(box.dir, 'builds', `${run}.jsonl`);
  const started = Date.now();
  const childEnv = { ...box.env, ...env, FIXTURE_BUILD_LOG: log, PATH: [dirname(node), box.env.PATH].join(delimiter) };
  const child = spawn(node, [join(cwd, 'scripts/proof.mjs'), 'before'], { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timer;
  const ended = await Promise.race([
    new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal }))),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]);
  clearTimeout(timer);
  if (!ended) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    assert.fail(`the proof did not end within ${ms / 1000} s\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const built = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { run, ...ended, stdout, stderr, wall: (Date.now() - started) / 1000, built, verdicts: verdicts(stdout), lines: buildLines(stdout) };
}

/** The before lane's verdict lines: `<STATE> before: …`, and its plain `before: …` notes, in order. */
export const verdicts = (stdout) => String(stdout).split('\n').filter((line) => /^(?:(?:PASS|FAIL|BLOCKED|INCONCLUSIVE) )?before: /.test(line));

/** The BUILD lines (README: The surface): `BUILD <one-line JSON object>`. */
export function buildLines(stdout) {
  const found = [];
  for (const line of String(stdout).split('\n')) {
    const match = line.match(/^BUILD (\{.*\})\s*$/);
    if (!match) continue;
    let fields;
    try { fields = JSON.parse(match[1]); } catch { continue; }
    found.push({ line, ...fields });
  }
  return found;
}

/** How many times a run built the tree whose build is `expected`, by its marker in the build log. */
export const timesBuilt = (result, expected) => result.built.filter(({ marker }) => marker === expected.marker).length;

/** A run with DEEP_BUILD_CACHE_BYTES=0 is one with no cache: it reused nothing and built the merge-base tree itself. */
export function assertNoCache(result, base) {
  const reused = result.lines.filter((line) => line.reused === true);
  assert.deepEqual(reused.map(({ line }) => line), [], `the run with DEEP_BUILD_CACHE_BYTES=0 reused a cached build, so it is no run without the cache\n${show(result)}`);
  assert.equal(timesBuilt(result, base), 1, `the run with DEEP_BUILD_CACHE_BYTES=0 built the merge-base tree ${timesBuilt(result, base)} times, not once\n${show(result)}`);
}

/** The verdicts a run must print for the fixture's change when every build is right, as it does with no cache. */
export function rightVerdicts() {
  const key = (tag, name) => `tests/acceptance/${ISSUE}/a.test.mjs › ${tag} ${name}`;
  return [`PASS before: ${key(C1, 'the built value is two')}: failed on the merge base at its assertion`, `PASS before: ${key(C2, 'the built label is w')}: failed on ${TWIN} at its assertion`];
}

/** Every regular file under `folder`, not following links, each inode once: path, size and inode. */
export function filesUnder(folder) {
  const found = [], inodes = new Set();
  const visit = (path) => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else if (stat.isFile() && !inodes.has(stat.ino)) {
      inodes.add(stat.ino);
      found.push({ path, size: stat.size });
    }
  };
  visit(folder);
  return found;
}

/** The cache's disk use: the bytes of its regular files, each inode once. */
export const diskUse = (box) => filesUnder(cacheOf(box)).reduce((sum, { size }) => sum + size, 0);

/** The cache's files whose bytes are `bytes`. */
export const holding = (box, bytes) => filesUnder(cacheOf(box)).filter(({ path, size }) => size === bytes.length && readFileSync(path).equals(bytes)).map(({ path }) => path);

export const show = (result) => [
  `${result.run}: exit ${result.status}${result.signal ? ` (${result.signal})` : ''}, ${result.wall} s`,
  `builds: ${result.built.map(({ marker, cwd }) => `${marker.slice(0, 12)} in ${cwd}`).join('; ') || 'none'}`,
  `stdout:\n${result.stdout.slice(-8000)}`,
  `stderr:\n${result.stderr.slice(-3000)}`,
].join('\n');
