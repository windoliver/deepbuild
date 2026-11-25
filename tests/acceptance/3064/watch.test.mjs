// #3064 AC3 (its first two cases) and AC4 on one scene: eleven runs of the main watch on a watched repository, the
// list each of the last two left, and what affected.mjs selects with the tenth's (README: The watch's scene).
import { after, before, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import {
  CHANGE, CLEAN_RUNS, LANDINGS, LONG, affected, assert, closed, dump, events, fileIssue, fileOf, folderOf, idAt, land, leftNames, lists, readList,
  sandbox, selects, settledFile, suite, tick, treeAt, watched,
} from './helpers.mjs';

// Four suites, each of one test that starts package a's build. CLEAN's, OPEN's and FAILS's are on main from its first
// commit; NINE's lands after the watch's first run. Every issue is closed as completed but OPEN's.
const CLEAN = 90011, NINE = 90012, OPEN = 90013, FAILS = 90014;
// The scene's ticks stop being started after this long, so a watch that crawls fails the tests at an assertion.
const BUDGET = 2_400_000;

const scene = { ticks: [] };
// The scene's sandbox is removed once every test of this file has read it.
const cleanups = [];
after(() => { for (const cleanup of cleanups) cleanup(); });
before(async () => {
  const started = Date.now();
  try {
    const box = scene.box = sandbox({ after: (cleanup) => cleanups.push(cleanup) });
    const fx = scene.fx = watched(box, { [CLEAN]: suite(CLEAN), [OPEN]: suite(OPEN), [FAILS]: suite(FAILS, { flaky: true }) });
    for (const issue of [CLEAN, NINE, FAILS]) closed(box, issue);
    fileIssue(box, OPEN);
    const at = (head, seen = 0) => ({
      head, tree: treeAt(fx, head), ids: Object.fromEntries([CLEAN, NINE, OPEN, FAILS].map((issue) => [issue, idAt(fx, head, issue)])),
      read: readList(box), runs: events(box).slice(seen),
    });
    // Ten runs of main's head: the first on the first commit, each of the rest once five landings reached main. The
    // first of those landings adds NINE's suite, so the tenth run is its ninth.
    let head = fx.git('rev-parse', 'HEAD');
    scene.ticks.push(await tick(box, fx));
    for (let n = 2; n <= CLEAN_RUNS; n++) {
      if (Date.now() - started > BUDGET) throw Error(`the watch's first ${n - 1} ticks took over ${BUDGET / 60_000} minutes`);
      head = land(fx, LANDINGS, n === 2 ? { [fileOf(NINE)]: suite(NINE) } : {});
      scene.ticks.push(await tick(box, fx));
    }
    scene.tenth = at(head);
    // What a change to package a's entry selects on main's head, with the list the watch just wrote.
    scene.listed = await affected(box, fx, ['--list', CHANGE]);
    // The eleventh run: FAILS's test fails once in it, and passes when the watch runs it again alone.
    writeFileSync(box.env.T3064_FLAKY, 'armed');
    head = land(fx);
    scene.ticks.push(await tick(box, fx));
    scene.eleventh = at(head, scene.tenth.runs.length);
  } catch (error) {
    scene.error = error;
  }
});

const all = () => dump(scene.box, ...scene.ticks.slice(-2), scene.listed);
const of = (runs, issue) => runs.filter((event) => event.suite === issue);

/** The tenth run's list, once the scene stands: the watch ran CLEAN's suite ten times, clean, and listed it. */
function tenth() {
  assert.ok(!scene.error, `the scene could not be built: ${scene.error?.stack ?? scene.error}\n${scene.box ? all() : ''}`);
  const { tenth: { head, tree, ids, read, runs } } = scene;
  const clean = of(runs, CLEAN);
  assert.ok(clean.length === CLEAN_RUNS && clean.every(({ ok }) => ok), `the watch's ${CLEAN_RUNS} ticks didn't run ${folderOf(CLEAN)} ${CLEAN_RUNS} times, clean: it ran ${clean.length} times, ${clean.filter(({ ok }) => !ok).length} failing\n${all()}`);
  assert.ok(read, `the watch's tenth run of main's head left no settled list at ${settledFile(scene.box)}\n${all()}`);
  assert.ok(read.list && typeof read.list === 'object' && read.list.suites && typeof read.list.suites === 'object' && !Array.isArray(read.list.suites), `the watch's settled.json isn't { "tree": …, "suites": { "tests/acceptance/<issue>/": … } }\n${all()}`);
  assert.equal(read.list.tree, tree, `the tenth run's settled.json isn't keyed by the tree of the head it ran, ${head}\n${all()}`);
  assert.equal(read.list.suites[folderOf(CLEAN)], ids[CLEAN], `${folderOf(CLEAN)}, whose issue is closed as completed and whose test passed in each of the watch's ${CLEAN_RUNS} runs, isn't on the list with git's ID of its folder, so another suite's absence shows nothing\n${all()}`);
  return scene.tenth;
}
/** With the watch's own list, a change that reaches every suite through the build runs `issue`'s and leaves CLEAN's. */
function runsWith(issue, why) {
  const out = scene.listed;
  assert.ok(selects(out, fileOf(issue)) && !leftNames(out, issue), `${folderOf(issue)} ${why}, and with the watch's list affected.mjs --list ${leftNames(out, issue) ? 'leaves it to the watch on a SETTLED line' : 'does not select it'}\n${all()}`);
  assert.ok(leftNames(out, CLEAN) && !selects(out, fileOf(CLEAN)), `the watch's list wasn't in force for affected.mjs --list, so that ${folderOf(issue)} is selected shows nothing: ${folderOf(CLEAN)}, which the list holds, is ${selects(out, fileOf(CLEAN)) ? 'still selected' : 'on no SETTLED line'}\n${all()}`);
}

test(`#3064.a5a02f7e a suite with 9 clean watch runs is not settled and runs; a list that admits it fails, naming the suite`, LONG, () => {
  const { read, runs } = tenth();
  const nine = of(runs, NINE);
  assert.ok(nine.length === CLEAN_RUNS - 1 && nine.every(({ ok }) => ok), `the scene went wrong: ${folderOf(NINE)} should have ${CLEAN_RUNS - 1} clean watch runs behind the tenth run's list, and has ${nine.length}, ${nine.filter(({ ok }) => !ok).length} failing\n${all()}`);
  assert.ok(!lists(read, NINE), `the list admits ${folderOf(NINE)} after ${CLEAN_RUNS - 1} clean watch runs\n${all()}`);
  runsWith(NINE, `has ${CLEAN_RUNS - 1} clean watch runs`);
});

test(`#3064.a5a02f7e a suite whose issue is open is not settled and runs; a list that admits it fails, naming the suite`, LONG, () => {
  const { read, runs } = tenth();
  const open = of(runs, OPEN);
  assert.ok(open.length === CLEAN_RUNS && open.every(({ ok }) => ok), `the scene went wrong: ${folderOf(OPEN)} should have ${CLEAN_RUNS} clean watch runs behind the tenth run's list, and has ${open.length}, ${open.filter(({ ok }) => !ok).length} failing\n${all()}`);
  assert.ok(!lists(read, OPEN), `the list admits ${folderOf(OPEN)}, whose issue #${OPEN} is open\n${all()}`);
  runsWith(OPEN, `is the suite of an open issue`);
});

test(`#3064.3deceb81 a settled suite that fails in a watch run is off the list in that run's settled.json; a watch that keeps it fails`, LONG, () => {
  const before = tenth();
  assert.equal(before.read.list.suites[folderOf(FAILS)], before.ids[FAILS], `${folderOf(FAILS)} wasn't settled after ${CLEAN_RUNS} clean watch runs, so nothing shows it leaving the list\n${all()}`);
  const { head, tree, ids, read, runs } = scene.eleventh;
  assert.ok(of(runs, FAILS).some(({ ok }) => !ok), `the test of ${folderOf(FAILS)} never failed in the watch's eleventh run, so nothing was judged\n${all()}`);
  assert.ok(read?.list?.suites && typeof read.list.suites === 'object', `the watch's eleventh run left no settled list that can be read at ${settledFile(scene.box)}\n${all()}`);
  assert.equal(read.list.tree, tree, `settled.json isn't that run's: the run was of main's head ${head}, whose tree is ${tree}\n${all()}`);
  assert.ok(!lists(read, FAILS), `the watch kept ${folderOf(FAILS)} on the list of the run its test failed in\n${all()}`);
  // The list is still the suites clean in the last ten runs, not an empty one.
  assert.equal(read.list.suites[folderOf(CLEAN)], ids[CLEAN], `${folderOf(CLEAN)}, clean in every run, left the list with ${folderOf(FAILS)}: the list isn't the suites clean in the watch's last ${CLEAN_RUNS} runs\n${all()}`);
});
