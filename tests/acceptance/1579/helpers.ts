// Test-side tools for the #1579 acceptance tests (README). A real hub (`deep hub run`) in a temp home under
// /tmp/dh1579-*, asks raised through the real asks core on its ledger before it starts, the OS confirmation's
// stand-in and the old-format signer from #34's helpers (tests/acceptance/34/helpers.ts), the hub as a process and
// the socket client from #16's. What is new is the signer of the design's format: `signature: {signed: {device,
// method, hub, at, once, params}, sig}`, built here from the design's words alone (Socket roles and contract
// versions, The trusted path is a device you paired). Every process is stopped by PID; the real ~/.deepbuild is
// never touched.
import { generateKeyPairSync, createHash, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import { cleanup as cleanup16, openAs, result, startHub, stopHub, tokenOf, type Conn, type Hub, type Line } from '../16/helpers.ts';
import { Confirmer, signed as oldSigned } from '../34/helpers.ts';

export { result, type Conn, type Hub, type Line };

/** Each criterion's tag: `#1579.` and the first 8 hex of SHA-256 of its checkbox text, trimmed, whitespace collapsed. */
export const AC = {
  1: 'AC1 #1579.cbb8b7e5',
  2: 'AC2 #1579.f338a953',
  3: 'AC3 #1579.68360e4a',
  4: 'AC4 #1579.1d716d86',
  5: 'AC5 #1579.78fa4f3f',
} as const;

export const MINUTE = 60_000;
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---- Temp folders, short, under /tmp/dh1579-* (a socket path must fit in 104 bytes), removed at cleanup.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1579-'));
  made.push(dir);
  return dir;
}
/** Stops every hub this suite started, by PID (#16's cleanup), and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const w of worlds.splice(0)) for (const c of [w.app, w.cli]) c.close();
  await cleanup16();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- A paired device: an Ed25519 key, its public half as the raw 32 bytes in base64url (#34's device.pair).
export interface Device { name: string; key: KeyObject; publicKey: string; id?: string }
export function newDevice(name: string): Device {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { name, key: privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x) };
}

// ---- The design's format (Socket roles and contract versions: "Its shape is `signature: {signed: {device, method,
// hub, at, once, params}, sig}`").
export interface Signing { hub: string; at: number; once?: string; method?: string }
/** A once-only ID: 16 to 128 base64url characters the device never uses again (here 24, from 18 random bytes). */
export const newOnce = (): string => randomBytes(18).toString('base64url');
/** `params`: the lower-case hex SHA-256 of the RFC 8785 bytes of the call's params with `signature` left out. */
export const paramsHash = (params: Line): string => {
  const { signature: _left, ...rest } = params;
  return sha256(canonicalize(rest as JsonValue));
};
/**
 * The call's params with `signature` added: `signed` names the device, the method called, the hub's ID (its hello's
 * `hub`), `at` in ms since the epoch, a fresh `once` and the params' hash; `sig` is the device's Ed25519 signature
 * over the RFC 8785 bytes of `signed`, in base64url. `device` stays inside `signed`; the call carries no top-level
 * `device` of the signer's.
 */
export function signNew(method: string, params: Line, device: Device, s: Signing): Line {
  if (!device.id) throw Error('BLOCKED: setup: the device was never paired, so it has no ID to sign as');
  const signed = { device: device.id, method: s.method ?? method, hub: s.hub, at: s.at, once: s.once ?? newOnce(), params: paramsHash(params) };
  const sig = edSign(null, canonicalize(signed as JsonValue), device.key).toString('base64url');
  return { ...params, signature: { signed, sig } };
}
/** The merge base's format (#34): `device` in the params, `signature` a string over the RFC 8785 bytes of the rest. */
export const signOld = (params: Line, device: Device): Line => oldSigned(params, device as Parameters<typeof oldSigned>[1]);

// ---- Asks put in the record before the hub starts, through the real asks core (as #34 and #65 seed them).
export interface SeedAsk { source: 'effect.push' | 'deep_ask.taste'; question: string; waitMs?: number }
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
      ...fixture, question: a.question, key: sha256(`#1579 ${a.question}`), deadline: now() + (a.waitMs ?? 86_400_000),
      pinned_to: { ...(fixture.pinned_to as Line), ref: (fixture.pinned_to as Line).kind === 'commit' ? sha256(a.question).slice(0, 40) : sha256(a.question) },
    };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, a.source, ask);
    out.push({ handle, question: a.question, source: a.source, options: ask.options as Seeded['options'], plan_hash: await shownPlanHash(core, handle) });
  }
  await record.close();
  return out;
}

// ---- A world: one hub, its asks, the app's paired device, an app and a CLI connection, and the hub's ID.
export interface World {
  home: string; root: string; hub: Hub; env: Record<string, string>; plant?: string;
  confirm: Confirmer; asks: Seeded[]; app: Conn; cli: Conn; hubId: string; device: Device;
}
const worlds: World[] = [];
export interface WorldOptions { asks: SeedAsk[]; plant?: string }
/**
 * Seeds the asks, starts the hub with the OS stand-in (#34's DEEP_HUB_TEST_CONFIRM) and a clock tests may step
 * (DEEP_HUB_TEST_CLOCK_STEPS=1, #965's test.clock), and pairs the app's device with the OS confirming you.
 */
export async function world(o: WorldOptions): Promise<World> {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const root = join(home, '.deepbuild');
  const asks = await seed(root, o.asks);
  const confirm = new Confirmer();
  const env = { DEEP_HUB_TEST_CONFIRM: confirm.path, DEEP_HUB_TEST_CLOCK_STEPS: '1', TZ: 'UTC' };
  const hub = await startHub({ home, env, ...(o.plant ? { plant: o.plant } : {}) }, 120_000);
  const app = await openAs(hub.socket, 'app', tokenOf(hub.root));
  const cli = await openAs(hub.socket, 'cli', tokenOf(hub.root));
  const hubId = app.hello?.hub;
  if (typeof hubId !== 'string' || !hubId) throw Error(`BLOCKED: setup: the hub's hello names no hub ID: ${JSON.stringify(app.hello)}`);
  const w: World = { home, root, hub, env, ...(o.plant ? { plant: o.plant } : {}), confirm, asks, app, cli, hubId, device: newDevice("this Mac's DeepBuild app") };
  worlds.push(w);
  w.device.id = await pairDevice(w, w.device);
  return w;
}
/** device.pair with the OS stand-in confirming you; the device's ID. */
export async function pairDevice(w: World, device: Device): Promise<string> {
  w.confirm.say(true);
  const reply = await w.app.call('device.pair', { name: device.name, public_key: device.publicKey }, 20_000);
  w.confirm.say(false);
  const id = reply.result?.device;
  if (typeof id !== 'string') throw Error(`BLOCKED: setup: device.pair didn't pair ${device.name} with the OS confirming you: ${JSON.stringify(reply)}`);
  device.id = id;
  return id;
}
/** The hub stopped by its PID and started again on the same home and settings; the connections are new. */
export async function restart(w: World): Promise<void> {
  w.app.close(); w.cli.close();
  await stopHub(w.hub);
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
export async function step(w: World, ms: number): Promise<number> {
  return Number(result(await w.cli.call('test.clock', { advance_ms: ms })).now);
}
/** What a device signs with on this hub, now by the hub's clock, `ageMs` ago. */
export async function signing(w: World, ageMs = 0): Promise<Signing> {
  return { hub: w.hubId, at: (await hubNow(w)) - ageMs };
}

// ---- Calls, the record and the inbox.
/** A call on the app's connection, as the DeepBuild app makes it. */
export const asApp = (w: World, method: string, params: Line): Promise<Line> => w.app.call(method, params, 30_000);
export async function inboxRow(w: World, ask: string): Promise<Line | undefined> {
  return (result(await w.cli.call('inbox.read', {}, 30_000)).asks as Line[]).find((r) => r.ask === ask);
}
export async function eventsOf(w: World, kind: string, subject?: string): Promise<Line[]> {
  const out: Line[] = [];
  for (let after = 0; ;) {
    const page = result(await w.cli.call('events.read', { after, limit: 1000 }, 30_000)).events as Line[];
    if (!page.length) return out;
    out.push(...page.filter((e) => e.kind === kind && (subject === undefined || e.subject === subject)));
    after = page[page.length - 1]!.log_pos as number;
  }
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false | null>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`BLOCKED: setup: timed out after ${ms} ms waiting for ${what}`);
    await sleep(200);
  }
}
/** Steps the hub's clock past an ask's wait until it takes its default (the asks core ticks each second). */
export async function defaulted(w: World, ask: string, stepMs: number): Promise<void> {
  if ((await inboxRow(w, ask))?.outcome === 'defaulted') return;
  await step(w, stepMs);
  await waitFor(async () => (await inboxRow(w, ask))?.outcome === 'defaulted', 30_000, `${ask} to take its default after the hub's clock stepped ${stepMs} ms`);
}

// ---- Judges: each returns what is wrong, or null; the tests expect null.
/** A judge's verdict holds: null, or the test fails with the judge's whole message. */
export function holds(failure: string | null): void {
  expect(failure, failure ?? '').toBeNull();
}
/** The JSON pointer a refusal names the field by: `/params/signature/signed/<field>` (README, Surfaces). */
export const fieldPointer = (field: string): string => `/params/signature/signed/${field}`;
/** A refusal naming `field`: an error whose `path` is that field's pointer. */
export function refusedNaming(reply: Line, field: string, what: string): string | null {
  if (!('error' in reply)) return `${what} was taken: the hub replied ${JSON.stringify(reply.result).slice(0, 400)}`;
  const path = String(reply.error?.path ?? '');
  if (path !== fieldPointer(field)) return `${what} was refused, but naming ${path || 'no field'}, not ${fieldPointer(field)}: ${JSON.stringify(reply.error).slice(0, 600)}`;
  return null;
}
/** A refusal of the signature at all: an error whose `path` is the signature or a field in it. */
export function refusedSignature(reply: Line, what: string): string | null {
  if (!('error' in reply)) return `${what} was taken: the hub replied ${JSON.stringify(reply.result).slice(0, 400)}`;
  const path = String(reply.error?.path ?? '');
  if (!path.startsWith('/params/signature')) return `${what} passed the signature check: the hub refused it only at ${path || 'no field'}: ${JSON.stringify(reply.error).slice(0, 600)}`;
  return null;
}
/** An answer that counted for nothing: no ask.answered for its ask, which stays open in the inbox. */
export async function answeredNothing(w: World, ask: string): Promise<string | null> {
  const answered = await eventsOf(w, 'ask.answered', ask);
  if (answered.length) return `${ask} was recorded answered (${answered.length} ask.answered: ${JSON.stringify(answered.map((e) => e.data)).slice(0, 300)})`;
  const row = await inboxRow(w, ask);
  if (row?.outcome !== 'unanswered') return `${ask} isn't open in the inbox: ${JSON.stringify(row)}`;
  return null;
}
/** How many times a defaulted ask was opened again (`default.undone`, the asks core's undo). */
export const undoneCount = async (w: World, ask: string): Promise<number> => (await eventsOf(w, 'default.undone', ask)).length;

/** An approval of an authority ask, as the question card sends it: the allow option, the plan's hash, the click's token. */
export function approve(ask: Seeded): Line {
  const allow = ask.options.find((o) => o.decision === 'allow');
  if (!allow) throw Error(`BLOCKED: setup: ${ask.handle} has no option that allows`);
  return { ask: ask.handle, option: allow.id, plan_hash: ask.plan_hash, token: `click-${newOnce()}` };
}
