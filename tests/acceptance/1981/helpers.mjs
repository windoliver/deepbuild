// Helpers for #1981's acceptance tests, on top of #1116's and #1874's (imported unchanged): a fixture that is a cargo
// workspace with one crate, deep-hook, and five budget tasks, each running a script or the crate's binary; what lets
// affected.mjs read that workspace inside the sandbox (the real cargo's metadata, this checkout's node_modules); and
// the samples each task writes, read per window. Nothing here imports the code under test: the window is reached by
// running it (README: The surface).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHECKOUT, fullWindow, samples, workload } from '../1116/helpers.mjs';
import { WINDOW_MS } from '../1874/helpers.mjs';

/** The tasks whose commands run deep-hook's binary: the binary itself, and a script that runs it. */
export const HOOK = ['hook-version', 'hook-overhead'];
/** The tasks that run only `benchmarks/canvas.mjs`. */
export const CANVAS = ['canvas-patch', 'canvas-seal'];
/** The task whose command `affected.mjs` can't place: inline code, naming no file of the tree and no crate's binary. */
export const LOOSE = 'loose';
export const TASKS = [...HOOK, ...CANVAS, LOOSE];

// Every sample is one line in the test's events file, at an absolute path baked in when the fixture is written:
// { kind: 'sample', task, cwd }. The last argument of each task's command is the task's own ID, which its program writes.
const canvas = (events) => `// The fixture's canvas benchmark: one sample naming its task.
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(events)}, JSON.stringify({ kind: 'sample', task: process.argv[2], cwd: process.cwd() }) + '\\n');
`;
const hookScript = `// The fixture's deep-hook benchmark: it runs the crate's binary, which writes the sample.
import { spawnSync } from 'node:child_process';
const hook = spawnSync(new URL('../target/debug/deep-hook', import.meta.url).pathname, [process.argv[2]], { stdio: 'inherit' });
process.exit(hook.status ?? 1);
`;
const loose = (events) => `require('node:fs').appendFileSync(${JSON.stringify(events)}, JSON.stringify({ kind: 'sample', task: process.argv[1], cwd: process.cwd() }) + '\\n')`;
// What the stand-in cargo builds as target/debug/deep-hook: the workload, then one sample. Only shell builtins, so the
// count of instructions retired covers all of it.
const binary = (events) => `#!/bin/sh
${workload()}printf '{"kind":"sample","task":"%s","cwd":"%s"}\\n' "$1" "$PWD" >> '${events}'
`;

const task = (id, command, criteria) => ({ id, command, margin: 0.5, limits: { p50Ms: 60_000 }, initialReason: 'Fixture for #1981.', ...criteria?.length && { criteria } });
const manifest = (events, criteria) => `${JSON.stringify({ tasks: [
  task('hook-version', ['target/debug/deep-hook', 'hook-version'], criteria['hook-version']),
  task('hook-overhead', ['node', 'benchmarks/deep-hook.mjs', 'hook-overhead'], criteria['hook-overhead']),
  task('canvas-patch', ['node', 'benchmarks/canvas.mjs', 'canvas-patch'], criteria['canvas-patch']),
  task('canvas-seal', ['node', 'benchmarks/canvas.mjs', 'canvas-seal'], criteria['canvas-seal']),
  task(LOOSE, ['node', '-e', loose(events), LOOSE], criteria[LOOSE]),
] }, null, 2)}\n`;

/** The real cargo and rustc, as this checkout runs them: by rustup, else from PATH. */
function real(tool) {
  for (const [command, args] of [['rustup', ['which', tool]], ['/bin/sh', ['-c', `command -v ${tool}`]]]) {
    const found = spawnSync(command, args, { cwd: CHECKOUT, encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

/**
 * Makes the sandbox able to run `affected.mjs`'s selection: its `cargo` answers `metadata` with the real cargo, so
 * the graph holds the fixture's real crate, and a build or test installs deep-hook's binary where cargo would put it
 * (CARGO_TARGET_DIR, else ./target); anything else does nothing, as #1116's stand-in did. This checkout's
 * node_modules is linked above every tree the window reads, the fixture checkout and its copies alike, so
 * `typescript` resolves. Throws when either is missing here.
 */
export function selectable(box) {
  const cargo = real('cargo'), rustc = real('rustc');
  if (!cargo) throw Error('no cargo here: the fixture reads its crate with the real `cargo metadata` (rustup, or cargo on PATH)');
  if (!existsSync(join(CHECKOUT, 'node_modules', 'typescript'))) throw Error(`no node_modules/typescript in ${CHECKOUT}: run npm ci there first`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(box.dir, 'node_modules'));
  const path = join(box.dir, 'bin', 'cargo');
  writeFileSync(path, `#!/bin/sh
case "$1" in
  metadata) exec env RUSTUP_HOME=${JSON.stringify(process.env.RUSTUP_HOME || join(homedir(), '.rustup'))} ${rustc ? `RUSTC=${JSON.stringify(rustc)} ` : ''}${JSON.stringify(cargo)} "$@" ;;
  build|test|clippy)
    [ -f crates/deep-hook/Cargo.toml ] || exit 0
    out="\${CARGO_TARGET_DIR:-target}/debug"
    mkdir -p "$out"
    cat > "$out/deep-hook" <<'BINARY'
${binary(box.events)}BINARY
    chmod +x "$out/deep-hook" ;;
esac
exit 0
`);
  chmodSync(path, 0o755);
}

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

/** One commit on the fixture's main with exactly `files` (no tags/ file of #1116's), pushed; its SHA. */
export function commit(box, repo, files, message) {
  write(join(box.dir, 'work'), files);
  repo.git('add', '-A');
  repo.git('commit', '-qm', message);
  repo.git('push', '-q', 'origin', 'main');
  return repo.git('rev-parse', 'HEAD');
}

/**
 * The commit that makes the fixture a cargo workspace with one crate, crates/deep-hook, adds benchmarks/canvas.mjs
 * and benchmarks/deep-hook.mjs, and sets the five tasks in benchmarks/budgets.json, `criteria` naming what each
 * proves by task ID. It lands before the first window's mark, so no window measures it and every later commit's
 * merge base holds the same tasks.
 */
export const workspace = (box, repo, criteria = {}) => commit(box, repo, {
  'Cargo.toml': '[workspace]\nmembers = ["crates/deep-hook"]\nresolver = "2"\n',
  'crates/deep-hook/Cargo.toml': '[package]\nname = "deep-hook"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n',
  'crates/deep-hook/src/main.rs': 'fn main() {\n    println!("deep-hook 0.0.0");\n}\n',
  'benchmarks/canvas.mjs': canvas(box.events),
  'benchmarks/deep-hook.mjs': hookScript,
  'benchmarks/budgets.json': manifest(box.events, criteria),
}, 'The fixture is a workspace with deep-hook and five budget tasks');

/** A complete window, and the samples its tasks wrote while it ran: with one commit merged since the last, that commit's. */
export async function windowOn(box, repo) {
  const from = samples(box).length;
  const run = await fullWindow(box, repo, { ms: WINDOW_MS });
  return { run, samples: samples(box).slice(from) };
}
/** The samples `task` wrote in a window. */
export const ran = (window, id) => window.samples.filter(({ task: written }) => written === id);
/** A task's row in a record's tests. */
export const row = (record, id) => record.tests.find((test) => test.id === id);
