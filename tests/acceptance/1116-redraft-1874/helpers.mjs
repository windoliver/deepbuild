// What #1116's helpers (imported unchanged) lack under #1874's rule: a fixture whose task names the fixture issues'
// budget criteria by ID, through #1874's surface (tests/acceptance/1874/README.md: The surface).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileIssue, fixture, issue, marked, TASK } from '../1116/helpers.mjs';
import { criterionId, nameCriteria } from '../1874/helpers.mjs';

/** The ID of a filed fixture issue's budget criterion: its unticked line that names the task. */
export function budgetCriterion(box, number) {
  const [, text] = issue(box, number).body.match(new RegExp(`^- \\[ \\] (.*${TASK}.*)$`, 'm'));
  return criterionId(number, text);
}

/** A commit on the fixture's main, pushed, after which the task names each of these issues' budget criterion. */
export const named = (box, repo, numbers, name) => nameCriteria(box, repo, numbers.map((number) => budgetCriterion(box, number)), name);

/** A commit on the fixture's main that only adds tags/<name>, pushed. */
export function plain(box, repo, name) {
  writeFileSync(join(box.dir, 'work', 'tags', name), '');
  repo.git('add', '-A');
  repo.git('commit', '-qm', `The fixture at ${name}`);
  repo.git('push', '-q', 'origin', 'main');
  return repo.git('rev-parse', 'HEAD');
}

/** #1116's oneMerged, with the task naming the issue's budget criterion before the first window's mark. */
export async function oneMerged(box, number, { files = {}, proven = true } = {}) {
  const repo = fixture(box);
  fileIssue(box, number, { proven });
  const from = named(box, repo, [number]);
  await marked(box, repo);
  repo.branch('x', from, number, files);
  return { repo, commit: repo.merge('x', number) };
}
