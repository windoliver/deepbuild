// Criterion 3 (live: needs network and gh signed in with read access to windoliver/deepbuild): #726, #109, #1567 and
// #1568 each link into the new text, a `docs/technical-design.md#<anchor>` link in the issue's body whose anchor lands
// in One hub for a project, once that section answers the four decisions (README.md, A link into the new text). An
// issue gh can't read makes the test skip as INCONCLUSIVE, unless something already read fails it; it never passes
// then.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB, NO_HUB, REPO, decisionProblems, gh, linkProblems, listed, readDesign, sectionAt } from './helpers.mjs';

const ISSUES = [726, 109, 1567, 1568];

test('AC3 #3242.4156bcc2 (live) #726, #109, #1567 and #1568 each have a body link that lands in One hub for a project, where the new text answers the four decisions', (t) => {
  const section = sectionAt(readDesign(), HUB);
  assert.ok(section, NO_HUB);
  const problems = decisionProblems(section.lines).map((problem) => `the section holds no new text to link into yet: ${problem}`);
  const bodies = [], unread = [];
  for (const number of ISSUES) {
    const read = gh(['issue', 'view', String(number), '--repo', REPO, '--json', 'body']);
    try {
      bodies.push([number, JSON.parse(read.out).body ?? '']);
    } catch {
      unread.push(`#${number} (${read.why ?? 'its reply was not JSON'})`);
    }
  }
  problems.push(...linkProblems(bodies, section));
  assert.ok(!problems.length, `the issues don't each link into the new text:${listed(problems)}${unread.length ? `\n(gh couldn't read ${unread.join(', ')})` : ''}`);
  if (unread.length) t.skip(`INCONCLUSIVE: gh couldn't read ${unread.join(', ')}, so its links are unread (signed out, offline or no access)`);
});
