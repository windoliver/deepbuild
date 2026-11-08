// Stack policy uses its supplied environment lifecycle, not env-local hidden inside the policy module.
// The actual shipped provider is exercised here with a real supervisor, record and HTTP server.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { openAsks } from '@deepbuild/asks';
import { openLeases } from '@deepbuild/leases';
import { openSupervisor } from '@deepbuild/supervisor';
import { answers, downStack, leaseKinds, newRun, portKind, upStack } from '@deepbuild/env-local';
import { Stacks } from '../src/stacks.js';

it('uses the supplied provider for start, health reuse and teardown, without bypassing the supervisor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-stack-provider-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const ports = portKind();
  for (const kind of leaseKinds) await leases.declare('env-local', kind, kind.name === ports.kind ? ports.free : undefined);
  const supervisor = await openSupervisor({ record, asks, leases, now: Date.now, resources: [ports], settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const calls: string[] = [];
  const stacks = new Stacks({
    raw: (sql, params) => record.raw(sql, params), now: Date.now, plant: undefined, held: [], scrub: () => undefined,
    appendCore: async (kind, data, extra) => { await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: newRun().slice(4), kind, ts: Date.now(), data: data as JsonValue, ...extra }); },
    supervisor: () => supervisor, leases: () => leases, stopping: () => false, session: () => undefined, pending: () => false, idle: () => true, plantedAsk: async () => undefined,
    environment: {
      newRun,
      up: options => { calls.push('up'); return upStack(supervisor, options); },
      healthy: stack => { calls.push('health'); return answers(stack); },
      down: run => { calls.push('down'); return downStack(supervisor, run); },
      warm: () => { throw Error('no warm stack in this test'); }, wanted: () => false, keys: () => { throw Error('no keys in this test'); },
    },
  });
  try {
    mkdirSync(join(dir, '.deepbuild'));
    writeFileSync(join(dir, 'server.mjs'), "import http from 'node:http';http.createServer((_,r)=>r.end('ok')).listen(Number(process.env.web),'127.0.0.1');\n");
    const quoted = `'${process.execPath.replaceAll("'", "'\\''")}' server.mjs`;
    writeFileSync(join(dir, '.deepbuild/done.yaml'), `environment:\n  up: ${JSON.stringify(quoted)}\n  ports: [web]\n  ready: {http: "http://127.0.0.1:\${web}/health", within: 10}\n`);
    const first = await stacks.up(dir);
    expect(first.status).toBe('ready');
    expect(await stacks.up(dir)).toEqual(first);
    expect(calls).toEqual(['up', 'health']);
    const down = await stacks.down(dir, { path: '/worktree', remedy: 'deep env up' });
    expect(down.left).toEqual([]);
    expect(calls).toEqual(['up', 'health', 'down']);
    const rows = await record.read({ after: 0, kinds: ['process.tracked', 'process.ended'] });
    expect(rows.some(event => event.kind === 'process.tracked' && event.data && typeof event.data === 'object' && 'run' in event.data && event.data.run === first.run)).toBe(true);
  } finally {
    await stacks.close();
    await supervisor.close();
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
