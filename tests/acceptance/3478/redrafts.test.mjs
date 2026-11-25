// #3478: the three blind redrafts take their originals' place. The three original files are gone from the checkout,
// and on a change to scripts/affected.mjs, `node scripts/affected.mjs --list` selects each redraft folder's test
// files. Read from this checkout's files and from the listing alone, with a HOME of the test's own (so no settled list
// of the machine's narrows it). Written blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from '../1115/helpers.mjs';
import { launch, sandbox, TEST, within } from './helpers.mjs';

const CHANGE = 'scripts/affected.mjs';
const REDRAFTS = ['tests/acceptance/1113-redraft-3478/', 'tests/acceptance/2574-redraft-3478/', 'tests/acceptance/1115-redraft-3478/'];
const ORIGINALS = ['tests/acceptance/1113/waits.test.mjs', 'tests/acceptance/2574/grant.test.mjs', 'tests/acceptance/1115-redraft-2833/no-grant.test.mjs'];
/** The listing may take this long, in minutes, before the test fails it. */
const LIST_MIN = 5;

/** The test files of a redraft folder in this checkout, as repository paths. */
const testFiles = (folder) => (existsSync(join(CHECKOUT, folder)) ? readdirSync(join(CHECKOUT, folder)).filter((name) => /\.test\.m?[jt]s$/.test(name)).map((name) => folder + name) : []);

/**
 * The files a run of the change starts: those of each `<lane> <runner>: <files>` line of the listing. A line ending
 * `(--<flag> runs them)` names files the run leaves to that flag, and a `SKIP <file> (by hand)` line selects nothing.
 */
function selected(stdout) {
  const run = new Set();
  for (const line of stdout.split('\n')) {
    const [, files] = line.match(/^[a-z]+ [a-z]+: (.+)$/) ?? [];
    if (files === undefined || / \(--[a-z-]+ runs them\)$/.test(files)) continue;
    for (const file of files.split(' ').filter(Boolean)) run.add(file);
  }
  return run;
}

test('#3478.1c95ae53 the three original files are gone from the checkout, and on a change to scripts/affected.mjs affected.mjs --list selects the three redraft folders\' files', TEST, async (t) => {
  const box = sandbox(t);
  const list = launch(box, [process.execPath, 'scripts/affected.mjs', '--list', CHANGE], { cwd: CHECKOUT });
  const result = await within(list.done, LIST_MIN);
  assert.ok(result, `the listing was still going ${LIST_MIN} min after it started\n${list.out()}`);
  const all = `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr.slice(-1_500)}`;
  assert.equal(result.status, 0, `the listing failed\n${all}`);
  const run = selected(result.stdout);
  assert.ok(run.size > 0, `the listing names no file a run would start, so it shows nothing\n${all}`);
  const wanted = REDRAFTS.map((folder) => [folder, testFiles(folder)]);
  const found = {
    // A redraft folder with no test file in this checkout, or with one the run would not start.
    'redraft folders not selected': wanted.filter(([, files]) => files.length === 0 || files.some((file) => !run.has(file))).map(([folder]) => folder),
    // An original still in the checkout.
    'originals still in the checkout': ORIGINALS.filter((file) => existsSync(join(CHECKOUT, file))),
  };
  assert.deepEqual(found, { 'redraft folders not selected': [], 'originals still in the checkout': [] }, `the redrafts have not taken their originals' place\n${all}`);
});
