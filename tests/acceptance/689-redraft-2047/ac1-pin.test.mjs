// #689 AC1 #689.6c214cc8: `rustc --version` run at the repository root reports `1.99.1`.
// Run: node --test tests/acceptance/689-redraft-2047/ac1-pin.test.mjs   (README.md beside this file)
//
// rustc through rustup's proxy at the checkout's root, twice, never installing anything:
// - as the person runs it, with their own rustup home: what any rustup default would answer is overruled only by the
//   checkout itself, so the version must be 1.99.1;
// - with a rustup home of the test's own that holds the user's installed 1.99.1 toolchain and nothing else, and no
//   default: only a pin in the checkout can choose a toolchain there, so a checkout that leaves the choice to rustup's
//   default (or pins `stable`, or another release) gets no rustc at all. On a machine whose default is 1.99.1 the first
//   run alone can't tell a pin from the default; this one can.
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC1, MINUTE, PIN, ROOT, childEnv, inconclusive, makeBox, pinnedInstalled, run, rustupBin, shown, userCargoHome, userRustupHome, withPath } from './helpers.mjs';

const VERSION = /^rustc (\d+\.\d+\.\d+)(?:-\S+)? \(/m;
const NOT_INSTALLED = /toolchain '([^']+)' is not installed/;

test(`${AC1} rustc --version run at the repository root reports 1.99.1, chosen by the checkout itself`, { timeout: 10 * MINUTE }, (t) => {
  const bin = rustupBin();
  const names = pinnedInstalled();
  const box = makeBox(t, 'ac1');

  // As the person runs it: their rustup home, at the root.
  const own = run('rustc', ['--version'], { cwd: ROOT, env: childEnv({ PATH: withPath(bin), RUSTUP_HOME: userRustupHome(), CARGO_HOME: userCargoHome() }), log: join(box, 'own.log'), timeout: 2 * MINUTE });
  if (own.error || own.signal) inconclusive(`rustc --version could not run: ${own.error?.message ?? own.signal}`);
  const asked = own.out.match(NOT_INSTALLED)?.[1];
  if (asked?.startsWith(`${PIN}-`)) inconclusive(`rustup asks for ${asked}, which isn't installed in ${userRustupHome()}: ${shown(own)}`);
  assert.equal(own.status, 0, `rustc --version at the repository root gives no version: ${shown(own)}`);
  assert.equal(own.out.match(VERSION)?.[1], PIN, `rustc --version at the repository root reports ${own.out.trim()}, not ${PIN}`);

  // A rustup home holding only the installed 1.99.1 toolchain, linked, and no default: only the checkout can choose it.
  const isolated = join(box, 'rustup');
  mkdirSync(join(isolated, 'toolchains'), { recursive: true });
  for (const name of names) symlinkSync(join(userRustupHome(), 'toolchains', name), join(isolated, 'toolchains', name));
  const pinned = run('rustc', ['--version'], { cwd: ROOT, env: childEnv({ PATH: withPath(bin), RUSTUP_HOME: isolated, CARGO_HOME: userCargoHome() }), log: join(box, 'pinned.log'), timeout: 2 * MINUTE });
  if (pinned.error || pinned.signal) inconclusive(`rustc --version could not run: ${pinned.error?.message ?? pinned.signal}`);
  assert.equal(pinned.status, 0, `with no default toolchain and only ${PIN} installed, rustc at the repository root has no toolchain: the checkout doesn't pin ${PIN}. ${shown(pinned)}`);
  assert.equal(pinned.out.match(VERSION)?.[1], PIN, `with only ${PIN} installed, rustc at the repository root reports ${pinned.out.trim()}`);
});
