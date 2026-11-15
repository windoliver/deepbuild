// Helpers for #2574's acceptance tests: a sandboxed HOME (so the shards and the throttle's table are never the real
// ~/deepbuild-shards/ and ~/.deepbuild/throttle/), fixture repositories, holders of the machine's test slots, the
// throttle log, and the scratch tree affected.mjs runs in. Nothing here imports the code under test: claimShards and
// select are called in a child process, and affected.mjs is run, so a missing export reads as an assertion failure
// (README: The surface). Written here, never imported from another suite.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const MAC = process.platform === 'darwin';
// docs/parallel-proof.md, section 6, and the issue: 2 test slots on the Mac, 4 on the Spark.
export const TEST_SLOTS = MAC ? 2 : 4;
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_SHARDS', 'DEEP_TEST_GRANT_WAIT', 'DEEP_TEST_SHARD_FLOOR', 'DEEP_BIN_DIR'];

// `node note.mjs <name> [args]` appends one start line; `node note.mjs <name> hold <ms>` holds, then notes its end.
const NOTE = `import { appendFileSync } from 'node:fs';
const [name, ...args] = process.argv.slice(2);
const note = (event) => appendFileSync(process.env.T2574_EVENTS, JSON.stringify({ name, args, event, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');
note('start');
if (args[0] === 'hold') {
  await new Promise((done) => setTimeout(done, Number(args[1])));
  note('end');
}
`;

/** A sandbox removed after the test, with its own HOME and events file; every process it started is stopped. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2574-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  mkdirSync(join(dir, 'tmp'));
  writeFileSync(join(dir, 'note.mjs'), NOTE);
  // TMPDIR too, so what a run leaves in the temporary folder, as affected.mjs's job logs, goes with the sandbox.
  const env = { ...process.env, HOME: home, TMPDIR: join(dir, 'tmp'), XDG_CACHE_HOME: join(home, '.cache'), T2574_EVENTS: join(dir, 'events.jsonl'), T2574_NODE: process.execPath, T2574_NOTE: join(dir, 'note.mjs'), DEEP_TEST_SHARD_FLOOR: '0' };
  for (const name of ENV_OUT.filter((name) => name !== 'DEEP_TEST_SHARD_FLOOR')) delete env[name];
  const box = { dir, home, env, note: join(dir, 'note.mjs'), children: [] };
  t.after(() => {
    // Only the processes this test started, by their own process group's PID.
    for (const child of box.children) if (child.pid && child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status and output. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  child.out = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { child.out.stdout += chunk; });
  child.stderr.on('data', (chunk) => { child.out.stderr += chunk; });
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, ...child.out })));
  return child;
}

/** The child's result, or null when it hasn't ended within `ms`. */
export async function within(child, ms) {
  let timer;
  try {
    return await Promise.race([child.done, new Promise((resolve) => { timer = setTimeout(resolve, ms, null); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}

export function events(box) {
  const file = box.env.T2574_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
/** What a run started: every noted event that is no holder's and no call of the throttle shim's. */
export const jobs = (box) => events(box).filter((e) => !e.name.startsWith('holder') && e.name !== 'throttle');
/** The calls of the tree's scripts/throttle.mjs, in order, as the shim noted their arguments (before any rewrite). */
export const throttleCalls = (box) => events(box).filter((e) => e.name === 'throttle');

/** Another session's grant: `throttle.mjs test --wait 1 -- node note.mjs holder-<n> hold <ms>`, a live process. */
export const hold = (box, n, ms = 120_000) => Object.assign(launch(box, [process.execPath, THROTTLE, 'test', '--wait', '1', '--', process.execPath, box.note, `holder-${n}`, 'hold', String(ms)]), { holder: true });

/** Every test slot of the machine held by a live process of its own; resolves once each holder runs. */
export async function holdEverySlot(box) {
  const holders = Array.from({ length: TEST_SLOTS }, (_, n) => hold(box, n));
  const running = () => events(box).filter((e) => e.name.startsWith('holder') && e.event === 'start').length === TEST_SLOTS;
  assert.ok(await until(running, 60_000), `the ${TEST_SLOTS} holders did not all get a test slot\n${dump(box)}`);
  return holders;
}

/** The throttle log: the JSON lines of ~/.deepbuild/throttle/log in the sandbox's HOME. */
export function logLines(box) {
  const file = join(box.home, '.deepbuild', 'throttle', 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((text) => {
    try { return { ...JSON.parse(text), text }; } catch { return { text }; }
  });
}

const redact = (box, text) => text.replaceAll(box.dir, '<tmp>').replaceAll(CHECKOUT, '<checkout>');
export const dump = (box, ...runs) => redact(box, [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `throttle log:\n${logLines(box).map(({ text }) => text).join('\n')}`,
  ...runs.filter(Boolean).map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`),
].join('\n'));

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}
export const gitIn = (cwd, env = process.env) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe', encoding: 'utf8' });

/** A fresh git repository at box.dir/<name> holding `files`, all committed but those `.gitignore` leaves out. */
export function repository(box, name, files) {
  const root = join(box.dir, name);
  mkdirSync(root);
  write(root, files);
  const git = gitIn(root, box.env);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return root;
}

/** Every file under `dir`, as paths from it, sorted; none when it doesn't exist. */
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1)).sort();
}

/** Runs module code in a child with the sandbox's environment; its last stdout line is the JSON it reports. */
function child(box, code, args) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, '--', ...args], { cwd: box.dir, env: box.env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120_000 });
  let value = null;
  try { value = JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch {}
  return { value, text: redact(box, `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`) };
}

/**
 * `claimShards(root, want, say)` of this checkout's scripts/shards.mjs, called in a child whose HOME is the sandbox's
 * and whose DEEP_TEST_SHARD_FLOOR is 0: the folders of the shards it returned, each released again, and what `say` got.
 */
export function claim(box, root, want) {
  const code = `const [url, root, want] = process.argv.slice(1);
    const { claimShards } = await import(url);
    const lines = [];
    const shards = await claimShards(root, Number(want), (line) => lines.push(String(line)));
    const dirs = shards.map((shard) => shard.dir);
    for (const shard of shards) shard.release();
    console.log('\\n' + JSON.stringify({ dirs, lines }));`;
  const { value, text } = child(box, code, [pathToFileURL(join(CHECKOUT, 'scripts/shards.mjs')).href, root, String(want)]);
  assert.ok(value && Array.isArray(value.dirs) && Array.isArray(value.lines), `claimShards(root, ${want}, say) of scripts/shards.mjs did not return\n${text}`);
  return { ...value, text: redact(box, `say got:\n${value.lines.join('\n')}\nreturned: ${JSON.stringify(value.dirs)}`) };
}

/** `select(cwd, changed, { files, workspace })` of this checkout's scripts/affected.mjs, called in a child. */
export function select(box, cwd, changed, { files, workspace }) {
  const code = `const [url, cwd, changed, files, workspace] = process.argv.slice(1);
    const { select } = await import(url);
    console.log('\\n' + JSON.stringify(select(cwd, JSON.parse(changed), { files: JSON.parse(files), workspace: JSON.parse(workspace) })));`;
  const { value, text } = child(box, code, [pathToFileURL(join(CHECKOUT, 'scripts/affected.mjs')).href, cwd, JSON.stringify(changed), JSON.stringify(files), JSON.stringify(workspace)]);
  assert.ok(value && Array.isArray(value.tests) && Array.isArray(value.wide), `select(cwd, changed, { files, workspace }) of scripts/affected.mjs did not return its tests and wide lists\n${text}`);
  return value;
}

/** A probe test file for node --test: one test that notes its start (with its DEEP_THROTTLE) and, 300 ms on, its end. */
export const probe = (name) => `import { appendFileSync } from 'node:fs';
import test from 'node:test';
const note = (event) => appendFileSync(process.env.T2574_EVENTS, JSON.stringify({ name: ${JSON.stringify(name)}, event, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid, cwd: process.cwd() }) + '\\n');
test(${JSON.stringify(`the ${name} probe runs`)}, async () => {
  note('start');
  await new Promise((done) => setTimeout(done, 300));
  note('end');
});
`;

/** lanes.mjs's lists and the scripts its lint lane runs, read by a child process. */
function lanesLists(root) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    const { alone, exclusive, timed, slow, byHand, ownLane } = lanes;
    console.log(JSON.stringify({ lint, alone, exclusive, timed, slow, byHand, ownLane }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}
const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * Paths for the probes, by what lanes.mjs's lists make of them: `plain`, which no list names; `alone`, two files in
 * two of the alone list's folders that no other list names, so each is an alone group of its own; and `timed`, a
 * .test.mjs file the timed list names and neither the by-hand list nor a lane of its own takes.
 */
export function probePaths() {
  const { alone, exclusive, timed, slow, byHand, ownLane } = lanesLists(CHECKOUT);
  const others = [...exclusive, ...timed, ...slow, ...byHand, ...ownLane];
  const groups = alone.filter((entry) => /^tests\/acceptance\/[^/]+\/$/.test(entry)).map((entry) => `${entry}probe-2574.test.mjs`).filter((file) => !covers(others, file)).slice(0, 2);
  assert.equal(groups.length, 2, 'lanes.mjs\'s alone list holds no two folders free of its other lists, so no alone probes can be placed');
  const timedFile = timed.find((entry) => entry.endsWith('.test.mjs') && !/\.live\.test\./.test(entry) && !covers([...byHand, ...ownLane], entry));
  assert.ok(timedFile, 'lanes.mjs\'s timed list names no .test.mjs file, so no timed probe can be placed');
  return { plain: 'tests/fixture-2574/plain.test.mjs', alone: groups, timed: timedFile };
}

// What the fixture changes besides its probes: a package's source, so the run builds the packages first, and a crate's
// Rust, so it runs cargo test, cargo fmt and clippy for it.
export const PACKAGE_SOURCE = 'packages/a/src/index.ts';
export const CRATE_SOURCE = 'crates/fx2574/src/lib.rs';

/**
 * The tree's scripts/throttle.mjs with `shimThrottle` (as #1115's helpers do it): the real one, moved to
 * throttle-real.mjs, behind a wrapper that notes each call's arguments and, for class test, runs it with `--wait 0.02`
 * (1.2 s) in place of the wait it was asked, writing the real throttle's "came within 0.02 min" back as the wait asked.
 * It stands for a throttle whose clock runs fast: a run whose grant isn't taken through `scripts/throttle.mjs test
 * --wait` waits the full wait instead. Its module exports stay the real one's, so importers see no change.
 */
const THROTTLE_SHIM = `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export * from './throttle-real.mjs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  appendFileSync(process.env.T2574_EVENTS, JSON.stringify({ name: 'throttle', args: [...args], event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');
  const at = args.indexOf('--wait'), split = args.indexOf('--');
  const asked = args[0] === 'test' && at >= 0 && (split < 0 || at < split) ? args[at + 1] : null;
  if (asked !== null) args[at + 1] = '0.02';
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./throttle-real.mjs', import.meta.url)), ...args], { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
  const back = (text) => (asked === null ? text : text.replaceAll('came within 0.02 min', 'came within ' + asked + ' min'));
  process.stdout.write(back(result.stdout ?? ''));
  process.stderr.write(back(result.stderr ?? ''));
  process.exit(result.status ?? 1);
}
`;

/**
 * The tree affected.mjs runs in (README: The affected.mjs tree): a copy of this checkout's scripts/, the lint lane's
 * own scripts replaced by stubs that note their start and pass, an empty known-failures baseline, a node_modules of
 * its own holding only a link to this checkout's typescript, and `files`, committed in a fresh git repository at
 * box.dir/tree. On PATH: npm and cargo stubs that note their start and pass (cargo metadata reports one crate,
 * fx2574, a library), and a deep stub whose `lease --` runs its command. With `shimThrottle`, scripts/throttle.mjs is
 * THROTTLE_SHIM.
 */
export function affectedTree(box, files, { shimThrottle = false } = {}) {
  const tree = join(box.dir, 'tree');
  mkdirSync(tree);
  cpSync(join(CHECKOUT, 'scripts'), join(tree, 'scripts'), { recursive: true });
  if (shimThrottle) {
    renameSync(join(tree, 'scripts/throttle.mjs'), join(tree, 'scripts/throttle-real.mjs'));
    writeFileSync(join(tree, 'scripts/throttle.mjs'), THROTTLE_SHIM);
  }
  for (const script of lanesLists(tree).lint) writeFileSync(join(tree, script), `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.T2574_EVENTS, JSON.stringify({ name: 'lint', args: process.argv.slice(1), event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');\n`);
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  mkdirSync(join(tree, 'node_modules'));
  symlinkSync(dirname(createRequire(join(CHECKOUT, 'scripts/affected.mjs')).resolve('typescript/package.json')), join(tree, 'node_modules/typescript'));
  write(tree, {
    '.gitignore': 'node_modules/\ndist/\ntarget/\n',
    [PACKAGE_SOURCE]: 'export const a = 1;\n',
    'packages/a/package.json': `${JSON.stringify({ name: '@deepbuild/a', version: '0.0.0' })}\n`,
    [CRATE_SOURCE]: 'pub fn one() -> u32 { 1 }\n',
    'crates/fx2574/Cargo.toml': '[package]\nname = "fx2574"\nversion = "0.0.0"\n',
    ...files,
  });
  const git = gitIn(tree, box.env);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  const metadata = join(box.dir, 'metadata.json');
  writeFileSync(metadata, JSON.stringify({ packages: [{ name: 'fx2574', manifest_path: join(tree, 'crates/fx2574/Cargo.toml'), dependencies: [], targets: [{ name: 'fx2574', kind: ['lib'], src_path: join(tree, CRATE_SOURCE) }] }], workspace_members: [], version: 1 }));
  const stubs = {
    npm: '#!/bin/sh\nexec "$T2574_NODE" "$T2574_NOTE" npm "$@"\n',
    cargo: `#!/bin/sh\nif [ "$1" = metadata ]; then cat '${metadata}'; exit 0; fi\nexec "$T2574_NODE" "$T2574_NOTE" cargo "$@"\n`,
    deep: '#!/bin/sh\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; exec "$@"; fi\necho "deep stub: $*" >&2\nexit 2\n',
  };
  for (const [name, text] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  return { tree, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** Starts `node scripts/affected.mjs ...args` in the tree. */
export const affected = (box, { tree, env }, args, more = {}) => launch(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd: tree, env: { ...env, ...more } });

/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';

/**
 * A run's one grant, by the throttle log of a HOME only that run and `others` holders used: the single `granted` event
 * outside the timed class, which is a top-level test grant, with no build grant and no timeout beside it, each
 * `passed` event passing through on it, and its `released` event. Fails at its assertion, naming what the log shows.
 */
export function oneGrant(box, all, { others = 0 } = {}) {
  const log = logLines(box);
  const holderPids = new Set(box.children.filter((child) => child.holder).map((child) => child.pid));
  const granted = log.filter((line) => line.event === 'granted' && line.class !== 'timed' && !holderPids.has(line.pid));
  const show = (lines) => lines.map((line) => `${line.grant ?? ''} ${line.class} (${line.event})`).join(', ') || 'none';
  const builds = log.filter((line) => line.class === 'build' && ['granted', 'timeout'].includes(line.event));
  assert.equal(builds.length, 0, `the run made ${builds.length} build ${builds.length === 1 ? 'request' : 'requests'} of the throttle's table: ${show(builds)}\n${all}`);
  assert.equal(granted.length, 1, `the throttle log shows ${granted.length} grants for the run's untimed jobs, not one top-level test grant: ${show(granted)}\n${all}`);
  const [grant] = granted;
  assert.deepEqual({ class: grant.class, grant: grant.grant }, { class: 'test', grant: 'top-level' }, `the run's one grant is not a top-level test grant\n${all}`);
  const timeouts = log.filter((line) => line.event === 'timeout');
  assert.equal(timeouts.length, 0, `a request of the run timed out: ${show(timeouts)}\n${all}`);
  const passed = log.filter((line) => line.event === 'passed');
  assert.ok(passed.length >= 1, `the throttle log shows no passed event: no job of the run passed through on its grant\n${all}`);
  const token = `test:${grant.id}`;
  const astray = passed.filter((line) => line.through !== token);
  assert.equal(astray.length, 0, `${astray.length} passed events passed through on something other than the run's grant ${token}\n${all}`);
  const released = log.find((line) => line.event === 'released' && line.id === grant.id);
  assert.ok(released, `the throttle log never shows the run's grant released\n${all}`);
  assert.equal(others, log.filter((line) => line.event === 'granted' && holderPids.has(line.pid)).length, `the holders' grants are not the ${others} the test made\n${all}`);
  return { grant, token, grantedAt: Date.parse(grant.at), releasedAt: Date.parse(released.at), passed };
}
