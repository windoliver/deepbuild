// #2741: an affected.mjs run whose alone block puts a cargo-building file in each of at least three shards, each on a
// target/ that must recompile, never has more rustc processes under its grant than the machine has cores, sampled once
// a second. Written blind from issue #2741, AGENTS.md, the design's Dogfooding section and docs/parallel-proof.md
// sections 6, 7a and 13, at base 80561d40c. This checkout's real scripts/ run in a scratch tree made by #1115's
// helpers, with a HOME of its own, so the throttle table and ~/deepbuild-shards/ are the sandbox's (README).
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, dump, sandbox, tree } from '../1115/helpers.mjs';
import { start } from '../2574/helpers.mjs';

const CORES = availableParallelism();
// The criterion's "at least three shards": one alone group each, and DEEP_SHARDS asks the run for that many.
const SHARDS = 3;
// Each planted build compiles as many independent crates as the machine has cores, so one cargo alone could fill
// them; each crate's constant takes about 2 s of one core to evaluate (README).
const LEAVES = CORES;
const STEPS = 1_000_000;
const NAME = 'fixture-2741.test';
const RUN_MS = 55 * 60_000;
// Where rustup's proxies live when cargo isn't on PATH, as on the reference Mac.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];
const RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');

const leaf = (k) => `planted-leaf-${String(k).padStart(2, '0')}`;
const pkg = (name, more = '') => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n${more}`;

/** A cargo workspace of LEAVES crates no other needs first, each a constant evaluated at compile time, and a binary. */
function workspace() {
  const names = Array.from({ length: LEAVES }, (_, k) => leaf(k));
  const files = {
    'Cargo.toml': `[workspace]\nresolver = "2"\nmembers = [${[...names, 'planted-bin'].map((name) => `"crates/${name}"`).join(', ')}]\n`,
    'crates/planted-bin/Cargo.toml': pkg('planted-bin', `\n[dependencies]\n${names.map((name) => `${name} = { path = "../${name}" }`).join('\n')}\n`),
    'crates/planted-bin/src/main.rs': `fn main() {\n    println!("{}", 0u64${names.map((name) => ` ^ ${name.replaceAll('-', '_')}::v()`).join('')});\n}\n`,
  };
  names.forEach((name, k) => {
    files[`crates/${name}/Cargo.toml`] = pkg(name);
    files[`crates/${name}/src/lib.rs`] = `#![allow(long_running_const_eval)]
// Evaluated while this crate compiles, so its rustc keeps one core busy for a while.
pub const V: u64 = {
    let mut i: u64 = 0;
    let mut acc: u64 = ${k + 1};
    while i < ${STEPS} {
        acc = acc.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407 ^ i);
        i += 1;
    }
    acc
};

pub fn v() -> u64 {
    V
}
`;
  });
  return files;
}

/**
 * A planted test file for vitest or node --test: it builds the planted binary with cargo in its own tree's target/,
 * noting its process, its tree and how many planted crates cargo compiled.
 */
function planted(file) {
  const vitest = file.endsWith('.ts');
  return `// Planted by tests/acceptance/2741: builds the planted crates with cargo in this tree's own target/.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
${vitest ? "import { expect, test } from 'vitest';" : "import assert from 'node:assert/strict';\nimport test from 'node:test';"}

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'Cargo.toml')) && dirname(root) !== root) root = dirname(root);
const note = (fields) => appendFileSync(process.env.T2741_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, root, pid: process.pid, at: Date.now(), ...fields }) + '\\n');

test('the planted crates build with cargo in this tree', () => {
  note({ event: 'start' });
  const result = spawnSync('cargo', ['build', '--offline', '-p', 'planted-bin'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const compiled = (result.stderr ?? '').match(/^\\s*Compiling planted-/gm)?.length ?? 0;
  note({ event: 'end', status: result.status, compiled, error: result.error?.message ?? null, tail: (result.stderr ?? '').trim().split('\\n').slice(-3).join('\\n') });
  ${vitest ? 'expect(result.status, result.stderr).toBe(0);' : 'assert.equal(result.status, 0, result.stderr);'}
}${vitest ? ', 3_600_000' : ''});
`;
}

/**
 * `count` folders of lanes.mjs's alone list, each its own group, where a planted file is neither exclusive, timed,
 * slow, left to a person nor in a lane of its own. The lists are read by a child, so a missing one fails here.
 */
function aloneFolders(count) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
    console.log(JSON.stringify(Object.fromEntries(['alone', 'exclusive', 'timed', 'slow', 'byHand', 'ownLane'].map((name) => [name, lanes[name] ?? []]))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  const lists = JSON.parse(result.stdout.trim().split('\n').at(-1));
  const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
  const folders = lists.alone.filter((entry) => /^tests\/.+\/$/.test(entry) && ['ts', 'mjs'].every((extension) => {
    const file = `${entry}${NAME}.${extension}`;
    return [...lists.exclusive, ...lists.alone].find((other) => covers([other], file)) === entry
      && ![lists.timed, lists.slow, lists.byHand, lists.ownLane].some((list) => covers(list, file));
  }));
  assert.ok(folders.length >= count, `scripts/lanes.mjs's alone list has ${folders.length} folders a planted file runs alone in, not ${count}`);
  return folders.slice(0, count);
}

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
const shardOf = (root) => {
  const k = root.match(/\/deepbuild-shards\/(\d+)$/)?.[1];
  return k ? `shard ${k}` : root;
};

/**
 * The process table, read once a second until the returned stop() (each reading starts on its second, however long
 * the last takes on a loaded machine): each counts the rustc processes under the run's grant, those whose parent
 * chain reaches the process holding it (docs/parallel-proof.md, section 6), by the planted file they descend from.
 */
function sampler(holderOf, plantedOf) {
  const samples = [], pending = new Set(), started = Date.now();
  const read = () => {
    const at = Date.now() - started;
    const job = new Promise((done) => execFile('ps', ['-A', '-o', 'pid=,ppid=,ucomm='], { maxBuffer: 1 << 26 }, (error, stdout) => {
      if (error) return done(samples.push({ at, count: 0, by: {}, error: error.message }));
      const procs = new Map();
      for (const line of stdout.split('\n')) {
        const [, pid, ppid, name] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/) ?? [];
        if (pid) procs.set(Number(pid), { ppid: Number(ppid), name });
      }
      const holder = holderOf(), files = plantedOf(), by = {};
      let count = 0;
      for (const [pid, { name }] of procs) {
        if (!holder || name !== 'rustc') continue;
        const chain = [];
        for (let p = pid; procs.has(p) && !chain.includes(p); p = procs.get(p).ppid) chain.push(p);
        if (!chain.includes(holder)) continue;
        count += 1;
        const shard = files.get(chain.find((p) => files.has(p))) ?? 'other';
        by[shard] = (by[shard] ?? 0) + 1;
      }
      done(samples.push({ at, count, by }));
    }));
    pending.add(job);
    job.then(() => pending.delete(job));
  };
  read();
  const timer = setInterval(read, 1000);
  return async () => {
    clearInterval(timer);
    await Promise.all(pending);
    return samples.sort((a, b) => a.at - b.at);
  };
}

const seconds = (sample) => `+${Math.round(sample.at / 1000)} s`;
const breakdown = (sample) => Object.entries(sample.by).map(([shard, count]) => `${shard}: ${count}`).join(', ') || 'none';

test('#2741 AC: an affected.mjs run whose alone block builds with cargo in three shards, each on a target/ that must recompile, never has more rustc processes under its grant than the machine has cores, sampled once a second', { timeout: RUN_MS + 5 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // cargo as the machine's developers run it: no job count, jobserver, wrapper or target folder from this process.
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$)/.test(name)) delete box.env[name];
  const files = aloneFolders(SHARDS).map((folder, k) => `${folder}${NAME}.${k % 2 ? 'mjs' : 'ts'}`);
  const fixture = tree(box, { '.gitignore': 'node_modules\n/target\n', ...workspace(), ...Object.fromEntries(files.map((file) => [file, planted(file)])) });
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp);
  const record = join(box.dir, 'builds.jsonl');
  const env = {
    PATH: [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter),
    RUSTUP_HOME, CARGO_HOME: join(box.dir, 'cargo'), TMPDIR: tmp,
    DEEP_TEST_SHARD_FLOOR: '0', DEEP_SHARDS: String(SHARDS), T2741_RECORD: record,
  };
  const cargo = spawnSync('cargo', ['--version'], { cwd: fixture.cwd, env: { ...box.env, ...env }, encoding: 'utf8' });
  assert.equal(cargo.status, 0, `cargo can't run in the sandbox, so nothing can build: ${cargo.error?.message ?? cargo.stderr}`);

  const log = join(box.home, '.deepbuild', 'throttle', 'log');
  const grantOf = () => lines(log).find((event) => event.event === 'granted' && event.grant === 'top-level');
  const child = start(box, { cwd: fixture.cwd, env }, files);
  let holder;
  const stop = sampler(() => (holder ??= grantOf()?.pid), () => new Map(lines(record).filter((e) => e.event === 'start').map((e) => [e.pid, shardOf(e.root)])));
  let run, timer;
  try {
    run = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), RUN_MS); })]);
  } finally {
    clearTimeout(timer);
  }
  const samples = await stop();
  const builds = lines(record);
  const counted = samples.filter((sample) => sample.count || sample.error);
  const series = `rustc processes under the run's grant, read once a second (time from the run's start: count; ${samples.length} readings, ${samples.filter((s) => s.error).length} failed, the other ${samples.length - counted.length} counted 0): ${counted.map((s) => `${seconds(s)}: ${s.error ? 'ps failed' : s.count}`).join(', ') || 'none'}`;
  const all = `${series}\nthe machine's cores: ${CORES}\nbuilds:\n${builds.map((e) => JSON.stringify(e)).join('\n')}\n${run ? dump(run) : `stdout so far:\n${child.out().slice(-2_500)}`}`;
  assert.ok(run, `affected.mjs did not end within ${RUN_MS / 60_000} min\n${all}`);

  // The run held a grant, the planted files each built in a shard of their own on a target/ that had to recompile, and
  // their rustc ran under the grant: otherwise the count below proves nothing.
  const grant = grantOf();
  assert.ok(grant, `the run took no top-level grant in its throttle table, so nothing ran under one\n${all}`);
  const ends = new Map(builds.filter((e) => e.event === 'end').map((e) => [e.file, e]));
  for (const file of files) {
    const end = ends.get(file);
    assert.ok(end, `the planted ${file} never finished its cargo build, so the run proves nothing\n${all}`);
    assert.equal(end.status, 0, `the planted ${file}'s cargo build failed in ${end.root}\n${all}`);
    assert.equal(end.compiled, LEAVES + 1, `the planted ${file}'s cargo build compiled ${end.compiled} of the ${LEAVES + 1} planted crates, so its target/ didn't have to recompile\n${all}`);
  }
  const shards = join(box.home, 'deepbuild-shards');
  const roots = [...new Set([...ends.values()].map((end) => end.root))];
  assert.ok(roots.length >= SHARDS && roots.every((root) => root.startsWith(`${shards}/`)), `the planted files built in ${roots.join(', ')}, not each in a shard of its own under ${shards}\n${all}`);
  for (const root of roots) assert.ok(samples.some((sample) => sample.by[shardOf(root)] > 0), `no rustc of the build in ${root} was seen under the run's grant (pid ${grant.pid}), so the count can't speak for it\n${all}`);

  const peak = samples.reduce((top, sample) => (sample.count > top.count ? sample : top));
  t.diagnostic(`peak: ${peak.count} rustc processes under the run's grant at ${seconds(peak)} (${breakdown(peak)}), on ${CORES} cores`);
  t.diagnostic(series);
  const over = samples.filter((sample) => sample.count > CORES);
  assert.ok(!over.length, `${peak.count} rustc processes ran under the run's grant at once at ${seconds(peak)} (${breakdown(peak)}), more than the machine's ${CORES} cores; ${over.length} of ${samples.length} readings were above ${CORES}\n${all}`);
});
