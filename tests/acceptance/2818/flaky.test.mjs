// #2818's second criterion (README: Criteria → tests). A record on the fixture's main, through the real
// `node scripts/affected.mjs --record`, in which one test fails once and passes on every later run, and one fails on
// every run.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { assert, dump, filed, KNOWN, knownFile, LONG, mainRepo, namesCommit, record, sandbox, shown } from './helpers.mjs';

const FLAKY = 'tests/fixture-2818-flaky.test.mjs', HELD = 'tests/fixture-2818-held.test.mjs';
const FLAKY_ID = `${FLAKY} › settles when run alone`, HELD_ID = `${HELD} › fails on every run`;
const q = JSON.stringify;
// Each test notes its runs in `events`; the flaky one fails once while `armed` reads armed, rewriting it as fired, so
// every later run passes.
const files = (armed, events) => ({
  [FLAKY]: `import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

test('settles when run alone', () => {
  const armed = existsSync(${q(armed)}) && readFileSync(${q(armed)}, 'utf8') === 'armed';
  if (armed) writeFileSync(${q(armed)}, 'fired');
  appendFileSync(${q(events)}, JSON.stringify({ test: 'flaky', ok: !armed, pid: process.pid }) + '\\n');
  assert.ok(!armed, 'failed once, as armed');
});
`,
  [HELD]: `import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import test from 'node:test';

test('fails on every run', () => {
  appendFileSync(${q(events)}, JSON.stringify({ test: 'held', ok: false, pid: process.pid }) + '\\n');
  assert.equal(1, 2);
});
`,
});

test('#2818.1e81ba0c a failure that passes when run alone is flaky: node scripts/affected.mjs --record reads it INCONCLUSIVE, files it the way scripts/main-watch.mjs files one, and doesn\'t list it, while a failure that fails alone too is listed', LONG, async (t) => {
  const box = sandbox(t);
  const armed = join(box.dir, 'armed'), events = join(box.dir, 'events.jsonl');
  const repo = mainRepo(box, files(armed, events), knownFile());
  writeFileSync(armed, 'armed');
  const result = await record(box, repo, [FLAKY, HELD]);
  const text = readFileSync(join(repo.cwd, KNOWN), 'utf8');
  const runs = existsSync(events) ? readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const flaky = runs.filter(({ test: name }) => name === 'flaky');
  const all = `${dump(result)}\nthe flaky test's runs, in order: ${flaky.map(({ ok }) => (ok ? 'pass' : 'FAIL')).join(', ') || 'none'}\n${KNOWN} after the record:\n${text}\nissues the record filed:\n${shown(filed(box))}`;

  assert.ok(flaky.length && !flaky[0].ok, `the flaky test didn't fail in the record's run, so there was nothing to judge\n${all}`);
  const lines = `${result.stdout}\n${result.stderr}`.split('\n');
  assert.ok(lines.some((line) => line.includes('INCONCLUSIVE') && line.includes(FLAKY_ID)), `no line of the record reads INCONCLUSIVE for ${FLAKY_ID}, which failed once and passes alone\n${all}`);

  // Filed as scripts/main-watch.mjs files one: an issue titled "Flaky: <id>" whose body says INCONCLUSIVE, names the
  // test and the head it failed at, and lists its runs, a line each starting FAIL or PASS.
  const named = filed(box).filter(({ title }) => title.includes(FLAKY_ID));
  assert.equal(named.length, 1, `the flaky test wasn't filed once, by an issue whose title names it\n${all}`);
  const [one] = named;
  assert.ok(one.title.startsWith('Flaky:'), `the issue filed for the flaky test isn't titled "Flaky: <id>", as main-watch titles one: ${one.title}`);
  assert.ok(one.body.includes('INCONCLUSIVE') && one.body.includes(FLAKY_ID), `the filed issue's body doesn't say INCONCLUSIVE and name ${FLAKY_ID}:\n${one.body}`);
  assert.ok(namesCommit(one.body, repo.head), `the filed issue's body doesn't name the head the test failed at, ${repo.head.slice(0, 10)}, as main-watch's does:\n${one.body}`);
  assert.ok(/^\W*FAIL\b/m.test(one.body) && /^\W*PASS\b/m.test(one.body), `the filed issue doesn't list its runs, a line each starting FAIL or PASS, as main-watch's does:\n${one.body}`);

  assert.ok(!text.includes(FLAKY_ID), `the flaky test is listed in ${KNOWN}\n${all}`);
  assert.ok(Object.hasOwn(JSON.parse(text).failures ?? {}, HELD_ID), `the record didn't list ${HELD_ID}, which fails when run alone too\n${all}`);
  assert.deepEqual(filed(box).filter(({ title }) => title.startsWith('Flaky:') && title.includes(HELD_ID)), [], `a failure that fails when run alone too was filed as flaky\n${all}`);
  assert.ok(flaky.slice(1).some(({ ok }) => ok), `the flaky test was never run again after it failed, so nothing showed it passes alone\n${all}`);
});
