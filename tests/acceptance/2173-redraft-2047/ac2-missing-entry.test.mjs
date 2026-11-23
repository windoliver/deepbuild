// #2173 AC2, the blind redraft for #2047's sweep: a dependency a manifest names with no entry in scripts/repo-rules.json
// still fails the checker's deps lane, naming the manifest and the dependency. One scratch copy of this checkout gets
// three such dependencies, then `node scripts/repo-rules.mjs` runs there once; each test reads that run for one of them.
// The checkout itself is never written (README: The surface). Run:
//   node --test tests/acceptance/2173-redraft-2047/ac2-missing-entry.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { CHECKER, childEnv, needCargo, quoted, removeCopy, runChecker, scratchCopy, some } from './helpers.mjs';

const RULES = 'scripts/repo-rules.json';
const DEEP_APP = 'crates/deep-app/Cargo.toml';
const MACOS = `[target.'cfg(target_os = "macos")'.dependencies]`;
// The issue's dependency, with its entry taken out of the copy's rules file.
const ISSUE_DEPENDENCY = 'accesskit_macos';
// A dependency planted in deep-app's macOS table, as the issue's is, and one in a package.json planted at the copy's root.
const PLANTED_CRATE = 'blind-planted-2173';
const PLANTED_MANIFEST = 'blind-2173-planted/package.json';
const PLANTED_PACKAGE = 'blind-planted-2173-npm';

/** Plants the three dependencies in the copy; notes what it found in `facts`; returns the files it added. */
function plant(copy, facts) {
  const rules = JSON.parse(readFileSync(join(copy, RULES), 'utf8'));
  facts.entriesTakenOut = 0;
  for (const names of Object.values(rules.deps?.[DEEP_APP] ?? {})) {
    if (names && Object.hasOwn(names, ISSUE_DEPENDENCY)) {
      delete names[ISSUE_DEPENDENCY];
      facts.entriesTakenOut++;
    }
  }
  writeFileSync(join(copy, RULES), `${JSON.stringify(rules, null, 2)}\n`);

  const lines = readFileSync(join(copy, DEEP_APP), 'utf8').split('\n');
  facts.namesIssueDependency = lines.some((line) => new RegExp(`^\\s*${ISSUE_DEPENDENCY}\\s*=`).test(line));
  const table = lines.findIndex((line) => line.trim() === MACOS);
  facts.macosTable = table >= 0;
  if (table >= 0) lines.splice(table + 1, 0, `${PLANTED_CRATE} = "0.1"`);
  else lines.push(MACOS, `${PLANTED_CRATE} = "0.1"`, '');
  writeFileSync(join(copy, DEEP_APP), lines.join('\n'));

  mkdirSync(join(copy, PLANTED_MANIFEST, '..'), { recursive: true });
  writeFileSync(join(copy, PLANTED_MANIFEST), `${JSON.stringify({ name: 'blind-2173-planted', private: true, dependencies: { [PLANTED_PACKAGE]: '1.0.0' } }, null, 2)}\n`);
  return [PLANTED_MANIFEST];
}

// One copy and one run for the file, made by the first test that needs it; a copy or run that can't be made fails
// every test INCONCLUSIVE. Offline, so cargo in the copy never reaches the network for the planted crate.
let outcome, copy;
function plantedRun() {
  if (!outcome) {
    try {
      const env = childEnv({ CARGO_NET_OFFLINE: 'true' });
      needCargo(env);
      const facts = {};
      copy = scratchCopy(env, (folder) => plant(folder, facts));
      outcome = { run: runChecker(copy, env), facts };
    } catch (error) {
      outcome = { error };
    }
  }
  if (outcome.error) throw outcome.error;
  return outcome;
}
after(() => removeCopy(copy));

// A word of a line, whole: not part of a longer name or path.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (text, word) => new RegExp(`(?<![\\w./@-])${escape(word)}(?![\\w/-])`).test(text);

/** The run failed, and a failing line of its deps lane names both the manifest and the dependency. */
function assertNamed(run, manifest, dependency, what) {
  const deps = run.results.filter(({ lane }) => lane === 'deps');
  const line = run.failing.find(({ lane, message }) => lane === 'deps' && names(message, manifest) && names(message, dependency));
  // The deps lines about this manifest or this dependency, else the lane's first lines.
  const near = deps.filter(({ message }) => names(message, manifest) || names(message, dependency));
  assert.ok(run.status !== 0 && line,
    `With ${what}, node ${CHECKER} exited ${run.status} and ${line ? 'printed' : 'printed no'} failing deps line naming ${manifest} and ${dependency}. `
    + `${near.length ? `Its ${near.length} deps lines naming either` : `None of its ${deps.length} deps lines names either; the first`}:\n`
    + `${quoted(some((near.length ? near : deps).map(({ line: text }) => text), 10), copy)}\nIts stderr:\n${quoted(run.stderr, copy)}`);
}

test("AC2 #2173.2db46adb with its entry taken out of scripts/repo-rules.json, deep-app's accesskit_macos fails the deps lane, naming crates/deep-app/Cargo.toml and accesskit_macos", () => {
  const { run, facts } = plantedRun();
  assertNamed(run, DEEP_APP, ISSUE_DEPENDENCY,
    `${facts.entriesTakenOut} ${ISSUE_DEPENDENCY} entr${facts.entriesTakenOut === 1 ? 'y' : 'ies'} taken out of the copy's ${RULES} for ${DEEP_APP}, `
    + `which ${facts.namesIssueDependency ? 'names' : 'does not name'} ${ISSUE_DEPENDENCY}`);
});

test("AC2 #2173.2db46adb a dependency planted in crates/deep-app/Cargo.toml's macOS table with no entry fails the deps lane, naming the manifest and the dependency", () => {
  const { run, facts } = plantedRun();
  assertNamed(run, DEEP_APP, PLANTED_CRATE, `${PLANTED_CRATE} = "0.1" planted in ${DEEP_APP}'s ${MACOS} table (${facts.macosTable ? 'found' : 'added at the end'})`);
});

test('AC2 #2173.2db46adb a package.json planted with a dependency and no entry fails the deps lane, naming the manifest and the dependency', () => {
  const { run } = plantedRun();
  assertNamed(run, PLANTED_MANIFEST, PLANTED_PACKAGE, `${PLANTED_MANIFEST} planted, naming ${PLANTED_PACKAGE} 1.0.0 under dependencies`);
});
