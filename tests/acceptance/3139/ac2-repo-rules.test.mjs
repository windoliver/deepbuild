// #3139 AC2, the repo rules in scratch repositories (README: AC2, planted). The decision: for `deps`, twins' manifests
// are out, while a suite's own tooling crate is a new dependency that needs its row in scripts/repo-rules.json; for
// `secrets`, the rule keeps judging all of tests/acceptance/. Outside tests/acceptance/ an unlisted dependency and a
// home path still fail. A scratch repository holds no SECURITY.md, cards or physics build, so its run fails on those
// checks whatever is planted: the tests judge the deps and secrets lines, never the exit code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADDED, AC2, HOME, PLANT, RULES, RULES_CONFIG, assertDepsRan, commit, findings, json, naming, put, rulesConfig, run, scratch, show } from './helpers.mjs';

const ROOT = { 'package.json': json({ name: 'fixture-root', private: true }) };
const npm = (name, deps) => json({ name, version: '0.0.0', private: true, dependencies: deps });
const crate = (name, deps) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n${Object.entries(deps).map(([dep, spec]) => `${dep} = "${spec}"\n`).join('')}`;
const row = (spec) => ({ spec, why: "Issue #3139's blind suite: a made-up dependency of a scratch repository." });
const SHOWN = { checks: ['deps', 'secrets'] };

/** The deps check reads PASS: a PASS deps line and no deps line in a failing state. */
function assertDepsPass(result, why) {
  assertDepsRan(result);
  assert.deepEqual(findings(result, 'deps'), [], `${why}\n${show(result, SHOWN)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS deps')), `no PASS deps line ${why}\n${show(result, SHOWN)}`);
}

const TWIN_NPM = `${PLANT}twins/copies-a-package/packages/fixture/package.json`;
const TWIN_CARGO = `${PLANT}twins/copies-a-crate/crates/fixture/Cargo.toml`;
const TOOL = `${PLANT}tool/Cargo.toml`; // a suite's own tooling crate

test(`${AC2} AC2: the deps rule leaves out twins' manifests, a package.json and a Cargo.toml with an unlisted dependency, and still judges a suite's own tooling crate, which passes once it has its row`, (t) => {
  const cwd = scratch(t, ROOT, { [RULES_CONFIG]: rulesConfig() });
  commit(cwd, {
    [TWIN_NPM]: npm('@fixture/copy', { 'fixture-unlisted': '1.0.0' }),
    [TWIN_CARGO]: crate('fixture-copy', { 'fixture-unlisted': '=1.0.0' }),
    [TWIN_CARGO.replace('Cargo.toml', 'src/lib.rs')]: '',
    [TOOL]: crate('fixture-tool', { 'fixture-unlisted': '=1.0.0' }),
    [TOOL.replace('Cargo.toml', 'src/main.rs')]: 'fn main() {}\n',
  });

  const result = run(RULES, cwd);
  assertDepsRan(result);
  assert.ok(naming(result, 'deps', `${TOOL} dependencies fixture-unlisted`).some((line) => line.startsWith('FAIL ')), `no FAIL deps line names ${TOOL}'s unlisted dependency: a suite's own tooling crate is a new dependency that needs its row\n${show(result, SHOWN)}`);
  assert.deepEqual([...naming(result, 'deps', TWIN_NPM), ...naming(result, 'deps', TWIN_CARGO)], [], `a deps line names a twin's manifest, which the decision leaves out\n${show(result, SHOWN)}`);

  put(cwd, RULES_CONFIG, rulesConfig({ [TOOL]: { dependencies: { 'fixture-unlisted': row('=1.0.0') } } }));
  assertDepsPass(run(RULES, cwd), `(${TOOL}'s dependency has its row; the twins' manifests are out)`);
});

test(`${AC2} AC2: the deps rule still fails an unlisted dependency planted outside tests/acceptance/, in a package.json and in a Cargo.toml under a twins/ folder there`, (t) => {
  const NPM = 'packages/fixture/package.json';
  const CARGO = 'tools/twins/copy/crates/fixture/Cargo.toml'; // a twins/ folder outside tests/acceptance/
  const listed = { 'fixture-listed': '1.0.0' };
  const cwd = scratch(t, {
    ...ROOT,
    [NPM]: npm('@fixture/package', listed),
    [CARGO]: crate('fixture-crate', { 'fixture-listed': '=1.0.0' }),
    [CARGO.replace('Cargo.toml', 'src/lib.rs')]: '',
  }, { [RULES_CONFIG]: rulesConfig({ [NPM]: { dependencies: { 'fixture-listed': row('1.0.0') } }, [CARGO]: { dependencies: { 'fixture-listed': row('=1.0.0') } } }) });
  assertDepsPass(run(RULES, cwd), `(${NPM} and ${CARGO} declare only their listed dependency)`);

  put(cwd, NPM, npm('@fixture/package', { ...listed, 'fixture-unlisted': '1.0.0' }));
  const npmResult = run(RULES, cwd);
  assertDepsRan(npmResult);
  assert.ok(naming(npmResult, 'deps', `${NPM} dependencies fixture-unlisted`).some((line) => line.startsWith('FAIL ')), `no FAIL deps line names ${NPM}'s planted unlisted dependency\n${show(npmResult, SHOWN)}`);
  put(cwd, NPM, npm('@fixture/package', listed));

  put(cwd, CARGO, crate('fixture-crate', { 'fixture-listed': '=1.0.0', 'fixture-unlisted': '=1.0.0' }));
  const cargoResult = run(RULES, cwd);
  assertDepsRan(cargoResult);
  assert.ok(naming(cargoResult, 'deps', `${CARGO} dependencies fixture-unlisted`).some((line) => line.startsWith('FAIL ')), `no FAIL deps line names ${CARGO}'s planted unlisted dependency: a twins/ folder outside tests/acceptance/ holds no planted twin\n${show(cargoResult, SHOWN)}`);
});

/** A run record: a failing test's line names where the file was, under `home` on line 2. */
const record = (home) => [
  'Acceptance tests for #3139-plant on the base, run with Node 24.',
  `not ok 1 - reads the record (${home}dev/deepbuild/tests/acceptance/3139-plant/record.test.mjs:12:5)`,
  '',
].join('\n');
/** A twin's copy of a source file that names a folder under `home` on line 2. */
const twinSource = (home) => [
  '// The folder the fixture reads.',
  `export const where = '${home}dev/fixture';`,
  '',
].join('\n');
/** Notes outside tests/acceptance/, with a path under `home` on line 2. */
const notes = (home) => ['# Notes', `The build ran in ${home}dev/deepbuild.`, ''].join('\n');

test(`${AC2} AC2: the secrets rule keeps judging all of tests/acceptance/, a run record the merge base holds, one the change adds and a twin's file, and still fails a home path planted outside tests/acceptance/`, (t) => {
  const HELD = `${PLANT}BASE-FAILURE.txt`;
  const TWIN = `${PLANT}twins/copy/packages/fixture/src/where.ts`;
  const NEW = `${ADDED}BASE-FAILURE.txt`;
  const OUTSIDE = 'docs/notes.md';
  const cwd = scratch(t, { ...ROOT, [HELD]: record('~/'), [TWIN]: twinSource('~/'), [OUTSIDE]: notes('~/') }, { [RULES_CONFIG]: rulesConfig() });
  commit(cwd, { [NEW]: record('~/') });
  const clean = run(RULES, cwd);
  assert.deepEqual(findings(clean, 'secrets'), [], `the files write their home folder as ~, which is no home path\n${show(clean, SHOWN)}`);
  assert.ok(clean.lines.some((line) => line.startsWith('PASS secrets')), `no PASS secrets line\n${show(clean, SHOWN)}`);

  for (const [path, text] of [[HELD, record(HOME)], [TWIN, twinSource(HOME)], [NEW, record(HOME)], [OUTSIDE, notes(HOME)]]) put(cwd, path, text);
  const planted = run(RULES, cwd);
  const missing = [HELD, TWIN, NEW, OUTSIDE].filter((path) => !naming(planted, 'secrets', `${path}:2:`).some((line) => line.startsWith('FAIL ') && line.endsWith('home path')));
  assert.deepEqual(missing, [], `no FAIL secrets line names line 2 of each file holding a planted home path (the value is left out here)\n${show(planted, SHOWN)}`);
});
