import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openLeases, SLOW_SLOT } from '@deepbuild/leases';
import { openRecord, ulid } from '@deepbuild/record';
import { HeavyQueue } from '@deepbuild/hub/lease';

it('AC3: a late grant cannot erase C, and a ticket absent from queue and holdings is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac2122-queue-'));
  const now = () => Date.now();
  const record = await openRecord({ path: join(dir, 'record.db'), now });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = once(child, 'exit');
  let openGate!: (free: boolean) => void;
  let entered!: () => void;
  const atGate = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<boolean>((resolve) => { openGate = resolve; });
  let pendingA: Promise<Record<string, unknown>> | undefined;
  try {
    await once(child, 'spawn');
    const table = await openLeases({ record, now, cores: 8 });
    // The real table's external resource-availability probe is the only gate.
    await table.declare('core', { name: 'browser', match: 'exact', cap: 8, cooldown: 0, cost: 0 }, async () => { entered(); return gate; });
    await table.declare('core', { name: 'gpu', match: 'exact', cap: 8, cooldown: 0, cost: 0 });
    const blocker = await table.lease({ holder: 'cli' }, { host: 'local', kind: 'gpu', key: 'gpu' }, 'shared');
    expect(blocker.status).toBe('granted');
    const q = new HeavyQueue({
      table, now, slow: SLOW_SLOT, pressure: () => 'normal', free: () => 100e9,
      worktreeOf: () => undefined, agentOf: () => undefined,
      append: async (kind, v, data, subject, session) => {
        const id = ulid(now());
        await record.append({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}) }, {
          id, kind, v, ts: now(), data: data as JsonValue, ...(subject ? { subject } : {}),
        });
        return id;
      },
    });
    const live = { pid: process.pid, start: '' };
    pendingA = q.wait({ kinds: ['browser'], command: 'build A', cwd: dir, jobs: 'none' }, { pid: child.pid!, start: '' }, async () => 'A');
    await atGate;
    const c = await q.wait({ kinds: ['gpu:exclusive'], command: 'render C', cwd: dir, jobs: 'none' }, live, async () => 'C');
    expect(c.status).toBe('waiting');
    expect(c.line).toContain('gpu');
    child.kill('SIGTERM');
    await exited;
    await q.tick();
    openGate(true);
    expect((await pendingA).status, 'A receives the delayed real table grant after its process left').toBe('granted');
    const poll = await q.wait({ ticket: c.ticket, secret: c.secret }, live, async () => 'C').catch((error: Error) => ({ status: 'refused', line: error.message }));
    const kinds = (await table.leases()).filter((v) => v.lease.holder === 'session:C').map((v) => v.lease.resource.kind);
    console.log('AC3 C poll:', poll.status, 'C held kinds:', kinds);
    expect.soft(poll.status, 'C must still wait, not receive a replacement cpu.slot-only grant or a lost-ticket refusal').toBe('waiting');
    expect.soft(poll.line, 'the original GPU requirement must survive').toContain('gpu');
    expect.soft(kinds, 'a GPU-blocked C must hold no partial cpu.slot lease').toEqual([]);
    const missing = await q.wait({ ticket: 'lease-wait:not-held', secret: 'not-held' }, live, async () => 'unknown').then(
      (reply) => ({ status: String(reply.status), message: '' }),
      (error: Error) => ({ status: 'refused', message: error.message }),
    );
    console.log('AC3 unknown-ticket poll:', missing.status);
    expect.soft(missing.status, 'a ticket nothing holds must not start a new command').toBe('refused');
    expect.soft(missing.message).toContain('this deep lease lost its place in the queue; run it again');
  } finally {
    openGate(true);
    await pendingA?.catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
