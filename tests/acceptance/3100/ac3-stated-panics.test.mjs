// #3100 #3100.89720c19: a cargo test that panics with `INCONCLUSIVE:` or `BLOCKED:` is read as INCONCLUSIVE or BLOCKED
// by the unit lane, never FAIL and never PASS.
// Run: node --test tests/acceptance/3100/ac3-stated-panics.test.mjs   (README.md beside this file; under a minute)
//
// A throwaway crate with no dependencies, in a folder of the test's own, built with the checkout's toolchain file, as the
// workspace's own runs are. Its tests panic with `INCONCLUSIVE: …` and `BLOCKED: …` (by `panic!` and by `assert!`'s
// message), beside a plain failure and two passes, in two targets: the library's, where nothing fails plainly, and an
// integration test where a stated panic sits beside a plain failure. The unit lane's own cargo command runs them, for
// real, and the unit lane's reader (`cargoResults`, given the crate by `crates()`) reads the output. Each stated panic
// must read as the state it names, INCONCLUSIVE as INCONCLUSIVE and BLOCKED as BLOCKED, and as nothing else: no FAIL
// under its ID or its target's, and no pass. The plain failure must still read FAIL and the passes PASS, so a reader
// that reads every failure as unproven, or drops them, fails too.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC3, MINUTE, ROOT, childEnv, inconclusive, machineMark, makeBox, readCargo, run, rustupBin, shown } from './helpers.mjs';

const CRATE = {
  'Cargo.toml': `[package]
name = "probe3100"
version = "0.0.0"
edition = "2021"
publish = false

# A workspace of its own, wherever the folder is.
[workspace]
`,
  'src/lib.rs': `//! #3100's probe: tests that end as the workspace's own do when they can prove nothing here.

#[cfg(test)]
mod tests {
    #[test]
    fn under_load() {
        panic!("INCONCLUSIVE: 52 ms against the 50 ms budget, read at load 300, not on the reference Mac");
    }

    #[test]
    fn needs_a_person() {
        let person_at_the_mac = false;
        assert!(person_at_the_mac, "BLOCKED: setup: the check needs a person at the Mac");
    }

    #[test]
    fn passes() {
        assert_eq!(2 + 2, 4);
    }
}
`,
  'tests/plain.rs': `//! #3100's probe: a plain failure, a stated panic beside it, and a pass, in a target of their own.

#[test]
fn fails_plainly() {
    assert_eq!(1 + 1, 3, "a plain failure: the sum is wrong");
}

#[test]
fn inconclusive_beside_a_failure() {
    panic!("INCONCLUSIVE: the reading was taken under load");
}

#[test]
fn passes_too() {}
`,
};

const LIB = 'cargo -p probe3100 --lib';
const PLAIN = 'cargo -p probe3100 --test plain';
/** Each probe test by the ID the reader gives it, and the one reading it must have. */
const EXPECTED = {
  [`${LIB} › tests::under_load`]: 'INCONCLUSIVE',
  [`${LIB} › tests::needs_a_person`]: 'BLOCKED',
  [`${PLAIN} › inconclusive_beside_a_failure`]: 'INCONCLUSIVE',
  [`${PLAIN} › fails_plainly`]: 'FAIL',
  [`${LIB} › tests::passes`]: 'PASS',
  [`${PLAIN} › passes_too`]: 'PASS',
};
/** The only IDs a FAIL may stand under: the plain failure, and the target that holds it. */
const MAY_FAIL = [`${PLAIN} › fails_plainly`, PLAIN];

test(`${AC3} a cargo test that panics with INCONCLUSIVE: or BLOCKED: is read as INCONCLUSIVE or BLOCKED by the unit lane, never FAIL and never PASS`, { timeout: 30 * MINUTE }, async (t) => {
  const env = childEnv(rustupBin());
  const box = makeBox(t, 'ac3');
  const crate = join(box, 'probe3100');
  for (const [path, text] of Object.entries(CRATE)) {
    mkdirSync(join(crate, path, '..'), { recursive: true });
    writeFileSync(join(crate, path), text);
  }
  // The checkout's toolchain, so the probe's output is cargo test's as the workspace's runs print it.
  if (existsSync(join(ROOT, 'rust-toolchain.toml'))) copyFileSync(join(ROOT, 'rust-toolchain.toml'), join(crate, 'rust-toolchain.toml'));
  const probeEnv = { ...env, CARGO_TARGET_DIR: join(box, 'target') };

  const lock = run('cargo', ['generate-lockfile', '--offline'], { cwd: crate, env: probeEnv, timeout: 5 * MINUTE, log: join(box, 'lock.log') });
  if (lock.status !== 0) inconclusive(`cargo couldn't start the probe crate here: ${shown(lock)}`);
  // The unit lane's cargo command (scripts/lanes.mjs, the unit lane), in the probe's own workspace.
  const ran = run('cargo', ['test', '--workspace', '--locked', '--no-fail-fast'], { cwd: crate, env: probeEnv, timeout: 20 * MINUTE, log: join(box, 'test.log') });
  if (ran.error || ran.signal || ran.timedOut) inconclusive(`the probe's cargo test didn't come to its own end: ${ran.error?.message ?? ''} ${shown(ran)}`);
  const mark = machineMark(ran);
  if (mark) inconclusive(`the probe's cargo test couldn't run here (${mark}): ${shown(ran)}`);
  assert.ok(/^test result: /m.test(ran.out) && ran.status !== 0, `the probe's tests didn't run as written (a plain failure among them must end cargo test nonzero): ${shown(ran)}`);

  const { failures, passed } = await readCargo(crate, ran.out, ran.status, probeEnv);
  const readings = new Map();
  const add = (id, state) => readings.set(id, [...(readings.get(id) ?? []), state]);
  for (const id of passed) add(id, 'PASS');
  for (const { id, state } of failures) add(id, state);
  const all = [...readings].map(([id, states]) => `${id}: ${states.join(', ')}`).join('\n');

  const got = Object.fromEntries(Object.keys(EXPECTED).map((id) => [id, (readings.get(id) ?? ['(not read)']).join(', ')]));
  assert.deepEqual(got, EXPECTED, `the unit lane's reader reads the probe's tests otherwise. All it read:\n${all}\ncargo test's output: ${shown(ran)}`);
  const failed = failures.filter(({ id, state }) => state === 'FAIL' && !MAY_FAIL.includes(id)).map(({ id, message }) => `${id}${message ? `: ${message}` : ''}`);
  assert.deepEqual(failed, [], `the unit lane's reader reads FAIL where only a stated panic ended a test. All it read:\n${all}`);
});
