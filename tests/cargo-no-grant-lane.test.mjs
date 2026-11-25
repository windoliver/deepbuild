// #3333 off the Mac: a whole cargo test lane the throttle gave no build grant reads INCONCLUSIVE naming the grant. Its
// blind suite reads one run through cargoResults and readRun; this runs the real runLanes, whose `-- --list` of a whole
// cargo run asks the throttle again and, refused too, read BLOCKED off the Mac, over the grant. runLanes waits 30 min
// for a grant, so the throttle beside the lanes here is a stand-in that refuses at once with the throttle's own words.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = fileURLToPath(new URL('../', import.meta.url));
const REFUSAL = 'INCONCLUSIVE no grant: no build grant came within 30 min; blocked by build grant 0123456789abcdef held by pid 1 since 2026-11-23T00:00:00.000Z (cargo)';

test('a whole cargo test lane refused every build grant reads INCONCLUSIVE naming the grant off the Mac, never BLOCKED by its listing', { timeout: 120_000 }, (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-no-grant-lane-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The checkout's lanes, beside a throttle that grants nothing, exiting 3 as throttle.mjs does with no grant.
  cpSync(join(CHECKOUT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/throttle.mjs'), `console.log(${JSON.stringify(`${REFUSAL}\n  Fix: Wait for the other sessions' builds and proofs on this machine, then run again.`)});\nprocess.exit(3);\n`);
  // A one-package workspace, committed, for cargo metadata to read.
  const root = join(dir, 'workspace');
  const files = {
    'Cargo.toml': '[workspace]\nmembers = ["fixture"]\nresolver = "2"\n',
    'fixture/Cargo.toml': '[package]\nname = "fixture-no-grant"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n',
    'fixture/src/lib.rs': '#[test]\nfn runs() {}\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  const code = `Object.defineProperty(process, 'platform', { value: 'linux' });
    const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(dir, 'scripts/lanes.mjs')).href)});
    process.exitCode = runLanes([{ name: 'unit', commands: [['cargo', 'test', '--workspace', '--locked', '--no-fail-fast']], fix: 'none' }], { cwd: process.cwd() });`;
  const { DEEP_THROTTLE, DEEP_PROOF_VITEST_REPORT, NODE_TEST_CONTEXT, CARGO_TARGET_DIR, ...env } = process.env;
  const home = join(dir, 'home');
  mkdirSync(home);
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...env, HOME: home, CARGO_HOME: env.CARGO_HOME ?? join(homedir(), '.cargo'), RUSTUP_HOME: env.RUSTUP_HOME ?? join(homedir(), '.rustup') } });
  const output = ran.stdout + ran.stderr;
  const verdicts = output.split('\n').filter((line) => /^(PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) unit\b/.test(line));
  assert.equal(verdicts.length, 1, `the lane prints one verdict\n${output}`);
  assert.match(verdicts[0], /^INCONCLUSIVE unit\b.*no build grant came within 30 min/, `the lane reads INCONCLUSIVE, naming the grant\n${output}`);
  assert.doesNotMatch(output, /cargo could not list the tests/, `a run that never started is not listed\n${output}`);
});
