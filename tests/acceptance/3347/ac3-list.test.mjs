// #3347 AC3: the check lists every fixture for a marked class with its statement, a clip, a recorded track and a run
// alike, and the list for hands@1 holds #1186's clip. A planted check that skips a clip with no statement
// (twins/skips-unstated.mjs) passes it and fails this criterion's judge, naming the clip.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FOLDER, agreed, assertListsAll, assertPasses, clip, clipOf1186, drawn, failing, handsFixtures, json, maintainer, plant, root, rules, scratch, show, skipped, statementOf } from './helpers.mjs';

const TWIN = fileURLToPath(new URL('./twins/skips-unstated.mjs', import.meta.url));

const PACK = 'packs/hands-1.0.0/fixtures/hands@1/labeled', RUNS = 'packages/checks/playtest/fixtures/hands@1';
const OPEN = `${FOLDER}/open.mov`, LEFT = `${PACK}/left.track`, ROUND = `${RUNS}/round.run.json`;
const BARE = `${FOLDER}/bare.mov`, RIGHT = `${PACK}/right.track`, SECOND = `${RUNS}/second.run.json`, BEHIND = `${FOLDER}/behind.mov`;
const run = (seed) => `{"run":"${seed}","entries":[{"class":"hands@1","points":[]}]}\n`;

test('#3347.0c0a0f6e AC3: the check lists every hands@1 fixture with its statement, a clip, a recorded track and a run, in any fixtures/hands@1/ folder, tracked or new, and a check that skips a clip with no statement fails this, naming the clip', (t) => {
  const key = maintainer(), STROKE = 'tests/fixtures/pen@1/stroke.track';
  const cwd = scratch(t, key.line, { ...drawn(OPEN), ...agreed(LEFT, { key, bytes: clip('left') }), [STROKE]: clip('stroke') });
  plant(cwd, drawn(ROUND, { bytes: Buffer.from(run('round')) })); // new, and not added to git
  const stated = [{ path: OPEN, statement: 'drawn' }, { path: LEFT, statement: 'agreed' }, { path: ROUND, statement: 'drawn' }];
  const before = rules(cwd);
  assertListsAll(before, stated, 'the check');
  assert.ok(!failing(before, STROKE).length, `the check fails ${STROKE}, a fixture for a class that isn't marked\n${show(before)}`);

  // A clip, a track and a run that state nothing, and a clip that states nothing either, which another fixture's
  // statement names as its script.
  const FRONT = `${FOLDER}/front.mov`;
  plant(cwd, { [BARE]: clip('bare'), [RIGHT]: clip('right'), [SECOND]: run('second'), [BEHIND]: clip('behind'), [FRONT]: clip('front'), [statementOf(FRONT)]: json({ statement: 'drawn', script: 'behind.mov' }) });
  const all = [...stated, ...[BARE, RIGHT, SECOND, BEHIND].map((path) => ({ path, statement: null }))];
  assertListsAll(rules(cwd), all, 'the check');

  // The planted check: it passes the clips that state nothing, and the judge above names each of them.
  const twin = rules(cwd, TWIN);
  assert.equal(twin.status, 0, `the planted check passes a tree whose clip has no statement\n${show(twin)}`);
  assert.ok(!skipped(twin, stated).length, `the planted check lists every fixture that has a statement\n${show(twin)}`);
  assert.throws(() => assertListsAll(twin, all, 'the planted check'), (error) => [BARE, RIGHT, SECOND, BEHIND].every((path) => error.message.includes(`${path} (no statement)`)), 'the judge fails the planted check, naming each clip it skipped');
});

test("#3347.0c0a0f6e AC3: on this checkout the check's list for hands@1 holds #1186's clip, and every other hands@1 fixture, with its statement", () => {
  const { path, stated } = clipOf1186();
  const result = rules(root);
  assertPasses(result, path, stated.statement, "#1186's clip");
  assertListsAll(result, handsFixtures().map((fixture) => ({ path: fixture.path, statement: fixture.stated?.statement ?? null })), 'the check on this checkout');
});
