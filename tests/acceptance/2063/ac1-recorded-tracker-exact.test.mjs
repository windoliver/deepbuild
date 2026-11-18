// Criterion 1, tightened on review with the owner's approval. It supersedes ac1-recorded-tracker-ruled.test.mjs, whose
// FAIL branch passed a lane that reports brief.uncited and more. On the owner's ruling that `brief.uncited` is a recorded
// event kind, the lane on the recorded tracker with the ruled list (fixtures/not-event-kinds-2026-11-14-ruled.txt)
// reports exactly brief.uncited from its one record source, #1193, when the catalogue lacks it, and passes when the
// catalogue holds it. No other name the record holds in backticks may appear in its output.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { CHECKOUT, RECORD, listEntries, naming, runLane } from './helpers.mjs';

const RULED_LIST = join(CHECKOUT, 'tests/acceptance/2063/fixtures/not-event-kinds-2026-11-14-ruled.txt');
const TODAY = [['plan.overlay', 1260], ['move.feel', 274], ['process.conserve', 980], ['archive.scene', 2036], ['stack.slot', 335]];
const KIND = 'brief.uncited';
// A backticked `<family>.<name>`, as the lane reads a name.
const DOTTED = /`([a-z][a-z_]*\.[a-z][a-z_]*)`/g;
// A name as a whole token in an output line: not part of a longer name, a path or a file name.
const token = (name) => new RegExp(`(?<![\\w./-])${name.replace(/[.]/g, '\\.')}(?![\\w/-]|\\.\\w)`);
// The issue numbers a line gives with `#`.
const issuesIn = (line) => [...line.matchAll(/#(\d+)(?!\d)/g)].map((m) => Number(m[1]));

test('#2063.1fc4ef66 criterion 1 (exact, on the ruling that brief.uncited is an event kind): on the recorded tracker copy the lane fails with an empty list, naming the five names with their issues; with the day\'s list it reports exactly brief.uncited from #1193 and no other name the record holds when the catalogue lacks brief.uncited, and passes when the catalogue holds it', async (t) => {
  const issues = JSON.parse(readFileSync(RECORD, 'utf8'));
  const list = readFileSync(RULED_LIST, 'utf8');
  const { catalogue } = await import(pathToFileURL(join(CHECKOUT, 'packages/contracts/dist/index.js')).href);
  const kinds = new Set(catalogue().map((entry) => entry.kind));
  const catalogued = kinds.has(KIND);
  // Every name the record holds in backticks that the catalogue lacks: the names the lane could report.
  const uncatalogued = new Set(issues.flatMap(({ body }) => [...(body ?? '').matchAll(DOTTED)].map((m) => m[1])).filter((name) => !kinds.has(name)));
  // The record's sources of brief.uncited (the docs are planted and don't name it).
  const sources = issues.filter(({ body }) => (body ?? '').includes(`\`${KIND}\``)).map(({ number }) => number);
  assert.deepEqual(sources, [1193], `the recorded tracker names ${KIND} in #1193 alone`);

  // Before, as on main: no listed name, so the lane reads each as an event kind the catalogue lacks.
  const before = runLane(t, { docs: 'planted', issues, list: '' });
  assert.deepEqual(before.verdicts, ['FAIL'], `with an empty list the lane's verdict on the recorded tracker is FAIL:\n${before.output}`);
  assert.notEqual(before.status, 0, `runLanes returned 0 with an empty list:\n${before.output}`);
  for (const [name, issue] of TODAY) assert.ok(naming(before, name, issue), `with an empty list, no output line names ${name} and issue ${issue}:\n${before.output}`);

  // The day's list: `<name> #<issue>` beside a recorded issue that names it, the five among them, brief.uncited not.
  const entries = listEntries(list);
  for (const entry of entries) {
    assert.ok(entry.name, `the recorded list holds a line that isn't \`<name> #<issue>\`: ${JSON.stringify(entry.line)}`);
    assert.ok(issues.find((issue) => issue.number === entry.issue)?.body.includes(`\`${entry.name}\``), `the recorded list holds ${entry.name} beside #${entry.issue}, which is not a recorded open issue that names \`${entry.name}\``);
  }
  for (const [name, issue] of TODAY) assert.ok(entries.some((entry) => entry.name === name && entry.issue === issue), `the recorded list doesn't hold ${name} #${issue}`);
  assert.ok(!entries.some((entry) => entry.name === KIND), `the recorded list holds ${KIND}, which the owner ruled an event kind`);

  // After: the recorded issues with the day's list as the copy's scripts/not-event-kinds.txt.
  const after = runLane(t, { docs: 'planted', issues, list });
  // The exact set: no name of the record but brief.uncited appears in the output, listed or not. A lane that still
  // reports a listed name, or over-reports a name in another family, fails here.
  const reported = [...uncatalogued].filter((name) => name !== KIND && after.lines.some((line) => token(name).test(line)));
  assert.deepEqual(reported, [], `with the day's list the lane reports names other than ${KIND}:\n${after.output}`);
  if (catalogued) {
    assert.deepEqual(after.verdicts, ['PASS'], `${KIND} is catalogued, so with the day's list the lane's verdict on the recorded tracker is PASS:\n${after.output}`);
    assert.equal(after.status, 0, `runLanes didn't return 0 with the day's list and ${KIND} catalogued:\n${after.output}`);
  } else {
    assert.deepEqual(after.verdicts, ['FAIL'], `${KIND} is an event kind the catalogue lacks, so with the day's list the lane's verdict on the recorded tracker is FAIL:\n${after.output}`);
    assert.notEqual(after.status, 0, `runLanes returned 0 with ${KIND} an uncatalogued event kind:\n${after.output}`);
    assert.ok(naming(after, KIND, 1193), `no output line names ${KIND} and issue 1193:\n${after.output}`);
    // Its sources, and only those: every issue a line beside brief.uncited gives with `#` is #1193.
    const others = [...new Set(after.lines.filter((line) => token(KIND).test(line)).flatMap(issuesIn))].filter((n) => !sources.includes(n));
    assert.deepEqual(others, [], `the lane names ${KIND} beside issues the record doesn't name it in:\n${after.output}`);
  }
});
