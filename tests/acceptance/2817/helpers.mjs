// #2817: a disposable fixture repository holding this checkout's unmodified scripts/, a two-crate Cargo workspace
// (bins deep-hook and deep-show), a hub stand-in at packages/cli/dist/main.js that looks for both only under its own
// checkout's target/{release,debug}/, as the hub does, and tagged inner tests the real before lane runs on each side.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The fixture issue holds #2817's own criteria, so the inner tests' tags are the criteria's IDs.
const CRITERIA = [
  "In the before lane, a tagged test that starts this checkout's hub through `packages/cli/dist/main.js hub run` and needs `deep-hook` and `deep-show` under its checkout's `target/` runs to its assertions on both the change side and the merge-base side: neither side ends BLOCKED for a missing binary",
  "On each side of the before lane, the `deep-hook` and `deep-show` under the copy's `target/debug/` are built from that side's own sources: when the change edits the `deep-hook` crate, a tagged test reading the copy's `target/debug/deep-hook` sees the change's program on the change side and the merge base's on the base side",
  'In the before lane, a tagged test that names neither `packages/hub/` nor `packages/cli/` (nor `@deepbuild/hub`, `@deepbuild/cli`) finds no `deep-hook` or `deep-show` the lane put under its copy\'s `target/debug/`',
];
export const ROOT =realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const write = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};
export const dump = (r) => `exit ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? r.error ?? ''}`;
export function run(box, command, args, cwd = box.repo) {
  return spawnSync(command, args, { cwd, env: box.env, encoding: 'utf8', timeout: 280_000, maxBuffer: 2 ** 24 });
}
export function ok(r) { assert.equal(r.status, 0, dump(r)); return r.stdout; }
const git = (box, ...args) => ok(run(box, 'git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]));
function commit(box, message) { git(box, 'add', '-A'); git(box, 'commit', '-qm', message); }

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2817-')));
  const repo = join(dir, 'repo'), home = join(dir, 'home'), temp = join(dir, 'tmp');
  for (const folder of [repo, home, temp]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: join(home, '.cargo'),
    CARGO_NET_OFFLINE: 'true', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    T2817_OBSERVATIONS: join(dir, 'observations.jsonl'), DEEP_PROOF_ISSUES: join(dir, 'issues') };
  for (const key of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'DEEP_THROTTLE',
    'DEEP_THROTTLE_TABLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_VITEST_REPORT',
    'DEEP_HUB_PLANT', 'DEEP_APPROVERS', '__STRYKER_ACTIVE_MUTANT__', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) delete env[key];
  cpSync(join(ROOT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  // The scripts import typescript; they resolve it through the sandbox parent, never a fixture install.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  write(dir, 'issues/2817.md', `### Acceptance criteria\n${CRITERIA.map((text) => `- [ ] ${text}\n`).join('')}`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, repo, env };
}

const crate = (name, word) => ({
  [`crates/${name}/Cargo.toml`]: `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n`,
  [`crates/${name}/src/main.rs`]: `fn main() { println!("${word}"); }\n`,
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

/**
 * The fixture's merge base (origin/main) prints base words; its change prints `change` words and adds `tests`, path to
 * source, tagged for the fixture's issue. Neither commit holds a target/.
 */
export function fixture(box, tests, change = { hook: 'hook-change', show: 'show-change' }) {
  const files = { '.gitignore': 'node_modules/\ntarget/\n',
    'Cargo.toml': '[workspace]\nmembers = ["crates/deep-hook", "crates/deep-show"]\nresolver = "2"\n',
    ...crate('deep-hook', 'hook-base'), ...crate('deep-show', 'show-base'), 'packages/cli/dist/main.js': HUB };
  for (const [path, bytes] of Object.entries(files)) write(box.repo, path, bytes);
  ok(run(box, 'cargo', ['generate-lockfile', '--offline']));
  git(box, 'init', '-q', '--template=', '-b', 'main');
  commit(box, 'base');
  git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const [path, bytes] of Object.entries({ ...crate('deep-hook', change.hook), ...crate('deep-show', change.show), ...tests })) write(box.repo, path, bytes);
  commit(box, 'fixture change\n\nPart of #2817');
}

/** The real before lane on the fixture, and what each side's inner tests saw, with the side read from its own sources. */
export function before(t, box) {
  rmSync(box.env.T2817_OBSERVATIONS, { force: true });
  const result = run(box, process.execPath, ['scripts/proof.mjs', 'before']);
  t.diagnostic(result.stdout);
  let seen = [];
  try { seen = readFileSync(box.env.T2817_OBSERVATIONS, 'utf8').trim().split('\n').map((line) => JSON.parse(line)); } catch {}
  return { result, seen };
}

// Every inner test notes its checkout, and which side it is by that checkout's own deep-hook source.
const note = `const side = /"hook-(\\w+)"/.exec(readFileSync(join(process.cwd(), 'crates/deep-hook/src/main.rs'), 'utf8'))?.[1];
const observe = (row) => appendFileSync(process.env.T2817_OBSERVATIONS, JSON.stringify({ side, cwd: process.cwd(), ...row }) + '\\n');`;
const head = `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
${note}
`;

/** AC1's inner test: starts this checkout's hub through packages/cli/dist/main.js hub run; a missing binary BLOCKs. */
export const HUB_TEST = `${head}
test('#2817.caef3798 hub run answers with the change programs', () => {
  const hub = spawnSync(process.execPath, ['packages/cli/dist/main.js', 'hub', 'run'], { encoding: 'utf8' });
  observe({ status: hub.status, stdout: hub.stdout.trim(), stderr: hub.stderr.trim() });
  if (hub.status !== 0) throw Error(hub.stderr.trim() || 'the hub did not start');
  assert.equal(hub.stdout.trim(), 'hook-change show-change');
});
`;

/** AC2's inner test: names the hub's CLI it checks for, and runs the copy's target/debug binaries directly. */
export const TARGET_TEST = `${head}
test('#2817.51a8f2a0 target/debug holds the change programs', () => {
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
});
`;

/** AC3's control: names the hub's CLI and only notes which binaries the copy's target/debug holds. */
export const CONTROL_TEST = `${head}
test('#2817.e0f437e2 control: a test that names the CLI finds both binaries', () => {
  const hub = join(process.cwd(), 'packages/cli/dist/main.js');
  const found = ['deep-hook', 'deep-show'].filter((name) => existsSync(join(process.cwd(), 'target', 'debug', name)));
  observe({ hub: existsSync(hub), found });
  assert.deepEqual(found, ['deep-hook', 'deep-show']);
});
`;

/** AC3's inner test: names no hub or CLI package; notes which binaries the copy's target/debug holds. */
export const NEITHER_TEST = `${head}
test('#2817.e0f437e2 a test naming neither package finds no binaries', () => {
  const found = ['deep-hook', 'deep-show'].filter((name) => existsSync(join(process.cwd(), 'target', 'debug', name)));
  observe({ found });
  assert.deepEqual(found, []);
});
`;

/** Both sides ran the inner test once each, in two different copies. */
export function bothSides(seen, result) {
  assert.deepEqual(seen.map(({ side }) => side).sort(), ['base', 'change'], `each side runs the tagged test once\n${dump(result)}`);
  assert.notEqual(seen[0].cwd, seen[1].cwd, 'the sides run in different copies');
  return Object.fromEntries(seen.map((row) => [row.side, row]));
}
