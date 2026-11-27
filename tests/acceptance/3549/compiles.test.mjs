// #3549 criterion 2 (#3549.13a91455): two real `cargo build`s of a fixture workspace, admitted together, never run
// more compiles at once than the pool, read from the process table at each look. A planted throttle that gives each
// build a jobserver with the pool's whole count fails, naming the look. Each build is
// `throttle.mjs build -- node stub.mjs <name> cargo <workspace>`: a real, offline cargo build of a copy of the fixture
// workspace, written here with no dependencies, in a folder of the build's own, since cargo's own lock keeps two
// builds of one folder apart.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { build, dump, ended, endOf, running, sandbox, since, startOf, until } from './helpers.mjs';

// Two tokens: with both builds under way each has its turn's own and none to lend, so each compiles one crate at a time.
const POOL = 2;
const BUILDS = ['first', 'second'];
// The fixture: one crate every other needs, slow to compile, so both builds are under way before either has a crate to
// compile beside it; then as many independent leaf crates as four pools, so one cargo at its own job count, or at the
// pool's whole count, would compile several at once for seconds; then a binary that needs them all. Each crate is a
// constant evaluated while it compiles: over a second of one core for a leaf, four times that for the first crate. A
// leaf calls the first crate when it runs, and never evaluates that crate's constant again.
const LEAVES = 4 * POOL;
const LEAF_STEPS = 600_000, FIRST_STEPS = 4 * LEAF_STEPS;
// Where rustup's proxies live when cargo isn't on PATH, as on the reference Mac.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];
const RUSTUP_HOME = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');

const leaf = (k) => `u3549-leaf-${String(k).padStart(2, '0')}`;
const pkg = (name, needs = []) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n${needs.length ? `\n[dependencies]\n${needs.map((dep) => `${dep} = { path = "../${dep}" }`).join('\n')}\n` : ''}`;
const constant = (steps, seed, mix = '') => `#![allow(long_running_const_eval)]
pub const V: u64 = {
    let mut i: u64 = 0;
    let mut acc: u64 = ${seed};
    while i < ${steps} {
        acc = acc.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407 ^ i);
        i += 1;
    }
    acc
};

pub fn v() -> u64 {
    V${mix}
}
`;

/** A copy of the fixture workspace at `at`, every crate seeded so that no cache of any kind can answer for its compile. */
function workspace(at, seed) {
  const names = Array.from({ length: LEAVES }, (_, k) => leaf(k));
  const files = {
    'Cargo.toml': `[workspace]\nresolver = "2"\nmembers = [${['u3549-first', ...names, 'u3549-bin'].map((name) => `"crates/${name}"`).join(', ')}]\n`,
    'crates/u3549-first/Cargo.toml': pkg('u3549-first'),
    'crates/u3549-first/src/lib.rs': constant(FIRST_STEPS, seed),
    'crates/u3549-bin/Cargo.toml': pkg('u3549-bin', names),
    'crates/u3549-bin/src/main.rs': `fn main() {\n    println!("{}", 0u64${names.map((name) => ` ^ ${name.replaceAll('-', '_')}::v()`).join('')});\n}\n`,
  };
  names.forEach((name, k) => {
    files[`crates/${name}/Cargo.toml`] = pkg(name, ['u3549-first']);
    files[`crates/${name}/src/lib.rs`] = constant(LEAF_STEPS, seed + 1 + k, ' ^ u3549_first::v()');
  });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
}

/**
 * The process table, read once a second until the returned stop(): each look counts the compiler processes of the
 * planted crates (a `rustc` whose arguments name `--crate-name u3549_`), by the build whose workspace they compile.
 */
function looks(box) {
  const seen = [], pending = new Set();
  // A compiler of this sandbox's workspaces names one of them in its arguments (its --out-dir), whoever else compiles.
  const workspaceOf = new RegExp(`${box.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/ws-(\\w+)/`);
  const read = () => {
    const look = { number: seen.length + 1, at: Date.now(), count: 0, by: {} };
    seen.push(look);
    const listing = new Promise((done) => execFile('ps', ['-A', '-ww', '-o', 'pid=,ucomm=,args='], { maxBuffer: 1 << 28 }, (error, stdout) => {
      if (error) look.error = error.message;
      for (const line of error ? [] : stdout.split('\n')) {
        const [, , name, args] = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/) ?? [];
        const of = name === 'rustc' && /--crate-name u3549_/.test(args) ? args.match(workspaceOf)?.[1] : null;
        if (!of) continue;
        look.count += 1;
        look.by[of] = (look.by[of] ?? 0) + 1;
      }
      done();
    }));
    pending.add(listing);
    listing.then(() => pending.delete(listing));
  };
  read();
  // deadline: the criterion's looks at the process table, one a second, until the builds have ended.
  const timer = setInterval(read, 1000);
  return async () => {
    clearInterval(timer);
    await Promise.all(pending);
    return seen;
  };
}

/** A look as a message names it: its number, its time since the first, and its count by build. */
const shown = (look, first) => `look ${look.number} (${since(first.at, look.at)}): ${look.error ? 'ps failed' : `${look.count} (${Object.entries(look.by).map(([name, n]) => `${name} ${n}`).join(', ') || 'none'})`}`;

test('#3549.13a91455 two real cargo builds of a fixture workspace, admitted together on a pool of 2 tokens, never run more than 2 compiler processes between them at any look, and a third build asked beside them waits for its turn', { timeout: 25 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: POOL + 1 });
  // cargo as a developer runs it: no job count, jobserver, wrapper or target folder from this process, so whatever
  // bounds the builds comes from the code under test.
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|RUSTC|RUSTUP_TOOLCHAIN$)/.test(name)) delete box.env[name];
  Object.assign(box.env, {
    PATH: [box.env.PATH, ...RUST_BINS.filter((dir) => existsSync(join(dir, 'cargo')))].join(delimiter),
    RUSTUP_HOME, CARGO_HOME: join(box.dir, 'cargo'),
  });
  const seed = (Date.now() % 1_000_000) * 1000;
  BUILDS.forEach((name, k) => workspace(join(box.dir, `ws-${name}`), seed + 100 * k));
  const cargo = spawnSync('cargo', ['--version'], { cwd: join(box.dir, 'ws-first'), env: box.env, encoding: 'utf8' });
  assert.equal(cargo.status, 0, `BLOCKED: cargo can't run in the sandbox, so nothing can build: ${cargo.error?.message ?? cargo.stderr}`);

  const stop = looks(box);
  // Admitted together: both asked at once.
  const builds = BUILDS.map((name) => build(box, name, ['cargo', join(box.dir, `ws-${name}`)]));
  let third = null;
  const all = () => dump(box, builds, third);
  let seen;
  try {
    // Once both are under way, a third build asks, with a wait of 0.05 min, 3 s: the pool's two tokens are held.
    await until(() => BUILDS.every((name) => startOf(box, name)) || builds.some((child) => !running(child)), 10 * 60_000);
    if (BUILDS.every((name) => startOf(box, name))) third = build(box, 'third', ['exit'], '0.05');
    for (const child of builds) assert.equal(await ended(child, 20 * 60_000), 0, `the cargo build ${child.named} failed, or didn't end in 20 min\n${all()}`);
    if (third) await ended(third, 120_000);
  } finally {
    seen = await stop();
  }
  const series = `planted compiler processes at each look, one a second (${seen.length} looks, ${seen.filter((look) => look.error).length} failed): ${seen.filter((look) => look.count || look.error).map((look) => shown(look, seen[0])).join(', ') || 'none'}`;
  t.diagnostic(series);

  // Each build compiled every planted crate, and its compilers were seen: otherwise the count proves nothing.
  for (const name of BUILDS) {
    const end = endOf(box, name);
    assert.equal(end?.status, 0, `the ${name} cargo build failed: ${end?.tail}\n${series}\n${all()}`);
    assert.equal(end.compiled, LEAVES + 2, `the ${name} cargo build compiled ${end.compiled} of the ${LEAVES + 2} planted crates, so it didn't have to compile\n${series}\n${all()}`);
    assert.ok(seen.some((look) => look.by[name] > 0), `no compiler of the ${name} build was seen at any look, so the count can't speak for it\n${series}`);
  }
  const peak = seen.reduce((top, look) => (look.count > top.count ? look : top));
  const over = seen.filter((look) => look.count > POOL);
  t.diagnostic(`peak: ${shown(peak, seen[0])}`);
  assert.ok(!over.length, `at ${shown(peak, seen[0])}, ${peak.count} compiler processes ran at once, more than the pool's ${POOL} tokens; ${over.length} of ${seen.length} looks were above ${POOL}: ${over.map((look) => shown(look, seen[0])).join(', ')}\n${series}`);
  // Admitted together and under way together: some look saw both builds compile.
  assert.ok(seen.some((look) => BUILDS.every((name) => look.by[name] > 0)), `no look saw both builds compile at once, so the two weren't admitted together and the count speaks for one build at a time\n${series}\n${all()}`);

  // The pool was in force: the third build, admitted beside them, started only once one of the two had ended, however
  // long that took, and never read INCONCLUSIVE.
  assert.ok(third, `the two builds were never under way together, so no third build asked beside them\n${all()}`);
  const [taken, freed] = [startOf(box, 'third'), Math.min(...BUILDS.map((name) => endOf(box, name).at))];
  assert.ok(taken && taken.at >= freed && third.status === 0, `the third build, ${third.named}, asked while the two builds held the pool's ${POOL} tokens, didn't wait for its turn and then run (exit ${third.status}; its start: ${taken?.at}; the first build's end: ${freed})\n${all()}`);
  assert.doesNotMatch(third.output(), /INCONCLUSIVE/, `the third build, ${third.named}, printed an INCONCLUSIVE line, though it was admitted: its turn has no wait limit\n${all()}`);
});
