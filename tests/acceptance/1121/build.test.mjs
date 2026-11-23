// AC1 (#1121.73d8f179): every crate of the workspace builds on the Spark. The real cargo builds the real workspace,
// past a crate that fails, and each workspace crate counts once cargo names what it built of it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { elsewhere, HOURS, PLATFORM, run, SPARK } from './helpers.mjs';

const BUILT = ['lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro', 'bin'];

test('#1121.73d8f179 every crate of the workspace builds on the Spark, 27 of 27 when the issue was written', HOURS, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const metadata = await run(['cargo', 'metadata', '--no-deps', '--format-version', '1', '--locked']);
  assert.equal(metadata.status, 0, `cargo metadata reads the workspace:\n${metadata.stderr}`);
  const { packages, workspace_members: members } = JSON.parse(metadata.stdout);
  // A crate counts when `cargo build` has something of it to build: a library or a binary.
  const crates = packages.filter((pkg) => members.includes(pkg.id) && pkg.targets.some((target) => target.kind.some((kind) => BUILT.includes(kind))));
  assert.ok(crates.length >= 27, `the workspace holds the issue's 27 crates or more: ${crates.length}`);

  const build = await run(['cargo', 'build', '--workspace', '--locked', '--keep-going', '--message-format=json']);
  const messages = build.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const made = new Set(messages.filter((message) => message.reason === 'compiler-artifact' && message.target.kind.some((kind) => BUILT.includes(kind))).map((message) => message.package_id));
  const failed = crates.filter((pkg) => !made.has(pkg.id)).map((pkg) => pkg.name).sort();
  const errors = build.stderr.split('\n').filter((line) => /^error(?:\[E\d+\])?:/.test(line)).slice(0, 20).join('\n');
  assert.deepEqual(failed, [], `${crates.length - failed.length} of ${crates.length} crates build on ${PLATFORM}; these don't: ${failed.join(', ')}\n${errors}`);
  assert.equal(build.status, 0, `cargo build --workspace --locked exits 0:\n${errors}`);
});
