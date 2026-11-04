// Heavy commands share the machine (#1015; design: Lease). An agent's full build or test suite runs as
// `deep lease [kind...] -- <command>`: the calling session's command, holding one `cpu.slot` under the `slow` key
// (#907) and a lease on each kind it names, at a lower CPU priority, and only while the system's memory pressure isn't
// critical. Its leases end once the command's whole process group has ended, released on the proof that each is gone
// (#237). While it waits, the hub keeps its place in one queue and the command prints a line a minute naming what it
// waits for and who holds it; a waiter its caller kills leaves no lease and no place behind.
//
// deep-hook matches each shell call against the heavy.command@1 entries at PreToolUse and writes its `deep lease`
// form; the hub's reply rewrites a matched call into it, or denies it once with it where the adapter can't rewrite
// (heavyDenial, which deep-hook words the same when the hub is late). A call that ran while the hub was away reads
// "ran unleased" in its session's row.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { availableParallelism, loadavg, totalmem } from 'node:os';
import type { Caller, Lease, LeaseTable, Mode, Resource } from '@deepbuild/leases';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

type Obj = Record<string, unknown>;

/** The deny an agent whose calls can't be rewritten gets once: the leased command to run instead, in backticks. */
export function heavyDenial(command: string, form: string, entry: string): string {
  return `DeepBuild runs heavy commands under one lease, so builds and test suites share the machine: \`${command.trim()}\` is one (heavy command ${entry}). Run \`${form}\` instead; it waits for a free slot and runs at a lower priority.`;
}

// ---- Memory pressure.

export type Pressure = 'normal' | 'warn' | 'critical';
/**
 * The system's memory-pressure level: macOS's (kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical),
 * or Linux's pressure stall information (/proc/pressure/memory: full stalls over 10% of the last 10 s are critical,
 * some over 10% a warning). DEEP_TEST_MEMORY_PRESSURE_FILE names a file holding the level instead (tests only).
 */
export function memoryPressure(env: NodeJS.ProcessEnv = process.env): Pressure {
  const file = env.DEEP_TEST_MEMORY_PRESSURE_FILE;
  if (file) {
    try {
      const word = readFileSync(file, 'utf8').trim();
      return word === 'critical' || word === 'warn' ? word : 'normal';
    } catch { return 'normal'; }
  }
  try {
    if (process.platform === 'darwin') {
      const level = Number(execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 2000 }).trim());
      return level >= 4 ? 'critical' : level >= 2 ? 'warn' : 'normal';
    }
    if (process.platform === 'linux') {
      const psi = readFileSync('/proc/pressure/memory', 'utf8');
      const avg = (kind: string) => Number(new RegExp(`^${kind} avg10=([0-9.]+)`, 'm').exec(psi)?.[1] ?? 0);
      return avg('full') >= 10 ? 'critical' : avg('some') >= 10 ? 'warn' : 'normal';
    }
  } catch { /* no reading: nothing to wait for */ }
  return 'normal';
}

// ---- Pools drafted from the machine.

/**
 * The shipped kinds' pools, drafted from the machine's cores and memory, proposals until the dogfood week measures
 * them (#43): a browser for each 16 GB, a stack for each 3 cores. On the reference Mac (12 cores, 36 GB) that is
 * browsers 2 and stacks 4.
 */
export function draftedPools(cores = availableParallelism(), memoryGb = totalmem() / 2 ** 30): { browser: number; stack: number } {
  return { browser: Math.min(8, Math.max(1, Math.floor(memoryGb / 16))), stack: Math.min(16, Math.max(1, Math.floor(cores / 3))) };
}

// ---- The hub's queue.

/** One kind a `deep lease` names: its lease kind and mode, `gpu:exclusive` for an export or a timing check. */
interface Need { kind: string; mode: Mode }
const KIND = /^([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*)(?::(shared|exclusive))?$/;
function needsOf(kinds: unknown): Need[] {
  if (!Array.isArray(kinds)) throw Error('name the kinds as a list');
  return kinds.map((k) => {
    const m = KIND.exec(String(k));
    if (!m) throw Error(`${String(k)} is no lease kind: name one such as browser, stack, gpu:shared or gpu:exclusive`);
    // The GPU is shared by functional work unless the command asks for it exclusive.
    return { kind: m[1]!, mode: (m[2] ?? (m[1] === 'gpu' ? 'shared' : 'exclusive')) as Mode };
  });
}
/** Every lease of a kind a `deep lease` takes is on one key, so its modes decide who runs beside whom. */
const resourceOf = (kind: string, slow: string): Resource => (kind === 'cpu.slot' ? { host: 'local', kind, key: slow } : { host: 'local', kind, key: kind });

interface Waiter {
  ticket: string; secret: string; holder: string; session?: string; command: string; cwd: string; needs: Need[];
  peer: { pid: number; start: string }; queued: number; seen: number; blockedOn?: string;
  /** How long it waited for each reason, in ms, and when it last read one. */
  waits: Record<string, number>; last?: { reason: string; at: number };
}
interface Held { ticket: string; secret: string; holder: string; session?: string; command: string; cwd: string; run: string; leases: Lease[]; granted: number; peer: { pid: number; start: string }; group?: number; leader?: number; started?: number; load?: number; waits: Record<string, number> }

export interface HeavyOptions {
  table: LeaseTable;
  /** The cpu.slot key slow work leases (SLOW_SLOT, #907), which keeps the pool's last slot for a held stop's quick checks. */
  slow: string;
  now: () => number;
  /** Appends one core event (process.tracked, process.ended, session.reading). */
  append: (kind: string, v: number, data: Obj, subject?: string, session?: string) => Promise<string>;
  /** A session's worktree folder, to name who holds a lease. */
  worktreeOf: (session: string) => string | undefined;
  /** A session's agent process, so its leases end with it. */
  agentOf: (session: string) => { pid: number; start: string } | undefined;
  /** The planted wrong programs: `ignores-memory-pressure`, `exclusive-beside-shared`, `releases-on-parent-exit`. */
  plant?: string;
  pressure?: () => Pressure;
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const groupAlive = (pgid: number): boolean => { try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const span = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
/** A `deep lease` run's ID starts so, which tells its leases from the gate runner's and the supervisor's after a restart. */
const RUN_PREFIX = 'run:LEASE';

/**
 * The queue `deep lease` waits in: a waiter is granted only when no waiter before it is held up by a kind it needs, or
 * by memory, so a freed slot goes to the first in line. A waiter whose process is gone loses its place at once.
 */
export class HeavyQueue {
  private readonly waiting: Waiter[] = [];
  private readonly held = new Map<string, Held>();
  constructor(private readonly o: HeavyOptions) {}

  /** `lease.wait`: one place in the queue, granted or still waiting with the line to show; `session` is the caller's. */
  async wait(params: Obj, peer: { pid: number; start: string } | undefined, session: () => Promise<string | undefined>): Promise<Obj> {
    const now = this.o.now();
    this.expire();
    let w = typeof params.ticket === 'string' ? this.waiting.find((x) => x.ticket === params.ticket && x.secret === params.secret) : undefined;
    const granted = typeof params.ticket === 'string' ? this.held.get(params.ticket) : undefined;
    if (granted && granted.secret === params.secret) return { status: 'granted', ticket: granted.ticket, secret: granted.secret, run: granted.run, leases: granted.leases.map((l) => l.id) };
    if (!w) {
      if (!peer) throw Error('deep lease names no process, so whose session it runs for is unknown; run the deep command itself');
      const id = await session();
      const needs = [{ kind: 'cpu.slot', mode: 'exclusive' as Mode }, ...needsOf(params.kinds ?? [])];
      w = {
        ticket: `lease-wait:${randomBytes(6).toString('hex')}`, secret: randomBytes(16).toString('hex'), holder: id ? `session:${letters(id)}` : 'cli', ...(id ? { session: id } : {}),
        command: String(params.command ?? '').slice(0, 2000), cwd: String(params.cwd ?? ''), needs, peer, queued: now, seen: now, waits: {},
      };
      this.waiting.push(w);
    }
    w.seen = now;
    const reason = await this.attempt(w);
    if (reason === undefined) {
      const h = this.held.get(w.ticket)!;
      return { status: 'granted', ticket: h.ticket, secret: h.secret, run: h.run, leases: h.leases.map((l) => l.id) };
    }
    if (w.last) w.waits[w.last.reason] = (w.waits[w.last.reason] ?? 0) + (now - w.last.at);
    w.last = { reason: reason.kind, at: now };
    return { status: 'waiting', ticket: w.ticket, secret: w.secret, line: reason.line };
  }

  /** Drops each waiter whose process is gone, so its place goes to the next. */
  private expire(): void {
    for (let i = this.waiting.length - 1; i >= 0; i--) if (!alive(this.waiting[i]!.peer.pid)) this.waiting.splice(i, 1);
  }

  /** Tries the waiter's leases, all or none; undefined once they are its, else what it waits for. */
  private async attempt(w: Waiter): Promise<{ kind: string; line: string } | undefined> {
    const before = this.waiting.slice(0, this.waiting.indexOf(w));
    const pressure = (this.o.pressure ?? memoryPressure)();
    if (pressure === 'critical' && this.o.plant !== 'ignores-memory-pressure') {
      w.blockedOn = 'memory';
      return { kind: 'memory', line: `deep lease: waiting for memory: the system reports critical memory pressure, so \`${w.command}\` starts once it eases` };
    }
    // A freed slot or kind goes to the first in line that waits for it.
    const ahead = before.find((x) => x.blockedOn === 'memory' || w.needs.some((n) => n.kind === x.blockedOn));
    if (ahead?.blockedOn) {
      const kind = ahead.blockedOn;
      w.blockedOn = kind;
      const holders = kind === 'memory' ? [] : (await this.o.table.leases()).filter((v) => v.lease.resource.kind === kind).map((v) => v.lease.holder);
      const by = [...new Set(holders.map((h) => this.who(h)))].join(', ');
      return { kind: kind === 'cpu.slot' ? 'slot' : kind, line: await this.line(w, kind, `${by ? `held by ${by}; ` : ''}${this.who(ahead.holder)} is ahead of it in the queue`) };
    }
    const run = `${RUN_PREFIX}${letters(w.ticket.slice('lease-wait:'.length)).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
    const agent = w.session ? this.o.agentOf(w.session) : undefined;
    const caller: Caller = { holder: w.holder, run, ...(agent ? { agent } : {}) };
    const got: Lease[] = [];
    for (const n of w.needs) {
      // The planted wrong program for AC6 grants an exclusive GPU lease beside shared ones.
      const mode: Mode = this.o.plant === 'exclusive-beside-shared' && n.kind === 'gpu' ? 'shared' : n.mode;
      const r = await this.o.table.lease(caller, resourceOf(n.kind, this.o.slow), mode).catch((e: Error) => ({ status: 'error' as const, message: e.message }));
      if (r.status === 'granted') { got.push(r.lease); continue; }
      for (const l of got) await this.o.table.release(l.id, []).catch(() => undefined);
      if (r.status === 'error') throw Error(`deep lease can't lease ${n.kind}: ${r.message}`);
      w.blockedOn = n.kind;
      const holders = 'holders' in r ? r.holders : [];
      const by = [...new Set(holders.map((l) => this.who(l.holder)))].join(', ');
      return { kind: n.kind === 'cpu.slot' ? 'slot' : n.kind, line: await this.line(w, n.kind, by ? `held by ${by}` : r.message) };
    }
    this.waiting.splice(this.waiting.indexOf(w), 1);
    const now = this.o.now();
    const waits = { ...w.waits };
    if (w.last) waits[w.last.reason] = (waits[w.last.reason] ?? 0) + (now - w.last.at);
    this.held.set(w.ticket, { ticket: w.ticket, secret: w.secret, holder: w.holder, ...(w.session ? { session: w.session } : {}), command: w.command, cwd: w.cwd, run, leases: got, granted: now, peer: w.peer, waits });
    return undefined;
  }
  private who(holder: string): string {
    const session = holder.startsWith('session:') ? holder.slice('session:'.length) : undefined;
    const wt = session ? this.o.worktreeOf(session) : undefined;
    return `${holder}${wt ? ` (${wt.split('/').filter(Boolean).at(-1)})` : ''}`;
  }
  private async line(w: Waiter, kind: string, who: string): Promise<string> {
    const what = kind === 'cpu.slot' ? 'a cpu.slot (slow work holds all but the slot kept for a held stop\'s quick checks)' : `the ${kind} lease`;
    return `deep lease: waiting ${span(this.o.now() - w.queued)} for ${what}: ${who}`;
  }

  /** `lease.started`: the command's process group, which holds its leases until every process in it has ended. */
  async started(params: Obj): Promise<Obj> {
    const h = this.mine(params);
    const pid = Number(params.pid);
    if (!Number.isInteger(pid) || pid < 2) throw Error('name the command\'s process by its ID');
    h.leader = pid;
    h.group = Number.isInteger(Number(params.pgid)) && Number(params.pgid) > 1 ? Number(params.pgid) : pid;
    h.started = this.o.now();
    h.load = loadavg()[0]!;
    const start = (await startOf(pid)) ?? new Date(h.started).toUTCString();
    await this.o.append('process.tracked', 1, { run: h.run, pid, start, pgid: h.group, cwd: typeof params.cwd === 'string' && params.cwd ? params.cwd : h.cwd || '/', token: null }, h.run, h.session);
    return { tracked: true };
  }
  /** `lease.exited`: the command's first process exited; its group may run on, and holds its leases while it does. */
  async exited(params: Obj): Promise<Obj> {
    const h = this.mine(params);
    // The planted wrong program for AC4 releases on the parent's exit, whatever its group still runs.
    if (this.o.plant === 'releases-on-parent-exit') await this.end(h, true);
    return { ok: true };
  }
  private mine(params: Obj): Held {
    const h = typeof params.ticket === 'string' ? this.held.get(params.ticket) : undefined;
    if (!h || h.secret !== params.secret) throw Error('no lease this deep lease holds has that ticket');
    return h;
  }

  /**
   * After a restart, the leases an earlier hub granted to `deep lease` runs, from the record: each is held again for
   * its process group, and released once the group has ended; one whose command never started is released now.
   */
  async recover(raw: (sql: string, params?: readonly (string | number)[]) => Promise<unknown[]>): Promise<void> {
    const views = (await this.o.table.leases()).map((v) => v.lease);
    const rows = (await raw(`SELECT subject, json_extract(data, '$.run') AS run FROM events WHERE kind = 'lease.acquired' AND json_extract(data, '$.run') LIKE '${RUN_PREFIX}%'`)) as { subject: string; run: string }[];
    const byRun = new Map<string, Lease[]>();
    for (const r of rows) {
      const lease = views.find((l) => l.id === r.subject);
      if (lease) byRun.set(r.run, [...(byRun.get(r.run) ?? []), lease]);
    }
    for (const [run, leases] of byRun) {
      const [proc] = (await raw(`SELECT json_extract(data, '$.pid') AS pid, json_extract(data, '$.pgid') AS pgid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = ? ORDER BY log_pos LIMIT 1`, [run])) as { pid: number; pgid: number }[];
      const h: Held = { ticket: `lease-wait:${run}`, secret: randomBytes(16).toString('hex'), holder: leases[0]!.holder, command: '', cwd: '', run, leases, granted: this.o.now(), peer: { pid: 0, start: '' }, waits: {}, ...(proc ? { leader: proc.pid, group: proc.pgid } : {}) };
      this.held.set(h.ticket, h);
      if (!proc) await this.end(h);
    }
  }

  /** Each tick: a waiter gone loses its place; a command whose group has ended, or that never started, gives its leases back. */
  async tick(): Promise<void> {
    this.expire();
    for (const h of [...this.held.values()]) {
      const over = h.group !== undefined ? !groupAlive(h.group) : !alive(h.peer.pid);
      if (over) await this.end(h);
    }
  }
  private async end(h: Held, early = false): Promise<void> {
    if (!this.held.delete(h.ticket)) return;
    const proof: string[] = [];
    if (h.leader !== undefined) proof.push(await this.o.append('process.ended', 1, { run: h.run, pid: h.leader }, h.run, h.session));
    for (const l of h.leases) await this.o.table.release(l.id, early ? [] : proof).catch(() => undefined);
    // The command's reading: how long it waited, by reason, how long it ran, and the load when it started.
    if (h.session && h.started !== undefined) {
      const waited = Object.entries(h.waits).filter(([, ms]) => ms > 0).map(([why, ms]) => `${span(ms)} for ${why}`).join(', ');
      const reading = `deep lease ran \`${h.command}\` for ${span(this.o.now() - h.started)}${waited ? ` after waiting ${waited}` : ' with no wait'}; load ${(h.load ?? 0).toFixed(1)} on ${availableParallelism()} cores when it started`;
      await this.o.append('session.reading', 1, { reading }, undefined, h.session).catch(() => undefined);
    }
  }
}

// ---- `deep lease [kind...] -- <command>`.

const USAGE = 'Usage: deep lease [kind...] -- <command>   the command run under a cpu.slot and a lease on each kind (browser, stack, gpu:shared, gpu:exclusive), at a lower priority';
const LINE_EVERY_MS = 60_000;
const POLL_MS = 250;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs the command as it is when no hub can lease it, saying so. */
function unleased(argv: string[], why: string): Promise<number> {
  process.stderr.write(`deep lease: ${why}, so \`${argv.join(' ')}\` runs unleased\n`);
  return runGroup(argv, () => undefined, () => undefined);
}
/** The command in a process group of its own at nice 10; resolves with its status once the whole group has ended. */
function runGroup(argv: string[], started: (pid: number) => void, exited: () => void): Promise<number> {
  return new Promise((resolve) => {
    // A `deep lease` inside a leased command runs under its lease: it takes no slot of its own, so nested leases never wait on each other.
    const child = spawn('/usr/bin/nice', ['-n', '10', ...argv], { stdio: 'inherit', detached: true, env: { ...process.env, DEEP_LEASED: '1' } });
    const forward = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* gone */ } };
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    for (const s of signals) process.on(s, () => forward(s));
    if (child.pid) started(child.pid);
    child.on('error', (error) => { process.stderr.write(`deep lease: ${argv[0]}: ${error.message}\n`); resolve(127); });
    child.on('exit', async (code, signal) => {
      exited();
      // The leases hold while any process of the group runs; the command's status is its first process's.
      while (groupAlive(child.pid!)) await sleep(100);
      resolve(code ?? 128 + (signal ? ({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>)[signal] ?? 1 : 1));
    });
  });
}

export async function leaseCommand(args: readonly string[]): Promise<number> {
  const dash = args.indexOf('--');
  const kinds = dash < 0 ? [] : args.slice(0, dash);
  const argv = dash < 0 ? [] : args.slice(dash + 1);
  if (!argv.length || kinds.some((k) => !KIND.test(k))) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (process.env.DEEP_LEASED) return runGroup(argv, () => undefined, () => undefined);
  let token: string;
  try { token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim(); } catch { return unleased(argv, 'DeepBuild isn\'t set up here (no hub token)'); }
  const socket = hubAddress().path;
  const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
  const ask = async (method: string, params: Obj): Promise<Reply> => call(socket, token, method, params, peer);
  let reply: Reply;
  try { reply = await ask('lease.wait', { kinds, command: argv.join(' '), cwd: process.cwd() }); } catch (error) { return unleased(argv, `the hub can't be reached (${error instanceof Error ? error.message : String(error)})`); }
  let shown = -Infinity;
  for (;;) {
    if ('error' in reply) {
      process.stderr.write(`deep lease: ${reply.error.remediation}\n`);
      return 3;
    }
    const r = reply.result;
    if (r.status === 'granted') break;
    if (Date.now() - shown >= LINE_EVERY_MS) {
      process.stderr.write(`${String(r.line)}\n`);
      shown = Date.now();
    }
    await sleep(POLL_MS);
    try { reply = await ask('lease.wait', { ticket: r.ticket, secret: r.secret }); } catch (error) {
      process.stderr.write(`deep lease: the hub stopped answering while it waited (${error instanceof Error ? error.message : String(error)})\n`);
      return 3;
    }
  }
  const granted = (reply as { result: Obj }).result;
  const own = { ticket: granted.ticket, secret: granted.secret };
  const tell = (method: string, extra: Obj = {}) => ask(method, { ...own, ...extra }).catch(() => undefined);
  let told: Promise<unknown> = Promise.resolve();
  return runGroup(argv, (pid) => { told = tell('lease.started', { pid, pgid: pid, cwd: process.cwd() }); }, () => { void told.then(() => tell('lease.exited')); });
}
