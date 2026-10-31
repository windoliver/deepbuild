// The plug-in blocks' budgets (issue #365): node benchmarks/plugin-blocks.mjs <source-call | store-query | schedule-fire>.
// One process opens a record, the asks core, the supervisor and project trust in a temp folder, loads one package in
// the hub (the release lists it), and then:
// - source-call: 200 reads of a polled source against an HTTP server on 127.0.0.1, its freshness 1 ms so each read calls;
// - store-query: 10,000 items put in the package's store, then 1,000 lookups of random keys, from inside the package;
// - schedule-fire: a schedule every second on the real clock, until its job ran three times.
// It prints how long the work took, as one JSON line. The issue's limits (5 ms beyond the network, 10 ms at p95 over
// 100,000 rows, 1 s) stay in tests/acceptance/365/budgets.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openExtensionHost, openTrust, packageDigest } from '../packages/extension-host/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const task = process.argv[2];
const CODE = {
  'source-call': `export default async function (deep: any): Promise<void> {
  await deep.registerSource('ext.bench.price', { variant: 'polled', host: 'api.bench.example', path: '/q', quota: { per_minute: 1000000, per_day: 10000000 }, timeout: 5000, freshFor: 1,
    parse: (answer: any) => ({ value: Number(JSON.parse(answer.body).price), unit: 'USD' }) });
}
`,
  'store-query': `const strict = (properties: any) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export default async function (deep: any): Promise<void> {
  await deep.store('ext.bench.item', { generation: 1, schema: strict({ n: { type: 'integer' } }) });
  deep.registerAction('ext.bench.fill', { declares: 'change', changes: ['ext.bench.item'], input: strict({ from: { type: 'integer' }, count: { type: 'integer' } }), output: strict({ taken: { type: 'integer' } }) },
    async (input: any) => { for (let n = input.from; n < input.from + input.count; n++) await deep.store.put('ext.bench.item', 'k' + n, { n }); return { output: { taken: input.count }, report: { verified: true, checked: 'puts answered' } }; });
  deep.registerAction('ext.bench.lookup', { declares: 'read', reads: ['ext.bench.item'], input: strict({ keys: { type: 'array', items: { type: 'string' } } }), output: strict({ found: { type: 'integer' } }) },
    async (input: any) => { let found = 0; for (const k of input.keys) if (await deep.store.get('ext.bench.item', k)) found++; return { found }; });
}
`,
  'schedule-fire': `let fired = 0;
export default async function (deep: any): Promise<void> {
  await deep.schedule('ext.bench.tick', { every: 1000, deadline: 5000, declares: { readings: [], notices: [], stores: [], sends: [], noop: true } }, async () => { fired++; return { noop: 'benchmark' }; });
  deep.registerAction('ext.bench.fired', { declares: 'read', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, output: { type: 'object', properties: { fired: { type: 'integer' } }, required: ['fired'], additionalProperties: false } },
    async () => ({ fired }));
}
`,
}[task];
if (!CODE) throw Error('usage: node benchmarks/plugin-blocks.mjs <source-call | store-query | schedule-fire>');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-blocks-bench-')));
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const trust = await openTrust({ record, now: Date.now });
const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"price":187.25}'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
// The source's host, routed to the local server; nothing else is reachable.
const http = async (request, signal) => {
  const url = new URL(request.url);
  if (url.hostname !== 'api.bench.example') throw Error(`no route to ${url.hostname}`);
  const res = await fetch(`http://127.0.0.1:${port}${url.pathname}`, { method: request.method, headers: request.headers, redirect: 'manual', signal });
  return { status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() };
};
const folder = join(dir, 'pkg');
mkdirSync(folder);
writeFileSync(join(folder, 'index.ts'), CODE);
const manifest = {
  id: 'bench/bench', version: '1.0.0', digest: '', access: { words: ['hosts'] }, stores: ['ext.bench.item'], actions: ['ext.bench.fill', 'ext.bench.lookup', 'ext.bench.fired'],
  sources: [{ name: 'ext.bench.price', variant: 'polled' }], requires: { preview: ['deep.registerSource', 'deep.store', 'deep.store.put', 'deep.store.get', 'deep.registerAction', 'deep.schedule'] },
};
writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
manifest.digest = packageDigest(folder);
writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
const home = join(dir, 'home');
mkdirSync(home);
const host = await openExtensionHost({ record, supervisor, trust, home, release: [{ id: manifest.id, version: manifest.version, digest: manifest.digest }], now: Date.now, http });
const target = { handle: 'ext:bench/bench', version: '1.0.0' };
const you = { writer: 'app', actor: 'you', scope: 'you' };
try {
  await host.ready();
  const installed = await host.install({ from: folder, builtBy: null, grant: { hosts: [{ host: 'api.bench.example', quota: { calls: 1_000_000, per_ms: 3_600_000 } }] } });
  if (!(await host.check(installed)).passed) throw Error('the benchmark package failed conformance');
  if ((await host.load(installed)).status !== 'loaded') throw Error('the benchmark package did not load');
  const t0 = performance.now();
  if (task === 'source-call') {
    for (let i = 0; i < 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const read = await host.readSource('ext.bench.price');
      if (read.status !== 'reading') throw Error(`the read: ${JSON.stringify(read)}`);
    }
  } else if (task === 'store-query') {
    for (let from = 0; from < 10_000; from += 1_000) await host.callAction({ action: 'ext.bench.fill', target, input: { from, count: 1_000 }, caller: you });
    const keys = Array.from({ length: 1_000 }, (_, i) => `k${(i * 7919) % 10_000}`);
    const out = await host.callAction({ action: 'ext.bench.lookup', target, input: { keys }, caller: you });
    if (out.status !== 'done' || out.output.found !== keys.length) throw Error(`the lookups: ${JSON.stringify(out)}`);
  } else {
    for (let fired = 0; fired < 3;) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const out = await host.callAction({ action: 'ext.bench.fired', target, input: {}, caller: you });
      fired = out.status === 'done' ? out.output.fired : 0;
    }
  }
  console.log(JSON.stringify({ task, ms: performance.now() - t0 }));
} finally {
  await host.close();
  server.close();
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
