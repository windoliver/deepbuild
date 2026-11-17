// Supervised probes must keep the ordinary report/crash contract and the service's narrow network grant.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { checkHost, openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { workFill, type ServiceSpec } from '@deepbuild/checks-work';
import { runProbe } from '@deepbuild/conformance/findings';

let dir: string, record: RecordStore, supervisor: Supervisor;
beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-probe-host-')));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
}, 60_000);
afterAll(async () => { await supervisor?.close(); await record?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

it.each([
  ['report', `process.stdout.write(JSON.stringify({outcome:'failed',testsRun:1,failures:[{test:'unicode',file:'input.txt',line:2,stack:null,assertion:true,message:'café differs'}],read:['input.txt']})+'\\n')`, 'failed', true, 'café differs'],
  ['crash', `throw Error('probe crashed before its assertion')`, 'failed', false, 'probe crashed'],
  ['malformed', `console.log('not JSON')`, 'failed', false, 'invalid JSON'],
] as const)('hosted %s retains its outcome, assertion classification and output', async (name, source, outcome, assertion, message) => {
  const probe = join(dir, `${name}.mjs`); writeFileSync(probe, source);
  const scope = checkHost(supervisor);
  try {
    const result = await runProbe(probe, {}, { checkout: dir, deadline: 10_000, now: Date.now, host: scope.host }, { kind: 'fixture', file: 'input.txt' });
    expect(result.outcome).toBe(outcome);
    expect(result.testsRun).toBe(assertion ? 1 : 0);
    expect(result.failures[0]).toMatchObject({ assertion, message: expect.stringContaining(message) });
  } finally { await scope.close(); }
}, 30_000);

it('a refused host start is missing and never falls back to local execution', async () => {
  const probe = join(dir, 'never.mjs'); writeFileSync(probe, 'throw Error("must not run")');
  const scope = checkHost(supervisor);
  await scope.close();
  const result = await runProbe(probe, {}, { checkout: dir, deadline: 10_000, now: Date.now, host: scope.host }, { kind: 'fixture', file: probe });
  expect(result.outcome).toBe('missing');
  expect(result.testsRun).toBe(0);
  expect(result.failures[0]).toMatchObject({ assertion: false, message: expect.stringContaining('the check ended') });
});

it('a supervised service reaches its declared loopback endpoint', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{"count":7}'); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('the fixture did not listen');
  const scope = checkHost(supervisor);
  const spec: ServiceSpec = { kind: 'service', runner: 'http', inputs: [], depth: 'integration', oracle: 'code', contract: null,
    url: `http://127.0.0.1:${address.port}/`, from: '127.0.0.1', shape: { count: 'number' }, requests: 1, floor: { latency_ms: 10_000, throughput_rps: 0 } };
  try {
    const result = await workFill('service').run(spec, { checkout: dir, deadline: 20_000, now: Date.now, host: scope.host });
    expect(result.outcome, JSON.stringify(result)).toBe('passed');
    expect(result.testsRun).toBe(3);
    expect(requests).toBe(1);
    const events = await record.read({ after: 0, limit: 1000 });
    expect(events.some(e => e.kind === 'process.tracked' && (e.data as { cwd: string }).cwd === dir)).toBe(true);
  } finally { await scope.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30_000);
