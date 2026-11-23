// A run's refusals have a ceiling and a target a bounded length on every path that records them (#2420). The egress
// filter's path is proven by tests/acceptance/2420; this is the Linux sandbox parent's, whose refusals come on a pipe
// and are never dropped, so the events while it lives are exactly 256 and the closing one exactly one; the closing
// count is a floor, since the shell may be refused something of its own. The macOS log reader shares the same code
// but its stream may drop reports under load, so no count can be asserted there.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type Event } from '@deepbuild/record';
import { afterEach, describe, expect, test } from 'vitest';
import { openSupervisor } from './index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'linux')('the Linux sandbox parent\'s refusals', () => {
  test('past 256 targets are counted in one closing event, and a long target is cut to 512 bytes and its length', async () => {
    const dir = realpathSync(mkdtempSync('/tmp/deep-ceiling-'));
    dirs.push(dir);
    const [cwd, outside] = ['run', 'outside'].map((n) => { mkdirSync(join(dir, n)); return join(dir, n); }) as [string, string];
    // A path over 512 bytes, its folders made here, outside the run's sandbox, so only the file's create is refused.
    const deep = join(outside, 'd'.repeat(200), 'e'.repeat(200), 'f'.repeat(200));
    mkdirSync(deep, { recursive: true });
    const long = join(deep, 'w.txt');
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
    try {
      // The long write first, so it falls under the ceiling, then 300 more at different paths.
      const script = `echo x > ${long} 2>/dev/null; i=0; while [ $i -lt 300 ]; do echo x > ${outside}/w$i.txt 2>/dev/null; i=$((i+1)); done; exit 0`;
      const started = await sup.start({ run: 'run:CEILING', argv: ['/bin/sh', '-c', script], cwd, grant: { write: [cwd] } });
      expect(started.status).toBe('started');
      await sup.wait('run:CEILING');
      const before = ((await record.read({ after: 0, limit: 100_000 })) as Event[])
        .filter((e) => e.kind === 'sandbox.denied' && (e.data as { run: string }).run === 'run:CEILING').map((e) => e.data as { operation: string; target: string });
      expect(before.length, 'run:CEILING\'s events naming a target while it lives').toBe(256);
      const bytes = Buffer.byteLength(long);
      expect(before.map((d) => d.target), 'the long target as its first 512 bytes and its full length').toContain(`${long.slice(0, 512)}…${bytes}`);
      await sup.cleanup('run:CEILING');
      const after = ((await record.read({ after: 0, limit: 100_000 })) as Event[])
        .filter((e) => e.kind === 'sandbox.denied' && (e.data as { run: string }).run === 'run:CEILING').map((e) => e.data as { operation: string; target: string });
      const more = after.filter((d) => d.operation === 'more');
      expect(more.length, 'one closing event once run:CEILING ends').toBe(1);
      // At least the 301 writes were refused; the shell may have been refused something of its own too.
      expect(256 + Number(more[0]!.target), 'the closing event counts every new target left out').toBeGreaterThanOrEqual(301);
      expect(after.length, 'nothing else was added for run:CEILING').toBe(257);
    } finally {
      await sup.close();
      await record.close();
    }
  }, 120_000);
});
