// The corpus recorder's redaction (scripts/corpus-redact.mjs): your home folder, user name and email addresses never
// reach a recorded set, in a value or in an object's key. Codex 0.166 keys a FileChange item's `changes` by the file's
// absolute path, so a redactor that rewrites values only leaks your home path through the key (found recording
// Codex 0.166.0-alpha.5.1 for #39).
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import { test } from 'node:test';
import { redactor } from '../scripts/corpus-redact.mjs';

const home = process.env.HOME;
const user = userInfo().username;

test('a home path, user name and email are redacted in values', () => {
  const out = redactor()({ cwd: `${home}/work`, note: `ran by ${user} <someone@example.org>`, list: [`/Users/${user}/x`] });
  assert.deepEqual(out, { cwd: '~/work', note: `ran by ${user} <user@example.com>`, list: ['/Users/user/x'] });
});

test('a home path in an object key is redacted, and the value under it kept', () => {
  const item = { type: 'file_change', changes: { [`${home}/work/notes.md`]: { type: 'update', unified_diff: '+two' } } };
  const out = redactor()(item);
  assert.deepEqual(Object.keys(out.changes), ['~/work/notes.md']);
  assert.deepEqual(out.changes['~/work/notes.md'], { type: 'update', unified_diff: '+two' });
  assert.ok(!JSON.stringify(out).includes(home), `the home path ${home} reached the redacted item: ${JSON.stringify(out)}`);
});
