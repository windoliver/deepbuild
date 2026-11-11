// What the #1580 tests share (README). A real hub (`deep hub run`) in a temp home under /tmp/dh1580-*, its channel
// plug-ins installed with `deep install` (packages/channels, and the planted `watch` in fixtures/), the providers they
// reach as #65's stand-ins on 127.0.0.1, asks raised through the real asks core before the hub starts, a paired phone
// and a paired app device, and the OS confirmation's stand-in (#34). The phone and the app sign in #1579's format:
// `signature: {signed: {device, method, hub, at, once, params}, sig}`. What is new is only what the issue and the design
// name, as README's "Surfaces this suite chose" lists it. Every process is stopped by PID; the real ~/.deepbuild is
// never touched.
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { askSources, openAsks, type PlanInput, type PlanStep } from '../../../packages/asks/src/index.ts';
import { packageDigest } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { cleanup as cleanup16, deep, startHub, stopHub, ulid, type Hub, type Line } from '../16/helpers.ts';
import { Confirmer } from '../34/helpers.ts';
import { cardHash, Provider, type Answer, type Item } from '../65/fixtures/providers.ts';
import { events, ofKind, ok, rpc, said, waitFor, type Ev } from '../65/helpers.ts';
import { hubOf } from '../65/redraft-1579/helpers.ts';
import { newOnce, paramsHash, sigOver } from '../65/redraft-1579/fixtures/phone.ts';

export { events, ofKind, ok, said, waitFor, type Ev, type Item, type Line };
export { inboxRow, openInNeedsYou, sleep, WHERE, YOU } from '../65/helpers.ts';

/** Each criterion's tag: `#1580.` and the first 8 hex of SHA-256 of its checkbox text, trimmed, whitespace collapsed. */
export const AC = {
  1: 'AC1 #1580.c589397a',
  2: 'AC2 #1580.e4bc2c78',
  3: 'AC3 #1580.96c9855a',
  4: 'AC4 #1580.787b444a',
} as const;
export const MINUTE = 60_000;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ---- Temp folders, short, under /tmp/dh1580-* (a socket path must fit in 104 bytes), removed at cleanup.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1580-'));
  made.push(dir);
  return dir;
}

// ---- A paired device: an Ed25519 key, its public half the raw 32 bytes in base64url, and the ID device.pair gave it.
export interface Device { name: string; key: KeyObject; publicKey: string; id: string }
function newDevice(name: string): Device {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { name, key: privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x), id: '' };
}

// ---- Asks in the record before the hub starts, through the real asks core (as #65 and #1579 seed them).
export interface SeedAsk { source: 'effect.push' | 'deep_ask.choice'; question: string; plan?: PlanInput }
export interface Seeded { handle: string; question: string; options: { id: string; label: string; decision: string }[]; plan: { hash: string; steps: PlanStep[] } | null }
async function seed(root: string, asks: readonly SeedAsk[]): Promise<Seeded[]> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = await openAsks({ record, now, deliver: () => undefined });
  const out: Seeded[] = [];
  for (const a of asks) {
    const row = askSources().find((r) => r.source === a.source);
    if (!row) throw Error(`BLOCKED: setup: ask.sources@1 has no row ${a.source}`);
    const fixture = row.fixture.ask as Line;
    const ask: Line = {
      ...fixture, question: a.question, key: sha256(`#1580 ${a.question}`), deadline: now() + 86_400_000,
      pinned_to: { ...(fixture.pinned_to as Line), ref: (fixture.pinned_to as Line).kind === 'commit' ? sha256(a.question).slice(0, 40) : sha256(a.question) },
    };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, a.source, ask, a.plan);
    const card = await core.card(handle);
    out.push({ handle, question: a.question, options: card.options.map((o) => ({ id: o.id, label: o.label, decision: String(o.decision) })), plan: card.plan });
  }
  await record.close();
  return out;
}
/** A plan of one step, as a raiser gives it: what it does, what it changes, its undo and its cost. */
export function planOf(does: string): PlanInput {
  return { steps: [{ does, changes: [does], undo: 'Revert it', public: true, cost: 0 }], diff: sha256(does) };
}

// ---- A world: one hub, its channels and their relays, its asks, the paired phone and app device.
export type ChannelName = 'paseo' | 'chat' | 'watch';
export interface WorldOptions { channels: ChannelName[]; seed: SeedAsk[] }
export interface World {
  home: string; root: string; hub: Hub; env: Record<string, string>; hubId: string;
  asks: Seeded[]; relays: Partial<Record<ChannelName, Provider>>; phone: Device; app: Device; confirmer: Confirmer;
}
const worlds: World[] = [];
const TOKEN = `bot-${newOnce()}`;
/**
 * Seeds the asks, writes channels.json (every kind of ask to every channel of the world), starts the hub with the OS
 * stand-in saying yes, pairs the phone and the app's device, installs each channel and waits for its first call to its
 * provider (the hub calls receive() at least once a second).
 */
export async function world(o: WorldOptions): Promise<World> {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  const root = join(home, '.deepbuild');
  const asks = await seed(root, o.seed);
  const relays: World['relays'] = {};
  const settings: Record<string, Line> = {};
  for (const name of o.channels) {
    const relay = await Provider.start(name === 'chat' ? 'chat' : 'paseo', name === 'chat' ? TOKEN : undefined);
    relays[name] = relay;
    settings[name] = { api: relay.api, ...(name === 'chat' ? { token: TOKEN } : {}) };
  }
  const routes = [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: [...o.channels] }];
  writeFileSync(join(root, 'channels.json'), `${JSON.stringify({ channels: settings, routes, quiet: null }, null, 2)}\n`, { mode: 0o600 });
  const confirmer = new Confirmer();
  confirmer.say(true);
  const env = { DEEP_HUB_TEST_CONFIRM: confirmer.path, TZ: 'UTC' };
  const hub = await startHub({ home, env }, 120_000);
  const w: World = { home, root, hub, env, hubId: '', asks, relays, phone: newDevice('Test phone'), app: newDevice("this Mac's DeepBuild app"), confirmer };
  worlds.push(w);
  w.hubId = await hubOf(w);
  for (const device of [w.phone, w.app]) device.id = String((await ok(w, 'device.pair', { name: device.name, public_key: device.publicKey })).device);
  for (const name of o.channels) await install(w, name === 'watch' ? watchPackage() : join(REPO, 'packages/channels', name));
  for (const name of o.channels) await waitFor(() => relays[name]!.calls.length > 0, MINUTE, `the ${name} channel's first call to its provider once installed`);
  return w;
}
/** `deep install <folder>`, as you run it; the package must install and load. */
async function install(w: World, folder: string): Promise<void> {
  const r = await deep(w.home, ['install', folder], { timeoutMs: 300_000 });
  if (r.code !== 0) throw Error(`BLOCKED: setup: deep install ${folder} exited ${r.code}: ${r.stdout.slice(-1500)} ${r.stderr.slice(-1500)}`);
}
/** The planted `watch` channel (fixtures/watch), installable: its index.ts.fixture renamed, its digest set. */
function watchPackage(): string {
  const dir = join(tempDir(), 'watch');
  cpSync(join(FIXTURES, 'watch'), dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  const file = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Line;
  manifest.digest = packageDigest(dir);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/**
 * The hub stopped by its PID, `between` run on its root while it is down, and the hub started again on the same home
 * and settings. Returns when it is ready; its ID is the same.
 */
export async function restart(w: World, between: (root: string) => Promise<void>): Promise<void> {
  await stopHub(w.hub);
  await between(w.root);
  w.hub = await startHub({ home: w.home, env: w.env }, 120_000);
  const id = await hubOf(w);
  if (id !== w.hubId) throw Error(`BLOCKED: setup: the hub's ID changed across its restart: ${id} after ${w.hubId}`);
}
/**
 * The core proposes another plan for an open ask (README, Surfaces: how a plan changes): a `plan.proposed` written by
 * the core, as the asks core writes one when an authority ask is raised, appended to the hub's record while it is
 * stopped. Returns the new plan with its hash, the SHA-256 of the RFC 8785 bytes of `{steps, diff}`.
 */
export async function proposeAgain(root: string, ask: string, plan: PlanInput): Promise<{ hash: string; steps: PlanStep[] }> {
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => Date.now() });
  const hash = sha256(canonicalize({ steps: plan.steps, diff: plan.diff } as unknown as JsonValue));
  await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ulid(), kind: 'plan.proposed', ts: Date.now(), data: { ask, steps: plan.steps, diff: plan.diff, hash } as unknown as JsonValue });
  await record.close();
  return { hash, steps: plan.steps };
}
export async function cleanup(): Promise<void> {
  for (const w of worlds.splice(0)) for (const relay of Object.values(w.relays)) await relay.stop().catch(() => undefined);
  await cleanup16();
  for (const dir of made.splice(0)) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ---- What a card carries (README, Surfaces: the plan on the card).
/** The plan an item carries, `{hash, steps}`, or undefined when it carries none. */
export function planOn(item: Item | undefined): { hash: string; steps: unknown[] } | undefined {
  const plan = item?.plan as { hash?: unknown; steps?: unknown } | undefined;
  return plan && typeof plan.hash === 'string' && Array.isArray(plan.steps) ? { hash: plan.hash, steps: plan.steps } : undefined;
}
export const describeItem = (item: Item | undefined): string => (item
  ? `revision ${item.revision}, ${item.answerable}, ${item.options.length} buttons, plan ${planOn(item)?.hash ?? 'none'}, "${item.summary.slice(0, 200)}"`
  : 'no card');

// ---- Signatures, in #1579's format, by a paired device for this hub.
function signature(device: Device, hub: string, method: string, params: Record<string, unknown>): { signed: Line; sig: string } {
  if (!device.id) throw Error(`BLOCKED: setup: ${device.name} was never paired`);
  const signed = { device: device.id, method, hub, at: Date.now(), once: newOnce(), params: paramsHash(params) };
  return { signed, sig: sigOver(signed, device.key) };
}
/**
 * The phone's answer to a card as it shows it (README, Surfaces: the signed fields): signed for `channel.answer` over
 * `{ask, revision, card_hash, answer}`, with `plan_hash` added when the card carries a plan, the params carried beside
 * `signed`. Made now; the test gives it to the relay when the case says.
 */
export function signedAnswer(device: Device, hub: string, shown: Item, option: string): Answer {
  const plan = planOn(shown);
  const params = { ask: shown.thread_key, revision: shown.revision, card_hash: cardHash(shown), ...(plan ? { plan_hash: plan.hash } : {}), answer: option };
  const sig = { ...signature(device, hub, 'channel.answer', params), params };
  return { thread_key: shown.thread_key, answer: option, signature: sig as unknown as NonNullable<Answer['signature']> };
}
/** A call on the hub's socket on an app connection, signed by `device` for `method` (#1579's format). */
export function signedCall(w: World, device: Device, method: string, params: Record<string, unknown>): Promise<Line> {
  return rpc(w, method, { ...params, signature: signature(device, w.hubId, method, params) as unknown as Line }, 'app');
}

// ---- What the hub did with a channel's answer.
/** The hub's first word on a thread after `since` (a log position): a refusal of a channel's answer, or the ask answered. */
export async function outcomeOf(w: World, ask: string, since: number, what: string): Promise<Ev> {
  return waitFor(async () => (await events(w)).find((e) => e.log_pos > since && e.subject === ask && (e.kind === 'channel.refused' || e.kind === 'ask.answered')), MINUTE, what);
}
export const lastPos = async (w: World): Promise<number> => (await events(w)).at(-1)?.log_pos ?? 0;
export const answeredOf = (w: World, ask: string): Promise<Ev[]> => ofKind(w, 'ask.answered', ask);
