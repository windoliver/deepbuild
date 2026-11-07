// The teardown check a repo drafts: passes once the resource the hub names in DEEP_RESOURCE_KEY is gone from the provider.
// It fails closed: a check that can't see the provider at all, which a sandbox would hide as a missing file, doesn't pass.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('the resource is gone', () => {
  const key = process.env.DEEP_RESOURCE_KEY;
  assert.ok(key, 'the check is told which resource to look for, in DEEP_RESOURCE_KEY');
  assert.ok(existsSync('.cloud/provider'), 'the check can read the provider');
  assert.equal(existsSync(join('.cloud', key)), false, `${key} still exists at the provider`);
});
