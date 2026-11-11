// Test-side tools for the #1577 acceptance tests (README). A real hub (`deep hub run`, packages/cli/dist/main.js) in
// a temp home under /tmp/dh1577-*, asks seeded through the real asks core on its ledger before it starts (as #34,
// #65 and #1579 seed them), the OS confirmation's stand-in from #34's helpers, the hub as a process and the socket
// client from #16's, the design's signature envelope from #1579's. What is new here: a socket in front of the hub
// that cuts one reply (the client never gets it; a copy is kept), hook lines for a session the app's note goes to,
// and the record reads the criteria name. Every process is stopped by PID; the real ~/.deepbuild is never touched.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import {
  alive, cleanup as cleanup16, Conn, REPO, fromHere, hookRequest, newSession, openAs, result, sendHook, sleep, startHub, stopHub, tokenOf,
  type Hub, type HookResult, type Line, type Session,
} from '../16/helpers.ts';
import { Confirmer } from '../34/helpers.ts';
import { newDevice, newOnce, sha256, signNew, type Device } from '../1579/helpers.ts';

export { alive, Conn, REPO, newOnce, result, sleep, type Device, type Line, type Session };

/** Each criterion's tag: `#1577.` and the first 8 hex of SHA-256 of its checkbox text, trimmed, white space collapsed. */
export const AC = {
  1: 'AC1 #1577.7967d9e6',
  2: 'AC2 #1577.7ab8071a',
  3: 'AC3 #1577.f0851143',
  4: 'AC4 #1577.1cb11a67',
  5: 'AC5 #1577.75136933',
  6: 'AC6 #1577.0e40df84',
  7: 'AC7 #1577.a6b9b799',
  8: 'AC8 #1577.0d3ede71',
} as const;

export const MINUTE = 60_000;
/** An ask that waits 3 minutes, so stepping the hub's clock 4 takes its default (as #1579's undo cases do). */
export const SHORT_WAIT_MS = 3 * MINUTE;
export const PAST_WAIT_MS = 4 * MINUTE;

/** A request ID: 26 base32-ish characters, as the app mints one per write (README, Readings). */
export const newRequest = (): string => `req-${randomBytes(12).toString('base64url')}`;

// ---- Temp folders, short, under /tmp/dh1577-* (a socket path must fit in 104 bytes), removed at cleanup.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1577-'));
  made.push(dir);
  return dir;
}
const closers: (() => void)[] = [];
/** Stops every hub this suite started, by PID (#16's cleanup), closes the cutters and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0)) { try { close(); } catch { /* gone */ } }
  await cleanup16();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Asks put in the record before the hub starts, through the real asks core.
export interface SeedAsk { source: 'effect.push' | 'deep_ask.taste' | 'deep_ask.choice'; question: string; waitMs?: number }
export interface Seeded { handle: string; question: string; options: { id: string; label: string; decision?: string }[]; plan_hash: string | null }
async function seed(root: string, asks: readonly SeedAsk[]): Promise<Seeded[]> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = withPlans(await openAsks({ record, now, deliver: () => undefined }));
  const out: Seeded[] = [];
  for (const a of asks) {
    const row = askSources().find((r) => r.source === a.source);
    if (!row) throw Error(`BLOCKED: setup: ask.sources@1 has no row ${a.source}`);
    const fixture = row.fixture.ask as Line;
    const ask: Line = {
      ...fixture, question: a.question, key: sha256(`#1577 ${a.question}`), deadline: now() + (a.waitMs ?? 86_400_000),
      pinned_to: { ...(fixture.pinned_to as Line), ref: (fixture.pinned_to as Line).kind === 'commit' ? sha256(a.question).slice(0, 40) : sha256(a.question) },
    };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, a.source, ask);
    out.push({ handle, question: a.question, options: ask.options as Seeded['options'], plan_hash: await shownPlanHash(core, handle) });
  }
  await record.close();
  return out;
}

/** Your ask settings, setup's drafts with no batch (as tests/acceptance/23 seeds them). */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};

// ---- A world: one hub, its asks, the app's paired device (and a second one), an app and a CLI connection.
export interface World {
  home: string; root: string; hub: Hub; env: Record<string, string>; confirm: Confirmer;
  asks: Seeded[]; app: Conn; cli: Conn; hubId: string; device: Device; phone: Device;
}
export interface WorldOptions { asks?: SeedAsk[]; env?: Record<string, string> }
/**
 * Seeds the asks, starts the hub with the OS stand-in (DEEP_HUB_TEST_CONFIRM) and a clock tests may step
 * (DEEP_HUB_TEST_CLOCK_STEPS=1), and pairs two devices with the OS confirming you: this Mac's app and a phone.
 * `env` is added to the first start only (a cut point such as DEEP_HUB_TEST_CRASH); a restart leaves it out.
 */
export async function world(o: WorldOptions = {}): Promise<World> {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const root = join(home, '.deepbuild');
  const asks = await seed(root, o.asks ?? []);
  // Your ask settings, as setup drafts them (#23's suite's shape): the offer saved below raises an authority ask.
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = new Confirmer();
  const env = { DEEP_HUB_TEST_CONFIRM: confirm.path, DEEP_HUB_TEST_CLOCK_STEPS: '1', TZ: 'UTC' };
  const hub = await startHub({ home, env: { ...env, ...o.env } }, 180_000);
  const app = await openAs(hub.socket, 'app', tokenOf(hub.root));
  const cli = await openAs(hub.socket, 'cli', tokenOf(hub.root));
  const hubId = app.hello?.hub;
  if (typeof hubId !== 'string' || !hubId) throw Error(`BLOCKED: setup: the hub's hello names no hub ID: ${JSON.stringify(app.hello)}`);
  const w: World = { home, root, hub, env, confirm, asks, app, cli, hubId, device: newDevice("this Mac's DeepBuild app"), phone: newDevice('your phone') };
  closers.push(() => { w.app.close(); w.cli.close(); });
  await pairDevice(w, w.device);
  await pairDevice(w, w.phone);
  return w;
}
async function pairDevice(w: World, device: Device): Promise<void> {
  w.confirm.say(true);
  const reply = await w.app.call('device.pair', { name: device.name, public_key: device.publicKey }, 30_000);
  w.confirm.say(false);
  const id = reply.result?.device;
  if (typeof id !== 'string') throw Error(`BLOCKED: setup: device.pair didn't pair ${device.name} with the OS confirming you: ${JSON.stringify(reply)}`);
  device.id = id;
}
/** Waits for the hub's process to be gone (it killed itself at a cut point, or the test killed it). */
export async function gone(w: World, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (alive(w.hub.pid) && Date.now() < end) await sleep(50);
  return !alive(w.hub.pid);
}
/** The hub killed by the PID this test started it with: SIGKILL, so nothing it holds in memory is written. */
export async function kill(w: World): Promise<void> {
  w.app.close(); w.cli.close();
  await stopHub(w.hub, 'SIGKILL');
}
/** The hub started again on the same home with the base settings (no cut point); the connections are new. */
export async function restart(w: World): Promise<void> {
  w.app.close(); w.cli.close();
  if (alive(w.hub.pid)) await stopHub(w.hub);
  else await w.hub.proc.exit;
  w.hub = await startHub({ home: w.home, env: w.env }, 180_000);
  w.app = await openAs(w.hub.socket, 'app', tokenOf(w.hub.root));
  w.cli = await openAs(w.hub.socket, 'cli', tokenOf(w.hub.root));
  closers.push(() => { w.app.close(); w.cli.close(); });
  if (w.app.hello?.hub !== w.hubId) throw Error(`BLOCKED: setup: the hub's ID changed across its restart: ${String(w.app.hello?.hub)} after ${w.hubId}`);
}

// ---- The hub's clock and signing.
export async function hubNow(w: World): Promise<number> {
  const now = result(await w.cli.call('test.clock', { advance_ms: 0 }, 30_000)).now;
  if (typeof now !== 'number') throw Error(`BLOCKED: setup: test.clock gave no time: ${String(now)}`);
  return now;
}
export async function step(w: World, ms: number): Promise<number> {
  return Number(result(await w.cli.call('test.clock', { advance_ms: ms }, 30_000)).now);
}
/** A write's params signed by `device` in the design's envelope, for `method` on this hub, now by its clock. */
export async function signedBy(w: World, device: Device, method: string, params: Line): Promise<Line> {
  return signNew(method, params, device, { hub: w.hubId, at: await hubNow(w) });
}
/** One method line as the app writes it: `{v: 1, id, method, params}`. */
export const lineOf = (id: string, method: string, params: Line): Line => ({ v: 1, id, method, params });
/** The same line sent on a connection, its reply awaited. */
export async function sendLine(conn: Conn, line: Line, ms = 60_000): Promise<Line> {
  const from = conn.received.length;
  conn.send(line);
  const reply = await conn.seek((l) => l.id === line.id && ('result' in l || 'error' in l), from, ms);
  if (!reply) throw Error(`BLOCKED: setup: no reply to ${String(line.method)} within ${ms} ms${conn.ended ? ' (the hub closed the connection)' : ''}`);
  return reply.json!;
}

// ---- A cut reply: a socket in front of the hub's that carries every line both ways, except the one reply it cuts.
export interface Cutter { path: string; cut: Line[]; close(): void }
/**
 * The hub's socket behind one that hands the client every line but the reply whose `id` is `cutId`: that one is
 * kept in `cut` and never reaches the client, as when a phone's link drops after the hub wrote its reply.
 */
export function cutter(socket: string, cutId: string): Promise<Cutter> {
  const path = join(tempDir(), 'cut.sock');
  const sockets = new Set<net.Socket>();
  const c: Cutter = { path, cut: [], close: () => { for (const s of sockets) s.destroy(); server.close(); } };
  const server = net.createServer((client) => {
    const hub = net.connect(socket);
    sockets.add(client); sockets.add(hub);
    let buffer = '';
    hub.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let json: Line | undefined;
        try { json = JSON.parse(raw) as Line; } catch { json = undefined; }
        if (json && json.id === cutId && ('result' in json || 'error' in json)) { c.cut.push(json); continue; }
        client.write(`${raw}\n`);
      }
    });
    client.pipe(hub);
    client.on('error', () => hub.destroy());
    hub.on('error', () => client.destroy());
    client.on('close', () => hub.end());
    hub.on('close', () => client.end());
  });
  closers.push(c.close);
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(c)); });
}
/** An app connection through the cutter. */
export async function appThrough(w: World, c: Cutter): Promise<Conn> {
  const conn = await openAs(c.path, 'app', tokenOf(w.hub.root));
  closers.push(() => conn.close());
  return conn;
}
/** Waits until the cutter holds the cut reply. */
export async function cutReply(c: Cutter, ms: number): Promise<Line | undefined> {
  const end = Date.now() + ms;
  while (!c.cut.length && Date.now() < end) await sleep(50);
  return c.cut[0];
}

// ---- The record and the inbox.
export async function events(w: World, after = 0): Promise<Line[]> {
  const out: Line[] = [];
  for (let at = after; ;) {
    const page = result(await w.cli.call('events.read', { after: at, limit: 1000 }, 60_000)).events as Line[];
    if (!page.length) return out;
    out.push(...page);
    at = page[page.length - 1]!.log_pos as number;
  }
}
export async function eventsOf(w: World, kind: string, subject?: string): Promise<Line[]> {
  return (await events(w)).filter((e) => e.kind === kind && (subject === undefined || e.subject === subject));
}
/** The log's end now: the log_pos `events.read` reflects. */
export async function logEnd(w: World): Promise<number> {
  const read = result(await w.cli.call('events.read', { after: 0, limit: 1 }, 60_000));
  let end = Number(read.log_pos);
  // A full page reflects its last event; read on to the end.
  for (;;) {
    const page = result(await w.cli.call('events.read', { after: end, limit: 1000 }, 60_000));
    const evs = page.events as Line[];
    end = Math.max(end, Number(page.log_pos));
    if (!evs.length) return end;
  }
}
export async function inboxRow(w: World, ask: string): Promise<Line | undefined> {
  return (result(await w.cli.call('inbox.read', {}, 60_000)).asks as Line[]).find((r) => r.ask === ask);
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false | null>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`BLOCKED: setup: timed out after ${ms} ms waiting for ${what}`);
    await sleep(250);
  }
}
/** Steps the hub's clock past an ask's wait until it takes its default (the asks core ticks each second). */
export async function defaulted(w: World, ask: string): Promise<void> {
  if ((await inboxRow(w, ask))?.outcome === 'defaulted') return;
  await step(w, PAST_WAIT_MS);
  await waitFor(async () => (await inboxRow(w, ask))?.outcome === 'defaulted', 60_000, `${ask} to take its default after the hub's clock stepped`);
}
/** An approval of an authority ask, as the question card sends it: the allow option, the plan's hash, the click's token. */
export function approve(ask: Seeded): Line {
  const allow = ask.options.find((o) => o.decision === 'allow');
  if (!allow) throw Error(`BLOCKED: setup: ${ask.handle} has no option that allows`);
  return { ask: ask.handle, option: allow.id, plan_hash: ask.plan_hash, token: `click-${newOnce()}` };
}

// ---- A session the app's note goes to, driven by hook lines as deep-hook sends them.
export interface Hooked { s: Session; replies: { event: string; text: string; result: HookResult }[] }
/** A Claude Code session in a fresh folder under the world's home, started by its SessionStart. */
export async function session(w: World): Promise<Hooked> {
  // Its folder is a git repository with one commit, so its work has a repo (a folder outside one gets a workspace).
  const cwd = join(tempDir(), 'repo');
  mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { stdio: 'ignore' });
  git('init', '-q'); writeFileSync(join(cwd, 'README.md'), 'probe\n'); git('add', '.'); git('commit', '-qm', 'one');
  const s = newSession(w.home, 'claude-code', cwd);
  const h: Hooked = { s, replies: [] };
  await hook(w, h, 'SessionStart');
  return h;
}
/** Everything a hook reply gives the agent: its stdout and stderr (additionalContext rides in stdout's JSON). */
export function agentText(r: HookResult): string {
  const reply = r.reply ?? {};
  return `${String(reply.stdout ?? '')}\n${String(reply.stderr ?? '')}`;
}
/** One hook line from this process for the session, acknowledged and replied to; its reply's text is kept. */
export async function hook(w: World, h: Hooked, event: string, extra: Line = {}): Promise<HookResult> {
  const r = await sendHook(w.hub.socket, fromHere(hookRequest(h.s, event, extra)), 60_000);
  if (!r.ack && !r.reply) throw Error(`BLOCKED: setup: the hub didn't answer ${event} for ${h.s.id}: ${JSON.stringify(r).slice(0, 600)}`);
  h.replies.push({ event, text: agentText(r), result: r });
  return r;
}
/** The newest Claude Code version the facts cover: the version these sessions run (as #340's suite reads it). */
const COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** A transcript line as Claude Code writes it (#340's suite's shape). */
function transcript(h: Hooked, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: h.s.id, cwd: h.s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(h.s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/**
 * A turn: a prompt you typed (its transcript entry, then UserPromptSubmit), the agent's answer and its stop. The
 * prompt's reply is what carries a note still waiting for the session (prompt context, #340); its text is returned.
 */
export async function turn(w: World, h: Hooked, prompt: string, typed = true): Promise<string> {
  const promptId = randomUUID();
  transcript(h, { type: 'user', promptId, message: { role: 'user', content: prompt }, ...(typed ? { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' } : {}) });
  const r = await hook(w, h, 'UserPromptSubmit', { prompt });
  transcript(h, { type: 'assistant', promptId, message: { id: `msg_${randomUUID().slice(0, 8)}`, role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  await hook(w, h, 'Stop', { last_assistant_message: 'Done.' });
  return agentText(r);
}
/** How many times the agent was given the note: hook replies whose text carries its words. */
export const timesGiven = (h: Hooked, words: string, since = 0): number => h.replies.slice(since).filter((r) => r.text.includes(words)).length;

// ---- The waiter: deep-hook's `session.wait`, which Claude Code's Stop entry runs and which holds until something
// waits for the idle session, then hands it over (#18, #25). Its text is what the agent is given on a wake.
/** One waiter run for the session, on a connection of its own: the text it was handed, or undefined after `ms`. */
export async function waiter(w: World, h: Hooked, ms: number): Promise<string | undefined> {
  const conn = await openAs(w.hub.socket, 'cli', tokenOf(w.hub.root));
  try {
    const reply = await conn.call('session.wait', { session: h.s.id, cwd: h.s.cwd, since: Date.now() }, ms).catch(() => undefined);
    const text = reply?.result?.text;
    if (typeof text !== 'string') return undefined;
    h.replies.push({ event: 'waiter', text, result: { lines: [reply!], raw: [], end: 'reply' } });
    return text;
  } finally {
    conn.close();
  }
}
/** The wake a waiter's exit 2 starts: a prompt carrying its text as a task notification, then the agent's stop. */
export async function wake(w: World, h: Hooked, text: string): Promise<void> {
  await turn(w, h, `<task-notification>${text}</task-notification>`, false);
}
/** `session.note` from the app, as the app sends it: the session, the words and the note's request ID. */
export const note = (w: World, h: Hooked, text: string, request: string): Promise<Line> =>
  w.app.call('session.note', { session: h.s.id, text, request }, 60_000);

/** A signed write on the app's connection: `params` signed by `device` for `method`, sent, its reply. */
export async function signedCall(w: World, device: Device, method: string, params: Line, conn: Conn = w.app): Promise<Line> {
  return conn.call(method, await signedBy(w, device, method, params), 60_000);
}
/** Every event after `after` up to and including `upTo`, through events.read (a read at that position). */
export async function readTo(w: World, after: number, upTo: number): Promise<Line[]> {
  return (await events(w, after)).filter((e) => Number(e.log_pos) <= upTo);
}
/** A short reply for a message. */
export const shown = (line: unknown): string => JSON.stringify(line ?? null).slice(0, 700);
