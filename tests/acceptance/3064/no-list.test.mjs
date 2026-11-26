// #3064 AC5: with no settled list, or one that can't be read, the selection is today's and the run says so on one
// line. One test a case, each on a real run (README: What each file proves).
import { test } from 'node:test';
import { CHANGE, LONG, NEAR, affected, assert, dump, fileOf, fixture, folderOf, leftNames, listOf, noList, ranOf, sandbox, selects, settledFile, writeList } from './helpers.mjs';

const SUITES = [90001, 90002, 90003];

/** Every suite is selected and ran, none is left to the watch, and one `SETTLED no list:` line names the file. */
function todaysSelection(box, out, which) {
  const all = dump(box, out);
  for (const file of [...SUITES.map(fileOf), NEAR]) assert.ok(selects(out, file), `${which}: the selection isn't today's: it lost ${file}\n${all}`);
  for (const issue of SUITES) assert.ok(ranOf(box, issue).some(({ ok }) => ok), `${which}: ${folderOf(issue)} didn't run: the run treated ${which} as a list that settles it\n${all}`);
  for (const issue of SUITES) assert.ok(!leftNames(out, issue), `${which}: ${folderOf(issue)} ran, and a SETTLED line still names it as left to the watch\n${all}`);
  const said = noList(out);
  assert.equal(said.length, 1, `${which}: the run doesn't say so on one line, "SETTLED no list: …" (it printed ${said.length})\n${all}`);
  assert.ok(said[0].includes('main-watch/settled.json'), `${which}: the line doesn't name the file, ${settledFile(box)}: "${said[0]}"\n${all}`);
}

test(`#3064.c0da1789 with no settled list the selection is today's and the run says so on one line; a run that treats a missing list as "all settled" fails`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  const out = await affected(box, fx, [CHANGE]);
  todaysSelection(box, out, 'no settled list');
});

test(`#3064.c0da1789 with a settled list cut short, which can't be read, the selection is today's and the run says so on one line`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // The watch's list for every suite, as far as its first 60 bytes.
  writeList(box, JSON.stringify(listOf(fx, SUITES), null, 2).slice(0, 60));
  const out = await affected(box, fx, [CHANGE]);
  todaysSelection(box, out, 'a settled list cut short');
});

test(`#3064.c0da1789 with a settled list that isn't the watch's shape, which can't be read as the list, the selection is today's and the run says so on one line`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // JSON, but not { tree, suites: { folder: ID } }: the folders alone, with no tree and no ID to hold them to.
  writeList(box, `${JSON.stringify(SUITES.map(folderOf))}\n`);
  const out = await affected(box, fx, [CHANGE]);
  todaysSelection(box, out, 'a settled list of another shape');
});
