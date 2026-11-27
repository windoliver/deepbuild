// #3593 criterion 3, its third case: a suite of an open issue runs whatever the reach. On one scene: ten runs of the
// main watch on a watched repository whose two suites import package a's entry themselves, and what affected.mjs
// selects with the list the tenth run left (README: The watch's scene).
import { after, before, test } from 'node:test';
import { CHANGE, CLEAN_RUNS, LANDINGS, LONG, affected, assert, closed, dump, events, fileIssue, fileOf, folderOf, idAt, imported, land, leftNames, lists, readList, sandbox, selects, settledFile, tick, treeAt, watched } from './helpers.mjs';

// Two suites on main from its first commit, each one test that imports packages/a/src/main.mjs itself, with no
// process between. CLEAN's issue is closed as completed; OPEN's is open.
const CLEAN = 90021, OPEN = 90023;
// The scene's ticks stop being started after this long, so a watch that crawls fails the test at an assertion.
const BUDGET = 900_000;

const scene = { ticks: [] };
const cleanups = [];
after(() => { for (const cleanup of cleanups) cleanup(); });
before(async () => {
  const started = Date.now();
  try {
    const box = scene.box = sandbox({ after: (cleanup) => cleanups.push(cleanup) });
    const fx = scene.fx = watched(box, { [CLEAN]: imported(CLEAN, { from: CHANGE }), [OPEN]: imported(OPEN, { from: CHANGE }) });
    closed(box, CLEAN);
    fileIssue(box, OPEN);
    // Ten runs of main's head: the first on the first commit, each of the rest once five landings reached main.
    let head = fx.git('rev-parse', 'HEAD');
    scene.ticks.push(await tick(box, fx));
    for (let n = 2; n <= CLEAN_RUNS; n++) {
      if (Date.now() - started > BUDGET) throw Error(`the watch's first ${n - 1} ticks took over ${BUDGET / 60_000} minutes`);
      head = land(fx, LANDINGS);
      scene.ticks.push(await tick(box, fx));
    }
    scene.tenth = { head, tree: treeAt(fx, head), ids: { [CLEAN]: idAt(fx, head, CLEAN), [OPEN]: idAt(fx, head, OPEN) }, read: readList(box), runs: events(box) };
    // What a change to package a's entry, which both suites import, selects on main's head with the watch's list.
    scene.listed = await affected(box, fx, ['--list', CHANGE]);
  } catch (error) {
    scene.error = error;
  }
});

const all = () => dump(scene.box, ...scene.ticks.slice(-1), scene.listed);
const of = (runs, issue) => runs.filter((event) => String(event.suite) === String(issue));

test(`#3593.24d41793 a suite whose issue is open runs when the change reaches it by import; a list that admits it fails, naming the suite`, LONG, () => {
  assert.ok(!scene.error, `the scene could not be built: ${scene.error?.stack ?? scene.error}\n${scene.box ? all() : ''}`);
  const { head, tree, ids, read, runs } = scene.tenth;
  for (const issue of [CLEAN, OPEN]) {
    const clean = of(runs, issue);
    assert.ok(clean.length === CLEAN_RUNS && clean.every(({ ok }) => ok), `the scene went wrong: the watch's ${CLEAN_RUNS} ticks didn't run ${folderOf(issue)} ${CLEAN_RUNS} times, clean: it ran ${clean.length} times, ${clean.filter(({ ok }) => !ok).length} failing\n${all()}`);
  }
  assert.ok(read?.list?.suites && typeof read.list.suites === 'object' && !Array.isArray(read.list.suites), `the watch's tenth run left no settled list of the design's shape at ${settledFile(scene.box)}\n${all()}`);
  assert.equal(read.list.tree, tree, `the tenth run's settled.json isn't keyed by the tree of the head it ran, ${head}\n${all()}`);
  assert.equal(read.list.suites[folderOf(CLEAN)], ids[CLEAN], `${folderOf(CLEAN)}, whose issue is closed as completed and whose test passed in each of the watch's ${CLEAN_RUNS} runs, isn't on the list with git's ID of its folder, so another suite's absence shows nothing\n${all()}`);
  assert.ok(!lists(read, OPEN), `the list admits ${folderOf(OPEN)}, whose issue #${OPEN} is open\n${all()}`);
  const out = scene.listed;
  assert.ok(selects(out, fileOf(OPEN)) && !leftNames(out, OPEN), `${folderOf(OPEN)} is the suite of an open issue, the change reaches it by an import of ${CHANGE}, and with the watch's list affected.mjs --list ${leftNames(out, OPEN) ? 'leaves it to the watch on a SETTLED line' : 'does not select it'}\n${all()}`);
  assert.ok(leftNames(out, CLEAN) && !selects(out, fileOf(CLEAN)), `the wider settled rule wasn't in force for affected.mjs --list, so that ${folderOf(OPEN)} is selected shows nothing: ${folderOf(CLEAN)}, which the list holds and the change reaches by the same import, is ${selects(out, fileOf(CLEAN)) ? 'still selected' : 'on no SETTLED line'}\n${all()}`);
});
