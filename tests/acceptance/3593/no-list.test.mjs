// #3593 criterion 4: with no settled list, or one that can't be read, the selection is today's, import-reached suites
// included, and the run says so on one line. One test a case, each on a real run (README: What each file proves).
import { test } from 'node:test';
import { IMPORTED, LONG, OWN_TEST, affected, assert, dump, fileOf, folderOf, importFixture, leftNames, listOf, noList, ranOf, sandbox, selects, settledFile, writeList } from './helpers.mjs';

// The fixture's two suites that import the changed file themselves; the list cases name the third, which starts the
// build, too.
const REACHED = [90001, 90002], SUITES = [90001, 90002, 90003];

/** Every reached suite is selected and ran, none is left to the watch, and one `SETTLED no list:` line names the file. */
function todaysSelection(box, out, which) {
  const all = dump(box, out);
  for (const file of [...REACHED.map(fileOf), OWN_TEST]) assert.ok(selects(out, file), `${which}: the selection isn't today's: it lost ${file}\n${all}`);
  for (const issue of REACHED) assert.ok(ranOf(box, issue).some(({ ok }) => ok), `${which}: ${folderOf(issue)} didn't run: the run treated ${which} as a list that settles it\n${all}`);
  for (const issue of SUITES) assert.ok(!leftNames(out, issue), `${which}: a SETTLED line names ${folderOf(issue)} as left to the watch\n${all}`);
  const said = noList(out);
  assert.equal(said.length, 1, `${which}: the run doesn't say so on one line, "SETTLED no list: …" (it printed ${said.length})\n${all}`);
  assert.ok(said[0].includes('main-watch/settled.json'), `${which}: the line doesn't name the file, ${settledFile(box)}: "${said[0]}"\n${all}`);
}

test(`#3593.5d85614a with no settled list a change that reaches suites by import selects them as today and the run says so on one line; a run that treats a missing list as "all settled" fails`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  const out = await affected(box, fx, [IMPORTED]);
  todaysSelection(box, out, 'no settled list');
});

test(`#3593.5d85614a with a settled list cut short, which can't be read, a change that reaches suites by import selects them as today and the run says so on one line`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  // The watch's list for every suite, as far as its first 60 bytes.
  writeList(box, JSON.stringify(listOf(fx, SUITES), null, 2).slice(0, 60));
  const out = await affected(box, fx, [IMPORTED]);
  todaysSelection(box, out, 'a settled list cut short');
});

test(`#3593.5d85614a with a settled list that isn't the watch's shape, which can't be read as the list, a change that reaches suites by import selects them as today and the run says so on one line`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  // JSON, but not { tree, suites: { folder: ID } }: the folders alone, with no tree and no ID to hold them to.
  writeList(box, `${JSON.stringify(SUITES.map(folderOf))}\n`);
  const out = await affected(box, fx, [IMPORTED]);
  todaysSelection(box, out, 'a settled list of another shape');
});
