// The runtime environment API must exist beyond the install kit, and missing providers must never start work.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRecord, openTrust } from '@deepbuild/record';
import { openAsks } from '@deepbuild/asks';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost } from '@deepbuild/extension-host';

test('runtime environment selection refuses a missing provider before starting any process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-runtime-environment-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60000 } } } });
  const home = join(dir, 'extensions');
  mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor, trust: await openTrust({ record, now: Date.now }), home, release: [], now: Date.now });
  try {
    await host.ready();
    assert.equal(typeof host.environment, 'function', 'registered environments need a runtime selection surface, not only an install kit');
    await assert.rejects(host.environment('absent'), /no loaded.*environment.*absent/);
    assert.equal((await record.read({ after: 0, kinds: ['process.starting'] })).length, 0);
  } finally {
    await host.close();
    await supervisor.close();
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
