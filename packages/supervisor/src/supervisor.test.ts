import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { afterEach, expect, test } from 'vitest';
import { openSupervisor } from './index.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// A guarded path is kept whole: a run that may write everything else can't move a folder above it aside and put its
// own in its place, which would leave the guard on a path no longer there.
test('a run as you can rename no folder above a guarded path', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supervisor-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'tools', '1.0', 'bin'), { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, guarded: [join(dir, 'tools', '1.0', 'bin')] });
  try {
    const script = 'mv tools/1.0 tools/old; mv tools tools-old; mkdir -p elsewhere && echo ok > elsewhere/f && mv elsewhere moved';
    const started = await sup.start({ run: 'run:TEST', argv: ['/bin/sh', '-c', script], cwd: dir, grant: { run_as_you: true } });
    expect(started.status).toBe('started');
    await sup.wait('run:TEST');
    expect(existsSync(join(dir, 'tools', '1.0', 'bin'))).toBe(true);
    // Folders above nothing guarded move as before.
    expect(existsSync(join(dir, 'moved', 'f'))).toBe(true);
  } finally {
    await sup.close();
    await record.close();
  }
}, 60_000);
