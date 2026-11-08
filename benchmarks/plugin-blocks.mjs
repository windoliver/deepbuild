// The plug-in blocks' budgets (issues #365, #262, #66): node benchmarks/plugin-blocks.mjs <source-call | store-query |
// schedule-fire | batch-refresh | value-at-position | work-item>.
// One process opens a record, the asks core, the supervisor and project trust in a temp folder, loads one package in
// the hub (the release lists it), and then:
// - source-call: 200 reads of a polled source against an HTTP server on 127.0.0.1, its freshness 1 ms so each read calls;
// - store-query: 10,000 items put in the package's store, then 1,000 lookups of random keys, from inside the package;
// - schedule-fire: a schedule every second on the real clock, until its job ran three times;
// - batch-refresh: 20 calls of a 500-series source, each landing one batch, then its 500 bound values read live;
// - value-at-position: 360 batches landed, then 200 bound values each pinned to a random earlier batch's log position;
// - work-item: a work source over a tracker on 127.0.0.1, run every second on the real clock; five items made one at a
//   time, each timed from when the tracker holds it to when it is a task (#66's 60 s stays in tests/acceptance/66).
// It prints how long the work took, as one JSON line (for the last two, the reads alone). The issues' limits (5 ms
// beyond the network, 10 ms at p95 over 100,000 rows, 1 s; 1 ms for 500 values, 1 ms at p50) stay in
// tests/acceptance/365/budgets.test.ts and tests/acceptance/262/budgets.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';
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
  'work-item': `export default async function (deep: any): Promise<void> {
  await deep.registerSource('ext.bench.work', { variant: 'stream', host: 'api.bench.example', quota: { per_minute: 1000000, per_day: 10000000 }, delivers: 'comment',
    read: (stream: any, cursor: any, limit: number) => { const s = cursor === null ? 0 : Number(cursor); const events = stream.events.slice(s, s + limit); return { events, cursor: String(s + events.length) }; },
    list: async (ctx: any, q: any) => ({ items: JSON.parse((await ctx.fetch({ method: 'GET', path: '/items' })).body).map((i: any) => ({ id: i.id, scope: q.scope, created: i.at, updated: i.at, mention: false })), cursor: null }),
    item: async (ctx: any, q: any) => {
      const i = JSON.parse((await ctx.fetch({ method: 'GET', path: '/items/' + q.id })).body);
      return { events: [{ id: i.id + '@' + i.at, kind: 'item', at: i.at, marker: null, mention: false, data: { source_id: i.id, link: 'https://bench.example/' + i.id, title: 'Item ' + i.id, body: 'Its body', criteria: [], authors: [{ handle: 'you', role: 'owner' }], updated: i.at } }] };
    },
    deliver: async () => ({ outcome: 'sent' }), find: async () => null });
}
`,
}[task] ?? (['batch-refresh', 'value-at-position'].includes(task) ? `export default async function (deep: any): Promise<void> {
  await deep.registerSource('ext.bench.fleet', { variant: 'polled', host: 'api.bench.example', path: '/fleet', shape: 'series', quota: { per_minute: 1000000, per_day: 10000000 }, timeout: 5000, freshFor: 1,
    parse: (answer: any) => ({ values: JSON.parse(answer.body), unit: 'rps' }) });
}
` : undefined);
if (!CODE) throw Error('usage: node benchmarks/plugin-blocks.mjs <source-call | store-query | schedule-fire | batch-refresh | value-at-position | work-item>');
const items = [];
const SERIES = Array.from({ length: 500 }, (_, i) => `svc${String(i).padStart(3, '0')}`);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-blocks-bench-')));
const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: Date.now });
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now, evidence });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const trust = await openTrust({ record, now: Date.now });
let calls = 0;
const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' })
  .end(req.url === '/fleet' ? JSON.stringify(Object.fromEntries(SERIES.map((s, i) => [s, ((++calls * 31 + i * 7) % 1000) / 10])))
    : req.url === '/items' ? JSON.stringify(items) : req.url.startsWith('/items/') ? JSON.stringify(items.find((i) => req.url === `/items/${i.id}`) ?? {}) : '{"price":187.25}'));
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
  sources: [{ name: 'ext.bench.price', variant: 'polled' }, { name: 'ext.bench.fleet', variant: 'polled' }, { name: 'ext.bench.work', variant: 'stream', reading: 'work.item@1' }], requires: { preview: ['deep.registerSource', 'deep.store', 'deep.store.put', 'deep.store.get', 'deep.registerAction', 'deep.schedule'] },
};
writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
manifest.digest = packageDigest(folder);
writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
const home = join(dir, 'home');
mkdirSync(home);
const host = await openExtensionHost({ record, supervisor, trust, home, release: [{ id: manifest.id, version: manifest.version, digest: manifest.digest }], now: Date.now, http, evidence });
const target = { handle: 'ext:bench/bench', version: '1.0.0' };
const you = { writer: 'app', actor: 'you', scope: 'you' };
try {
  await host.ready();
  const installed = await host.install({ from: folder, builtBy: null, grant: { hosts: [{ host: 'api.bench.example', quota: { calls: 1_000_000, per_ms: 3_600_000 } }] } });
  if (!(await host.check(installed)).passed) throw Error('the benchmark package failed conformance');
  if ((await host.load(installed)).status !== 'loaded') throw Error('the benchmark package did not load');
  // A batch lands once a call answers; the reads are what these two time.
  const land = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const read = await host.readSource('ext.bench.fleet');
    if (read.status !== 'batch') throw Error(`the call: ${JSON.stringify(read)}`);
    return read.batch;
  };
  const handles = SERIES.map((s) => `reading:ext.bench.fleet#${s}`);
  let t0 = performance.now();
  let spent = null;
  if (task === 'batch-refresh') {
    spent = 0;
    for (let i = 0; i < 20; i++) {
      await land();
      const start = performance.now();
      const values = await host.boundValues(handles);
      spent += performance.now() - start;
      if (values.some((v) => v.status !== 'reading')) throw Error(`the bound values: ${JSON.stringify(values.slice(0, 2))}`);
    }
  } else if (task === 'value-at-position') {
    const positions = [];
    for (let i = 0; i < 360; i++) {
      const { handle } = await land();
      const [row] = await record.raw('SELECT log_pos FROM events WHERE id = ?', [handle.slice('reading:'.length)]);
      positions.push(row.log_pos);
    }
    t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      const [v] = await host.boundValues([handles[(i * 7919) % 500]], { log_pos: positions[(i * 104729) % (positions.length - 1)] });
      if (v.status !== 'reading') throw Error(`the pinned value: ${JSON.stringify(v)}`);
    }
  } else if (task === 'work-item') {
    await host.addWorkSource(you, { source: 'ext.bench.work', scope: 'bench', every: 1000 });
    for (let n = 1; n <= 5; n++) {
      items.push({ id: `item-${n}`, at: new Date().toISOString() });
      while (!(await host.workTasks()).some((t) => t.id === `item-${n}`)) await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } else if (task === 'source-call') {
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
  console.log(JSON.stringify({ task, ms: spent ?? performance.now() - t0 }));
} finally {
  await host.close();
  server.close();
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
