// #2328's acceptance tests, written blind before the work (README). One `deep lease -- leased-true` runs from inside a
// stand-in agent's process tree, with the hub up and the agent's session known to it, and is watched from two sides: a
// stand-in `ps` first on PATH notes every `ps` the hub and `deep lease` run (fixtures/ps.pl), and an observer socket
// that `deep lease` reaches the hub through notes every call it makes (README, How ps waits are counted). AC1 counts the
// `ps` waits before the command starts, AC2 the `lease.exited()` calls the hub hears, and AC3 reads whose session holds
// the lease, then runs a second command once the hub must treat the agent's PID as another process's
// (DEEP_HUB_TEST_PID_REUSE).
//
// Safety: #1015's world (helpers.ts there): folders under /tmp/dh1015-*, every process it starts stopped by its PID or
// process group's ID after the file, never by name or port; no network, model or real agent.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, folder, heldBy, leaseRows, Session, shownHook, shownLeases, sleep, until, World, type LeaseRow, type Line, type Ran } from '../1015/helpers.ts';

// Criterion IDs: `#2328.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
const AC1 = '#2328.661c3161';
const AC2 = '#2328.a793e073';
const AC3 = '#2328.7a05df84';
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/**
 * How long the stand-in `ps` holds each call while the first command runs, so calls started together overlap by
 * seconds: the gap between two spawns on a loaded Mac is tens to hundreds of ms.
 */
const HOLD_MS = 5000;

/** #1015's world, with the hub told which PIDs another process now holds, and the stand-in `ps` and `leased-true` first on its PATH. */
class LeaseWorld extends World {
  /** Where the stand-ins write ps.log and leased.log, and read `hold`. */
  readonly seen = join(this.dir, 'seen');
  /** DEEP_HUB_TEST_PID_REUSE's file: the PIDs the hub must treat as now held by another process, read at each check. */
  readonly reused = join(this.dir, 'reused-pids.json');
  constructor() {
    super({ pressure: 'normal' });
    mkdirSync(this.seen);
    writeFileSync(this.reused, '[]');
    for (const [name, file] of [['ps', 'ps.pl'], ['leased-true', 'leased.pl']] as const) {
      writeFileSync(join(this.bin, name), readFileSync(join(FIXTURES, file), 'utf8').replaceAll('__DIR__', this.seen));
      chmodSync(join(this.bin, name), 0o755);
    }
  }
  override env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return super.env({ DEEP_HUB_TEST_PID_REUSE: this.reused, ...extra });
  }
}

// ---- The stand-in ps's notes.
/** One `ps` call: its PID, its parent's and its parent's parent's, when it started and ended (ms), its status and arguments. */
interface PsCall { pid: number; ppid: number; gppid: number; start: number; end: number; status: number; args: string }
const rows = (file: string): string[][] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : []);
const psCalls = (w: LeaseWorld): PsCall[] => rows(join(w.seen, 'ps.log')).map(([pid, ppid, gppid, start, end, status, ...args]) => ({
  pid: Number(pid), ppid: Number(ppid), gppid: Number(gppid), start: Number(start), end: Number(end), status: Number(status), args: args.join('\t'),
}));
/** A process's calls: those it ran, or ran through a process of its own. */
const by = (pid: number) => (x: PsCall): boolean => x.ppid === pid || x.gppid === pid;
/** The waits a run of calls makes: calls whose times overlap ran together and are one wait; one after another, one each. */
function waits(calls: readonly PsCall[]): PsCall[][] {
  const out: { calls: PsCall[]; end: number }[] = [];
  for (const x of [...calls].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && x.start < last.end) { last.calls.push(x); last.end = Math.max(last.end, x.end); } else out.push({ calls: [x], end: x.end });
  }
  return out.map((g) => g.calls);
}

// ---- The observer: a socket between `deep lease` and the hub that passes every byte on and notes each call.
/** One call: when its connection opened, the cli hello's peer, its method and params, when it came, the hub's answer and when. */
interface Wire { opened: number; peer?: Line; id: unknown; method: string; params: Line; sent: number; reply?: Line; replied?: number }
const parsed = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
function liner(take: (l: Line) => void): (chunk: Buffer) => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return (chunk) => {
    buffer += decoder.write(chunk);
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const l = parsed(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (l) take(l);
    }
  };
}
class Observer {
  readonly calls: Wire[] = [];
  private readonly server: net.Server;
  private open = 0;
  constructor(readonly path: string, hub: string) {
    this.server = net.createServer({ allowHalfOpen: true }, (client) => {
      this.open++;
      const opened = Date.now();
      let peer: Line | undefined;
      const mine: Wire[] = [];
      const upstream = net.connect({ path: hub, allowHalfOpen: true });
      const fromClient = liner((l) => {
        if (typeof l.hello === 'string' && typeof l.peer === 'object' && l.peer !== null) peer = l.peer as Line;
        if (typeof l.method !== 'string') return;
        const call: Wire = { opened, ...(peer ? { peer } : {}), id: l.id, method: l.method, params: (l.params ?? {}) as Line, sent: Date.now() };
        mine.push(call);
        this.calls.push(call);
      });
      const fromHub = liner((l) => {
        const call = 'result' in l || 'error' in l ? mine.find((x) => x.reply === undefined && x.id === l.id) : undefined;
        if (call) Object.assign(call, { reply: l, replied: Date.now() });
      });
      client.on('data', (chunk: Buffer) => { upstream.write(chunk); fromClient(chunk); });
      upstream.on('data', (chunk: Buffer) => { fromHub(chunk); if (client.writable) client.write(chunk); });
      // The client's end goes on to the hub, which still answers what it was sent; the hub's end goes back.
      let left = 2;
      const closed = () => { if (--left === 0) this.open--; };
      client.on('end', () => upstream.end());
      client.on('close', () => { upstream.end(); setTimeout(() => upstream.destroy(), 30_000).unref(); closed(); });
      upstream.on('end', () => client.end());
      upstream.on('close', () => { client.destroy(); closed(); });
      client.on('error', () => undefined);
      upstream.on('error', () => client.destroy());
    });
  }
  listen(): Promise<void> {
    return new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.path, () => resolve()); });
  }
  /** Whether every connection has closed within `ms`. */
  idle(ms: number): Promise<boolean> { return until(() => this.open === 0, ms, 100); }
  close(): Promise<void> { return Promise.race([new Promise<void>((resolve) => this.server.close(() => resolve())), sleep(10_000)]); }
}

// ---- The world, the session and the leased commands.
interface Ctx { w: LeaseWorld; hubPid: number; s: Session; agentPid: number; observer: Observer; leases: string }
async function setUp(): Promise<Ctx> {
  const w = new LeaseWorld();
  const hub = await w.startHub();
  const leases = folder(w, 'leases');
  const observer = new Observer(join(w.dir, 'o.sock'), hub.socket);
  await observer.listen();
  // A deep command finds the hub through config.json (paths.ts, hubAddress): one run under `leases` reaches it through
  // the observer (`hub.use`, as `deep hub use` writes it); deep-hook and every other client keep the hub's own socket.
  const config = join(w.root, 'config.json');
  const prior = existsSync(config) ? (JSON.parse(readFileSync(config, 'utf8')) as Line) : {};
  writeFileSync(config, `${JSON.stringify({ ...prior, hub: { ...(prior.hub ?? {}), use: { [leases]: `unix:${observer.path}` } } }, null, 2)}\n`);
  // The agent's session, known to the hub from its SessionStart alone: a process two hooks named is watched, and its
  // start read again every 30 s off the lease path, which would land in the counted window by chance (README).
  const s = new Session(w, 'claude', folder(w, 'agent'));
  const hooked = await s.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  const known = await until(async () => (await allEvents(hub)).some((e) => e.kind === 'session.start' && e.session === s.id), 120_000, 500);
  expect(known, `the hub records the stand-in agent's SessionStart (${shownHook(hooked)})`).toBe(true);
  // The agent's process: its shell tool's parent.
  const probe = await s.run('echo $PPID').done;
  const agentPid = Number(probe.output.trim());
  expect(Number.isSafeInteger(agentPid) && agentPid > 1, `the agent's shell names its parent: ${JSON.stringify(probe.output)}`).toBe(true);
  // What the session's start set off settles first: no new `ps` for 3 s.
  let count = -1;
  let since = Date.now();
  await until(() => { const n = psCalls(w).length; if (n !== count) { count = n; since = Date.now(); } return Date.now() - since > 3000; }, 60_000, 250);
  return { w, hubPid: hub.pid, s, agentPid, observer, leases };
}

interface Run {
  t0: number; ran?: Ran; output: string;
  /** The leased command's own note: its PID, its parent's (`deep lease`'s) and when it started. */
  command?: { pid: number; ppid: number; at: number };
  wires: Wire[]; ps: PsCall[]; leases: LeaseRow[];
}
/** The agent's shell runs `deep lease -- leased-true` in `leases/<label>`; with `hold`, the stand-in ps holds each call. */
async function lease(c: Ctx, label: string, hold: boolean): Promise<Run> {
  const cwd = join(c.leases, label);
  mkdirSync(cwd);
  const held = join(c.w.seen, 'hold');
  if (hold) writeFileSync(held, `${HOLD_MS}\n`);
  const before = c.observer.calls.length;
  const t0 = Date.now();
  const bash = c.s.run('deep lease -- leased-true', { cwd });
  const ran = await Promise.race([bash.done, sleep(300_000).then(() => undefined)]);
  rmSync(held, { force: true });
  await c.observer.idle(30_000);
  const command = rows(join(c.w.seen, 'leased.log')).map(([pid, ppid, at]) => ({ pid: Number(pid), ppid: Number(ppid), at: Number(at) })).find((x) => x.at >= t0);
  return {
    t0, ...(ran ? { ran } : {}), output: bash.output(), ...(command ? { command } : {}),
    wires: c.observer.calls.slice(before), ps: psCalls(c.w).filter((x) => x.start >= t0), leases: (await leaseRows(c.w.hub!)).filter((r) => r.at >= t0),
  };
}

// ---- What the failures show.
const after = (t: number | undefined, t0: number): string => (t === undefined ? '?' : `+${t - t0} ms`);
function named(x: PsCall, c: Ctx, r: Run): string {
  const p = /(?:^|\s)-p\s*(\d+)/.exec(x.args)?.[1];
  const who = by(c.hubPid)(x) ? 'the hub' : r.command && by(r.command.ppid)(x) ? '`deep lease`' : `pid ${x.ppid}`;
  const what = /(^|\s)-A\b/.test(x.args) ? 'the process table' : p === String(r.command?.ppid) ? "`deep lease`'s start" : p === String(c.agentPid) ? "the agent's start"
    : p === String(r.command?.pid) ? "the command's start" : 'other';
  return `\`ps ${x.args}\` by ${who}, ${what}, ${after(x.start, r.t0)} to ${after(x.end, r.t0)}`;
}
const shownWaits = (groups: PsCall[][], c: Ctx, r: Run): string => groups.map((g, i) => `wait ${i + 1}: ${g.map((x) => named(x, c, r)).join(' beside ')}`).join('; ') || 'none';
/** An answer in one line, its lease's secret left out. */
const answer = (l: Line): string => JSON.stringify(l.result ?? l.error, (key, v: unknown) => (key === 'secret' ? '<secret>' : v)).slice(0, 200);
const shownWires = (wires: readonly Wire[], t0: number): string => wires.map((x) => `${x.method} ${after(x.sent, t0)}${x.reply ? ` answered ${after(x.replied, t0)}: ${answer(x.reply)}` : ' (no answer)'}`).join('; ') || 'none';
const grantedOf = (r: Run): Wire | undefined => r.wires.find((x) => x.method === 'lease.wait' && (x.reply?.result as Line | undefined)?.status === 'granted');

describe('#2328 a leased command starts sooner', () => {
  let ctx: Promise<Ctx> | undefined;
  let one: Promise<Run> | undefined;
  const world = (): Promise<Ctx> => (ctx ??= setUp());
  /** The first leased command, run once with the stand-in ps holding each call, read by all three tests. */
  const first = async (): Promise<Run> => { const c = await world(); return (one ??= lease(c, 'one', true)); };
  afterAll(async () => {
    const c = await ctx?.catch(() => undefined);
    if (!c) return;
    c.s.stop();
    await c.w.stopHub();
    await c.observer.close();
  }, 120_000);

  it(`${AC1} A leased command with the hub up starts after at most one \`ps\` wait in \`deep lease\` itself and two in the hub, counted by a stand-in \`ps\` on PATH`, async () => {
    const c = await world();
    const r = await first();
    expect(r.command, `\`deep lease -- leased-true\` runs its command (${r.ran ? `exit ${r.ran.code}` : 'still running after 300 s'}): ${r.output}`).toBeDefined();
    const granted = grantedOf(r);
    expect(granted?.replied, `\`deep lease\` reaches the hub through the observer (hub.use for ${c.leases}) and is granted its lease: ${shownWires(r.wires, r.t0)}`).toBeDefined();
    // Precondition: the peer check found the agent's session above the command, so it read all it reads for a session.
    expect(r.leases.filter((l) => l.kind === 'cpu.slot' && heldBy(l, c.s)).length, `the command's cpu.slot is held as the agent's session ${c.s.id}: ${shownLeases(r.leases)}`).toBeGreaterThan(0);
    // `deep lease`'s waits end before its command starts; the hub's run from its first connection to the grant.
    const opened = Math.min(...r.wires.map((x) => x.opened));
    const own = waits(r.ps.filter((x) => by(r.command!.ppid)(x) && x.end <= r.command!.at));
    const hub = waits(r.ps.filter((x) => by(c.hubPid)(x) && x.start >= opened && x.end <= granted!.replied!));
    console.log(`AC1: deep lease (pid ${r.command!.ppid}) started by +0 ms, first connection ${after(opened, r.t0)}, granted ${after(granted!.replied, r.t0)}, the command started ${after(r.command!.at, r.t0)}`);
    console.log(`AC1: deep lease's own waits before the command started: ${shownWaits(own, c, r)}`);
    console.log(`AC1: the hub's waits between deep lease's first call and its grant: ${shownWaits(hub, c, r)}`);
    console.log(`AC1: every ps from deep lease's start on: ${r.ps.map((x) => named(x, c, r)).join('; ')}`);
    expect(hub.length, `the stand-in ps saw no ps of the hub's (pid ${c.hubPid}) between \`deep lease\`'s first call and its grant, so the hub's reads can't be counted; every ps it saw: ${r.ps.map((x) => named(x, c, r)).join('; ')}`).toBeGreaterThan(0);
    expect(own.length, `\`deep lease\` itself waited on ${own.length} ps, one after another, before its command started: ${shownWaits(own, c, r)}`).toBeLessThanOrEqual(1);
    expect(hub.length, `the hub waited on ${hub.length} ps, one after another, before it granted the lease and the command could start: ${shownWaits(hub, c, r)}`).toBeLessThanOrEqual(2);
  }, 600_000);

  it(`${AC2} The hub hears \`lease.exited()\` once for a command whose group ended with it`, async () => {
    const r = await first();
    expect(r.command, `\`deep lease -- leased-true\` runs its command: ${r.output}`).toBeDefined();
    expect(r.ran?.code, `\`deep lease\` ends with its command's status, 0: ${r.output}`).toBe(0);
    const exited = r.wires.filter((x) => x.method === 'lease.exited');
    console.log(`AC2: every call deep lease made: ${shownWires(r.wires, r.t0)}`);
    expect(exited.length, `the hub heard lease.exited() ${exited.length} times for \`leased-true\`, whose process group ended with its one process: ${shownWires(exited, r.t0)}`).toBe(1);
  }, 600_000);

  it(`${AC3} A \`deep lease\` run from inside an agent's process tree still holds its lease as that session; one whose PID was reused is still refused`, async () => {
    const c = await world();
    const r = await first();
    const slots = r.leases.filter((l) => l.kind === 'cpu.slot');
    console.log(`AC3: \`deep lease\` under agent pid ${c.agentPid} (session ${c.s.id}): ${shownLeases(slots)}`);
    expect(slots.some((l) => heldBy(l, c.s)), `\`deep lease\` run from inside the agent's process tree (agent pid ${c.agentPid}) holds its cpu.slot as session ${c.s.id}: ${shownLeases(slots)}; ${r.output}`).toBe(true);
    // The agent's PID is now another process's, as far as the hub can tell.
    writeFileSync(c.w.reused, JSON.stringify([c.agentPid]));
    const b = await lease(c, 'two', false);
    const asked = b.wires.find((x) => x.method === 'lease.wait');
    const theirs = b.leases.filter((l) => l.kind === 'cpu.slot');
    console.log(`AC3: with pid ${c.agentPid} reused, the second \`deep lease\`: ${shownWires(b.wires, b.t0)}; ${shownLeases(theirs)}`);
    expect(asked?.reply, `the hub answers the second \`deep lease\`'s lease.wait: ${shownWires(b.wires, b.t0)}; ${b.output}`).toBeDefined();
    expect(theirs.filter((l) => heldBy(l, c.s)).map((l) => `${l.kind} ${l.mode} by ${l.holder}`), `with the agent's PID ${c.agentPid} held by another process (DEEP_HUB_TEST_PID_REUSE), a \`deep lease\` under it is refused as session ${c.s.id}; it held: ${shownLeases(theirs)}`).toEqual([]);
  }, 600_000);
});
