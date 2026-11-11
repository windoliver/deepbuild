// Helpers for #1874's acceptance tests, on top of #1116's (imported unchanged): issues with a body of the test's own,
// a criterion's ID as the trace lane computes it, and the commit that makes the fixture's task name criteria. Nothing
// here imports the code under test: the window is reached by running it (README: The surface).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { budgets, LONG } from '../1116/helpers.mjs';

/** A window takes minutes on a loaded machine: the test's own limit, and the window's. */
export const SLOW = { timeout: 3_000_000, skip: LONG.skip };
export const WINDOW_MS = 1_500_000;

/** `#<issue>.<h8>`: the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed. */
export const criterionId = (number, text) => `#${number}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

/** The IDs of an issue's unticked criteria, read from its body as the trace lane reads them. */
export function unticked(number, body) {
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- \[ \] (.+)$/gm)].map(([, text]) => criterionId(number, text));
}

/** An open issue in the stand-in gh's state, with this body. */
export function fileBody(box, number, body) {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title: `Fixture ${number}`, state: 'OPEN', body, comments: [] }));
}

/**
 * One commit on the fixture's main, pushed, after which its one task names `criteria` (README: The surface). It lands
 * before the first window's mark, so no window measures it and every later commit's merge base holds the same task.
 * Returns the commit, which also adds tags/<name>.
 */
export function nameCriteria(box, repo, criteria, name = 'task-names') {
  const manifest = JSON.parse(budgets());
  manifest.tasks[0].criteria = criteria;
  const work = join(box.dir, 'work');
  mkdirSync(join(work, 'tags'), { recursive: true });
  writeFileSync(join(work, 'benchmarks/budgets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(work, 'tags', name), '');
  repo.git('add', '-A');
  repo.git('commit', '-qm', `The fixture's task names the criteria it proves (${name})`);
  repo.git('push', '-q', 'origin', 'main');
  return repo.git('rev-parse', 'HEAD');
}
