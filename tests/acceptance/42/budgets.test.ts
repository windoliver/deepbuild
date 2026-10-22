// #42 AC6: 2,000 spans a second at under 5% of a core and 50 MB. The receiver runs in this process on a real
// record; a separate node process sends Claude Code trace exports (OTLP/HTTP protobuf, 200 spans every 100 ms),
// so this process's CPU time is the receiver's work (and the record's appends), not the sender's.
// Judged by the design's rule for timing results (as tests/acceptance/14): five 5 s runs after a 2 s warm-up;
// PASS when all are within the limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE.
// Off a reference Mac the result is a reading only and the test skips; it never passes by skipping.
// The merge-base comparison belongs to the perf lane (README: Criterion 6).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startReceiver } from '../../../packages/otlp/src/index.ts';
import type { Receiver } from '../../../packages/otlp/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { allEvents, claudePrompt, environmentProblem, judge, OTLP, openTempRecord, protobuf, removeRoots, tempRoot, traces } from './helpers.ts';

const problem = environmentProblem();
const open: Array<Receiver | RecordStore> = [];
afterEach(async () => { for (const o of open.splice(0).reverse()) await o.close(); removeRoots(); }, 120_000);

const PER_REQUEST = 200, INTERVAL_MS = 100, WARM_S = 2, RUNS = 5, RUN_S = 5;
const REQUESTS = ((WARM_S + RUNS * RUN_S) * 1000) / INTERVAL_MS;
// Sends each length-prefixed body from the file on its own 100 ms tick, then prints the response codes.
const SENDER = `const fs=require('fs');const [file,url]=process.argv.slice(1);const buf=fs.readFileSync(file);const bodies=[];
for(let o=0;o<buf.length;){const n=buf.readUInt32LE(o);bodies.push(buf.subarray(o+4,o+4+n));o+=4+n;}
const t0=Date.now(),codes={},pending=[];(async()=>{for(let i=0;i<bodies.length;i++){const wait=t0+i*${INTERVAL_MS}-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
pending.push(fetch(url+'/v1/traces',{method:'POST',headers:{'content-type':'application/x-protobuf'},body:bodies[i]}).then(r=>r.arrayBuffer().then(()=>{codes[r.status]=(codes[r.status]||0)+1}),()=>{codes.error=(codes.error||0)+1}));}
await Promise.all(pending);console.log(JSON.stringify(codes));})();`;

describe('AC6 budgets on the reference Mac', () => {
  it('AC6 2,000 spans a second take under 5% of a core, and the resident set grows under 50 MB', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const record = await openTempRecord();
    open.push(record);
    const receiver = await startReceiver({ record, connection: OTLP, port: 0 });
    open.push(receiver);
    // 40 Claude Code prompts of 5 spans each per request (a tool span with its wait and execution, a model request, the interaction).
    const parts: Buffer[] = [];
    for (let r = 0; r < REQUESTS; r++) {
      const spans = Array.from({ length: PER_REQUEST / 5 }, (_, p) => (claudePrompt(`budget-session-${p % 8}`).traces as { resourceSpans: [{ scopeSpans: [{ spans: never[] }] }] }).resourceSpans[0].scopeSpans[0].spans).flat();
      const body = Buffer.from(protobuf(traces(spans)));
      const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
      parts.push(size, body);
    }
    const file = join(tempRoot(), 'bodies.bin');
    writeFileSync(file, Buffer.concat(parts));
    if (global.gc) global.gc();
    const sender = spawn(process.execPath, ['-e', SENDER, file, receiver.url], { stdio: ['ignore', 'pipe', 'inherit'] });
    let printed = '';
    sender.stdout.on('data', (d: Buffer) => { printed += d.toString(); });
    const exited = new Promise<number | null>((resolve) => sender.on('exit', resolve));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await sleep(WARM_S * 1000);
    const rssBefore = process.memoryUsage().rss;
    const runs: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const cpu0 = process.cpuUsage(), t0 = process.hrtime.bigint();
      await sleep(RUN_S * 1000);
      const cpu = process.cpuUsage(cpu0), wallUs = Number(process.hrtime.bigint() - t0) / 1000;
      runs.push((cpu.user + cpu.system) / wallUs);
    }
    const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / 1e6;
    expect(await exited, 'the sender finished').toBe(0);
    expect(JSON.parse(printed), 'every export was accepted').toEqual({ 200: REQUESTS });
    const toolSpans = (await allEvents(record)).filter((e) => e.kind === 'tool.span').length;
    expect(toolSpans, 'every tool span reached the record').toBe(REQUESTS * (PER_REQUEST / 5));
    console.log(`AC6 resident set grew ${rssGrowthMb.toFixed(1)} MB over ${RUNS * RUN_S} s at ${(PER_REQUEST * 1000) / INTERVAL_MS} spans/s`);
    expect(rssGrowthMb, 'the receiver\'s working memory stays under 50 MB').toBeLessThan(50);
    judge(ctx, 'AC6 share of a core at 2,000 spans/s', runs, 0.05);
  }, 600_000);
});
