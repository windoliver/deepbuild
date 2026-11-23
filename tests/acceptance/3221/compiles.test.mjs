// #3221 AC2: three runs whose jobs each start a cargo build that must compile never have more compiler processes
// between them than the pool's tokens, sampled once a second. Each run's one job is
// `throttle.mjs test -- node job.mjs <run> 0 cargo <workspace>`, a real cargo build in a workspace of the run's own.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { GiB, dump, ended, ends, readings, run, sandbox } from './helpers.mjs';

const POOL = 4;
const RUNS = ['first', 'second', 'third'];
// Each build compiles as many independent leaf crates as two pools, then a binary that needs them all, so one cargo at
// its own job count could run 8 compilers at once. Each leaf's constant takes about a second of one core to evaluate.
const LEAVES = 2 * POOL;
const STEPS = 600_000;
// Where rustup's proxies live when cargo isn't on PATH, as on the reference Mac.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];
const RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');

const leaf = (k) => `u3221-leaf-${String(k).padStart(2, '0')}`;
const pkg = (name, more = '') => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n${more}`;

/** A workspace of LEAVES crates no other needs first, each a constant evaluated while it compiles, and a binary. */
function workspace(at, seed) {
  const names = Array.from({ length: LEAVES }, (_, k) => leaf(k));
  const files = {
    'Cargo.toml': `[workspace]\nresolver = "2"\nmembers = [${[...names, 'u3221-bin'].map((name) => `"crates/${name}"`).join(', ')}]\n`,
    'crates/u3221-bin/Cargo.toml': pkg('u3221-bin', `\n[dependencies]\n${names.map((name) => `${name} = { path = "../${name}" }`).join('\n')}\n`),
    'crates/u3221-bin/src/main.rs': `fn main() {\n    println!("{}", 0u64${names.map((name) => ` ^ ${name.replaceAll('-', '_')}::v()`).join('')});\n}\n`,
  };
  // A seed no earlier build saw, in every leaf, so no cache of any kind can answer for its compile.
  names.forEach((name, k) => {
    files[`crates/${name}/Cargo.toml`] = pkg(name);
    files[`crates/${name}/src/lib.rs`] = `#![allow(long_running_const_eval)]
pub const V: u64 = {
    let mut i: u64 = 0;
    let mut acc: u64 = ${seed + k};
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
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
}

/**
 * The process table, read once a second until the returned stop(): each reading counts the compiler processes of the
 * planted crates (a `rustc` whose arguments name `--crate-name u3221_`), by the run whose workspace they build.
 */
function sampler(box) {
  const samples = [], pending = new Set(), zero = Date.now();
  // A compiler of this sandbox's workspaces names one of them in its arguments (its --out-dir), whoever else compiles.
  const escaped = box.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const workspaceOf = new RegExp(`${escaped}/ws-(\\w+)/`);
  const read = () => {
    const at = Date.now();
    const job = new Promise((done) => execFile('ps', ['-A', '-ww', '-o', 'pid=,ucomm=,args='], { maxBuffer: 1 << 28 }, (error, stdout) => {
      if (error) return done(samples.push({ at: at - zero, count: 0, by: {}, error: error.message }));
      const by = {};
      let count = 0;
      for (const line of stdout.split('\n')) {
        const [, , name, args] = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/) ?? [];
        if (name !== 'rustc' || !/--crate-name u3221_/.test(args)) continue;
        const of = args.match(workspaceOf)?.[1];
        if (!of) continue;
        count += 1;
        by[of] = (by[of] ?? 0) + 1;
      }
      done(samples.push({ at: at - zero, count, by }));
    }));
    pending.add(job);
    job.then(() => pending.delete(job));
  };
  read();
  // deadline: the criterion's sampling, once a second, until the runs have ended.
  const timer = setInterval(read, 1000);
  return async () => {
    clearInterval(timer);
    await Promise.all(pending);
    return samples.sort((a, b) => a.at - b.at);
  };
}

const shown = (sample) => `+${Math.round(sample.at / 1000)} s: ${sample.error ? 'ps failed' : `${sample.count} (${Object.entries(sample.by).map(([name, n]) => `${name} ${n}`).join(', ') || 'none'})`}`;

test('#3221.cbe8556f three runs whose jobs each start a cargo build that must compile never have more compiler processes between them than the pool\'s 4 tokens, sampled once a second', { timeout: 40 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // cargo as a developer runs it: no job count, jobserver, wrapper or target folder from this process, so whatever
  // bounds the builds comes from the code under test.
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$)/.test(name)) delete box.env[name];
  Object.assign(box.env, {
    PATH: [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter),
    RUSTUP_HOME, CARGO_HOME: join(box.dir, 'cargo'),
  });
  readings(box, { memory: 1024 * GiB, load: 0, cores: POOL + 1 });
  const seed = (Date.now() % 1_000_000) * 1000;
  RUNS.forEach((name, k) => workspace(join(box.dir, `ws-${name}`), seed + 100 * k));
  const cargo = spawnSync('cargo', ['--version'], { cwd: join(box.dir, 'ws-first'), env: box.env, encoding: 'utf8' });
  assert.equal(cargo.status, 0, `cargo can't run in the sandbox, so nothing can build: ${cargo.error?.message ?? cargo.stderr}`);

  const stop = sampler(box);
  const runs = RUNS.map((name) => run(box, name, { jobs: [{ mode: ['cargo', join(box.dir, `ws-${name}`)] }] }));
  const all = () => dump(box, ...runs);
  let samples;
  try {
    for (const child of runs) assert.equal(await ended(child, 35 * 60_000, all), 0, `${child.label} failed\n${all()}`);
  } finally {
    samples = await stop();
  }
  const series = `planted compiler processes, read once a second (${samples.length} readings, ${samples.filter((s) => s.error).length} failed): ${samples.filter((s) => s.count || s.error).map(shown).join(', ') || 'none'}`;
  t.diagnostic(series);

  // Each build compiled every planted crate, and its compilers were seen: otherwise the count proves nothing.
  for (const name of RUNS) {
    const end = ends(box, name)[0];
    assert.ok(end, `the ${name} run's cargo build never finished\n${series}\n${all()}`);
    assert.equal(end.status, 0, `the ${name} run's cargo build failed: ${end.tail}\n${series}\n${all()}`);
    assert.equal(end.compiled, LEAVES + 1, `the ${name} run's cargo build compiled ${end.compiled} of the ${LEAVES + 1} planted crates, so it didn't have to compile\n${series}\n${all()}`);
    assert.ok(samples.some((s) => s.by[name] > 0), `no compiler of the ${name} run's build was seen in any reading, so the count can't speak for it\n${series}`);
  }
  const peak = samples.reduce((top, s) => (s.count > top.count ? s : top));
  const over = samples.filter((s) => s.count > POOL);
  t.diagnostic(`peak: ${shown(peak)}`);
  assert.ok(!over.length, `${peak.count} compiler processes ran at once at ${shown(peak)}, more than the pool's ${POOL} tokens; ${over.length} of ${samples.length} readings were above ${POOL}\n${series}`);
});
