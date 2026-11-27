// Blind redraft (#3549) of #3567's build-grant test: a neighbour holds each build slot of the limit throttle.mjs
// states for this platform (./helpers.mjs buildLimit), where the original started two. Name, criterion, waits,
// assertions and expected values are the original's. The file's first test, the test grant's, is carried as it is: the
// swap is by file, so every test of the original file runs here.
// #3567, criterion 4: a run still waiting for its first grant at the bound ends INCONCLUSIVE naming the class, and
// holds no request in the throttle's table afterwards. A planted run that leaves its request fails. A run's first
// grant is its test grant, or, when its selected tests need a Rust binary, the build grant for its binaries
// (docs/parallel-proof.md, section 6), so each class has its test. Other sessions' holders keep the class from the run
// in the sandbox's own table; DEEP_TEST_GRANT_WAIT is unset, so the run's own wait for a grant is far longer than the
// bound.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, AFTER_MS, BOUND_MIN, BOUND_MS, BOUNDED, dump, expectEnded, heldBy, hold, holding, inconclusive, leftBy, noted, readings, sandbox, throttleLog, throttleTable, tree, unstarted, until, without } from '../3567/helpers.mjs';
import { buildLimit } from './helpers.mjs';

const BUILD_LIMIT = buildLimit();
const FILE = 'tests/fixture-3567-waits.test.mjs';
// The fixture's own crate and binary: no literal here names a binary of the workspace, so no change to one selects this file.
const CRATE = 'deep-canvas-3567';
const BINARY = 'deep-fixture-3567';
// A test that starts a workspace binary from DEEP_BIN_DIR, so the run builds it first, under a build grant of its own.
const starts = (box) => `${unstarted(box)}import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
test('it starts the binary', () => { assert.equal(spawnSync(join(process.env.DEEP_BIN_DIR, ${JSON.stringify(BINARY)})).status, 0); });
`;

/** What the criterion holds of a run that waited for a grant of `cls` behind the `neighbours` (their throttles' PIDs). */
async function expectNoGrant(box, run, cls, neighbours) {
  const all = () => dump(box, run);
  expectEnded(box, run, { what: `waiting for its ${cls} grant, the first it asks for` });
  // Still waiting at the bound: a run that gave up long before it, by more than the 15 s a run may take to end, wasn't.
  assert.ok(run.ms >= BOUND_MS - AFTER_MS, `the run ended ${(run.ms / 1000).toFixed(1)} s after its start, long before its ${BOUND_MS / 1000} s bound: it was not still waiting for its ${cls} grant at the bound\n${all()}`);
  const granted = throttleLog(box).filter((entry) => entry.event === 'granted' && !neighbours.includes(entry.pid));
  assert.deepEqual(granted, [], `the run was given a grant, so it wasn't waiting for its first one at the bound and this run proves nothing\n${all()}`);
  assert.equal(noted(box).find(({ role }) => role === 'unstarted'), undefined, `the run started ${FILE}, though it had no grant\n${all()}`);

  // Naming the class: an INCONCLUSIVE line that says, beside the paths it names, both `grant` and the class's name.
  const said = inconclusive(run.stdout).map((line) => without(line, FILE, box.dir));
  assert.ok(said.some((line) => /\bgrant\b/.test(line) && new RegExp(`\\b${cls}\\b`).test(line)), `no INCONCLUSIVE line names the class the run waited for, as "${cls}" beside "grant"\n${all()}`);

  const held = await heldBy(box, neighbours);
  assert.deepEqual(held.requests, [], `the run left its request in the throttle's table after it ended: ${held.requests.map((request) => `a ${request.class} request of pid ${request.pid}`).join(', ')}\n${all()}`);
  assert.deepEqual(held.grants, [], `the run left a grant in the throttle's table after it ended\n${all()}`);
  const left = await leftBy(box, run);
  assert.deepEqual(left.group, [], `processes of the run still run after it ended, so one may still ask for its grant\n${all()}`);
}

test("#3567.f4411929 a run still waiting for its test grant at the bound ends INCONCLUSIVE naming the test class, and holds no request in the throttle's table afterwards", BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [FILE]: unstarted(box) });
  // No memory for a second run: past the first test grant, the readings keep another out (section 6).
  readings(box, { memory: 0, load: 0, cores: 4 });
  const neighbours = [hold(box, fixture, 'test')];
  // deadline: the neighbour's grant comes at once on an empty table; 60 s bounds a machine that can't start it.
  assert.ok(await until(() => holding(box) === 1, 60_000), `the neighbour never took the sandbox's first test grant\n${JSON.stringify(throttleTable(box))}`);
  const run = await affected(box, fixture, [FILE], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  await expectNoGrant(box, run, 'test', neighbours);
});

test("#3567.f4411929 a run still waiting for the build grant of its binaries at the bound ends INCONCLUSIVE naming the build class, and holds no request in the throttle's table afterwards", BOUNDED, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [FILE]: starts(box), 'Cargo.toml': `[workspace]\nresolver = "2"\nmembers = ["crates/${CRATE}"]\n` }, { crates: [{ name: CRATE, bins: [BINARY] }] });
  // A neighbour for each build slot: each asks before the run does, so one still in line is ahead of the run.
  const neighbours = Array.from({ length: BUILD_LIMIT }, () => hold(box, fixture, 'build'));
  const asked = () => { const { grants = [], requests = [] } = throttleTable(box); return neighbours.every((pid) => [...grants, ...requests].some((entry) => entry.pid === pid)); };
  // deadline: the neighbours ask at once; 60 s bounds a machine that can't start them.
  assert.ok(await until(() => holding(box) >= 1 && asked(), 60_000), `the neighbours never took the sandbox's build slots\n${JSON.stringify(throttleTable(box))}`);
  const run = await affected(box, fixture, [FILE], { env: { DEEP_AFFECTED_MIN: String(BOUND_MIN) } });
  await expectNoGrant(box, run, 'build', neighbours);
});
