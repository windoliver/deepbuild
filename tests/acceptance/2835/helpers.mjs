// #2835: a disposable fixture repository holding this checkout's unmodified scripts/, a two-crate Cargo workspace
// (bins deep-hook and deep-show), a hub stand-in at packages/cli/dist/main.js that looks for both only under its own
// checkout's target/{release,debug}/, as the hub does, a TypeScript file the change adds lines to under
// packages/*/src, and tagged inner tests. The real mutation lane (`node scripts/proof.mjs mutation`) runs on it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The fixture issue holds #2835's own criteria, so the inner tests' tags are the criteria's IDs.
const CRITERIA = [
  "In the mutation lane, a passing tagged test that starts its checkout's hub through `packages/cli/dist/main.js hub run` and needs `deep-hook` and `deep-show` under its checkout's `target/` gets through StrykerJS's initial run, and the lane reports mutants on the change's added lines instead of BLOCKED for a missing binary",
  "In the mutation lane, the `deep-hook` and `deep-show` under the mutation copy's `target/debug/` are built from the change's own sources, even when an earlier use of the same bay in that proof (a twin's before-lane run that edits the `deep-hook` crate) put its own `deep-hook` there: a tagged test reading the copy's `target/debug/deep-hook` during the mutation lane sees the change's program, not the twin's",
  "In the mutation lane, a tagged test that names neither `packages/hub/` nor `packages/cli/` (nor `@deepbuild/hub`, `@deepbuild/cli`) finds no `deep-hook` or `deep-show` under the mutation copy's `target/debug/` that the lane or an earlier use of its bay put there",
];
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const write = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};
export const dump = (r) => `exit ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? r.error ?? ''}`;
export function run(box, command, args, cwd = box.repo) {
  return spawnSync(command, args, { cwd, env: box.env, encoding: 'utf8', timeout: 560_000, maxBuffer: 2 ** 24 });
}
export function ok(r) { assert.equal(r.status, 0, dump(r)); return r.stdout; }
const git = (box, ...args) => ok(run(box, 'git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]));
export function commit(box, files, message) {
  for (const [path, bytes] of Object.entries(files)) {
    if (bytes === null) rmSync(join(box.repo, path), { force: true });
    else write(box.repo, path, bytes);
  }
  git(box, 'add', '-A');
  git(box, 'commit', '-qm', message);
}

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2835-')));
  const repo = join(dir, 'repo'), home = join(dir, 'home'), temp = join(dir, 'tmp');
  for (const folder of [repo, home, temp]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: join(home, '.cargo'),
    CARGO_NET_OFFLINE: 'true', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    T2835_OBSERVATIONS: join(dir, 'observations.jsonl'), DEEP_PROOF_ISSUES: join(dir, 'issues') };
  for (const key of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'DEEP_THROTTLE',
    'DEEP_THROTTLE_TABLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_VITEST_REPORT',
    'DEEP_HUB_PLANT', 'DEEP_APPROVERS', '__STRYKER_ACTIVE_MUTANT__', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) delete env[key];
  cpSync(join(ROOT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  // The lane finds StrykerJS at <repository>/node_modules/.bin/stryker, and the scripts import typescript: a
  // node_modules folder of the fixture's own whose entries link to this checkout's installed packages (as
  // tests/acceptance/569 lays it), never a link to the folder itself and never a write into this checkout's.
  mkdirSync(join(repo, 'node_modules'));
  for (const entry of readdirSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules', entry), join(repo, 'node_modules', entry));
  write(dir, 'issues/2835.md', `### Acceptance criteria\n${CRITERIA.map((text) => `- [ ] ${text}\n`).join('')}`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, repo, home, env };
}

// Each bin's source is crates/<name>/main.rs, outside crates/*/src/, so the change's edit of it gives the mutation
// lane no Rust line to hand cargo-mutants (not installed here); only the TypeScript lines are mutated.
const crate = (name, word) => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n\n[[bin]]\nname = "${name}"\npath = "main.rs"\n`,
  [`crates/${name}/main.rs`]: `fn main() { println!("${word}"); }\n`,
});

// Starts like the hub: deep-hook and deep-show only from this checkout's target/{release,debug}/, else BLOCKED.
const HUB = `import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
// As the real CLI does, \`lease -- <command>\` runs the command: scripts/lease reaches this CLI for the lane's builds.
if (process.argv[2] === 'lease') { const r = spawnSync(process.argv[4], process.argv.slice(5), { stdio: 'inherit' }); process.exit(r.status ?? 1); }
if (process.argv[2] !== 'hub' || process.argv[3] !== 'run') { console.error('stand-in: only hub run'); process.exit(2); }
const replies = [];
for (const name of ['deep-hook', 'deep-show']) {
  const bin = ['release', 'debug'].map((profile) => join(repo, 'target', profile, name)).find((path) => existsSync(path));
  if (!bin) { console.error('BLOCKED: no ' + name + ' is built under target/'); process.exit(3); }
  const reply = spawnSync(bin, [], { encoding: 'utf8' });
  if (reply.status !== 0) { console.error(name + ' did not run'); process.exit(4); }
  replies.push(reply.stdout.trim());
}
console.log(replies.join(' '));
`;

// The TypeScript the change adds lines to, under packages/*/src, so the mutation lane has lines to mutate.
const SOURCE = 'packages/numbers/src/numbers.ts';
const BASE_SOURCE = 'export const zero = (): number => 0;\n';
const CHANGE_SOURCE = `${BASE_SOURCE}export const next = (n: number): number => n + 1;\n`;

/** The merge base (origin/main): base words, the hub stand-in, no target/. Returns nothing; HEAD is main. */
export function base(box) {
  const files = { '.gitignore': 'node_modules/\ntarget/\n',
    'Cargo.toml': '[workspace]\nmembers = ["crates/deep-hook", "crates/deep-show"]\nresolver = "2"\n',
    ...crate('deep-hook', 'hook-base'), ...crate('deep-show', 'show-base'), 'packages/cli/dist/main.js': HUB,
    'packages/numbers/package.json': '{ "name": "numbers", "version": "0.0.0", "private": true, "type": "module" }\n', [SOURCE]: BASE_SOURCE };
  for (const [path, bytes] of Object.entries(files)) write(box.repo, path, bytes);
  ok(run(box, 'cargo', ['generate-lockfile', '--offline']));
  git(box, 'init', '-q', '--template=', '-b', 'main');
  commit(box, {}, 'base');
  git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

/** The change: `change` words in both crates, lines added to the TypeScript source, and `files` (tests, twins). */
export function change(box, files) {
  commit(box, { ...crate('deep-hook', 'hook-change'), ...crate('deep-show', 'show-change'), [SOURCE]: CHANGE_SOURCE, ...files }, 'fixture change\n\nPart of #2835');
}

/**
 * The real proof on the fixture with `lanes`, and what the inner tests saw. With `bay: false` it runs under a holder
 * of a bay-pair grant, so the proof gets no bay pair and keeps temporary copies (bays.mjs: "an ancestor of this
 * process holds a bay pair"), as a proof under another's pair does.
 */
export function proof(t, box, lanes, { bay = true } = {}) {
  rmSync(box.env.T2835_OBSERVATIONS, { force: true });
  const result = bay ? run(box, process.execPath, ['scripts/proof.mjs', ...lanes])
    : run(box, process.execPath, ['--input-type=module', '-e', HOLDER, ...lanes]);
  t.diagnostic(result.stdout);
  let seen = [];
  try { seen = readFileSync(box.env.T2835_OBSERVATIONS, 'utf8').trim().split('\n').map((line) => JSON.parse(line)); } catch {}
  return { result, seen };
}
const HOLDER = `import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { acquire, release } = await import(pathToFileURL(process.cwd() + '/scripts/throttle.mjs').href);
const grant = acquire('bay-pair', { wait: 5 });
if (!grant) { console.log('holder: no bay-pair grant came'); process.exit(90); }
const r = spawnSync(process.execPath, ['scripts/proof.mjs', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: grant.token } });
release(grant);
process.exit(r.status ?? 1);
`;

// Every inner test notes its stage: the mutation lane writes stryker.proof.config.json into the copy StrykerJS runs
// in, and StrykerJS names the active mutant in __STRYKER_ACTIVE_MUTANT__ (none in its initial run).
const head = `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import * as numbers from '../../../${SOURCE}';
const stage = existsSync(join(process.cwd(), 'stryker.proof.config.json')) ? 'mutation' : 'before';
const mutant = process.env.__STRYKER_ACTIVE_MUTANT__ ?? null;
const observe = (row) => appendFileSync(process.env.T2835_OBSERVATIONS, JSON.stringify({ stage, mutant, cwd: process.cwd(), ...row }) + '\\n');
`;

/** AC1's inner test: starts this checkout's hub through packages/cli/dist/main.js hub run; a missing binary throws. */
export const HUB_TEST = `${head}
test('#2835.addc1d10 hub run answers with the change programs', () => {
  const hub = spawnSync(process.execPath, ['packages/cli/dist/main.js', 'hub', 'run'], { encoding: 'utf8' });
  observe({ status: hub.status, stdout: hub.stdout.trim(), stderr: hub.stderr.trim() });
  if (hub.status !== 0) throw Error(hub.stderr.trim() || 'the hub did not start');
  assert.equal(hub.stdout.trim(), 'hook-change show-change');
  assert.equal(numbers.next?.(1), 2);
});
`;

/** AC2's inner test: names the hub's CLI it checks for, and runs the copy's target/debug binaries directly. */
export const TARGET_TEST = `${head}
test('#2835.1b0cb5cf target/debug holds the change programs', () => {
  // Where the change's TypeScript is missing (the merge base) this throws, not an assertion: the merge base proves
  // nothing here, so the lane runs the twin, which is what proves this test, in the change bay.
  if (typeof numbers.next !== 'function') throw Error('no next() in this checkout');
  const hub = join(process.cwd(), 'packages/cli/dist/main.js');
  const read = (name) => {
    const bin = join(process.cwd(), 'target/debug', name);
    const reply = spawnSync(bin, [], { encoding: 'utf8' });
    return { bin, status: reply.status, word: reply.status === 0 ? reply.stdout.trim() : null };
  };
  const hook = read('deep-hook'), show = read('deep-show');
  observe({ hub: existsSync(hub), hook, show });
  assert.equal(hook.word, 'hook-change');
  assert.equal(show.word, 'show-change');
  assert.equal(numbers.next?.(1), 2);
});
`;

/** AC2's twin: the change with the deep-hook crate edited, so a before-lane run of it builds another deep-hook. */
export const TWIN_HOOK = crate('deep-hook', 'hook-twin')['crates/deep-hook/main.rs'];

/** AC3's control: names the hub's CLI and notes which binaries the copy's target/debug holds. */
export const CONTROL_TEST = `${head}
test('#2835.fe9d8d8e control: a test that names the CLI finds both binaries', () => {
  const hub = join(process.cwd(), 'packages/cli/dist/main.js');
  const found = ['deep-hook', 'deep-show'].filter((name) => existsSync(join(process.cwd(), 'target', 'debug', name)));
  observe({ hub: existsSync(hub), found });
  assert.deepEqual(found, ['deep-hook', 'deep-show']);
  assert.equal(numbers.next?.(1), 2);
});
`;

/** AC3's inner test: names no hub or CLI package; notes which binaries the copy's target/debug holds. */
export const NEITHER_TEST = `${head}
test('#2835.fe9d8d8e a test naming neither package finds no binaries', () => {
  const found = ['deep-hook', 'deep-show'].filter((name) => existsSync(join(process.cwd(), 'target', 'debug', name)));
  observe({ found });
  assert.deepEqual(found, []);
  assert.equal(numbers.next?.(1), 2);
});
`;

/** The rows the inner test wrote during StrykerJS's initial run in the mutation lane (no active mutant). */
export function initialRun(seen, result) {
  const rows = seen.filter((row) => row.stage === 'mutation' && row.mutant === null);
  assert.ok(rows.length > 0, `StrykerJS's initial run ran the tagged test in the mutation lane\n${JSON.stringify(seen)}\n${dump(result)}`);
  return rows;
}

/** The lane's own verdict: no BLOCKED mutation line, and a count of mutants of the added lines. */
export function reportsMutants(result) {
  assert.doesNotMatch(result.stdout, /^BLOCKED mutation: /m, `the mutation lane is BLOCKED\n${dump(result)}`);
  assert.match(result.stdout, /^(?:PASS )?mutation: [1-9]\d* mutants? of the added lines, /m, `the mutation lane reports mutants of the added lines\n${dump(result)}`);
}

export const bays = (box) => join(box.home, 'deepbuild-bays');
export { existsSync };
