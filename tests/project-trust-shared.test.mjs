// Moving trust below the extension host must not create independent caches: the wiki and the host share answers.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRecord, openTrust } from '@deepbuild/record';
import { openTrust as hostTrust } from '@deepbuild/extension-host';

test('record and extension-host trust readers share decisions and revocations across symlink paths', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'deep-shared-trust-'));
  const project = join(folder, 'project');
  const link = join(folder, 'project-link');
  mkdirSync(project);
  symlinkSync(project, link, 'dir');
  const record = await openRecord({ path: join(folder, 'ledger.db'), now: Date.now });
  try {
    const wiki = await openTrust({ record, now: Date.now });
    const host = await hostTrust({ record, now: Date.now });
    assert.equal(await wiki.trusted(project), false, 'prime the negative cache before approving through the other entry');
    await host.answer({ writer: 'app', actor: 'you', scope: 'you' }, link, true);
    assert.equal(await wiki.trusted(project), true);
    assert.equal(await host.trusted(link), true);
    await wiki.answer({ writer: 'app', actor: 'you', scope: 'you' }, project, false);
    assert.equal(await host.trusted(link), false, 'revocation is visible immediately through the other entry');
    await assert.rejects(host.answer({ writer: 'hook', actor: 'agent', scope: 'you' }, project, true), /trusted path/);
    assert.equal(await wiki.trusted(project), false, 'an untrusted caller cannot reopen the project');
    const decisions = (await record.read({ after: 0, kinds: ['decision.created'] })).filter(event => event.kind === 'decision.created');
    assert.equal(decisions.length, 2);
    assert.deepEqual(decisions.map(event => event.data.answer), ['trusted', 'not trusted']);
    assert.equal(decisions[0].data.key, decisions[1].data.key, 'both paths name one decision key');
  } finally {
    await record.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
