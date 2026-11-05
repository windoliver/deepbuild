// #879 acceptance: the card check in `node scripts/repo-rules.mjs`, run as a process in scratch
// git repositories that hold a copy of this checkout's script (#246's `repo` helper). Each
// repository is otherwise valid for the other rules: a root package.json and planted manifests
// with no dependencies, and a scripts/repo-rules.json that lists nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { repo, rules, rulesFile, show } from '../246/helpers.mjs';
import {
  HEADINGS, assertCardFail, assertCardPass, card, crate, failLines, lineOf, names, namesLine, npmPackage, stateLines,
} from './helpers.mjs';

const TALLY = 'packages/tally', COUNT = 'packages/count', CORE = 'crates/tally-core';
const carded = (dir, options) => ({ [`${dir}/README.md`]: card(dir.split('/').at(-1), options) });

// --- AC2: a package or crate without a card ------------------------------------------------------

test('AC2: a planted package without a card fails the lint rules, naming it, and its carded neighbours are not named', (t) => {
  const cwd = repo(t, { tracked: { ...npmPackage(TALLY), ...npmPackage(COUNT), ...carded(COUNT), ...crate(CORE), ...carded(CORE) } });
  const result = rules(cwd);
  assertCardFail(result, `${TALLY} without a card`, (line) => names(line, TALLY));
  for (const other of [COUNT, CORE])
    assert.ok(!failLines(result).some((line) => names(line, other)), `a FAIL cards line names ${other}, which has its card\n${show(result)}`);
});

test('AC2: a planted crate without a card fails the lint rules, naming it', (t) => {
  const cwd = repo(t, { tracked: { ...npmPackage(TALLY), ...carded(TALLY), ...crate(CORE) } });
  const result = rules(cwd);
  assertCardFail(result, `${CORE} without a card`, (line) => names(line, CORE));
  assert.ok(!failLines(result).some((line) => names(line, TALLY)), `a FAIL cards line names ${TALLY}, which has its card\n${show(result)}`);
});

test('AC2: a folder under packages/ with no package.json still needs a card', (t) => {
  const cwd = repo(t, { tracked: { ...npmPackage(TALLY), ...carded(TALLY), ...crate(CORE), ...carded(CORE), 'packages/notes/src/index.ts': 'export const notes = 0;\n' } });
  assertCardFail(rules(cwd), 'packages/notes without a card', (line) => names(line, 'packages/notes'));
});

// --- AC2: a card without one of its headings ----------------------------------------------------

test('AC2: a card without its deviations heading fails, naming the heading, and the same card with it passes (an exists-only check cannot do both)', (t) => {
  const base = { ...npmPackage(TALLY), ...crate(CORE), ...carded(CORE) };
  const without = rules(repo(t, { tracked: { ...base, ...carded(TALLY, { omit: 'Deviations' }) } }));
  assertCardFail(without, `${TALLY}'s card without ## Deviations`, (line) => names(line, TALLY) && /deviations/i.test(line));

  const twin = rules(repo(t, { tracked: { ...base, ...carded(TALLY) } }));
  assertCardPass(twin, 'the same card with ## Deviations (and None. under it)');
});

test("AC2: a crate's card without its deviations heading fails, naming the crate and the heading", (t) => {
  const result = rules(repo(t, { tracked: { ...npmPackage(TALLY), ...carded(TALLY), ...crate(CORE), ...carded(CORE, { omit: 'Deviations' }) } }));
  assertCardFail(result, `${CORE}'s card without ## Deviations`, (line) => names(line, CORE) && /deviations/i.test(line));
});

for (const heading of HEADINGS.filter((heading) => heading !== 'Deviations')) {
  test(`scope: a card without "## ${heading}" fails, naming the package and the heading`, (t) => {
    const result = rules(repo(t, { tracked: { ...npmPackage(TALLY), ...carded(TALLY, { omit: heading }), ...crate(CORE), ...carded(CORE) } }));
    assertCardFail(result, `${TALLY}'s card without ## ${heading}`, (line) => names(line, TALLY) && line.toLowerCase().includes(heading.toLowerCase()));
  });
}

// --- AC3: a deviation whose file is gone ---------------------------------------------------------

const KEPT = ['src/index.ts', 'keeps its imports unsorted on purpose, so the loader order stays fixed.'];
const LEGACY = ['src/legacy-order.ts', 'keeps the old export order for callers pinned to it.'];

test("AC3: a deviation naming src/legacy-order.ts, which the package doesn't have, fails naming the package and the deviation's line; once the file exists it passes", (t) => {
  const text = card('tally', { deviations: [KEPT, LEGACY] });
  const line = lineOf(text, '`src/legacy-order.ts`');
  assert.ok(line > lineOf(text, '## Deviations') + 2, 'the planted deviation sits below the heading and the first deviation');
  const base = { ...npmPackage(TALLY), [`${TALLY}/README.md`]: text, ...crate(CORE), ...carded(CORE) };

  const missing = rules(repo(t, { tracked: base }));
  assertCardFail(missing, `${TALLY}'s deviation at line ${line} naming a missing file`, (failed) => names(failed, TALLY) && namesLine(failed, line));

  const present = rules(repo(t, { tracked: { ...base, [`${TALLY}/src/legacy-order.ts`]: 'export const order = [];\n' } }));
  assertCardPass(present, 'the same deviation once src/legacy-order.ts exists');
});

test("AC3: a crate's deviation naming a file the crate doesn't have fails naming the crate and the line; once the file exists it passes", (t) => {
  const text = card('tally-core', { deviations: [['src/lib.rs', 'keeps one function per file on purpose.'], ['src/legacy_order.rs', 'keeps the old order for pinned callers.']] });
  const line = lineOf(text, '`src/legacy_order.rs`');
  const base = { ...npmPackage(TALLY), ...carded(TALLY), ...crate(CORE), [`${CORE}/README.md`]: text };

  const missing = rules(repo(t, { tracked: base }));
  assertCardFail(missing, `${CORE}'s deviation at line ${line} naming a missing file`, (failed) => names(failed, CORE) && namesLine(failed, line));

  const present = rules(repo(t, { tracked: { ...base, [`${CORE}/src/legacy_order.rs`]: 'pub const ORDER: [u32; 0] = [];\n' } }));
  assertCardPass(present, 'the same deviation once src/legacy_order.rs exists');
});

// --- Scope: imports stay the dependency rule's -------------------------------------------------

test("scope: a card's import section is never checked against what the package declares; the deps rule alone reads that", (t) => {
  // tally declares a listed dependency its card doesn't mention; count's card mentions one count doesn't declare.
  const tally = npmPackage(TALLY);
  tally[`${TALLY}/package.json`] = `${JSON.stringify({ name: '@fixture/tally', private: true, dependencies: { 'left-pad': '1.3.0' } }, null, 2)}\n`;
  const countCard = card('count').replace('Only `node:` modules.', 'It may import `left-pad` and `node:` modules.');
  const cwd = repo(t, {
    tracked: {
      'scripts/repo-rules.json': rulesFile({ deps: { [`${TALLY}/package.json`]: { dependencies: { 'left-pad': '1.3.0' } } } }),
      ...tally, ...carded(TALLY), ...npmPackage(COUNT), [`${COUNT}/README.md`]: countCard, ...crate(CORE), ...carded(CORE),
    },
  });
  const result = rules(cwd);
  assert.equal(stateLines(result, 'deps').filter((line) => line.startsWith('PASS')).length, 1, `the deps rule should pass on the listed dependency\n${show(result)}`);
  assertCardPass(result, "cards whose import sections differ from the packages' declared dependencies");
});
