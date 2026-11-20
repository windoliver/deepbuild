// #2818's first criterion (README: Criteria → tests). A record on main over every test file and crate, through the real
// `node scripts/affected.mjs --record` in a fixture repository whose main holds this checkout's scripts; then this
// checkout's own scripts/known-failures.json, read for what doesn't change with the calendar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { assert, check, CHECKOUT, day, dump, filed, issues, KNOWN, knownFile, LONG, mainRepo, namesCommit, namesMainCommit, record, sandbox, seedIssue, shown, SUFFIX } from './helpers.mjs';

const VITEST = 'tests/fixture-2818/held.test.ts', NODE = 'tests/fixture-2818-held.test.mjs', CRATE = 'crates/fixture-2818';
// Every test that fails on the fixture's main, by the ID affected.mjs gives it.
const FAILING = [`${VITEST} › fails on main`, `${NODE} › fails on main`, 'cargo -p fixture-2818 --lib › tests::fails_on_main'];
// An earlier record's entries: one whose test passes now, and one whose test file is gone.
const PASSES_NOW = `${NODE} › passes on main`, GONE = 'tests/fixture-2818-gone.test.mjs › was deleted';
const FILES = {
  [VITEST]: "import { expect, test } from 'vitest';\n\ntest('passes on main', () => { expect(1).toBe(1); });\ntest('fails on main', () => { expect(1).toBe(2); });\n",
  [NODE]: "import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest('passes on main', () => { assert.equal(1, 1); });\ntest('fails on main', () => { assert.equal(1, 2); });\n",
  [`${CRATE}/Cargo.toml`]: '[package]\nname = "fixture-2818"\nversion = "0.1.0"\nedition = "2021"\n',
  [`${CRATE}/src/lib.rs`]: '#[cfg(test)]\nmod tests {\n    #[test]\n    fn passes() { assert_eq!(1, 1); }\n    #[test]\n    fn fails_on_main() { assert_eq!(1, 2); }\n}\n',
};
// What an issue for a failure's cause names: its test's file, or for a cargo test the target that reruns it.
const subject = (id) => id.split(' › ')[0];

test('#2818.7301b617 node scripts/affected.mjs --record, run on main over every test file and crate, lists the tests that fail there at the named head, each entry ending "(#<open issue>, added <date>)" with an open issue for its cause, and node scripts/known-failures-check.mjs passes; this checkout\'s scripts/known-failures.json holds that shape', LONG, async (t) => {
  const box = sandbox(t);
  const earlier = day(Date.now() - 2 * 86_400_000);
  seedIssue(box, 9801);
  seedIssue(box, 9802);
  const repo = mainRepo(box, FILES, knownFile({ failures: {
    [PASSES_NOW]: `fails on main 0a1b2c3d4e: an earlier record's failure (#9801, added ${earlier})`,
    [GONE]: `fails on main 0a1b2c3d4e: a test since deleted (#9802, added ${earlier})`,
  } }));
  const from = Date.now();
  const result = await record(box, repo, [VITEST, NODE, `${CRATE}/src/lib.rs`]);
  const today = new Set([day(from), day()]);
  const text = readFileSync(join(repo.cwd, KNOWN), 'utf8');
  const failures = JSON.parse(text).failures ?? {};
  const all = `${dump(result)}\n${KNOWN} after the record:\n${text}\nissues on the stand-in's GitHub:\n${shown(issues(box))}`;

  for (const id of FAILING) assert.ok(Object.hasOwn(failures, id), `the record didn't list ${id}, which fails on main\n${all}`);
  for (const id of FAILING) assert.match(failures[id], SUFFIX, `${id}'s entry doesn't end "(#<open issue>, added <date>)"\n${all}`);
  for (const id of FAILING) assert.ok(namesCommit(failures[id], repo.head), `${id}'s entry doesn't name the head it was recorded at, ${repo.head.slice(0, 10)}, by seven or more hex digits\n${all}`);
  for (const id of FAILING) assert.ok(today.has(failures[id].match(SUFFIX)[2]), `${id}'s entry says it was added on ${failures[id].match(SUFFIX)[2]}, not on the day of the record, ${[...today].join(' or ')}\n${all}`);
  for (const id of FAILING) {
    const number = Number(failures[id].match(SUFFIX)[1]);
    const issue = issues(box).find((one) => one.number === number);
    assert.ok(issue?.state === 'OPEN', `${id}'s entry names #${number}, which isn't an open issue on the stand-in's GitHub\n${all}`);
    assert.ok(`${issue.title}\n${issue.body}`.includes(subject(id)), `${id}'s entry names #${number}, an issue that doesn't name ${subject(id)}, so it isn't one for this failure's cause:\n${shown([issue])}\nissues the record filed:\n${shown(filed(box))}`);
  }
  assert.deepEqual(Object.keys(failures).sort(), [...FAILING].sort(), `the record lists other tests than those that fail on main at its head: ${PASSES_NOW} passes there and ${GONE} is in no test file\n${all}`);

  const checked = await check(box, repo);
  assert.equal(checked.status, 0, `node scripts/known-failures-check.mjs fails on what the record wrote\n${dump(checked)}\n${all}`);

  // This checkout's own file, by what holds whatever the date: whether each issue is still open, and each entry still
  // within its 14 days, is the lint lane's to read (README: Readings).
  const own = JSON.parse(readFileSync(join(CHECKOUT, KNOWN), 'utf8')).failures ?? {};
  const unended = Object.keys(own).filter((id) => !SUFFIX.test(own[id]));
  assert.deepEqual(unended, [], `these entries of this checkout's ${KNOWN} don't end "(#<issue>, added <YYYY-MM-DD>)"`);
  const headless = Object.keys(own).filter((id) => !namesMainCommit(own[id]));
  assert.deepEqual(headless, [], `these entries of this checkout's ${KNOWN} name no head of main they fail at, a commit at or before HEAD, by seven or more hex digits`);
});
