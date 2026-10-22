// #42 AC6: 2,000 spans a second at under 5% of a core and 50 MB. The receiver runs on a real record in its own
// node process started here (the built `@deepbuild/otlp`, as doctor.test.ts runs the built CLI), a second
// process sends Claude Code trace exports (OTLP/HTTP protobuf, 200 spans every 100 ms), and this process only
// builds the load and asks the receiver process for its CPU time and memory. So the readings are the receiver's
// (and the record's appends) alone: not the sender's, and not this process's garbage from building 19 MB of
// bodies, whose heap would otherwise swing the resident set by far more than the limit (AC6-REDRAFT.md).
// Judged by the design's rule for timing results (as tests/acceptance/14): five 5 s runs after a 2 s warm-up;
// PASS when all are within the limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE.
// Off a reference Mac the result is a reading only and the test skips; it never passes by skipping.
// The merge-base comparison belongs to the perf lane (README: Criterion 6).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { allEvents, claudePrompt, environmentProblem, judge, OTLP, protobuf, removeRoots, REPO, tempRoot, traces } from './helpers.ts';

const problem = environmentProblem();
const open: RecordStore[] = [];
const children: ChildProcess[] = [];
beforeAll(() => {
  const built = spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (built.status !== 0) throw Error(`npm run build --workspaces failed:\n${built.stdout}\n${built.stderr}`);
}, 600_000);
afterEach(async () => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill();
  for (const o of open.splice(0)) await o.close();
  removeRoots();
}, 120_000);

const PER_REQUEST = 200, INTERVAL_MS = 100, WARM_S = 2, RUNS = 5, RUN_S = 5;
const REQUESTS = ((WARM_S + RUNS * RUN_S) * 1000) / INTERVAL_MS;
// The receiver process: opens the record at the given path, starts the receiver on a free port, reports its
// URL, then answers each IPC message: 'cpu' with its CPU and wall clocks, 'memory' with its resident set and
// retained heap after a full collection (it runs with --expose-gc), anything else by closing and exiting.
const RECEIVER = `const [recordModule, otlpModule, db, connection] = process.argv.slice(1);
const { openRecord } = await import(recordModule); const { startReceiver } = await import(otlpModule);
const record = await openRecord({ path: db, now: Date.now });
const receiver = await startReceiver({ record, connection: JSON.parse(connection), port: 0 });
process.on('message', async (m) => {
  if (m === 'cpu') { const c = process.cpuUsage(); process.send({ cpuUs: c.user + c.system, wallUs: Number(process.hrtime.bigint() / 1000n) }); }
  else if (m === 'memory') { gc(); const u = process.memoryUsage(); process.send({ rss: u.rss, retained: u.heapUsed + u.external }); }
  else { await receiver.close(); await record.close(); process.disconnect(); }
});
process.send({ url: receiver.url });`;
// Sends each length-prefixed body from the file on its own 100 ms tick, then prints the response codes.
const SENDER = `const fs=require('fs');const [file,url]=process.argv.slice(1);const buf=fs.readFileSync(file);const bodies=[];
for(let o=0;o<buf.length;){const n=buf.readUInt32LE(o);bodies.push(buf.subarray(o+4,o+4+n));o+=4+n;}
const t0=Date.now(),codes={},pending=[];(async()=>{for(let i=0;i<bodies.length;i++){const wait=t0+i*${INTERVAL_MS}-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
pending.push(fetch(url+'/v1/traces',{method:'POST',headers:{'content-type':'application/x-protobuf'},body:bodies[i]}).then(r=>r.arrayBuffer().then(()=>{codes[r.status]=(codes[r.status]||0)+1}),()=>{codes.error=(codes.error||0)+1}));}
await Promise.all(pending);console.log(JSON.stringify(codes));})();`;

interface Clocks { cpuUs: number; wallUs: number }
interface Memory { rss: number; retained: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AC6 budgets on the reference Mac', () => {
  it('AC6 2,000 spans a second take under 5% of a core, and the receiver process\'s resident set grows under 50 MB', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    // 40 Claude Code prompts of 5 spans each per request (a tool span with its wait and execution, a model request, the interaction).
    const parts: Buffer[] = [];
    for (let r = 0; r < REQUESTS; r++) {
      const spans = Array.from({ length: PER_REQUEST / 5 }, (_, p) => (claudePrompt(`budget-session-${p % 8}`).traces as { resourceSpans: [{ scopeSpans: [{ spans: never[] }] }] }).resourceSpans[0].scopeSpans[0].spans).flat();
      const body = Buffer.from(protobuf(traces(spans)));
      const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
      parts.push(size, body);
    }
    const root = tempRoot();
    const file = join(root, 'bodies.bin');
    writeFileSync(file, Buffer.concat(parts));
    const db = join(root, 'record.db');
    const modules = ['packages/record/dist/index.js', 'packages/otlp/dist/index.js'].map((p) => pathToFileURL(join(REPO, p)).href);
    const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', RECEIVER, ...modules, db, JSON.stringify(OTLP)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child);
    const ask = <T>(message: string): Promise<T> => new Promise((resolve) => { child.once('message', (m) => resolve(m as T)); child.send(message); });
    const childExited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    const { url } = await new Promise<{ url: string }>((resolve) => child.once('message', (m) => resolve(m as { url: string })));
    const sender = spawn(process.execPath, ['-e', SENDER, file, url], { stdio: ['ignore', 'pipe', 'inherit'] });
    children.push(sender);
    let printed = '';
    sender.stdout.on('data', (d: Buffer) => { printed += d.toString(); });
    const senderExited = new Promise<number | null>((resolve) => sender.on('exit', resolve));
    await sleep(WARM_S * 1000);
    const before = await ask<Memory>('memory');
    const runs: number[] = [];
    let last = await ask<Clocks>('cpu');
    for (let r = 0; r < RUNS; r++) {
      await sleep(RUN_S * 1000);
      const now = await ask<Clocks>('cpu');
      runs.push((now.cpuUs - last.cpuUs) / (now.wallUs - last.wallUs));
      last = now;
    }
    const after = await ask<Memory>('memory');
    const rssGrowthMb = (after.rss - before.rss) / 1e6, retainedGrowthMb = (after.retained - before.retained) / 1e6;
    expect(await senderExited, 'the sender finished').toBe(0);
    expect(JSON.parse(printed), 'every export was accepted').toEqual({ 200: REQUESTS });
    child.send('close');
    expect(await childExited, 'the receiver process closed cleanly').toBe(0);
    const record = await openRecord({ path: db, now: Date.now });
    open.push(record);
    const toolSpans = (await allEvents(record)).filter((e) => e.kind === 'tool.span').length;
    expect(toolSpans, 'every tool span reached the record').toBe(REQUESTS * (PER_REQUEST / 5));
    console.log(`AC6 receiver process: resident set grew ${rssGrowthMb.toFixed(1)} MB (retained heap ${retainedGrowthMb.toFixed(1)} MB after a full collection) over ${RUNS * RUN_S} s at ${(PER_REQUEST * 1000) / INTERVAL_MS} spans/s`);
    expect(rssGrowthMb, 'the receiver\'s working memory stays under 50 MB').toBeLessThan(50);
    judge(ctx, 'AC6 share of a core at 2,000 spans/s', runs, 0.05);
  }, 600_000);
});
