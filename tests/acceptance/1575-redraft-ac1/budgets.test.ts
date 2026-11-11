// #1575.1adcfe64: "With a reader replaying from 0 on a record of 100,000 events and a live reader beside it, the live
// reader's frames stay within the 50 ms budget. The merge base fails this, naming the cold reader"
//
// One real hub (`deep hub run`) on a record of 100,000 events seeded through the record before it starts. The live
// reader is an app connection subscribed after the log's end, as the app subscribes. A run is ten cold readers, one
// after another: each is an app connection that subscribes after 0 and reads as fast as the socket gives (cut off with
// fell_behind, it subscribes again after the last log_pos it holds, as #34's refusal says), and from the moment its
// subscribe is written until it holds the frame of the log's end as it stood then, a hook is sent every 10 ms. A sample is one of those hooks:
// from its request written to the live reader's frame for its event read (#34's measure of the 50 ms budget). A run's
// reading is the p95 of its samples. One warm-up run, then five.
//
// The five are judged by the perf lane's own rule, `judgeLimit` on `fingerprint()` in scripts/benchmark.mjs (design:
// Numbers version 0 has to hold): it counts only on a reference Mac, on mains power, with Low Power Mode off, the
// thermal state nominal and the load at each run's start and end within the cores. PASS when all five are within
// 50 ms, FAIL when all five are over it by more than the margin, the larger of 5% and their spread. Anything else is
// INCONCLUSIVE: the test is skipped with its readings, and neither passes nor fails.
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  asApp, cleanup, Confirmer, confirmEnv, Conn, fromHere, hookRequest, installedRoot, logEnd, makeHome, newSession, p95, REPO, result,
  sleep, startHub, tokenOf, ulid, waitFor, type Hub, type Line, type Session,
} from '../34/helpers.ts';

afterEach(cleanup, 60_000);

const EVENTS = 100_000;
const LIMIT = 50;        // ms: the design's live-stream budget, an event delivered to the app within 50 ms at p95
const READERS = 10;      // cold readers a run, one after another
const PACE = 10;         // ms between the hooks sent while a cold reader replays
const RUNS = 5;

/** 100,000 events in the ledger, through the record, as #34's budgets seed history: sessions of prompts, tool calls and stops. */
async function seed(root: string, events: number): Promise<number> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let at = Date.now() - 30 * 86_400_000;
  let now = at;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  let count = 0;
  while (count < events) {
    const session = ulid(at);
    now = at;
    const pending: Promise<unknown>[] = [];
    const add = (event: Parameters<typeof record.append>[1]) => { if (count + pending.length < events) pending.push(record.append(conn(session), event)); };
    add({ v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } });
    for (let t = 0; t < 10; t++) {
      at += 1000;
      add({ v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } });
      for (let k = 0; k < 13; k++) {
        at += 1000;
        add({ v: 1, id: ulid(at), kind: k % 2 === 0 ? 'tool.before' : 'tool.after', ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } });
      }
      at += 1000;
      add({ v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } });
    }
    count += pending.length;
    await Promise.all(pending);
    at += 1000;
  }
  await record.close();
  return count;
}

/**
 * The cold reader: an app connection that subscribes after 0. It keeps none of the replay: it reads the lines up to
 * its first event frame, then only counts lines and bytes and looks for the frame of `head`, so that 100,000 frames
 * read in this process cost the live reader's clock as little as they can. (#16's Conn parses and keeps every line.)
 */
class Cold {
  subscribedAt = 0;
  reply: Line | undefined;         // the subscribe's reply
  first: number | undefined;       // the log_pos of its first event frame
  reachedAt: number | undefined;   // when it held the frame of `head`
  lines = 0;
  bytes = 0;
  cuts = 0;                        // times it was cut off with fell_behind and subscribed again
  lost = false;                    // cut off with no frame in hand to resume from
  ended = false;
  private early: Line[] = [];
  private text = '';
  private parsing = true;
  private carry: Buffer = Buffer.alloc(0);
  private marker: Buffer = Buffer.alloc(0);
  private constructor(private readonly sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => {
      const at = performance.now();
      this.bytes += chunk.length;
      for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, i + 1)) this.lines++;
      if (this.parsing) this.parse(chunk);
      const hay = Buffer.concat([this.carry, chunk]);
      if (this.reachedAt === undefined && this.marker.length) {
        for (let i = hay.indexOf(this.marker); i >= 0; i = hay.indexOf(this.marker, i + 1)) {
          const next = hay[i + this.marker.length];
          if (next === undefined) break;                                    // the digit after it comes with the next chunk
          if (next < 48 || next > 57) { this.reachedAt = at; break; }
        }
      }
      const cutAt = hay.indexOf('"fell_behind"');
      if (cutAt >= 0 && hay.indexOf(10, cutAt) >= 0) return this.again(hay);
      this.carry = hay.subarray(Math.max(0, hay.length - 8192));
    });
    sock.on('error', () => { this.ended = true; });
    sock.on('close', () => { this.ended = true; });
  }
  /**
   * Cut off with fell_behind, the base's answer to a consumer over 10,000 frames behind (#34): it subscribes again
   * after the last log_pos it holds, as that refusal says and the app does.
   */
  private again(hay: Buffer): void {
    let last: number | undefined;
    for (const raw of hay.toString('utf8').split('\n')) {
      let line: Line | undefined;
      try { line = JSON.parse(raw) as Line; } catch { continue; }
      if (line?.event) last = line.event.log_pos as number;
      else if (line?.error?.code === 'fell_behind') break;
    }
    this.carry = Buffer.alloc(0);
    if (last === undefined) { this.lost = true; return; }
    this.cuts++;
    this.sock.write(`${JSON.stringify({ v: 1, id: `cold-${this.cuts}`, method: 'stream.subscribe', params: { after: last } })}\n`);
  }
  private parse(chunk: Buffer): void {
    this.text += chunk.toString('utf8');
    let i: number;
    while (this.parsing && (i = this.text.indexOf('\n')) >= 0) {
      let line: Line | undefined;
      try { line = JSON.parse(this.text.slice(0, i)) as Line; } catch { line = undefined; }
      this.text = this.text.slice(i + 1);
      if (!line) continue;
      this.early.push(line);
      if (line.id === 'cold' && ('result' in line || 'error' in line)) this.reply = line;
      if (line.id === 'cold' && line.event && this.first === undefined) this.first = line.event.log_pos as number;
      if (this.reply && this.first !== undefined) { this.parsing = false; this.text = ''; }
    }
  }
  /** Connects and presents the app's credential; BLOCKED when the hub refuses it. */
  static async open(hub: Hub): Promise<Cold> {
    const cold = new Cold(net.connect(hub.socket));
    await waitFor(() => cold.early.length >= 1 || cold.ended, 10_000, 'the hub\'s hello to the cold reader');
    cold.sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: tokenOf(hub.root) })}\n`);
    await waitFor(() => cold.early.length >= 2 || cold.ended, 10_000, 'the hub\'s answer to the cold reader\'s hello');
    if (cold.early[1]?.role !== 'app') throw Error(`BLOCKED: the hub refused the cold reader's app hello: ${JSON.stringify(cold.early[1])}`);
    return cold;
  }
  /** `stream.subscribe` after 0, as the app subscribes; `head` is the log's end now, whose frame ends this reader's replay. */
  subscribe(head: number): void {
    this.marker = Buffer.from(`"log_pos":${head}`);
    this.subscribedAt = performance.now();
    this.sock.write(`${JSON.stringify({ v: 1, id: 'cold', method: 'stream.subscribe', params: { after: 0 } })}\n`);
  }
  close(): void { this.sock.destroy(); }
}

interface Run { p95: number; samples: number; worst: number; median: number; replays: number[]; cuts: number }

describe('AC1 #1575.1adcfe64 one reader never holds another: a live reader beside a cold one', () => {
  it('#1575.1adcfe64 with a reader replaying from 0 on a record of 100,000 events and a live reader beside it, the live reader\'s frames stay within the 50 ms budget at p95 (five runs after a warm-up, judged by the perf lane\'s rule)', async (ctx) => {
    const home = makeHome();
    const seeded = await seed(installedRoot(home), EVENTS);
    expect(seeded, 'BLOCKED: setup: the record holds 100,000 events').toBe(EVENTS);
    const hub = await startHub({ home, env: confirmEnv(new Confirmer()) }, 120_000);
    const live = await asApp(hub);
    let head = await waitFor(async () => { const end = await logEnd(live); return end >= EVENTS ? end : undefined; }, 120_000, 'the seeded record');
    const firstPage = result(await live.call('events.read', { after: 0, limit: 1 }, 30_000));
    const firstPos = (firstPage.events as Line[])[0]!.log_pos as number;

    // The live reader subscribes as the app does: after the log_pos its reads reflect.
    const liveFrom = live.received.length;
    const reply = await live.call('stream.subscribe', { after: head });
    expect(reply.result?.start, 'the live reader\'s subscribe is answered with the hub\'s start ID').toBe(hub.start);
    const sub = reply.id as string;
    let scanned = liveFrom;
    /** The log's end, as the live reader's frames show it. */
    const end = (): number => {
      for (; scanned < live.received.length; scanned++) {
        const line = live.received[scanned]!.json;
        if (line?.id === sub && line.event) head = Math.max(head, line.event.log_pos as number);
      }
      return head;
    };

    const s: Session = newSession(hub.home, 'claude-code');
    /** One hook: from its request written to the live reader's frame for its event read. */
    const sample = async (): Promise<{ t0: number; ms: number }> => {
      const request = fromHere(hookRequest(s, 'PreToolUse'));
      const from = live.received.length;
      const hookConn = await Conn.open(hub.socket);
      const t0 = hookConn.send(request);
      const frame = await live.seek((l) => l.id === sub && l.event?.id === request.id, from, 60_000);
      hookConn.close();
      if (!frame) throw Error(`BLOCKED: the live reader got no frame for hook ${request.id} within 60 s`);
      return { t0, ms: frame.at - t0 };
    };

    const once = async (): Promise<Run> => {
      const ms: number[] = [];
      const replays: number[] = [];
      let cuts = 0;
      for (let r = 0; r < READERS; r++) {
        const cold = await Cold.open(hub);
        cold.subscribe(end());
        const pending: Promise<{ t0: number; ms: number }>[] = [];
        while (cold.reachedAt === undefined) {
          if (cold.lost) throw Error('BLOCKED: the cold reader was cut off with fell_behind and held no frame to resume from');
          if (cold.ended) throw Error(`BLOCKED: the hub closed the cold reader's connection after ${cold.lines} lines: ${JSON.stringify(cold.reply)}`);
          if (performance.now() - cold.subscribedAt > 120_000) throw Error(`BLOCKED: the cold reader, subscribed after 0, didn't reach the log's end within 120 s (${cold.lines} lines, first event frame ${String(cold.first)}, reply ${JSON.stringify(cold.reply)})`);
          const one = sample();
          one.catch(() => undefined);   // a failure is thrown where the samples are gathered, or with the reader's own
          pending.push(one);
          await sleep(PACE);
        }
        const got = await Promise.all(pending);
        // The premise: this reader replayed from 0, every seeded event, beside the live one.
        if (cold.first !== firstPos) throw Error(`BLOCKED: the cold reader's first event frame is log_pos ${String(cold.first)}, not the record's first, ${firstPos}`);
        if (cold.lines < EVENTS) throw Error(`BLOCKED: the cold reader reached the log's end on ${cold.lines} lines, fewer than the record's ${EVENTS} events`);
        // Only hooks written while it was still replaying count.
        ms.push(...got.filter((g) => g.t0 < cold.reachedAt!).map((g) => g.ms));
        replays.push(cold.reachedAt - cold.subscribedAt);
        cuts += cold.cuts;
        cold.close();
      }
      if (ms.length < 20) throw Error(`BLOCKED: only ${ms.length} hooks were written while a cold reader replayed, too few for a p95`);
      const sorted = [...ms].sort((a, b) => a - b);
      return { p95: p95(ms), samples: ms.length, worst: sorted[sorted.length - 1]!, median: sorted[Math.floor(sorted.length / 2)]!, replays, cuts };
    };

    await once();   // warm-up
    const runs: Run[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) {
      const start = loadavg()[0]!;
      runs.push(await once());
      loads.push({ start, end: loadavg()[0]! });
    }

    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint(): Line; judgeLimit(o: unknown): Line };
    const machine = bench.fingerprint();
    const verdict = bench.judgeLimit({ limit: LIMIT, runs: runs.map((r) => r.p95), fingerprint: machine, loads });
    const f = (x: number) => x.toFixed(1);
    const replay = runs.flatMap((r) => r.replays).sort((a, b) => a - b);
    const readings = [
      `live reader's frame delay beside the cold reader, p95 per run (ms): ${runs.map((r) => f(r.p95)).join(', ')} against ${LIMIT}`,
      `per run: ${runs.map((r, k) => `run ${k + 1}: ${r.samples} hooks, median ${f(r.median)}, p95 ${f(r.p95)}, worst ${f(r.worst)} ms, load ${loads[k]!.start.toFixed(2)} → ${loads[k]!.end.toFixed(2)}`).join('; ')}`,
      `the cold reader: stream.subscribe after 0 on ${head} events, ${READERS} a run; a replay took ${f(replay[0]!)} to ${f(replay[replay.length - 1]!)} ms, median ${f(replay[Math.floor(replay.length / 2)]!)} ms; cut off with fell_behind and subscribed again ${runs.map((r) => r.cuts).join(', ')} times per run`,
      `machine: ${JSON.stringify(machine)}, ${availableParallelism()} cores`,
      `judgeLimit: ${JSON.stringify(verdict)}`,
    ].join('\n  ');
    console.log(`#1575.1adcfe64 ${String(verdict.status)}\n  ${readings}`);

    if (verdict.status === 'PASS') return;
    if (verdict.status === 'FAIL') {
      expect.fail(`FAIL #1575.1adcfe64: the cold reader held the live reader: while a reader subscribed after 0 replayed ${head} events, the live reader's frames came ${runs.map((r) => f(r.p95)).join(', ')} ms after their hooks at p95, over the ${LIMIT} ms budget in all five runs (${String(verdict.reason)})\n  ${readings}`);
    }
    if (verdict.status !== 'INCONCLUSIVE') throw Error(`BLOCKED: ${String(verdict.reason)}\n  ${readings}`);
    ctx.skip(`INCONCLUSIVE #1575.1adcfe64, neither a pass nor a fail: ${String(verdict.reason)}\n  ${readings}`);
  }, 900_000);
});
