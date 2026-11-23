// Test-side tools for the #1576 acceptance tests (README). The hub as a process, the line-protocol client, hook
// requests, temp folders and cleanup are #16's, and the app's and the CLI's connections and the OS confirmation's
// stand-in are #34's, reused as they are. What is new here is what #1576's surface needs (README, The surface): the
// names the issue leaves open, each in one place; records of 1,000 and 100,000 sessions seeded through the real record
// and asks core before a hub starts; a cold open, a reconnect and a recorded turn as a phone's client sees them; load
// beside a run; and the judges each criterion's failure message comes from.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord, type Connection } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { nextSeq, settle, spawnHub } from '../16/helpers.ts';
import {
  asApp, asCli, Confirmer, confirmEnv, Conn, installedRoot, makeHome, own, REPO, result, sendHook, sleep, startHub, stopHub,
  tempDir, tokenOf, ulid, type Hub, type Line,
} from '../34/helpers.ts';

export { asApp, asCli, cleanup, deep, result, type Hub, type Line } from '../34/helpers.ts';
export { shared } from '../16/helpers.ts';

// ---- The surface #1576 leaves open. Each name is here once; a different choice is a one-line change here.

/** The list's reads a cold open and a reconnect make after the app's hello, in this order, each with no params. */
export const LIST_READS = ['inbox.read', 'sessions.read'] as const;
/** At most this many settled asks, or settled sessions, on one page of a list read (the issue's Scope). */
export const PAGE_SIZE = 25;
/** A list read's count of the settled items older than its page, which no page before it held: `rest`. */
export const restOf = (reply: Line): unknown => reply.result?.rest;
/** A list read's cursor to the next, older page: `next`, a string, or null on the last page. */
export const nextOf = (reply: Line): unknown => reply.result?.next;
/** The params that read the page a cursor names. */
export const pageAt = (next: string): Line => ({ page: next });
/** The SQL statements the hub ran to answer one call: `queries`, an integer on the call's result. */
export const queriesOf = (reply: Line): unknown => reply.result?.queries;
/** Where the ceilings are recorded: one task of benchmarks/budgets.json and three of its limits. */
export const BUDGETS = { file: 'benchmarks/budgets.json', task: 'phone-reads', turnFrames: 'report.turnFrames', turnBytes: 'report.turnBytes', reconnectQueries: 'report.reconnectQueries' } as const;
/** The planted wrong programs, by DEEP_HUB_PLANT (README, Wrong programs). */
export const PLANT = { everyRow: 'reads-every-row', pageFrame: 'page-hook-frame-per-event', rowQuery: 'query-per-row' } as const;
/** The method each plant is in, which its criterion's failure must name. */
export const PLANTED_IN = { everyRow: 'sessions.read', rowQuery: 'inbox.read' } as const;
/** The kind of the frame page-hook-frame-per-event sends, which AC3's failure must name. */
export const PAGE_HOOK = 'page.hook';

// ---- Records seeded before a hub starts, through the real record and asks core, as the hub's own would be.

/** What a seeded record holds: its live sessions with an open ask each, and the asks settled in other sessions. */
export interface Fixture { sessions: number; live: string[]; open: string[]; settled: string[] }
const who = { actor: 'you', scope: 'you' };
const hookOf = (session: string): Connection => ({ writer: 'hook', ...who, session, project: 'shop', agent: 'claude-code' });
const coreOf = (session: string): Connection => ({ writer: 'core', ...who, session, project: 'shop' });
const card: Connection = { writer: 'app', ...who };
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** Fixed-width numbers in the asks' words, so the records' pages hold the same bytes whatever their size. */
const six = (n: number): string => String(n).padStart(6, '0');

/**
 * A record of `sessions` sessions, seeded into `root`'s ledger with no hub running: `sessions - live` settled ones
 * (each started, then its turn stopped, from six hours ago on), `asks` of them spread evenly with one ask raised in it
 * while it ran and answered on the question card; then `live` sessions still at work, each with one open ask that
 * waits a week. No session sends session.end: at the base the asks core forgets ended sessions in a pass that grows
 * with their square, which a hub on 100,000 of them would not get through (README, Criteria to tests).
 */
export async function seedRecord(root: string, o: { sessions: number; live: number; asks: number }): Promise<Fixture> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let now = Date.now() - 6 * 3_600_000;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  const source = askSources().find((r) => r.source === 'deep_ask.choice')!;
  const ask = (n: number, deadline: number): Line => ({
    ...structuredClone(source.fixture.ask as Line), question: `Keep the store of item ${six(n)} on SQLite or plain files?`, key: sha256(`#1576 ${n}`), deadline,
  });
  const out: Fixture = { sessions: o.sessions, live: [], open: [], settled: [] };
  const start = (session: string): Promise<unknown> => record.append(hookOf(session), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: nextSeq(now), data: { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: session } });
  try {
    const settled = o.sessions - o.live;
    const every = Math.floor(settled / o.asks);
    for (let from = 0; from < settled; from += 1000) {
      const batch = Array.from({ length: Math.min(1000, settled - from) }, () => randomUUID());
      now += 1;
      await Promise.all(batch.map(start));
      for (const [i, session] of batch.entries()) {
        if ((from + i + 1) % every || out.settled.length >= o.asks) continue;
        now += 1;
        const handle = await asks.raise(coreOf(session), source.source, ask(out.settled.length, now + 86_400_000));
        await asks.answer(card, handle, { option: 'files' });
        out.settled.push(handle);
      }
      now += 1;
      await Promise.all(batch.map((session) => record.append(hookOf(session), { v: 1, id: ulid(now), kind: 'agent.stop', subject: `session:${session.replace(/-/g, '')}`, ts: now, seq: nextSeq(now), data: { turn: 1, did_work: false } })));
    }
    for (let i = 0; i < o.live; i++) {
      now += 1;
      const session = randomUUID();
      await start(session);
      out.live.push(session);
      out.open.push(await asks.raise(coreOf(session), source.source, ask(900_000 + i, now + 7 * 86_400_000)));
    }
  } finally {
    await record.close();
  }
  return out;
}

/**
 * A record seeded once in a folder of its own, then opened once by a hub, which records its first state of every
 * session and the list's rows and stops: as a hub that has run on the record holds it. Each test's hub starts on a copy
 * of its ledger, so it writes to the copy alone and none of them pays for that first pass again.
 */
export interface Template { root: string; fixture: Fixture }
export async function template(o: { sessions: number; live: number; asks: number }): Promise<Template> {
  const root = join(tempDir(), 'template');
  const fixture = await seedRecord(root, o);
  const hub = await startHub({ home: makeHome(), root, env: confirmEnv(new Confirmer()) }, 900_000);
  try {
    await settledBy(hub, 'inbox.read');
  } finally {
    await stopHub(hub, 'SIGTERM', 300_000);
  }
  return { root, fixture };
}
/** The ledger's files a copy of a record takes. */
const LEDGER = ['ledger.db', 'ledger.db-wal', 'ledger.db-shm'];
/**
 * The records a cold open is judged on (AC1, AC2, AC4, AC5): 5 live sessions, each with an open ask, and asks settled
 * in one settled session of every 100, and in 50 at least, so both records fill a page of settled asks.
 */
export const recordOf = (sessions: number): Promise<Template> => template({ sessions, live: 5, asks: Math.max(50, sessions / 100) });

// ---- The hub on a record, stopped by its PID when the test is done with it.

const running = new Set<Hub>();
/** Stops every hub `onRecord` started that is still running (each test's afterEach). */
export async function stopHubs(): Promise<void> {
  for (const hub of [...running]) { running.delete(hub); await stopHub(hub); }
}
/**
 * A hub started on a copy of `t`'s record (none: an empty one), under `plant` when one is named, with the log settled.
 * Its result is `refused` when the hub names no such planted program: the merge base names none of this suite's.
 */
export async function onRecord(t: Template | undefined, plant?: string): Promise<{ hub: Hub; refused?: undefined } | { hub?: undefined; refused: string }> {
  const home = makeHome();
  if (t) {
    mkdirSync(installedRoot(home), { recursive: true, mode: 0o700 });
    for (const file of LEDGER) if (existsSync(join(t.root, file))) copyFileSync(join(t.root, file), join(installedRoot(home), file));
  }
  const proc = spawnHub({ home, ...(plant ? { plant } : {}), env: confirmEnv(new Confirmer()) });
  const r = await settle(proc, 900_000);
  if (!r.ready) {
    const said = proc.stderr();
    const named = plant && said.split('\n').find((line) => line.includes(`DEEP_HUB_PLANT=${plant} names no planted program`));
    if (named) return { refused: `the hub names no planted program ${plant}: ${named.trim()}` };
    throw Error(`BLOCKED: the hub didn't start: ${r.hung ? 'no ready line' : `exit ${JSON.stringify(r.exit)}`}; stderr: ${said.slice(0, 2000)}`);
  }
  const hub: Hub = { ...r.ready, home, root: installedRoot(home), proc };
  running.add(hub);
  await settledBy(hub, 'inbox.read');
  return { hub };
}
/** The hub of `onRecord`'s result; BLOCKED when it refused. */
export const started = (r: Awaited<ReturnType<typeof onRecord>>): Hub => {
  if (!r.hub) throw Error(`BLOCKED: ${r.refused}`);
  return r.hub;
};

/**
 * Waits until the hub is settled: `method`'s read, which answers behind what the hub has under way (inbox.read behind its
 * state pass; status.read behind every hook it acknowledged too), reflects the same log_pos twice, a second apart, so
 * nothing the hub appends by itself is still to come. Gives that log_pos.
 */
export async function settledBy(hub: Hub, method: 'inbox.read' | 'status.read'): Promise<number> {
  const cli = await asCli(hub);
  try {
    for (let end = -1; ;) {
      const now = Number(result(await cli.call(method, {}, 900_000)).log_pos);
      if (now === end) return end;
      end = now;
      await sleep(1000);
    }
  } finally {
    cli.close();
  }
}

// ---- A phone's client: a cold open, a reconnect and the frames of a turn, in bytes, frames and queries.

const bytesOf = (raw: string): number => Buffer.byteLength(raw, 'utf8') + 1;
/** One list read of a connection: its reply line and the bytes the hub sent for it. */
export interface Read { method: string; reply: Line; bytes: number }
/** A cold open: every byte the hub sent on the connection, its hello and the role's answer included, and each read. */
export interface Open { bytes: number; reads: Read[] }
/**
 * A new connection as the app, then the list's reads one after another (LIST_READS): what a phone opening the list
 * costs. Its lines are read as bytes and split at each newline as they come, so a reply of tens of megabytes, as the
 * base's sessions.read on 100,000 sessions is, costs this process no more than its size.
 */
export async function coldOpen(hub: Hub): Promise<Open> {
  const sock = net.connect(hub.socket);
  const lines: { bytes: number; json: Line | undefined }[] = [];
  const waiting: (() => void)[] = [];
  let pending: Buffer[] = [];
  let ended = '';
  sock.on('data', (chunk: Buffer) => {
    for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10)) {
      const raw = Buffer.concat([...pending, chunk.subarray(0, at)]);
      pending = [];
      chunk = chunk.subarray(at + 1);
      let json: Line | undefined;
      try { json = JSON.parse(raw.toString('utf8')) as Line; } catch { json = undefined; }
      lines.push({ bytes: raw.length + 1, json });
    }
    if (chunk.length) pending.push(chunk);
    for (const wake of waiting.splice(0)) wake();
  });
  sock.on('error', (error: NodeJS.ErrnoException) => { ended = error.code ?? error.message; for (const wake of waiting.splice(0)) wake(); });
  sock.on('close', () => { ended ||= 'closed'; for (const wake of waiting.splice(0)) wake(); });
  /** The index of the first line from `from` on that matches, once it has come; BLOCKED if the connection ends or 10 minutes pass first. */
  const seek = async (from: number, match: (json: Line) => boolean, what: string): Promise<number> => {
    const deadline = Date.now() + 600_000;
    for (let at = from; ; at++) {
      while (lines.length <= at) {
        if (ended || Date.now() > deadline) throw Error(`BLOCKED: no ${what} from the hub (${ended || 'timed out'})`);
        await new Promise<void>((wake) => { waiting.push(wake); setTimeout(wake, 1000); });
      }
      if (lines[at]!.json && match(lines[at]!.json!)) return at;
    }
  };
  try {
    await seek(0, () => true, 'hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: tokenOf(hub.root) })}\n`);
    const role = lines[await seek(1, () => true, "answer to the app's hello")]!.json!;
    if (role.role !== 'app') throw Error(`BLOCKED: the hub refused the app's hello: ${JSON.stringify(role)}`);
    const reads: Read[] = [];
    for (const method of LIST_READS) {
      const from = lines.length;
      sock.write(`${JSON.stringify({ v: 1, id: method, method, params: {} })}\n`);
      const at = await seek(from, (json) => json.id === method && ('result' in json || 'error' in json), `reply to ${method}`);
      reads.push({ method, reply: lines[at]!.json!, bytes: lines[at]!.bytes });
    }
    return { bytes: lines.reduce((sum, l) => sum + l.bytes, 0), reads };
  } finally {
    sock.destroy();
  }
}
/** A reconnect: a cold open's calls again, on a new connection, after one: the queries each read ran. */
export async function reconnect(hub: Hub): Promise<Read[]> {
  return (await coldOpen(hub)).reads;
}

/** The recorded turn: the first turn of adapters/corpus/claude-code/2.1.308/tools, its SessionStart first (README). */
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const TURN = 'fixtures/turn.jsonl';
/** What a session's page got for the turn: its frames and bytes, and each kind's. */
export interface Turn { session: string; reply: Line; frames: number; bytes: number; kinds: Map<string, { frames: number; bytes: number }> }
/** A frame's kind: its event's, else the name of what it carries (`caught_up`, say). */
const kindOf = (line: Line): string => (line.event ? String(line.event.kind) : Object.keys(line).filter((k) => k !== 'v' && k !== 'id').join('+'));
/**
 * The recorded turn played on `hub`, as its deep-hook would send it, one hook at a time, the hub quiet after each:
 * the session starts, its page subscribes scoped to it from the log's end and is caught up, and then the turn's hooks
 * (UserPromptSubmit to Stop) come. Counted: every line on the page's subscription after its caught-up frame, until
 * the hub is quiet after the Stop.
 */
export async function playTurn(hub: Hub): Promise<Turn> {
  const payloads = readFileSync(join(FIXTURES, 'turn.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  const session = String(payloads[0]!.session_id);
  const cwd = join(tempDir(), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(hub.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, readFileSync(join(FIXTURES, 'turn-transcript.jsonl')));
  const send = async (payload: Line): Promise<void> => {
    const at = Date.now();
    const r = await sendHook(hub.socket, { v: 1, agent: 'claude-code', event: String(payload.hook_event_name), seq: nextSeq(at), id: ulid(at), matched: [], payload: { ...payload, cwd, transcript_path: transcript }, pid: process.pid, ppid: process.ppid }, 120_000);
    if (!r.ack || r.end !== 'reply') throw Error(`BLOCKED: the hub didn't take the turn's ${String(payload.hook_event_name)}: ${JSON.stringify(r.lines)}`);
    await settledBy(hub, 'status.read');
  };
  await send(payloads[0]!);
  const page = await asApp(hub);
  try {
    const from = page.received.length;
    const reply = await page.call('stream.subscribe', { after: await settledBy(hub, 'status.read'), scope: { kind: 'session', session } }, 60_000);
    const out: Turn = { session, reply, frames: 0, bytes: 0, kinds: new Map() };
    if (!reply.result) return out;
    const caught = await page.seek((l) => l.id === reply.id && 'caught_up' in l, from, 60_000);
    if (!caught) throw Error(`BLOCKED: the page's subscribe was never caught up: ${JSON.stringify(reply)}`);
    const mark = page.received.indexOf(caught) + 1;
    for (const payload of payloads.slice(1)) await send(payload);
    await sleep(1000);
    for (const r of page.received.slice(mark)) {
      if (!r.json || r.json.id !== reply.id || 'result' in r.json) continue;
      const kind = kindOf(r.json);
      const k = out.kinds.get(kind) ?? { frames: 0, bytes: 0 };
      k.frames += 1;
      k.bytes += bytesOf(r.raw);
      out.kinds.set(kind, k);
      out.frames += 1;
      out.bytes += bytesOf(r.raw);
    }
    return out;
  } finally {
    page.close();
  }
}

/**
 * Runs `body` with one busy process per core beside it, each stopped by its PID after: the load of AC5. They run at
 * the lowest priority, so the machine's load is over its core count while the hubs' own work goes first: other
 * sessions on a shared machine lose no more than its idle time.
 */
export async function underLoad<T>(body: () => Promise<T>): Promise<T> {
  const burners = Array.from({ length: availableParallelism() }, () => spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' }));
  for (const b of burners) {
    own(b.pid);
    try { setPriority(b.pid!, 19); } catch { /* gone */ }
  }
  try {
    return await body();
  } finally {
    for (const b of burners) try { process.kill(b.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---- The ceilings recorded in benchmarks/budgets.json (BUDGETS).

export interface Ceilings { turnFrames?: number; turnBytes?: number; reconnectQueries?: number }
export function ceilings(): Ceilings {
  const file = join(REPO, BUDGETS.file);
  if (!existsSync(file)) return {};
  const task = ((JSON.parse(readFileSync(file, 'utf8')) as Line).tasks as Line[] | undefined)?.find((t) => t.id === BUDGETS.task);
  const limit = (name: string): number | undefined => (Number.isFinite(task?.limits?.[name]) ? Number(task!.limits[name]) : undefined);
  return { ...defined('turnFrames', limit(BUDGETS.turnFrames)), ...defined('turnBytes', limit(BUDGETS.turnBytes)), ...defined('reconnectQueries', limit(BUDGETS.reconnectQueries)) };
}
const defined = <K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> => (value === undefined ? {} : ({ [key]: value } as Record<K, number>));
const where = (limit: string): string => `${BUDGETS.file} › ${BUDGETS.task} › limits › ${limit}`;

// ---- Judges. Each returns the failure its criterion names, or null; the tests assert null.

const refusedRead = (r: Read): string | undefined => (r.reply.error ? `the hub refused ${r.method}: ${String(r.reply.error.code)} (${String(r.reply.error.remediation)})` : undefined);

/** AC1's judge: the cold opens on the two records differ by under 10%; else it names the read that grew most. */
export function judgeGrowth(small: { sessions: number; open: Open }, large: { sessions: number; open: Open }): string | null {
  for (const r of [...small.open.reads, ...large.open.reads]) if (refusedRead(r)) return refusedRead(r)!;
  const [a, b] = [small.open.bytes, large.open.bytes];
  const apart = Math.max(a, b) / Math.min(a, b) - 1;
  if (apart < 0.1) return null;
  const grew = large.open.reads.map((r, i) => ({ method: r.method, from: small.open.reads[i]!.bytes, to: r.bytes })).sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from))[0]!;
  return `cold-open bytes on a record of ${large.sessions} sessions (${b}) and on one of ${small.sessions} (${a}) differ by ${(apart * 100).toFixed(1)}%, not under 10%: ${grew.method} grew most, from ${grew.from} to ${grew.to} bytes`;
}
/** AC2's judge: a cold open on the large record is under 1 MiB; else it names the largest read. */
export function judgeUnder(sessions: number, open: Open): string | null {
  for (const r of open.reads) if (refusedRead(r)) return refusedRead(r)!;
  if (open.bytes < 1 << 20) return null;
  const big = [...open.reads].sort((x, y) => y.bytes - x.bytes)[0]!;
  return `a cold open on the ${sessions}-session record is ${open.bytes} bytes, not under 1 MiB (${1 << 20}): ${big.method}'s reply alone is ${big.bytes} bytes`;
}
/** AC3's judge: the turn's frames and bytes on the page are at or under the recorded ceiling; else it names the kind with the most frames. */
export function judgeTurn(t: Turn, c: Ceilings): string | null {
  if (!t.reply.result) return `the hub refused the page's subscribe scoped to session ${t.session}: ${String(t.reply.error?.code)} (${String(t.reply.error?.remediation)})`;
  if (!t.frames) return `the session's page got no frame for the turn of ${TURN}`;
  if (c.turnFrames === undefined || c.turnBytes === undefined) return `no ceiling for a turn's frames and bytes is recorded (this turn of ${TURN} sent the page ${t.frames} frames, ${t.bytes} bytes): ${where(BUDGETS.turnFrames)} and ${where(BUDGETS.turnBytes)} must hold them`;
  if (t.frames <= c.turnFrames && t.bytes <= c.turnBytes) return null;
  const [kind, most] = [...t.kinds].sort(([ka, a], [kb, b]) => b.frames - a.frames || b.bytes - a.bytes || ka.localeCompare(kb))[0]!;
  return `a turn of ${TURN} sent the session's page ${t.frames} frames, ${t.bytes} bytes, past the ceiling of ${c.turnFrames} frames, ${c.turnBytes} bytes: the most frames were of kind ${kind} (${most.frames} frames, ${most.bytes} bytes)`;
}
/** AC4's judge: every read of the reconnect counts its queries, and their sum is at or under the ceiling; else it names the method that ran the most. */
export function judgeQueries(reads: readonly Read[], c: Ceilings): string | null {
  for (const r of reads) if (refusedRead(r)) return refusedRead(r)!;
  const uncounted = reads.find((r) => !Number.isSafeInteger(queriesOf(r.reply)) || (queriesOf(r.reply) as number) < 0);
  if (uncounted) return `the hub doesn't count its queries: ${uncounted.method}'s reply on a reconnect carries no queries (${JSON.stringify(queriesOf(uncounted.reply))})`;
  if (c.reconnectQueries === undefined) return `no ceiling for queries per reconnect is recorded: ${where(BUDGETS.reconnectQueries)} must hold it`;
  const total = reads.reduce((sum, r) => sum + (queriesOf(r.reply) as number), 0);
  if (total <= c.reconnectQueries) return null;
  const most = [...reads].sort((x, y) => (queriesOf(y.reply) as number) - (queriesOf(x.reply) as number))[0]!;
  return `a reconnect ran ${total} queries, past the ceiling of ${c.reconnectQueries}: ${most.method} ran ${String(queriesOf(most.reply))} of them`;
}
/** One run of every budget: each number, or what kept it from being read. */
export type Numbers = Record<string, number | string>;
/** AC5's judge: each budget reads the same number in both runs, and none is missing in either. */
export function judgeSame(first: Numbers, second: Numbers): string | null {
  for (const name of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const [a, b] = [first[name], second[name]];
    if (typeof a !== 'number') return `${name} can't be read in the first run under load (${String(a)}), and a number that can't be read is missing, never the same`;
    if (typeof b !== 'number') return `${name} can't be read in the second run under load (${String(b)}), and a number that can't be read is missing, never the same`;
    if (a !== b) return `two runs under load read ${name} differently: ${a}, then ${b}`;
  }
  return null;
}
/** AC6's judge, `deep inbox`: it listed every open ask, by its handle, and exited 0. */
export function judgeListed(open: readonly string[], ran: { code: number | null; stdout: string; stderr: string }): string | null {
  if (ran.code !== 0) return `deep inbox exited ${String(ran.code)}: ${ran.stderr.trim() || ran.stdout.trim()}`;
  const missing = open.filter((handle) => !ran.stdout.includes(handle));
  if (missing.length) return `deep inbox left out ${missing.length} of the ${open.length} open asks, the first ${missing[0]}`;
  return null;
}
/**
 * AC6's judge, paging: the first page of inbox.read holds every open ask and at most PAGE_SIZE settled ones, each page
 * counts the settled asks older than it, and following `next` finds every settled ask once.
 */
export function judgePages(open: readonly string[], settled: readonly string[], pages: readonly Line[]): string | null {
  const refused = pages.find((p) => p.error);
  if (refused) return `the hub refused a page of inbox.read: ${String(refused.error.code)} (${String(refused.error.remediation)})`;
  const asksOn = (p: Line): string[] => ((p.result?.asks ?? []) as Line[]).map((a) => String(a.ask));
  const first = new Set(asksOn(pages[0]!));
  const notOpen = open.find((h) => !first.has(h));
  if (notOpen) return `inbox.read's first page left out the open ask ${notOpen}`;
  const all = new Set(settled);
  const seen = new Map<string, number>();
  for (const [i, p] of pages.entries()) {
    const on = asksOn(p).filter((h) => all.has(h));
    if (on.length > PAGE_SIZE) return `inbox.read gives no page of the settled asks: its ${i ? `page ${i + 1}` : 'first read'} holds ${on.length} of the ${settled.length}, past the ${PAGE_SIZE} newest${restOf(p) === undefined ? ', with no count of the rest' : ''}`;
    for (const h of on) {
      if (seen.has(h)) return `paging found the settled ask ${h} twice, on pages ${seen.get(h)! + 1} and ${i + 1}`;
      seen.set(h, i);
    }
    const rest = settled.length - seen.size;
    if (restOf(p) !== rest) return `page ${i + 1} of inbox.read counts ${JSON.stringify(restOf(p))} settled asks as the rest; ${rest} of the ${settled.length} were on no page yet`;
  }
  const lost = settled.find((h) => !seen.has(h));
  if (lost) return `paging found ${seen.size} of the ${settled.length} settled asks: ${lost} was on no page`;
  return null;
}
/** Every page of inbox.read: the first with no params, each after it at the cursor the one before gave, until none does. */
export async function inboxPages(conn: Conn, most = 100): Promise<Line[]> {
  const pages = [await conn.call('inbox.read', {}, 120_000)];
  for (let next = nextOf(pages[0]!); typeof next === 'string' && pages.length < most; next = nextOf(pages[pages.length - 1]!)) pages.push(await conn.call('inbox.read', pageAt(next), 120_000));
  return pages;
}
