// #3567, criterion 5: a run that ends inside the bound prints the lines it prints today, but for times, on the three
// fixture changes of #2673: one line in one hub source file, in one canvas crate and in one design doc. Each change is
// a commit above origin/main in a scratch repository, and the run is `node scripts/affected.mjs` with no path, as
// #2673 runs it, with DEEP_AFFECTED_MIN unset, and once more with a bound of 10 minutes that the run ends inside.
// TODAY holds what the base (f063c8098) prints there (BASE-FAILURE.txt shows these tests passing on it); the README
// says what stands for a time.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { affected, dump, sandbox, tree, WHOLE, WHOLE_MS } from './helpers.mjs';

// The hub's folder is put together here, and each fixture source below takes it by substitution, so that no literal
// of this file names the hub's package: the selection and the proof lanes read such a literal as a test that starts
// the real hub, and build its binaries for it (scripts/proof-binaries.mjs). The canvas crate is the fixture's own,
// deep-canvas-3567, for the same reason: no test here runs a crate of the workspace.
const HUB_DIR = ['packages', 'hub'].join('/');
const HUB = `${HUB_DIR}/src/core.mjs`;
const CRATE = 'deep-canvas-3567';
const CANVAS = `crates/${CRATE}/src/lib.rs`;
const DOC = 'docs/technical-design.md';
const HUB_VITEST = `${HUB_DIR}/test/core.test.ts`;
const HUB_NODE = 'tests/fixture-3567-hub.test.mjs';
const CANVAS_NODE = 'tests/fixture-3567-canvas.test.mjs';
// A failure of the canvas crate that main already has, so the run reads it apart, as KNOWN.
const KNOWN_ID = `cargo -p ${CRATE} --lib › tests::known`;
const KNOWN_WHY = 'a failure the fixture plants on main (#3567)';

const FILES = {
  [HUB]: '// The hub\'s core, as far as a selection needs one.\nexport const lanes = () => 3;\n',
  [HUB_VITEST]: `import { expect, test } from 'vitest';\nimport { lanes } from '../src/core.mjs';\ntest('the hub has its lanes', () => { expect(lanes()).toBe(3); });\n`,
  [HUB_NODE]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { lanes } from '../${HUB}';\ntest('the hub has its lanes', () => { assert.equal(lanes(), 3); });\n`,
  [`crates/${CRATE}/Cargo.toml`]: `[package]\nname = "${CRATE}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n`,
  [CANVAS]: '// The canvas core, as far as a selection needs one.\npub fn layers() -> u32 {\n    3\n}\n',
  [CANVAS_NODE]: `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\ntest('the canvas source names its layers', () => { assert.match(readFileSync('${CANVAS}', 'utf8'), /fn layers/); });\n`,
  [DOC]: '# Technical design\n\nThe design, as far as a selection needs one.\n',
};
// What `cargo test` prints for the canvas crate: one test passes, and one fails that main already has.
const CARGO_TEST = `     Running unittests src/lib.rs (target/debug/deps/${CRATE.replaceAll('-', '_')}-0123456789abcdef)

running 2 tests
test tests::layers ... ok
test tests::known ... FAILED

failures:

---- tests::known stdout ----

thread 'tests::known' panicked at ${CANVAS}:9:9:
planted: main already fails this

failures:
    tests::known

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass \`-p ${CRATE} --lib\`
`;
// Each change is one line of one file.
const CHANGES = {
  hub: [HUB, FILES[HUB].replace('as far as a selection needs one', 'as far as a run needs one')],
  canvas: [CANVAS, FILES[CANVAS].replace('as far as a selection needs one', 'as far as a run needs one')],
  doc: [DOC, FILES[DOC].replace('as far as a selection needs one', 'as far as a run needs one')],
};

const TIMED = '<the TIMED line: the timed list, as scripts/lanes.mjs holds it>';
const SUMMARY_TAIL = 'in <n> s at load <n>; logs in <sandbox>/tmp/deep-affected-<random>';
const NO_LIST = 'SETTLED no list: <sandbox>/user/.deepbuild/main-watch/settled.json is missing, so every suite the change reaches runs';
// The lines the base prints, in order, and its exit status.
const TODAY = {
  hub: {
    status: 0,
    lines: [
      `parallel vitest: ${HUB_VITEST}`,
      `parallel node: ${HUB_NODE}`,
      NO_LIST,
      TIMED,
      `PASS affected: 0 new, 0 already failing on main, 0 inconclusive or blocked, 0 listed skips, 2 passed, ${SUMMARY_TAIL}`,
    ],
  },
  canvas: {
    status: 0,
    lines: [
      `parallel node: ${CANVAS_NODE}`,
      `parallel cargo test: ${CRATE}`,
      NO_LIST,
      `KNOWN ${KNOWN_ID}: ${KNOWN_WHY}`,
      TIMED,
      `NO NEW FAILURES affected: 0 new, 1 already failing on main, 0 inconclusive or blocked, 0 listed skips, 2 passed, ${SUMMARY_TAIL}`,
    ],
  },
  doc: {
    status: 0,
    lines: [
      NO_LIST,
      TIMED,
      `PASS affected: 0 new, 0 already failing on main, 0 inconclusive or blocked, 0 listed skips, 0 passed, ${SUMMARY_TAIL}`,
    ],
  },
};

/**
 * The run's lines with what isn't the run's own to say taken out: the seconds it took and the load it read (`in <n> s
 * at load <n>`), the sandbox's folder, the random name of its logs folder, and the TIMED line, which must be the
 * tree's own timed list, whole.
 */
function printed(box, fixture, run) {
  const timed = `TIMED the timed list, from scripts/lanes.mjs (${fixture.timed.length}): ${fixture.timed.join(' ')}`;
  return run.stdout.replace(/\n$/, '').split('\n').map((line) => (line === timed ? TIMED : line
    .replaceAll(box.dir, '<sandbox>')
    .replace(/\bin \d+ s at load \d+(?=;)/, 'in <n> s at load <n>')
    .replace(/(?<=\/tmp\/deep-affected-)\w+$/, '<random>')));
}

/** One fixture change of #2673, committed above origin/main, then `node scripts/affected.mjs` with no path, under `env`. */
async function expectToday(t, name, env = {}) {
  const box = sandbox(t);
  const fixture = tree(box, FILES, { known: { [KNOWN_ID]: KNOWN_WHY }, crates: [{ name: CRATE }], cargoTest: CARGO_TEST });
  const [path, content] = CHANGES[name];
  writeFileSync(join(fixture.cwd, path), content);
  fixture.git('commit', '-qam', `one line of ${path}`);
  const changed = fixture.git('diff', '--numstat', 'origin/main', 'HEAD').trim();
  assert.equal(changed, `1\t1\t${path}`, `the fixture change isn't one line of ${path}`);

  const run = await affected(box, fixture, [], { env, limit: WHOLE_MS });
  const all = () => dump(box, run);
  assert.ok(!run.limited, `the run on the ${name} change did not end within ${WHOLE_MS / 1000} s, though nothing in it runs that long: it no longer ends as it does today\n${all()}`);
  assert.deepEqual(printed(box, fixture, run), TODAY[name].lines, `the run on the one-line change to ${path} ended inside its bound, but doesn't print the lines it prints today\n${all()}`);
  assert.equal(run.status, TODAY[name].status, `the run on the one-line change to ${path} exited ${run.status}, not ${TODAY[name].status} as today\n${all()}`);
}

test('#3567.4cd7e4a4 a one-line change to a hub source file: the run ends inside the bound and prints the lines it prints today, but for times', WHOLE, async (t) => {
  await expectToday(t, 'hub');
});

test('#3567.4cd7e4a4 a one-line change to a canvas crate: the run ends inside the bound and prints the lines it prints today, but for times', WHOLE, async (t) => {
  await expectToday(t, 'canvas');
});

test('#3567.4cd7e4a4 a one-line change to a design doc: the run ends inside the bound and prints the lines it prints today, but for times', WHOLE, async (t) => {
  await expectToday(t, 'doc');
});

test('#3567.4cd7e4a4 the hub change again with DEEP_AFFECTED_MIN at 10 minutes: the run ends inside that bound and prints the same lines', WHOLE, async (t) => {
  await expectToday(t, 'hub', { DEEP_AFFECTED_MIN: '10' });
});
