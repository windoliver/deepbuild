// The Linux backend (#70) against the seam's own suite, as #236's acceptance tests run Seatbelt against it on macOS
// (tests/acceptance/236/suite.test.ts): every case holds on bubblewrap, each planted twin fails its own case and no
// other, and a run through the supervisor is scanned, refused and recorded as the seam promises.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type Event } from '@deepbuild/record';
import { afterEach, describe, expect, test } from 'vitest';
import { bubblewrap, openSupervisor, plantedBackends, sandboxSuite, HELPER } from './index.js';

const linux = process.platform === 'linux';
const dirs: string[] = [];
const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/deep-bwrap-'));
  dirs.push(dir);
  return dir;
}
function unixListener(path: string): Promise<{ path: string; connections: () => number }> {
  let n = 0;
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => { n++; sock.on('error', () => undefined).resume(); });
    servers.push(server);
    server.once('error', reject);
    server.listen(path, () => resolve({ path, connections: () => n }));
  });
}
const CASES = ['egress', 'write-outside', 'read-outside', 'hub-socket', 'inbox-socket', 'camera', 'microphone', 'audio-output', 'screen-capture'];

describe.skipIf(!linux)('the seam\'s suite on bubblewrap', () => {
  test('passes, every case run, and nothing reached the hub\'s or the inbox socket', async () => {
    const dir = tempDir();
    const hub = await unixListener(join(dir, 'hub.sock'));
    const inbox = await unixListener(join(dir, 'inbox.sock'));
    const result = await sandboxSuite(bubblewrap, { hubSocket: hub.path, inboxSocket: inbox.path });
    expect(result.cases.map((c) => c.name)).toEqual(CASES);
    expect(result.cases.filter((c) => !c.ok), 'cases that failed on bubblewrap').toEqual([]);
    expect(result.passed).toBe(true);
    expect(bubblewrap.platform).toBe('linux');
    expect(hub.connections(), 'a sandboxed process reached the hub\'s socket').toBe(0);
    expect(inbox.connections(), 'a sandboxed process reached the inbox socket').toBe(0);
  }, 120_000);

  test.each(['egress', 'write-outside', 'hub-socket', 'camera'] as const)('fails the planted backend %s, naming its case and no other', async (name) => {
    const dir = tempDir();
    const hub = await unixListener(join(dir, 'hub.sock'));
    const inbox = await unixListener(join(dir, 'inbox.sock'));
    const fixtures = { hubSocket: hub.path, inboxSocket: inbox.path };
    const result = await sandboxSuite(plantedBackends(fixtures)[name], fixtures);
    expect(result.passed).toBe(false);
    expect(result.cases.filter((c) => !c.ok).map((c) => c.name)).toEqual([name]);
  }, 120_000);
});

describe.skipIf(!linux)('a run through the supervisor on Linux', () => {
  test('its processes are found by the run\'s marker, an undeclared write and a connect to the hub\'s socket are refused and recorded, and a declared write lands', async () => {
    const dir = tempDir();
    const [cwd, out, outside] = ['run', 'out', 'outside'].map((n) => { mkdirSync(join(dir, n)); return join(dir, n); }) as [string, string, string];
    const hub = await unixListener(join(dir, 'hub.sock'));
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
    try {
      // A shell that writes where it may and where it may not, tries the hub's socket, then lingers so the scan finds it.
      const script = `echo granted > ${out}/w.txt; echo stolen > ${outside}/w.txt; ${HELPER} probe ${out}/tries.json unix ${hub.path}; sleep 1; exit 3`;
      const started = await sup.start({ run: 'run:BWRAP', argv: ['/bin/sh', '-c', script], cwd, grant: { read: [HELPER.slice(0, HELPER.lastIndexOf('/'))], write: [out], sockets: [] } });
      expect(started.status).toBe('started');
      const exit = await sup.wait('run:BWRAP');
      expect(exit.code, 'the program\'s own exit code comes through the sandbox').toBe(3);
      expect(existsSync(join(out, 'w.txt'))).toBe(true);
      expect(existsSync(join(outside, 'w.txt')), 'the undeclared write left no file').toBe(false);
      expect(hub.connections(), 'the hub\'s socket was never reached').toBe(0);
      const events = (await record.read({ after: 0, limit: 10_000 })) as Event[];
      const denied = events.filter((e) => e.kind === 'sandbox.denied').map((e) => e.data as { run: string; operation: string; target: string });
      expect(denied).toContainEqual({ run: 'run:BWRAP', operation: 'file-write-create', target: join(outside, 'w.txt') });
      expect(denied).toContainEqual({ run: 'run:BWRAP', operation: 'network-outbound', target: hub.path });
      const tracked = events.filter((e) => e.kind === 'process.tracked' && (e.data as { run: string }).run === 'run:BWRAP');
      expect(tracked.length, 'the shell and what it started, found by the marker, not only the process the supervisor spawned').toBeGreaterThan(1);
    } finally {
      await sup.close();
      await record.close();
    }
  }, 60_000);

  test('a run as you writes your files but not a guarded path, and the refusal names it', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'guarded'));
    mkdirSync(join(dir, 'guarded', 'jobs'));
    writeFileSync(join(dir, 'guarded', 'kept.txt'), 'kept\n');
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, guarded: [{ path: join(dir, 'guarded'), except: [join(dir, 'guarded', 'jobs')] }] });
    try {
      const script = `echo mine > ${dir}/mine.txt; echo job > ${dir}/guarded/jobs/j.txt; echo changed > ${dir}/guarded/kept.txt; mv ${dir}/guarded ${dir}/moved`;
      const started = await sup.start({ run: 'run:ASYOU', argv: ['/bin/sh', '-c', script], cwd: dir, grant: { run_as_you: true } });
      expect(started.status).toBe('started');
      await sup.wait('run:ASYOU');
      expect(existsSync(join(dir, 'mine.txt')), 'your files, as you').toBe(true);
      expect(existsSync(join(dir, 'guarded', 'jobs', 'j.txt')), 'the folder left to the run\'s grant').toBe(true);
      expect(existsSync(join(dir, 'guarded', 'kept.txt')), 'the guarded path stays where it is').toBe(true);
      expect(existsSync(join(dir, 'moved'))).toBe(false);
      const denied = ((await record.read({ after: 0, limit: 10_000 })) as Event[]).filter((e) => e.kind === 'sandbox.denied').map((e) => (e.data as { operation: string; target: string }));
      expect(denied.map((d) => d.target)).toContain(join(dir, 'guarded', 'kept.txt'));
      expect(denied.map((d) => d.target)).toContain(join(dir, 'guarded'));
    } finally {
      await sup.close();
      await record.close();
    }
  }, 60_000);
});
