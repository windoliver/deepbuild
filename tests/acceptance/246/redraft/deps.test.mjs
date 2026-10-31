// #246 acceptance, blind redraft of three deps criteria for a world where #879's cards rule holds:
// every folder planted under packages/ or crates/ carries a minimal card, so the cards rule can't
// be what fails or passes these tests. The rules are reached only by running
// `node scripts/repo-rules.mjs` in a scratch git repository, through ../helpers.mjs.
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FIX, NPM12, assertLine, assertNoState, repo, rules, rulesFile, show, write } from '../helpers.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// #879's card: four level-2 headings, and a Deviations section holding only `None.`.
const card = (name) => `# ${name}

## What it is for

A fixture for the #246 deps tests.

## Where new code goes

Nowhere; it is a fixture.

## What it may import

What scripts/repo-rules.json lists for it.

## Deviations

None.
`;

const manifest = (name, tables = '') => `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\n\n${tables}`;
const crateFiles = (name, tables) => ({
  [`crates/${name}/README.md`]: card(name),
  [`crates/${name}/Cargo.toml`]: manifest(name, tables),
  [`crates/${name}/src/lib.rs`]: '',
});

const NOT_PASS = /^(?:FAIL|INVALID|BLOCKED) /m;
const depsPass = (packageFiles, crates) =>
  new RegExp(`^PASS deps: ${packageFiles} package\\.json files? and ${crates} crates? match scripts/repo-rules\\.json$`, 'm');

// "Passes", as the other #246 tests read it: exit 0 and no FAIL, INVALID or BLOCKED line from any check.
function assertPasses(result, packageFiles, crates) {
  assert.equal(result.status, 0, show(result));
  assert.doesNotMatch(result.stdout, NOT_PASS, show(result));
  assert.match(result.stdout, depsPass(packageFiles, crates), show(result));
}

const failDeps = (result) => result.lines.filter((line) => line.startsWith('FAIL deps: '));

test('a new packages/x/package.json with a dependencies entry fails, and one with none passes', (t) => {
  // #246: "With scripts/repo-rules.json holding #12's three devDependencies".
  const cwd = repo(t, { tracked: {
    'package.json': json({ name: 'fixture', private: true, devDependencies: NPM12 }),
    'scripts/repo-rules.json': rulesFile({ deps: { 'package.json': { devDependencies: NPM12 } } }),
  } });
  assertPasses(rules(cwd), 1, 0);

  write(cwd, {
    'packages/x/README.md': card('x'),
    'packages/x/package.json': json({ name: 'x', private: true, dependencies: { 'left-pad': '1.3.0' } }),
  });
  const withEntry = rules(cwd);
  assert.equal(withEntry.status, 1, show(withEntry));
  assertLine(withEntry, 'FAIL deps: packages/x/package.json dependencies left-pad 1.3.0 is not in scripts/repo-rules.json', FIX.deps);
  assertNoState(withEntry, 'PASS', 'deps');

  write(cwd, { 'packages/x/package.json': json({ name: 'x', private: true }) });
  assertPasses(rules(cwd), 2, 0);
});

test('a Rust dependency fails in each section that declares it, and passes once listed with spec ^1', (t) => {
  const sections = [
    ['[dependencies]', (word) => word === 'dependencies'],
    ['[dev-dependencies]', (word) => word.includes('dev-dependencies')],
    ["[target.'cfg(unix)'.dependencies]", (word) => word.includes('cfg(unix)')],
  ];
  const unlisted = /^FAIL deps: crates\/fx\/Cargo\.toml (\S+) serde \^1 is not in scripts\/repo-rules\.json$/;
  for (const [table, names] of sections) {
    const cwd = repo(t, { tracked: crateFiles('fx', `${table}\nserde = "1"\n`) });
    const result = rules(cwd);
    assert.equal(result.status, 1, `${table}\n${show(result)}`);
    const fails = failDeps(result);
    assert.equal(fails.length, 1, `${table}: one declaration, one FAIL deps line\n${show(result)}`);
    const match = fails[0].match(unlisted);
    assert.ok(match, `${table}: ${fails[0]}`);
    assert.ok(names(match[1]), `${table}: the FAIL line names ${match[1]}, not that section`);
    assertLine(result, fails[0], FIX.deps);
    assertNoState(result, 'PASS', 'deps');

    // Listed under the section word its FAIL line printed (246 README: "The rules file").
    writeFileSync(join(cwd, 'scripts/repo-rules.json'), rulesFile({ deps: { 'crates/fx/Cargo.toml': { [match[1]]: { serde: '^1' } } } }));
    const listed = rules(cwd);
    assertPasses(listed, 1, 1);
  }
});

test('a path dependency is listed relative to its manifest, and no absolute path is printed or listed', (t) => {
  const cwd = repo(t, { tracked: {
    ...crateFiles('fx', '[dependencies]\nhelper = { path = "../helper" }\n'),
    ...crateFiles('helper'),
  } });
  const roots = [...new Set([cwd, tmpdir(), realpathSync(tmpdir())])];
  const noAbsolute = (text, where) => {
    for (const absolute of roots) assert.ok(!text.includes(absolute), `${where} holds the absolute path ${absolute}`);
  };

  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = result.lines.find((text) => /^FAIL deps: crates\/fx\/Cargo\.toml dependencies helper .+ is not in scripts\/repo-rules\.json$/.test(text));
  assert.ok(line, show(result));
  assertLine(result, line, FIX.deps);
  assertNoState(result, 'PASS', 'deps');
  noAbsolute(result.out, 'the output');
  const spec = line.match(/ dependencies helper (.+) is not in /)[1];
  assert.ok(spec.includes('../helper'), `the spec ${JSON.stringify(spec)} doesn't hold ../helper, the path relative to crates/fx/Cargo.toml`);
  assert.doesNotMatch(spec, /(?:^|[^.\w])\//, `the spec ${JSON.stringify(spec)} holds an absolute path`);

  const list = rulesFile({ deps: { 'crates/fx/Cargo.toml': { dependencies: { helper: spec } } } });
  noAbsolute(list, 'scripts/repo-rules.json');
  writeFileSync(join(cwd, 'scripts/repo-rules.json'), list);
  const listed = rules(cwd);
  assertPasses(listed, 1, 2);
  noAbsolute(listed.out, 'the output');
});
