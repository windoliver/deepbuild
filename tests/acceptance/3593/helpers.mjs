// Helpers for #3593's acceptance tests. The sandbox, the stand-ins, the fixture repository, the settled list and the
// watched repository are #3064's (tests/acceptance/3064/helpers.mjs), imported and never edited. What this file adds
// is the suite #3593 is about: one whose test imports a file of package a itself, with no process between (README:
// The fixture repository). Nothing here imports the code under test.
export * from '../3064/helpers.mjs';
import { fixture, suite } from '../3064/helpers.mjs';

/** The package file the import-reached suites import, and the change of most tests here. */
export const IMPORTED = 'packages/a/src/util.mjs';
/** A file of package a that a suite's test reads by path (`reads`), and which nothing imports. */
export const READ = 'packages/a/greeting.txt';

/** The name node --test gives an import-reached suite's one test. */
export const importName = (issue) => `issue ${issue}: package a's util shouts`;

/**
 * A suite's test file that reaches package a only by importing `from` itself, with no process between: by default
 * `packages/a/src/util.mjs`, whose `shout` it calls. With `reads` it also reads packages/a/greeting.txt by path. It
 * notes its run in the events file, as #3064's suites do.
 */
export const imported = (issue, { from = IMPORTED, reads = false } = {}) => {
  const spec = `../../../${from}`;
  const util = from === IMPORTED;
  return `// The suite of fixture issue #${issue} (tests/acceptance/3593/README.md, The fixture repository): it imports ${from} itself.
import assert from 'node:assert/strict';
import { appendFileSync${reads ? ', readFileSync' : ''} } from 'node:fs';
import test from 'node:test';
${util ? `import { shout } from ${JSON.stringify(spec)};` : `import ${JSON.stringify(spec)};`}

const note = (ok) => { if (process.env.T3064_EVENTS) appendFileSync(process.env.T3064_EVENTS, JSON.stringify({ suite: ${JSON.stringify(String(issue))}, ok, t: Date.now(), pid: process.pid }) + '\\n'); };

test(${JSON.stringify(importName(issue))}, () => {
  let ok = ${util ? "shout('a') === 'A'" : 'true'};
${reads ? `  ok = ok && readFileSync(new URL(${JSON.stringify(`../../../${READ}`)}, import.meta.url), 'utf8').includes('hi from a');\n` : ''}  note(ok);
  assert.ok(ok, 'package a did not answer as the suite expects');
});
`;
};

/**
 * #3064's fixture repository with the suites of this suite's tests: by default 90001 and 90002 import package a's
 * util.mjs themselves, and 90003 starts package a's build as #3064's do. packages/a/greeting.txt and a test of package
 * a's own, outside tests/acceptance/, which imports util.mjs, are there too.
 */
export const OWN_TEST = 'packages/a/test/util.test.mjs';
const OWN_TEST_SOURCE = `// Package a's own test, outside every suite: it imports util.mjs itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import { shout } from '../src/util.mjs';

test("package a's util shouts", () => assert.equal(shout('a'), 'A'));
`;
export const importFixture = (box, suites = { 90001: imported(90001), 90002: imported(90002), 90003: suite(90003) }) =>
  fixture(box, { suites, files: { [READ]: 'hi from a\n', [OWN_TEST]: OWN_TEST_SOURCE } });
