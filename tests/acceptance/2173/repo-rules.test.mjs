// #2173 AC1: the issue's public command must exit 0 on the real checkout.
// AC2 reuses #246's scratch-repository negative control; see README.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import { root, rules, show } from '../246/helpers.mjs';

test('AC1: node scripts/repo-rules.mjs exits 0 on main', (t) => {
  const result = rules(root);
  t.diagnostic(show(result));
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'the command must finish normally');
  assert.equal(result.status, 0, 'issue #2173 requires exit 0; see command output');
});
