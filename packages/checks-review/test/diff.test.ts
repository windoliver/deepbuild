// The -U0 diff reader a re-review follows cited lines through.
import { expect, it } from 'vitest';
import { follow, hunks } from '../src/diff.js';

it('reads a removed line that starts with "-- " as a removed line, not as a file header', () => {
  // Failed on a reader that took every line starting "--- " for a header: the second hunk went to a file named
  // "drop the old index", so line 50, which the commit rewrote, read as still there.
  const diff = [
    'diff --git a/schema.sql b/schema.sql',
    '--- a/schema.sql',
    '+++ b/schema.sql',
    '@@ -10 +9,0 @@',
    '--- drop the old index',
    '@@ -50 +49 @@',
    '-create index a on t (x);',
    '+create index a on t (x, y);',
    'diff --git a/other.sql b/other.sql',
    '--- a/other.sql',
    '+++ b/other.sql',
    '@@ -3 +3 @@',
    '-select 1;',
    '+select 2;',
  ].join('\n');
  expect(hunks(diff).map((h) => h.file)).toEqual(['schema.sql', 'schema.sql', 'other.sql']);
  expect(follow('schema.sql', 50, hunks(diff))).toBeNull();
  expect(follow('schema.sql', 60, hunks(diff))).toBe(59);
});
