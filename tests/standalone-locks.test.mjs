// #2469: a [patch] in .cargo/config.toml reaches every crate under the checkout, and cargo records each one a crate
// doesn't use as [[patch.unused]] in that crate's own Cargo.lock. So a patch added to the config leaves every
// standalone test crate's lock stale, and `cargo build --locked` there refuses ("cannot update the lock file"): its
// suite reads BLOCKED on every test. That happened after #1551, #358 and #503 (fixed by #2469) and again after #2359.
// This reads every standalone lock under tests/ as its suite's `--locked` build does, so the change that adds a patch
// fails here, naming the locks to refresh. A suite that builds its crate from outside the checkout (cwd in the system's
// temporary folder, as tests/acceptance/416/interfaces/wat.ts does) sees no config [patch]: its lock is current when
// cargo reads it as current from there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const STALE = /cannot update the lock file/;

/** Every Cargo.lock under tests/ that isn't a build product or a package's install. */
function locks(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return ['target', 'node_modules', '.git'].includes(entry.name) ? [] : locks(join(dir, entry.name));
    return entry.name === 'Cargo.lock' ? [dir] : [];
  });
}

/** `cargo metadata --locked --offline` for the crate in `dir`, run from `cwd`. */
function metadata(dir, cwd, env = {}) {
  const run = spawnSync('cargo', ['metadata', '--locked', '--offline', '--format-version', '1', '--manifest-path', join(dir, 'Cargo.toml')], {
    cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, env: { ...process.env, ...env },
  });
  return { ok: run.status === 0, why: run.error?.message ?? run.stderr.trim().split('\n').slice(-3).join(' ') };
}

test('every standalone crate under tests/ has a lock cargo --locked reads as current, so a config [patch] never leaves one stale', (t) => {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(root, 'rust-toolchain.toml'), 'utf8'))?.[1];
  assert.ok(channel, 'rust-toolchain.toml names a channel');
  const stale = [], blocked = [];
  for (const dir of locks(join(root, 'tests'))) {
    const name = relative(root, dir);
    const inside = metadata(dir, dir);
    if (inside.ok) continue;
    if (!STALE.test(inside.why)) { blocked.push(`${name}: ${inside.why}`); continue; }
    // Its suite may build it from outside the checkout, where no config [patch] applies.
    if (metadata(dir, tmpdir(), { RUSTUP_TOOLCHAIN: channel }).ok) continue;
    stale.push(name);
  }
  assert.deepEqual(stale, [], `these locks are stale for the checkout's .cargo/config.toml, so cargo build --locked refuses there. In each folder run \`cargo metadata --format-version 1 > /dev/null\` and check the diff adds only [[patch.unused]] entries:\n${stale.join('\n')}`);
  if (blocked.length) t.skip(`BLOCKED: cargo couldn't read these locks offline (fetch the crates once, or install the toolchain):\n${blocked.join('\n')}`);
});
