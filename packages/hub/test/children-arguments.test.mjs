// #1906: moving execFile off the core thread must preserve invalid-argument rejection, not read it as no changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenItems } from '../dist/open-items.js';
import { SizeScope } from '../dist/scope.js';

const unused = () => { throw Error('the invalid child arguments must reject before any record read'); };

test('an open-item read rejects the same invalid cwd as execFile', async () => {
  const items = new OpenItems({ raw: unused, append: unused, connection: unused, asks: unused, pin: unused, now: Date.now, github: unused, taskList: unused });
  await assert.rejects(items.atClaim({ session: 's1906', agent: 'claude-code', task: 't1906', cwd: '\0', base: 'HEAD', message: 'Done.', transcript: undefined, pr: undefined }), { code: 'ERR_INVALID_ARG_VALUE' });
});

test('accepted-history reads reject an invalid revision instead of reporting no history', async () => {
  const scope = new SizeScope({ raw: unused, append: unused, connection: unused, asks: unused, now: Date.now, pin: unused, keep: unused, scopeOf: unused, evidence: '', accepted: undefined });
  await assert.rejects(scope.usual(process.cwd(), 'fix', '\0'), { code: 'ERR_INVALID_ARG_VALUE' });
});
