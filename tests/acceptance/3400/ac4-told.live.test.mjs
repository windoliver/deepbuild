// Criterion 4, the others (live: needs network and gh signed in with read access to windoliver/deepbuild): the others
// are told of the taste call, and can overrule it. As on the three design issues before this one, they are told by a
// comment on the issue: one that names the criterion and says the call can be overruled, made no earlier than the
// recorded call (README.md, Telling the others). Code can't read whether anyone saw it. When gh can't read the
// comments the test skips as INCONCLUSIVE, unless the missing record already fails it; it never passes then.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPO, gh, listed, readRecord, toldProblems } from './helpers.mjs';

test('AC4 #3400.28fd1eed (live) a comment on #3400, made no earlier than the recorded taste call, names the criterion and says the others can overrule the call', (t) => {
  const record = readRecord();
  const read = gh(['issue', 'view', '3400', '--repo', REPO, '--json', 'comments']);
  let comments = null;
  try {
    comments = JSON.parse(read.out).comments ?? [];
  } catch { /* no reply, or one that isn't JSON: unread */ }
  const unread = comments ? '' : `gh couldn't read #3400's comments (signed out, offline or no access): ${read.why ?? 'its reply was not JSON'}`;
  const problems = [...(record.call ? [] : [record.why]), ...(comments ? toldProblems(comments, record.call) : [])];
  assert.ok(!problems.length, `the others on the project aren't told of the taste call:${listed(problems)}${unread && `\n(${unread})`}`);
  if (unread) t.skip(`INCONCLUSIVE: ${unread}, so nothing shows the others were told`);
});
