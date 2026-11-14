// Test-side tools for the #1577 acceptance tests (README). A real hub (`deep hub run`) in a temp home under /tmp,
// asks raised through the real asks core on its ledger before it starts, two devices paired with `device.pair` and
// signing in the design's format, the hook lines an agent's deep-hook sends, and the hub killed by its PID. The hub
// as a process, the socket client, hook requests and cleanup are #16's (tests/acceptance/16/helpers.ts), the OS
// confirmation's stand-in is #34's, and the world, the signer and the clock step follow tests/acceptance/1579's
// helpers (same repo, same license), kept here as a copy so a redraft there never moves these tests. Nothing here
// stands in for the hub: every test reaches it through its socket and the files the design names under its root.
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import {
  cleanup as cleanup16, fromHere, hookRequest, newSession, openAs, REPO, result, sendHook, startHub, stopHub, tokenOf,
  type Conn, type HookResult, type Hub, type Line, type Session,
} from '../16/helpers.ts';
import { Confirmer } from '../34/helpers.ts';

export { result, type Conn, type Hub, type Line, type Session };

/** Each criterion's tag: `#1577.` and the first 8 hex of SHA-256 of its checkbox text, trimmed, whitespace collapsed. */
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

/** The planted wrong programs the implementation adds to packages/hub/src/plant.ts (README, Wrong programs). */
export const PLANTS = { pendingAcrossRestart: 'pending-across-restart', appliesStaleUndo: 'applies-stale-undo' } as const;

export const MINUTE = 60_000;
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** A request ID: 26 characters of [0-9A-Z], as the app's request IDs are (README, The surface: `request`). */
export const requestId = (): string => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (const byte of randomBytes(26)) out += alphabet[byte % 32]!;
  return out;
};
/** A short random tag that makes a note's words or a question unique to one test. */
export const tag = (): string => randomBytes(4).toString('hex');

// ---- Temp folders, short, under /tmp/dh1577-* (a socket path must fit in 104 bytes), removed at cleanup.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1577-'));
  made.push(dir);
  return dir;
}
/** Stops every hub this suite started, by PID (#16's cleanup), and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const w of worlds.splice(0)) for (const c of [w.app, w.cli]) c.close();
  await cleanup16();
  // A git the hub started for a session's workspace may still be writing there for a moment after the hub stops.
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

// ---- A paired device: an Ed25519 key, its public half as the raw 32 bytes in base64url (#34's device.pair).
export interface Device { name: string; key: KeyObject; publicKey: string; id?: string }
export function newDevice(name: string): Device {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { name, key: privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x) };
}

// ---- The design's signature (Socket roles and contract versions: `signature: {signed: {device, method, hub, at,
// once, params}, sig}`), over every param but `signature`, `request` included (README, The surface).
export const newOnce = (): string => randomBytes(18).toString('base64url');
export const paramsHash = (params: Line): string => {
  const { signature: _left, ...rest } = params;
  return sha256(canonicalize(rest as JsonValue));
};
/** The call's params with `signature` added, signed by `device` for `method` on the hub `hub` at `at`. */
export function signed(method: string, params: Line, device: Device, s: { hub: string; at: number }): Line {
  if (!device.id) throw Error('BLOCKED: setup: the device was never paired, so it has no ID to sign as');
  const body = { device: device.id, method, hub: s.hub, at: s.at, once: newOnce(), params: paramsHash(params) };
  const sig = edSign(null, canonicalize(body as JsonValue), device.key).toString('base64url');
  return { ...params, signature: { signed: body, sig } };
}

// ---- Asks put in the record before the hub starts, through the real asks core (as #34, #65 and #1579 seed them).
export interface SeedAsk { source: 'effect.push' | 'deep_ask.choice'; question: string; waitMs?: number; session?: string }
export interface Seeded { handle: string; question: string; source: string; options: { id: string; label: string; decision?: string }[]; plan_hash: string | null }
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
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you', ...(a.session ? { session: a.session } : {}) }, a.source, ask);
    out.push({ handle, question: a.question, source: a.source, options: ask.options as Seeded['options'], plan_hash: await shownPlanHash(core, handle) });
  }
  await record.close();
  return out;
}

// ---- A world: one hub, its asks, two paired devices, an app and a CLI connection, and the hub's ID.
export interface World {
  home: string; root: string; hub: Hub; env: Record<string, string>; plant?: string;
  confirm: Confirmer; asks: Seeded[]; app: Conn; cli: Conn; hubId: string;
  /** This Mac's DeepBuild app, and a phone: two devices you paired. */
  a: Device; b: Device;
}
const worlds: World[] = [];
/** The asks block setup drafts in <root>/config.json (as #65's worlds write it): how long each kind waits and its default. */
const ASK_SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export interface WorldOptions {
  asks?: SeedAsk[];
  /** Settings for this start only, such as DEEP_HUB_TEST_CRASH; a restart starts without them. */
  once?: Record<string, string>;
  /** Write the first-party guard entries to <root>/rules.json before the hub starts, as an install does. */
  rules?: boolean;
}
/**
 * Seeds the asks, starts the hub with the OS stand-in (#34's DEEP_HUB_TEST_CONFIRM) and a clock tests may step
 * (DEEP_HUB_TEST_CLOCK_STEPS=1), and pairs both devices with the OS confirming you. DEEP_HUB_PLANT set by hand
 * reaches every hub, to try a wrong program (README, Wrong programs).
 */
export async function world(o: WorldOptions = {}): Promise<World> {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const root = join(home, '.deepbuild');
  const asks = await seed(root, o.asks ?? []);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASK_SETTINGS }, null, 2)}\n`);
  if (o.rules) copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
  const confirm = new Confirmer();
  const env = { DEEP_HUB_TEST_CONFIRM: confirm.path, DEEP_HUB_TEST_CLOCK_STEPS: '1', TZ: 'UTC' };
  const plant = process.env.DEEP_HUB_PLANT || undefined;
  const hub = await startHub({ home, env: { ...env, ...o.once }, ...(plant ? { plant } : {}) }, 120_000);
  const app = await openAs(hub.socket, 'app', tokenOf(hub.root));
  const cli = await openAs(hub.socket, 'cli', tokenOf(hub.root));
  const hubId = app.hello?.hub;
  if (typeof hubId !== 'string' || !hubId) throw Error(`BLOCKED: setup: the hub's hello names no hub ID: ${JSON.stringify(app.hello)}`);
  const w: World = { home, root, hub, env, ...(plant ? { plant } : {}), confirm, asks, app, cli, hubId, a: newDevice("this Mac's DeepBuild app"), b: newDevice('your phone') };
  worlds.push(w);
  for (const device of [w.a, w.b]) await pairDevice(w, device);
  return w;
}
/** device.pair with the OS stand-in confirming you; the device's ID. */
async function pairDevice(w: World, device: Device): Promise<string> {
  w.confirm.say(true);
  const reply = await w.app.call('device.pair', { name: device.name, public_key: device.publicKey }, 20_000);
  w.confirm.say(false);
  const id = reply.result?.device;
  if (typeof id !== 'string') throw Error(`BLOCKED: setup: device.pair didn't pair ${device.name} with the OS confirming you: ${JSON.stringify(reply)}`);
  device.id = id;
  return id;
}
/** The hub killed with SIGKILL by its PID, as a crash kills it: no clean stop, nothing flushed after. */
export async function kill(w: World): Promise<void> {
  w.app.close(); w.cli.close();
  await stopHub(w.hub, 'SIGKILL');
}
/** The hub started again on the same home and settings, without the start-only ones; the connections are new. */
export async function restart(w: World): Promise<void> {
  w.app.close(); w.cli.close();
  await stopHub(w.hub, 'SIGKILL');
  w.hub = await startHub({ home: w.home, env: w.env, ...(w.plant ? { plant: w.plant } : {}) }, 120_000);
  w.app = await openAs(w.hub.socket, 'app', tokenOf(w.hub.root));
  w.cli = await openAs(w.hub.socket, 'cli', tokenOf(w.hub.root));
  if (w.app.hello?.hub !== w.hubId) throw Error(`BLOCKED: setup: the hub's ID changed across its restart: ${String(w.app.hello?.hub)} after ${w.hubId}`);
}

// ---- The hub's clock (test.clock, served under DEEP_HUB_TEST_CLOCK_STEPS=1 to the CLI).
export async function hubNow(w: World): Promise<number> {
  const now = result(await w.cli.call('test.clock', { advance_ms: 0 })).now;
  if (typeof now !== 'number') throw Error(`BLOCKED: setup: test.clock gave no time: ${String(now)}`);
  return now;
}
/** Steps the hub's clock past an ask's wait until it takes its default (the asks core ticks each second). */
export async function defaulted(w: World, ask: string, stepMs: number): Promise<void> {
  result(await w.cli.call('test.clock', { advance_ms: stepMs }));
  await waitFor(async () => (await inboxRow(w, ask))?.outcome === 'defaulted', 30_000, `${ask} to take its default after the hub's clock stepped ${stepMs} ms`);
}

// ---- Calls as a device makes them, the record and the inbox.
/** A call's params signed by `device` for `method`, now by the hub's clock. */
export async function signedBy(w: World, device: Device, method: string, params: Line): Promise<Line> {
  return signed(method, params, device, { hub: w.hubId, at: await hubNow(w) });
}
/** One call on a new app connection, as a device that reconnected sends it; the connection closes once it replies. */
export async function sendOnce(w: World, method: string, params: Line): Promise<Line> {
  const conn = await openAs(w.hub.socket, 'app', tokenOf(w.hub.root));
  try {
    return await conn.call(method, params, 60_000);
  } finally {
    conn.close();
  }
}
export async function inboxRow(w: World, ask: string): Promise<Line | undefined> {
  return (result(await w.cli.call('inbox.read', {}, 30_000)).asks as Line[]).find((r) => r.ask === ask);
}
/** Every event in the log, paged by log_pos through events.read. */
export async function allEvents(w: World, after = 0): Promise<Line[]> {
  const out: Line[] = [];
  for (let from = after; ;) {
    const page = result(await w.cli.call('events.read', { after: from, limit: 1000 }, 30_000)).events as Line[];
    if (!page.length) return out;
    out.push(...page);
    from = page[page.length - 1]!.log_pos as number;
  }
}
export async function eventsOf(w: World, kind: string, subject?: string): Promise<Line[]> {
  return (await allEvents(w)).filter((e) => e.kind === kind && (subject === undefined || e.subject === subject));
}
/** The log's end: the last event's log_pos. */
export async function logEnd(w: World): Promise<number> {
  const events = await allEvents(w);
  return events.length ? Number(events[events.length - 1]!.log_pos) : 0;
}
export const said = (evs: readonly Line[]): string => evs.map((e) => `${String(e.kind)}@${String(e.log_pos)} ${JSON.stringify(e.data).slice(0, 240)}`).join('; ') || 'none';
export async function waitFor<T>(probe: () => Promise<T | undefined | false | null>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- An agent's session, as its deep-hook reaches the hub: hook lines sent from this process.
/** A Claude Code session in a fresh folder that has started and taken its first prompt, so it is live on the hub. */
export async function liveSession(w: World): Promise<Session> {
  const s = newSession(w.home, 'claude-code', join(tempDir(), 'work'));
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const r = await hook(w, s, event);
    if (r.end !== 'reply') throw Error(`BLOCKED: setup: the hub didn't answer ${event} for ${s.id}: ${JSON.stringify(r.lines).slice(0, 600)}`);
  }
  return s;
}
/** One hook line of the session's agent, on a new connection, as deep-hook sends it; resolves with what came back. */
export function hook(w: World, s: Session, event: string, extra: Line = {}): Promise<HookResult> {
  return sendHook(w.hub.socket, fromHere(hookRequest(s, event, extra)), 30_000);
}
/** What a hook's reply carried to the agent: every line the hub sent back, as text. */
export const carried = (r: HookResult): string => r.lines.map((l) => JSON.stringify(l)).join('\n');
/** The note as the app sends it: `session.note {session, text, request}` on an app connection. */
export const note = (w: World, s: Session, text: string, request: string): Promise<Line> => sendOnce(w, 'session.note', { session: s.id, text, request });

/** A file the test writes, so a staged folder holds something to put back. */
export function folderWithFile(name: string): { dir: string; file: string } {
  const dir = join(tempDir(), name);
  mkdirSync(dir);
  const file = join(dir, 'kept.txt');
  writeFileSync(file, `kept ${tag()}\n`);
  return { dir, file };
}
