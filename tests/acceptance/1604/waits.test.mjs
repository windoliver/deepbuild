// #1604 acceptance: the lint lane's wait guard over planted test files (AC1, AC2, AC4, AC5, and Rust's
// thread::sleep). Each plant runs after its clean twin passed in the same scratch repository, so a guard that
// fails everything can't satisfy a test, and each FAIL must name the planted line or suite. The planted waits are
// text these tests write into scratch files; nothing here waits on a timer.
import test from 'node:test';
import { LISTED, assertFailsAt, assertFailsNaming, assertNotNamed, assertPasses, base, ceilings, drop, guard, guardCommand, put, CEILINGS } from './helpers.mjs';

/** A vitest file that starts a server and asserts it's ready, after `wait` (one line) or after nothing. */
const served = (wait) => [
  "import { expect, it } from 'vitest';",
  ...(wait ? ["import { sleep } from './helpers';"] : []),
  "import { start } from './server';",
  '',
  "it('serves once started', async () => {",
  '  const server = start();',
  wait ? '  await sleep(200);' : '  await server.started;',
  '  expect(server.ready).toBe(true);',
  '});',
  '',
].join('\n');

/** A node:test file that waits on a timer resolved only to let time pass, or on the event it needs. */
const timed = (wait) => [
  "import assert from 'node:assert/strict';",
  "import { once } from 'node:events';",
  "import test from 'node:test';",
  "import { start } from './server.mjs';",
  '',
  "test('serves once started', async () => {",
  '  const server = start();',
  wait ? '  await new Promise((resolve) => setTimeout(resolve, 200));' : "  await once(server, 'ready');",
  '  assert.ok(server.ready);',
  '});',
  '',
].join('\n');

test('AC1: a planted test that sleeps 200 ms before it asserts fails the lint lane, naming the file and line; the twin that waits for its event passes', (t) => {
  guardCommand();
  const cwd = base(t);
  const SLEEPS = 'packages/fixture/test/sleep.test.ts';
  put(cwd, SLEEPS, served(false));
  assertPasses(guard(cwd), `(the twin of ${SLEEPS}, which awaits its event)`);
  put(cwd, SLEEPS, served(true));
  const result = guard(cwd);
  assertFailsAt(result, SLEEPS, 7, '(await sleep(200) is on line 7)');
  assertNotNamed(result, LISTED);
});

test('AC1: a planted test that awaits setTimeout(resolve, 200) before it asserts fails the lint lane, naming the file and line; the twin passes', (t) => {
  guardCommand();
  const cwd = base(t);
  const TIMER = 'tests/fixture-timer.test.mjs';
  put(cwd, TIMER, timed(false));
  assertPasses(guard(cwd), `(the twin of ${TIMER}, which awaits its event)`);
  put(cwd, TIMER, timed(true));
  const result = guard(cwd);
  assertFailsAt(result, TIMER, 8, '(the setTimeout wait is on line 8)');
  assertNotNamed(result, LISTED);
});

/** A wait for `ready` bounded by a 30 s deadline that rejects, with `mark` as the comment line above its timer. */
const bounded = (mark) => [
  "import { once } from 'node:events';",
  "import { expect, it } from 'vitest';",
  "import { start } from './server';",
  '',
  "it('serves once ready, or fails within 30 s', async () => {",
  '  const server = start();',
  "  const ready = once(server, 'ready');",
  '  const deadline = new Promise((_, reject) => {',
  ...(mark === null ? [] : [`    ${mark}`]),
  "    setTimeout(() => reject(new Error('no ready event within 30 s')), 30_000);",
  '  });',
  '  await Promise.race([ready, deadline]);',
  '  expect(server.ready).toBe(true);',
  '});',
  '',
].join('\n');

test('AC2: a planted wait bounded by a deadline that rejects when it expires passes when marked with its reason; unmarked, or marked with no reason, it fails naming the line', (t) => {
  guardCommand();
  const cwd = base(t);
  const DEADLINE = 'packages/fixture/test/deadline.test.ts';
  put(cwd, DEADLINE, bounded('// deadline: turns a hang into a failure when the ready event never comes'));
  assertPasses(guard(cwd), `(${DEADLINE}'s deadline carries its marker and reason)`);
  put(cwd, DEADLINE, bounded(null));
  assertFailsAt(guard(cwd), DEADLINE, 9, '(the same deadline with no marker: an allowed exception carries its reason; the timer is on line 9)');
  put(cwd, DEADLINE, bounded('// deadline:'));
  assertFailsAt(guard(cwd), DEADLINE, 10, '(the marker with no reason after it; the timer is on line 10)');
});

/** A node:test file that builds, asserting either on the build's result or on two wall-clock reads' difference. */
const clocked = (wallClock) => [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { build } from './build.mjs';",
  '',
  "test('builds', () => {",
  ...(wallClock ? ['  const start = Date.now();', '  build();', '  assert.ok(Date.now() - start < 50);'] : ["  assert.equal(build().status, 'built');"]),
  '});',
  '',
].join('\n');

/** The same in vitest's expect form. */
const expected = (wallClock) => [
  "import { expect, it } from 'vitest';",
  "import { build } from './build';",
  '',
  "it('builds', () => {",
  ...(wallClock ? ['  const start = Date.now();', '  build();', '  expect(Date.now() - start).toBeLessThan(50);'] : ["  expect(build().status).toBe('built');"]),
  '});',
  '',
].join('\n');

test('AC4: a planted assertion that Date.now() - start is under 50 fails the lint lane, naming the line, in assert and expect form; the twins that assert the result pass', (t) => {
  guardCommand();
  const cwd = base(t);
  const ASSERTS = 'tests/fixture-clock.test.mjs';
  const EXPECTS = 'packages/fixture/test/clock.test.ts';
  put(cwd, ASSERTS, clocked(false));
  put(cwd, EXPECTS, expected(false));
  assertPasses(guard(cwd), '(the twins, which assert the build result)');
  put(cwd, ASSERTS, clocked(true));
  const asserted = guard(cwd);
  assertFailsAt(asserted, ASSERTS, 8, '(assert.ok(Date.now() - start < 50) is on line 8)');
  assertNotNamed(asserted, LISTED);
  put(cwd, ASSERTS, clocked(false));
  put(cwd, EXPECTS, expected(true));
  assertFailsAt(guard(cwd), EXPECTS, 7, '(expect(Date.now() - start).toBeLessThan(50) is on line 7)');
});

/** A new acceptance suite's one test file, with one fixed wait or with none. */
const suite = (wait) => [
  "import { expect, it } from 'vitest';",
  "import { start } from './helpers';",
  '',
  "it('reports done', async () => {",
  '  const job = start();',
  wait ? '  await new Promise((resolve) => setTimeout(resolve, 500));' : '  await job.done;',
  "  expect(job.state).toBe('done');",
  '});',
  '',
].join('\n');

test('AC5: a planted new acceptance suite with one fixed wait fails the lint lane, naming the suite, even with a ceiling of its own; its twin with no wait passes', (t) => {
  guardCommand();
  const cwd = base(t);
  const SUITE = 'tests/acceptance/9001/';
  const FILE = `${SUITE}reports.test.ts`;
  put(cwd, `${SUITE}helpers.ts`, "export const start = () => ({ done: Promise.resolve(), state: 'done' });\n");
  put(cwd, FILE, suite(false));
  assertPasses(guard(cwd), `(the twin of ${SUITE}, which awaits its job)`);
  put(cwd, FILE, suite(true));
  const result = guard(cwd);
  assertFailsNaming(result, SUITE, '(a suite new since the merge base starts at zero)');
  assertNotNamed(result, LISTED);
  // A ceiling the change gives the new suite itself doesn't count: the merge base lists none, so it starts at zero.
  put(cwd, CEILINGS, ceilings({ [LISTED]: 2, [FILE]: 1 }));
  assertFailsNaming(guard(cwd), SUITE, '(with a ceiling of 1 for it written in the same change)');
});

test("a planted Rust test that calls thread::sleep fails the lint lane, naming the file and line; the twin passes", (t) => {
  guardCommand();
  const cwd = base(t);
  const RUST = 'crates/fixture/tests/wait.rs';
  const rust = (sleeps) => [
    'use std::time::Duration;',
    '',
    '#[test]',
    'fn settles() {',
    sleeps ? '    std::thread::sleep(Duration::from_millis(200));' : '    let _ = Duration::from_millis(200);',
    '    assert_eq!(1 + 1, 2);',
    '}',
    '',
  ].join('\n');
  put(cwd, RUST, rust(false));
  assertPasses(guard(cwd), `(the twin of ${RUST}, with no sleep)`);
  put(cwd, RUST, rust(true));
  const result = guard(cwd);
  assertFailsAt(result, RUST, 5, '(std::thread::sleep is on line 5)');
  assertNotNamed(result, LISTED);
  drop(cwd, RUST);
  assertPasses(guard(cwd), '(with the planted file gone, the scratch repository is back at its base)');
});
