// What a start leaves in memory (design: Numbers version 0 has to hold, Memory). The hub's threads and `deep mcp`
// load no built-in only a kit's case or a planted program uses; the check for a newer record reads it through
// SQLite's 2 MB page cache, as the record's writer does; and the collection a thread makes once it has started gives
// the start's garbage back, in the hub and in `deep mcp`, which idles for a session's life. Each case failed on the
// program it names: main at 435141d5.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, expect, it, vi } from 'vitest';
import { openRecord } from '@deepbuild/record';
import { unreadable } from '../src/readonly-core.js';
import { withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const SETTLE = pathToFileURL(fileURLToPath(new URL('../dist/settle.js', import.meta.url))).href;
const SETTLE_JSON = JSON.stringify(SETTLE);
const dir = mkdtempSync(join(tmpdir(), 'deep-startup-memory-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A preload that appends each module a thread loads, `<thread> <url>`, to $DEEP_TEST_LOADS. */
const LOADS = join(dir, 'loads.mjs');
writeFileSync(LOADS, `import { registerHooks } from 'node:module';\nimport { appendFileSync } from 'node:fs';\nimport { threadId } from 'node:worker_threads';\nregisterHooks({ load(url, context, next) { appendFileSync(process.env.DEEP_TEST_LOADS, threadId + ' ' + url + '\\n'); return next(url, context); } });\n`);
const loaded = (log: string): { thread: string; url: string }[] => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => ({ thread: l.slice(0, l.indexOf(' ')), url: l.slice(l.indexOf(' ') + 1) }));
/** Built-ins only a work kit's serving case (HTTP, about 1.5 MB of heap) or a planted wrong program (the inspector) uses. */
const UNUSED = /^node:(http|inspector)$/;

it("the hub's threads load no HTTP server or inspector at a start, and its event loop no record store", async () => {
  const log = join(dir, 'hub-loads.log');
  await withHub(async () => {
    const urls = loaded(log);
    const core = urls.find((l) => l.url.endsWith('/packages/hub/dist/core.js'))?.thread;
    expect(core, 'the core thread loaded the core').toBeDefined();
    expect(urls.some((l) => l.thread === core && l.url.endsWith('/packages/hub/dist/kinds.js')), 'the core thread holds the kinds table').toBe(true);
    expect(urls.filter((l) => UNUSED.test(l.url)).map((l) => `thread ${l.thread}: ${l.url.replace(/^.*\/packages\//, 'packages/')}`)).toEqual([]);
    // The event loop reads the record's generation for its hello: through the record's own small entry, about 0.5 MB less.
    const main = urls.find((l) => l.url.endsWith('/packages/hub/dist/server.js'))?.thread;
    expect(main, 'the main thread loaded the server').toBeDefined();
    expect(urls.some((l) => l.thread === main && l.url.endsWith('/packages/record/dist/meta.js')), 'the main thread read the generation').toBe(true);
    expect(urls.filter((l) => l.thread === main && /\/packages\/record\/dist\/(index|projections|learned)\.js$/.test(l.url)).map((l) => l.url.replace(/^.*\/packages\//, 'packages/'))).toEqual([]);
  }, { NODE_OPTIONS: `--import=${LOADS}`, DEEP_TEST_LOADS: log });
}, 60_000);

it('deep mcp loads no inspector', () => {
  const home = mkdtempSync(join(dir, 'mcp-home-'));
  const log = join(dir, 'mcp-loads.log');
  // Its input is at its end, so it serves nothing and leaves.
  spawnSync(process.execPath, ['--import', LOADS, CLI, 'mcp'], { cwd: home, env: { ...process.env, HOME: home, DEEP_TEST_LOADS: log }, input: '', encoding: 'utf8' });
  const urls = loaded(log);
  expect(urls.some((l) => l.url.endsWith('/packages/hub/dist/mcp.js')), 'deep mcp ran').toBe(true);
  expect(urls.filter((l) => UNUSED.test(l.url)).map((l) => l.url)).toEqual([]);
}, 60_000);

it("deep mcp loads what serves its client: no contracts, and Codex's settings for Codex alone", () => {
  const served = (client: string): string[] => {
    const home = mkdtempSync(join(dir, 'mcp-client-'));
    const log = join(home, 'loads.log');
    const hello = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: client } } };
    const ran = spawnSync(process.execPath, ['--import', LOADS, CLI, 'mcp'], { cwd: home, env: { ...process.env, HOME: home, DEEP_TEST_LOADS: log }, input: `${JSON.stringify(hello)}\n`, encoding: 'utf8' });
    expect(ran.stdout, `deep mcp answered ${client}'s initialize`).toContain('"serverInfo"');
    return loaded(log).map((l) => l.url.replace(/^.*\/packages\//, 'packages/'));
  };
  // The contracts' entry brings its validator, lint and code generators, and the settings their writers: about
  // 1.6 MB a session, which every Claude Code session held for one type guard and a timeout only Codex sets.
  const unused = served('claude-code').filter((url) => url.startsWith('packages/contracts/') || /^packages\/hub\/dist\/(codex-settings|claude-settings|agent-files)\.js$/.test(url));
  expect(unused).toEqual([]);
  // Codex gives its MCP server's tool calls its own timeout, which a call's wait reads from Codex's settings.
  expect(served('codex-mcp-client')).toContain('packages/hub/dist/codex-settings.js');
}, 60_000);

it("the asks core reads a long log at its open without growing a hub thread's heap", () => {
  const at = (path: string): string => JSON.stringify(pathToFileURL(fileURLToPath(new URL(path, import.meta.url))).href);
  const ledger = join(mkdtempSync(join(dir, 'long-log-')), 'ledger.db');
  // The core's thread, under the hub's own limit on its young generation: what outlives a page of events is promoted,
  // and the heap keeps the pages of that garbage until V8 shrinks it.
  const worker = `import { parentPort } from 'node:worker_threads';
const { openRecord } = await import(${at('../../record/dist/index.js')});
const { openAsks } = await import(${at('../../asks/dist/index.js')});
const { shedStartup } = await import(${SETTLE_JSON});
const record = await openRecord({ path: ${JSON.stringify(ledger)}, now: Date.now });
shedStartup();
const before = process.memoryUsage().heapTotal;
await openAsks({ record, now: Date.now, deliver: () => undefined });
const grew = process.memoryUsage().heapTotal - before;
await record.close();
parentPort.postMessage(grew);`;
  const script = `import { Worker } from 'node:worker_threads';
const { openRecord } = await import(${at('../../record/dist/index.js')});
const { ulid } = await import(${at('../../record/src/ids.js')});
const { YOUNG } = await import(${SETTLE_JSON});
let at = Date.now() - 86_400_000;
const record = await openRecord({ path: ${JSON.stringify(ledger)}, now: () => at });
for (let s = 0; s < 100; s++) {
  const session = ulid(at);
  const hook = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  const appends = [record.append(hook, { v: 1, id: ulid(++at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } })];
  for (let k = 0; k < 199; k++) appends.push(record.append(hook, { v: 1, id: ulid(++at), kind: k % 2 ? 'tool.after' : 'tool.before', ts: at, seq: String(BigInt(at) * 1000000n), data: { kind: 'shell', paths: [], command: 'npm test -- src/' + k + '.test.ts' } }));
  await Promise.all(appends);
}
await record.close();
const grew = await new Promise((resolve, reject) => { const core = new Worker(${JSON.stringify(worker)}, { eval: true, type: 'module', resourceLimits: YOUNG }); core.once('message', resolve); core.once('error', reject); });
console.log(JSON.stringify({ grew }));`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(ran.status, ran.stderr).toBe(0);
  const { grew } = JSON.parse(ran.stdout) as { grew: number };
  // Read a thousand events a page, 20,000 events grew the heap by 11 MB, and a month's record took the hub's footprint
  // to 150 MB at a start for the 95 MB it settles at.
  expect(grew / 2 ** 20, `the heap grew by ${(grew / 2 ** 20).toFixed(1)} MB over 20,000 events`).toBeLessThan(4);
}, 120_000);

it("the check for a newer record reads it through SQLite's 2 MB page cache", async () => {
  const root = mkdtempSync(join(dir, 'root-'));
  const ledger = join(root, 'ledger.db');
  await (await openRecord({ path: ledger, now: () => 1_760_013_451_000 })).close();
  const capped: string[] = [];
  const real = Database.prototype.pragma;
  const pragma = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (this: Database.Database, source: string, options?: Database.PragmaOptions) {
    if (this.readonly && source === 'cache_size = -2000') capped.push(this.name);
    return real.call(this, source, options);
  });
  try {
    expect(unreadable({ root, clock: { start: 0, real: 0 }, held: [] }), 'a record this build wrote is readable').toBeNull();
  } finally {
    pragma.mockRestore();
  }
  // Left at better-sqlite3's default, the check keeps up to 16 MB of a long record's pages at every start.
  expect(capped, 'the check set its cache before it read').toEqual([ledger]);
});

it("the collection a thread makes once started gives the start's garbage back", () => {
  // A heap as a start leaves it: most of what was made is garbage, spread among what stays.
  const script = `import { shedStartup } from ${JSON.stringify(SETTLE)};
const kept = [];
for (let i = 0; i < 600_000; i++) { const made = { at: i, name: 'n' + i, pair: [i, i + 1] }; if (i % 7 === 0) kept.push(made); }
shedStartup();
const { heapUsed, heapTotal } = process.memoryUsage();
console.log(JSON.stringify({ heapUsed, heapTotal, kept: kept.length }));`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(ran.status, ran.stderr).toBe(0);
  const { heapUsed, heapTotal, kept } = JSON.parse(ran.stdout) as { heapUsed: number; heapTotal: number; kept: number };
  expect(kept).toBe(85_715);
  // A collection that frees the garbage and keeps its pages leaves the heap several times what it uses.
  expect(heapTotal / heapUsed, `the heap holds ${(heapTotal / 2 ** 20).toFixed(1)} MB for the ${(heapUsed / 2 ** 20).toFixed(1)} MB it uses`).toBeLessThan(1.5);
}, 60_000);

it('an idle deep mcp holds little heap beyond what it uses', () => idleHeap('test'), 60_000);
// Codex's settings load once Codex names itself, after the start's collection: what loading them leaves is given back too.
it('an idle deep mcp that serves Codex holds little heap beyond what it uses', () => idleHeap('codex-mcp-client'), 60_000);

async function idleHeap(client: string): Promise<void> {
  const home = mkdtempSync(join(dir, 'mcp-idle-'));
  const out = join(home, 'heap.json');
  // A preload that writes the process's heap four seconds in, once its start has settled: whole, under its name by a rename.
  const report = join(dir, 'heap.mjs');
  writeFileSync(report, `import { renameSync, writeFileSync } from 'node:fs';\nconst out = process.env.DEEP_TEST_HEAP;\nsetTimeout(() => { writeFileSync(out + '.part', JSON.stringify(process.memoryUsage())); renameSync(out + '.part', out); }, 4000).unref();\n`);
  mkdirSync(join(home, 'work'));
  const child = spawn(process.execPath, ['--import', report, CLI, 'mcp'], { cwd: join(home, 'work'), env: { ...process.env, HOME: home, DEEP_TEST_HEAP: out }, stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const answered = new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: client } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    await answered;
    for (let i = 0; i < 200 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
    const { heapUsed, heapTotal } = JSON.parse(readFileSync(out, 'utf8')) as { heapUsed: number; heapTotal: number };
    // One that never collects after its start keeps over 4 MB it doesn't use, for a session's life.
    expect((heapTotal - heapUsed) / 2 ** 20, `deep mcp holds ${(heapTotal / 2 ** 20).toFixed(1)} MB of heap for the ${(heapUsed / 2 ** 20).toFixed(1)} MB it uses`).toBeLessThan(2.5);
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }
}
