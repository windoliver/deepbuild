// Helpers for #1835's acceptance tests, on top of #1116's and #1874's (imported unchanged): the fixture's change, whose
// tests prove the first two of an issue's three criteria; the real trace lane run on it; that lane's evidence record;
// and an issue's criteria read from its body as the trace lane reads them. Nothing here imports the code under test:
// the trace lane and the window are reached by running them (README: The surface).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, ended, launch } from '../1116/helpers.mjs';
import { criterionId } from '../1874/helpers.mjs';

/** The trace lane runs each tagged test on two copies of the fixture, which takes minutes on a loaded machine: its limit. */
const TRACE_MS = 900_000;

// What each fixture change fixes: the issue's own module, wrong on main until its change lands.
export const WRONG = 'export const add = (a, b) => a - b;\nexport const half = (n) => n;\n';
const RIGHT = 'export const add = (a, b) => a + b;\nexport const half = (n) => n / 2;\n';
export const source = (number) => `src/sums-${number}.mjs`;
// A test of the fixture, tagged with the criterion it proves. The tag is built here from the criterion's text, so no
// file of this folder carries the tag of a planted issue.
const proving = (number, tag, name, check) => `import assert from 'node:assert/strict';
import { it } from 'node:test';
import { add, half } from '../../../${source(number)}';

it('${tag} ${name}', () => {
  ${check}
});
`;

/**
 * The files of a change that proves an issue's first two criteria and no other: the fix of its module, and one tagged
 * test for each, which fails on the merge base at its assertion.
 */
export const provesTwo = (number, [sum, halving]) => ({
  [source(number)]: RIGHT,
  [`tests/acceptance/${number}/add.test.mjs`]: proving(number, criterionId(number, sum), 'adds two numbers', 'assert.equal(add(2, 3), 5);'),
  [`tests/acceptance/${number}/half.test.mjs`]: proving(number, criterionId(number, halving), 'halves a number', 'assert.equal(half(8), 4);'),
});

/**
 * A `Part of #number` change, landed: a branch from `fork` holding `files`, the real trace lane run on its tip in a
 * clean checkout (`node scripts/proof.mjs trace`, this checkout's, with its cwd at the fixture), then the branch
 * merged into main with a merge commit, as the merge button leaves it, and pushed. Returns the lane's run, the tree
 * it ran on (the tip's), the tip and the commit on main.
 */
export async function land(box, repo, number, files, fork) {
  const name = `change-${number}`;
  const tip = repo.branch(name, fork, number, files);
  repo.git('checkout', '-q', name);
  const trace = await ended(launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'trace'], { cwd: join(box.dir, 'work') }), TRACE_MS);
  repo.git('checkout', '-q', 'main');
  return { trace, tip, tree: repo.tree(tip), commit: repo.merge(name, number) };
}

/** The trace lane's own line on a `Part of #number` change, which names each criterion it left open (#569). */
export const partOfLine = (trace, number) => trace.stdout.split('\n').find((line) => line.startsWith('PASS trace:') && line.includes(`Part of #${number}`)) ?? '';

/** The name of the trace lane's evidence record for a tree, under ~/.deepbuild/lanes/ (README: The surface). */
export const recordName = (tree) => `${tree}-trace.json`;
/** That record, or null when the lane left none. */
export function traceRecord(box, tree) {
  try {
    return JSON.parse(readFileSync(join(box.home, '.deepbuild', 'lanes', recordName(tree)), 'utf8'));
  } catch {
    return null;
  }
}
/** The criteria of `ids` a record proves: each that a row of its tests names, the row's ID holding the criterion's, with the state PASS. */
export const provenIn = (record, ids) => ids.filter((id) => (Array.isArray(record.tests) ? record.tests : []).some((row) => row?.state === 'PASS' && String(row.id).includes(id)));

/**
 * An issue's criteria, read from its body as the trace lane's readIssue reads them: the `- [ ]`, `- [x]` and `- [X]`
 * lines under `### Acceptance criteria`, up to the next heading. Each has its ID, whether it is ticked, and its item:
 * its own line and what follows it, up to the next criterion's line or the section's end.
 */
export function criteriaIn(number, body) {
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  const lines = [...section.matchAll(/^\s*- \[([ xX])\] (.+)$/gm)];
  return lines.map(([, box, text], at) => ({ id: criterionId(number, text), ticked: box !== ' ', item: section.slice(lines[at].index, lines[at + 1]?.index ?? section.length) }));
}
