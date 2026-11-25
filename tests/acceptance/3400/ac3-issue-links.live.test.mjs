// Criterion 3 (live: needs network and gh signed in with read access to windoliver/deepbuild): #3397 and #3398 each
// link into the new text. Both linked One hub for a project before this issue wrote a line, so a link counts only
// when it lands in that section, once it answers the three decisions, and either uses an anchor the design didn't
// have at the base or sits on a line of the issue's body that holds a decision's words (README.md, A link into the
// new text). An issue gh can't read makes the test skip as INCONCLUSIVE, unless something already read fails it; it
// never passes then.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB, NO_HUB, REPO, baseDesign, decisionProblems, gh, linkProblems, listed, readDesign, sectionAt } from './helpers.mjs';

const ISSUES = [3397, 3398];

test("AC3 #3400.8f95766f (live) #3397 and #3398 each have a body link into the new text: one that lands in One hub for a project, where the three decisions are answered, by an anchor the design gained or from a line that holds a decision's words", (t) => {
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
  problems.push(...linkProblems(bodies, section, baseDesign()));
  assert.ok(!problems.length, `the issues don't each link into the new text:${listed(problems)}${unread.length ? `\n(gh couldn't read ${unread.join(', ')})` : ''}`);
  if (unread.length) t.skip(`INCONCLUSIVE: gh couldn't read ${unread.join(', ')}, so its links are unread (signed out, offline or no access)`);
});
