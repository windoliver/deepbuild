import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { build, dump, ended, endOf, running, sandbox, since, startOf, until } from '../3549/helpers.mjs';

const POOL = 2;
const BUILDS = ['first', 'second'];
const THIRD_WAIT = '15', BUILDS_MS = 12 * 60_000;
const LEAVES = 4 * POOL;
const LEAF_STEPS = 600_000, FIRST_STEPS = 4 * LEAF_STEPS;
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

function looks(box) {
  const seen = [], pending = new Set();
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

const shown = (look, first) => `look ${look.number} (${since(first.at, look.at)}): ${look.error ? 'ps failed' : `${look.count} (${Object.entries(look.by).map(([name, n]) => `${name} ${n}`).join(', ') || 'none'})`}`;

test('#3549.13a91455 two real cargo builds of a fixture workspace, admitted together on a pool of 2 tokens, never run more than 2 compiler processes between them at any look, and a third build asked beside them waits for its turn', { timeout: 19 * 60_000 }, async (t) => {
  const box = sandbox(t, { cores: POOL + 1 });
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
  const builds = BUILDS.map((name) => build(box, name, ['cargo', join(box.dir, `ws-${name}`)]));
  let third = null;
  const all = () => dump(box, builds, third);
  let seen;
  try {
    await until(() => BUILDS.every((name) => startOf(box, name)) || builds.some((child) => !running(child)), 3 * 60_000);
    if (BUILDS.every((name) => startOf(box, name))) third = build(box, 'third', ['exit'], THIRD_WAIT);
    const over = Date.now() + BUILDS_MS;
    for (const child of builds) assert.equal(await ended(child, over - Date.now()), 0, `the cargo build ${child.named} failed, or didn't end within ${BUILDS_MS / 60_000} min of both being under way\n${all()}`);
    if (third) await ended(third, 120_000);
  } finally {
    seen = await stop();
  }
  const series = `planted compiler processes at each look, one a second (${seen.length} looks, ${seen.filter((look) => look.error).length} failed): ${seen.filter((look) => look.count || look.error).map((look) => shown(look, seen[0])).join(', ') || 'none'}`;
  t.diagnostic(series);

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
  assert.ok(seen.some((look) => BUILDS.every((name) => look.by[name] > 0)), `no look saw both builds compile at once, so the two weren't admitted together and the count speaks for one build at a time\n${series}\n${all()}`);

  assert.ok(third, `the two builds were never under way together, so no third build asked beside them\n${all()}`);
  const [taken, freed] = [startOf(box, 'third'), Math.min(...BUILDS.map((name) => endOf(box, name).at))];
  assert.ok(taken && taken.at >= freed && third.status === 0, `the third build, ${third.named}, asked while the two builds held the pool's ${POOL} tokens, didn't wait for its turn and then run (exit ${third.status}; its start: ${taken?.at}; the first build's end: ${freed})\n${all()}`);
  assert.doesNotMatch(third.output(), /INCONCLUSIVE/, `the third build, ${third.named}, printed an INCONCLUSIVE line, though it was admitted and its turn came inside its wait of ${THIRD_WAIT} min\n${all()}`);
});
