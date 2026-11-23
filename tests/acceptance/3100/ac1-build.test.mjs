// #3100 #3100.18bcb434: `cargo build --workspace --locked` succeeds natively on main.
// Run: node --test tests/acceptance/3100/ac1-build.test.mjs   (README.md beside this file; it builds the whole workspace,
// minutes on a warm target/, hours cold, after waiting for the machine's build grant)
//
// The issue's command at the checkout's root, with the checkout's toolchain, for the machine's own target (no --target,
// no CARGO_BUILD_TARGET), as a lane runs it: a build grant of the throttle, the lease script, nice 10. Success is exit 0.
// A run the machine stopped or kept from starting (no grant, a time limit, a signal, a missing toolchain, crates that
// can't be fetched, a full disk, a compiler the system killed) reads INCONCLUSIVE.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC1, WORKSPACE_TEST, cameToItsEnd, childEnv, inconclusive, machineMark, rustupBin, shown, workspaceCargo } from './helpers.mjs';

test(`${AC1} cargo build --workspace --locked succeeds natively on main`, { timeout: WORKSPACE_TEST }, () => {
  const env = childEnv(rustupBin());
  const ran = workspaceCargo('ac1-cargo-build', ['cargo', 'build', '--workspace', '--locked'], env);
  cameToItsEnd('cargo build --workspace --locked', ran);
  const mark = machineMark(ran);
  if (mark) inconclusive(`cargo build --workspace --locked couldn't run here (${mark}). ${shown(ran)}`);
  const crates = [...new Set([...ran.out.matchAll(/^error: could not compile `([^`]+)`/gm)].map(([, name]) => name))];
  const errors = ran.out.split('\n').filter((line) => /^error(\[\w+\])?: /.test(line) && !line.startsWith('error: could not compile')).slice(0, 12);
  assert.equal(ran.status, 0, `cargo build --workspace --locked fails natively${crates.length ? `; it can't compile ${crates.join(', ')}` : ''}: ${errors.join(' | ')}. ${shown(ran)}`);
});
