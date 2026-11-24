// #3300 criterion 1: "Each test in `tests/acceptance/896/` and `tests/acceptance/854/` that judges a made-up reading
// passes on any Mac; on the merge base the same tests fail, naming \"the load at each run's start and end can't be read\""
//
// One row per test the issue lists as judging a made-up reading (its "Tests that judge a made-up reading"). The first
// draft is frozen, so the test that runs in its place is its blind redraft: scripts/lanes.mjs `redrafted` sends the
// first draft's file to a redraft folder inside the suite's own folder, the first draft runs by hand only (`byHand`),
// and the redraft is timed where the first draft was (`timed`). The redraft's file of the same name carries every test
// of the first draft's, by full name, and its test of this row's name passes, run by vitest on this Mac; the first
// draft's same test fails, naming the load it can't read. README: Criterion 1. The wrong programs: the merge base (no
// redraft in the lanes' place); a redraft that drops or renames a test; a redraft whose made-up runs still give no loads,
// or whose idle runs give no shown window; a lanes entry that leaves the first draft in the unit lane.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { AC1, CANT_READ, lanes, REPO, vitestRun } from './helpers.ts';

interface Row { label: string; file: string; name: string; firstDraftFails: boolean; runs: boolean }
/** A row; `label`, its file's suite and name and the test's ordinal there, keeps the test's name short (vitest cuts a long `$` value). */
const row = (label: string, file: string, name: string, extra: Partial<Row> = {}): Row => ({ label, file, name, firstDraftFails: true, runs: true, ...extra });

/** The tests that judge a made-up reading, by file and a part of their name, as the issue lists them (file and lines). */
const ROWS: Row[] = [
  row('896/settled #3', 'tests/acceptance/896/settled.test.ts', "the lane's judge fails a reading past 4 ms in all five runs"),
  row('896/dirty #4', 'tests/acceptance/896/dirty.test.ts', "the lane's judge fails a reading whose CPU per patch doubles from 1,000 to 10,000 items"),
  row('896/dirty #7', 'tests/acceptance/896/dirty.test.ts', "the lane's judge fails a reading whose one-item patch uploads 640 KB"),
  row('854/patch #3', 'tests/acceptance/854/patch.test.ts', "the lane's judge fails a reading whose p95 is past 4 ms in all five runs"),
  row('854/scene-read #4', 'tests/acceptance/854/scene-read.test.ts', "the lane's judge fails a reading whose summary is 2,000 tokens or more"),
  row('854/idle #4', 'tests/acceptance/854/idle.test.ts', "the lane's judge fails a reading that drew frames while still"),
  row('854/replica #3', 'tests/acceptance/854/replica.test.ts', "the lane's judge fails a reading past 300 ms in all five runs"),
  // The rest of this test builds deep-show (cargo build --locked --bin deep-show), so it runs in its suite's own lane,
  // never here: this row holds its lanes entry and its name, and its first draft fails before the build (README).
  row('854/release #1', 'tests/acceptance/854/release.test.ts', "the lane refuses each task's perf reading taken from a debug build (dev)", { runs: false }),
  row('854/replica-redraft #2', 'tests/acceptance/854/replica-redraft.test.ts', "the lane's judge fails a reading within 300 ms whose first frames compiled pipelines"),
  // The issue's :89–103 spans this test too. It reads FAIL on the pipeline, which a missing load doesn't stop, so its
  // first draft passes on the merge base as well (README: Readings where the issue leaves a choice).
  row('854/replica-redraft #3', 'tests/acceptance/854/replica-redraft.test.ts', "the lane's judge fails a reading in which one run's first frame compiled a pipeline", { firstDraftFails: false }),
];

const listed = (path: string, list: readonly string[]): boolean => list.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

test.each(ROWS)(`${AC1} $label: the test of the first draft that judges a made-up reading runs as its blind redraft inside the suite's folder, which passes on this Mac, while the first draft runs by hand and fails, naming the load`, async ({ file, name, firstDraftFails, runs }) => {
  const { byHand, redrafted, timed } = await lanes();
  const suite = `${dirname(file)}/`;
  const folder = redrafted[file];
  expect(folder, `scripts/lanes.mjs redrafted names the blind redraft that runs in ${file}'s place`).toEqual(expect.any(String));
  expect(folder!.startsWith(suite) && folder !== suite && folder!.endsWith('/'), `${file}'s redraft is a folder inside ${suite}: ${folder}`).toBe(true);
  expect(existsSync(join(REPO, folder!)), `the redraft folder ${folder} is in the checkout`).toBe(true);
  expect(byHand, `${file}, the frozen first draft, runs by hand only`).toContain(file);
  const redraft = `${folder}${basename(file)}`;
  if (listed(file, timed)) expect(listed(redraft, timed), `${redraft} is timed, as ${file} is`).toBe(true);
  expect(listed(redraft, byHand), `${redraft} runs in the unit lane, not by hand`).toBe(false);

  const first = vitestRun(file, name);
  const second = vitestRun(redraft, runs ? name : 'no test of #3300 has this name');
  const names = (results: { fullName: string }[]): string[] => results.map((r) => r.fullName).sort();
  expect(names(first.results).length, `vitest reads the first draft's tests:\n${first.output}`).toBeGreaterThan(0);
  expect(names(second.results), `${redraft} carries every test of ${file}, each full name unchanged:\n${second.output}`).toEqual(names(first.results));

  const was = first.results.filter((r) => r.title.includes(name));
  expect(was.length, `${file} has one test named "${name}"`).toBe(1);
  if (firstDraftFails) {
    expect(was[0]!.status, `${file}'s first draft fails "${name}" on this Mac`).toBe('failed');
    expect(was[0]!.failureMessages.join('\n'), `and names the load it can't read`).toContain(CANT_READ);
  }
  if (runs) {
    const now = second.results.filter((r) => r.fullName === was[0]!.fullName);
    expect(now.map((r) => r.status), `${redraft} passes "${name}" on this Mac:\n${now.flatMap((r) => r.failureMessages).join('\n').slice(0, 3000)}\n${second.output}`).toEqual(['passed']);
  }
}, 600_000);
