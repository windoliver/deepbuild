// #3296 AC7 (#3296.27d9fa8c): with the build folder emptied between two jobs, the next job finds every binary the run's
// plan built.
//
// Each scene's tree holds one crate with no dependencies, built by the real cargo, and its run's plan builds two binaries
// of it: `seen3296`, which tests read through DEEP_BIN_DIR, and `placed3296`, which the alone block's tests build in their
// own checkout's target/ and which the run builds there first. Every job notes, as its file starts, whether the binaries
// its plan built run, and empties both folders, its DEEP_BIN_DIR and its checkout's target/, as it ends. So every job but
// a folder's first starts on emptied folders. One scene runs the alone block in the worktree; the other in two shards,
// where a cleanup emptied the folder of the run the issue reports.
//
// The merge base is the planted program that builds once at the start.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import test, { before } from 'node:test';
import { aloneFile, CHECKOUT, dump, nodeFile, parallelFile, scene, timedFile, toEnd } from './helpers.mjs';

const AC7 = '#3296.27d9fa8c';

// The real toolchain, by its own folder, so no rustup stands between a scene's HOME and it.
const found = spawnSync('rustc', ['--print', 'sysroot'], { cwd: CHECKOUT, encoding: 'utf8', env: { ...process.env, PATH: [process.env.PATH, join(homedir(), '.cargo/bin'), '/opt/homebrew/opt/rustup/bin'].join(delimiter) } });
const toolchain = found.status === 0 ? join(found.stdout.trim(), 'bin') : null;
const CARGO = `#!/bin/sh
case "$1" in build|metadata) RUSTC='${toolchain}/rustc' exec '${toolchain}/cargo' "$@" ;; esac
exit 0
`;
const CRATE = {
  'Cargo.toml': '[package]\nname = "crate3296"\nversion = "0.0.0"\nedition = "2024"\n',
  'Cargo.lock': 'version = 4\n\n[[package]]\nname = "crate3296"\nversion = "0.0.0"\n',
  'src/bin/seen3296.rs': 'fn main() {\n    println!("seen3296 runs");\n}\n',
  'src/bin/placed3296.rs': 'fn main() {\n    println!("placed3296 runs");\n}\n',
};

// A job's one file. It reads its binaries as tests do, so the run's plan builds them: DEEP_BIN_DIR by its name and a
// cargo build of its own written out, which it never starts, since its binary is there or the job has shown it isn't.
const probe = (name, runner, placed) => `import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import ${runner === 'node' ? 'test' : '{ test }'} from '${runner === 'node' ? 'node:test' : 'vitest'}';
const bin = process.env.DEEP_BIN_DIR ?? '', target = join(process.cwd(), 'target');
const note = (event, more) => appendFileSync(process.env.T3296_EVENTS ?? '', JSON.stringify({ name: ${JSON.stringify(name)}, event, cwd: process.cwd(), bin, ...more }) + '\\n');
const runs = (path, name) => spawnSync(path, [], { encoding: 'utf8' }).stdout?.trim() === name + ' runs';
const binaries = { seen3296: runs(join(bin, 'seen3296'), 'seen3296')${placed ? ", placed3296: runs(join(target, 'debug', 'placed3296'), 'placed3296')" : ''} };
note('start', { binaries });
${placed ? "if (process.env.T3296_NEVER) spawnSync('cargo', ['build', '--offline', '--bin', 'placed3296'], { stdio: 'ignore' });" : ''}
test('one', () => {});
test('two', () => {
  for (const folder of [bin, target]) if (folder && existsSync(folder)) for (const entry of readdirSync(folder)) rmSync(join(folder, entry), { recursive: true, force: true });
  note('emptied');
});
`;

const scenes = {
  worktree: { shards: '1', commands: ['parallel', 'alone', 'node'], files: { [parallelFile('p')]: 'p', [aloneFile(0, 'a')]: 'a', [aloneFile(1, 'a')]: 'b', [aloneFile(2, 'a')]: 'c', [timedFile()]: 't', [nodeFile('n')]: 'n' } },
  shards: { shards: '2', commands: ['alone'], files: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name, k) => [aloneFile(k, 'a'), name])) },
};
const ran = {};

before(async () => {
  if (!toolchain) return;
  for (const [name, { shards, commands, files }] of Object.entries(scenes)) {
    const probes = Object.fromEntries(Object.entries(files).map(([file, probed]) => [file, probe(probed, file.endsWith('.mjs') ? 'node' : 'vitest', file !== timedFile() && file.startsWith('tests/acceptance/'))]));
    const box = scene({ files, commands, extra: { ...CRATE, ...probes }, bin: { cargo: CARGO }, env: { DEEP_SHARDS: shards, CARGO_INCREMENTAL: '0' } });
    box.env.CARGO_HOME = join(box.dir, 'cargo-home');
    const run = await toEnd(box);
    ran[name] = { ...run, box, notes: box.notes(), shown: dump(box, run) };
  }
}, { timeout: 60 * 60_000 });

/** Each binary a job of the scene started without, as `<binary> missing at the start of <file>, after <n> jobs`. */
function missing({ box, notes }) {
  const starts = notes.filter(({ event }) => event === 'start');
  return starts.flatMap(({ name, binaries }, k) => Object.entries(binaries).filter(([, there]) => !there).map(([binary]) => `${binary} missing at the start of ${Object.keys(box.files).find((file) => box.files[file] === name)}, after ${k} other jobs`));
}
function whole(name) {
  assert.ok(toolchain, `no Rust toolchain here, so nothing can be built: ${found.error?.message ?? found.stderr}`);
  const run = ran[name];
  const names = Object.values(run.box.files);
  assert.deepEqual(names.filter((probed) => !run.notes.some((note) => note.name === probed && note.event === 'emptied')), [], `jobs that didn't run and empty their build folders\n${run.shown}`);
  return run;
}

test(`${AC7} in the worktree, every job finds every binary the run's plan built, the folders emptied after the job before it`, () => {
  const run = whole('worktree');
  assert.deepEqual(missing(run), [], `jobs started without a binary the run's plan built\n${run.shown}`);
  assert.equal(run.code, 0, `the preflight exited ${run.code}\n${run.shown}`);
});

test(`${AC7} in a shard, every job finds every binary the run's plan built, the folders emptied after the job before it`, (t) => {
  const run = whole('shards');
  const places = new Set(run.notes.filter(({ event }) => event === 'start').map(({ cwd }) => cwd));
  t.diagnostic(`${run.notes.filter(({ event }) => event === 'start').length} jobs in ${places.size} places: ${[...places].map((cwd) => cwd.replace(run.box.home, '~').replace(run.box.dir, '<tmp>')).join(', ')}`);
  assert.ok([...places].some((cwd) => cwd.includes('deepbuild-shards')), `no job ran in a shard\n${run.shown}`);
  assert.deepEqual(missing(run), [], `jobs started without a binary the run's plan built\n${run.shown}`);
  assert.equal(run.code, 0, `the preflight exited ${run.code}\n${run.shown}`);
});
