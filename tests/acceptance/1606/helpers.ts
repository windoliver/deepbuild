// Test-side tools for the #1606 acceptance tests (README). A real hub (`deep hub run`) in a temp home under /tmp, the
// OS secret store stood in for by DEEP_HUB_TEST_SECRETS (a file beside the home, never in it), the OS prompt by #34's
// stand-in, the chat channel installed with `deep install` as #65's tests install it, its provider as #65's stand-in,
// deep-hook run as an agent's hook entry runs it (#1503's payloads), the merge base's deep-hook built from the pinned
// commit, the real app built with its stand-ins, and the judges each criterion's failure message comes from.
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// no test touches the real ~/.deepbuild, ~/.claude, ~/Library/LaunchAgents or your login Keychain. A hub always gets
// DEEP_HUB_TEST_SECRETS, and an app is only ever started from a build with its store's stand-in, or from the merge
// base's own code, which keeps its key in a file and reaches no Keychain (`appWith`).
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import {
  buildDeepHook, cleanup as cleanup16, childEnv, deep, makeHome, NODE, openAs, own, REPO, run, sleep, startHub, stopHub, tokenOf, ulid,
  type Conn, type Hub, type Line, type Ran,
} from '../16/helpers.ts';
import { Confirmer } from '../34/helpers.ts';
import { approve, newDevice, signNew, type Device, type Seeded } from '../1579/helpers.ts';
import { forms } from '../364/judges.ts';
import { Provider } from '../65/fixtures/providers.ts';

export { approve, newDevice, signNew, sleep, type Device, type Hub, type Line, type Ran, type Seeded };

/** Each criterion's tag: `#1606.` and the first 8 hex of SHA-256 of its checkbox text, trimmed, whitespace collapsed. */
export const AC = {
  1: 'AC1 #1606.0f8635c4',
  2: 'AC2 #1606.692cab52',
  3: 'AC3 #1606.8cb3635c',
  4: 'AC4 #1606.701685ed',
  5: 'AC5 #1606.1b905924',
  6: 'AC6 #1606.632a863e',
  7: 'AC7 #1606.fca4f55a',
  8: 'AC8 #1606.bf38dab5',
  9: 'AC9 #1606.21a4b991',
} as const;

/**
 * The merge base these tests were written on, pinned: main before any #1606 code. Pinned rather than computed, so the
 * wrong program stays the pre-fix deep-hook after #1606 merges and main moves past it.
 */
export const BASE = '1c4d1f0e2aaad8c6a6573848823566d04ff73d17';
const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MINUTE = 60_000;

/** A bot token, made fresh for each run: what the chat provider takes, and what must never leave the store. */
export const TOKEN = `bot-1606-${randomBytes(16).toString('hex')}`;
/** The chat channel's token by handle in channels.json after the move, and its key in the OS secret store (README). */
export const HANDLE = 'secret:channels/chat';
export const STORE_KEY = 'deepbuild/channels/chat';
/** The name the app pairs as (crates/deep-app/src/device.rs at the base). */
const APP_NAME = 'DeepBuild on this Mac';

async function waitFor<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(250);
  }
}
/** The first value `probe` gives within `ms`, or undefined: for steps a wrong program never takes. */
export const within = <T>(ms: number, probe: () => Promise<T | undefined | false | null> | T | undefined | false | null): Promise<T | undefined> =>
  waitFor(probe, ms, '').catch(() => undefined);
const readJson = (file: string): Line | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as Line; } catch { return undefined; } };

// ---- Cleanup: connections and providers this file opened, then every process #16's helpers own, by PID, and the folders.
const conns: Conn[] = [];
const providers: Provider[] = [];
export async function cleanup(): Promise<void> {
  for (const c of conns.splice(0)) c.close();
  for (const p of providers.splice(0)) await p.stop().catch(() => undefined);
  await cleanup16();
}

// ---- A hub on a temp home: the store's stand-in beside the home, the OS prompt's stand-in saying yes, asks seeded first.
interface SeedAsk { source: 'effect.push' | 'deep_ask.choice'; question: string }
export interface World { home: string; root: string; store: string; hub: Hub; asks: Seeded[] }
interface WorldOptions {
  asks?: SeedAsk[];
  plant?: string;
  /** Files written under the hub's root before it starts. */
  files?: (root: string) => void;
}
/**
 * Seeds the asks through the real asks core, writes `files`, and starts `deep hub run` with DEEP_HUB_TEST_SECRETS (the
 * OS secret store's stand-in, base's agents.ts) and DEEP_HUB_TEST_CONFIRM (#34's OS prompt, saying yes).
 */
export async function hubWorld(o: WorldOptions = {}): Promise<World> {
  await buildDeepHook();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const store = join(dirname(home), 'hub-secrets.json');
  o.files?.(root);
  const asks = await seed(root, o.asks ?? []);
  const confirm = new Confirmer();
  confirm.say(true);
  // No TZ of its own: the peer check compares a deep command's start time as `ps` prints it in each process's zone.
  const hub = await startHub({ home, ...(o.plant ? { plant: o.plant } : {}), env: { DEEP_HUB_TEST_SECRETS: store, DEEP_HUB_TEST_CONFIRM: confirm.path } }, 120_000);
  return { home, root, store, hub, asks };
}
async function seed(root: string, asks: readonly SeedAsk[]): Promise<Seeded[]> {
  if (!asks.length) return [];
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = withPlans(await openAsks({ record, now, deliver: () => undefined }));
  const out: Seeded[] = [];
  for (const a of asks) {
    const row = askSources().find((r) => r.source === a.source);
    if (!row) throw Error(`BLOCKED: setup: ask.sources@1 has no row ${a.source}`);
    const fixture = row.fixture.ask as Line;
    const ask: Line = {
      ...fixture, question: a.question, key: sha256(`#1606 ${a.question}`), deadline: now() + 86_400_000,
      pinned_to: { ...(fixture.pinned_to as Line), ref: (fixture.pinned_to as Line).kind === 'commit' ? sha256(a.question).slice(0, 40) : sha256(a.question) },
    };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, a.source, ask);
    out.push({ handle, question: a.question, source: a.source, options: ask.options as Seeded['options'], plan_hash: await shownPlanHash(core, handle) });
  }
  await record.close();
  return out;
}
const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

/** A connection with the control token, as `deep` (cli) or the app (app) holds one. */
export async function connect(w: World, role: 'cli' | 'app' = 'cli'): Promise<Conn> {
  const conn = await openAs(w.hub.socket, role, tokenOf(w.root));
  conns.push(conn);
  return conn;
}
export async function eventsOf(conn: Conn): Promise<Line[]> {
  const out: Line[] = [];
  for (let after = 0; ;) {
    const page = (await conn.call('events.read', { after, limit: 1000 }, 30_000)).result?.events as Line[] | undefined;
    if (!page) throw Error('BLOCKED: events.read gave no events');
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos as number;
  }
}
/** An ask that counted for nothing: no ask.answered for it, and its inbox row still open. */
export async function answeredNothing(conn: Conn, ask: string): Promise<string[]> {
  const answered = (await eventsOf(conn)).filter((e) => e.kind === 'ask.answered' && e.subject === ask);
  if (answered.length) return [`${ask} was recorded answered (${answered.length} ask.answered: ${JSON.stringify(answered.map((e) => e.data)).slice(0, 300)})`];
  const row = ((await conn.call('inbox.read', {}, 30_000)).result?.asks as Line[] | undefined)?.find((r) => r.ask === ask);
  return row?.outcome === 'unanswered' && row.status !== 'closed' ? [] : [`${ask} isn't open in the inbox: ${JSON.stringify(row)}`];
}
/** device.pair with the OS stand-in saying yes: the paired device's ID. */
export async function pair(w: World, device: Device): Promise<string> {
  const conn = await connect(w);
  const reply = await conn.call('device.pair', { name: device.name, public_key: device.publicKey }, 20_000);
  const id = reply.result?.device;
  if (typeof id !== 'string') throw Error(`BLOCKED: setup: device.pair didn't pair ${device.name}: ${JSON.stringify(reply)}`);
  device.id = id;
  return id;
}

// ---- The channel world (AC2, AC3, AC4): channels.json with the chat channel's token, its provider, the plug-in installed.
export interface ChannelWorld extends World { provider: Provider; file: string }
/**
 * #65's chat provider on 127.0.0.1 (it answers 401 to a call without `authorization: Bearer <TOKEN>`), channels.json
 * naming it with TOKEN in plain text at `mode`, every kind of ask routed to it, then the hub and `deep install` of
 * packages/channels/chat. `send` seeds one choice ask, which goes to chat once the channel loads.
 */
export async function channelWorld(o: { mode?: number; plant?: string; send?: boolean } = {}): Promise<ChannelWorld> {
  const provider = await Provider.start('chat', TOKEN);
  providers.push(provider);
  let file = '';
  const w = await hubWorld({
    ...(o.plant ? { plant: o.plant } : {}),
    ...(o.send ? { asks: [{ source: 'deep_ask.choice', question: 'Which name for the export button?' }] } : {}),
    files: (root) => {
      file = join(root, 'channels.json');
      const routes = [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: ['chat'] }];
      writeFileSync(file, `${JSON.stringify({ channels: { chat: { api: provider.api, token: TOKEN } }, routes, quiet: null }, null, 2)}\n`);
      chmodSync(file, o.mode ?? 0o600);
    },
  });
  const r = await deep(w.home, ['install', join(REPO, 'packages/channels/chat')], { timeoutMs: 300_000 });
  if (r.code !== 0) throw Error(`BLOCKED: setup: deep install packages/channels/chat exited ${r.code}: ${r.stdout.slice(-1500)} ${r.stderr.slice(-1500)}`);
  return { ...w, provider, file };
}
/** The calls the chat provider answered 200: each carried `authorization: Bearer <TOKEN>`, or it would have been 401. */
export const carried = (w: ChannelWorld, after = 0) => w.provider.calls.filter((c) => c.at > after && c.status === 200);
export const statuses = (w: ChannelWorld): string => w.provider.calls.map((c) => `${c.method} ${c.path} ${c.status}`).slice(-8).join(', ') || 'none';
export const octal = (mode: number): string => `0${mode.toString(8)}`;

// ---- Scans: every form the Privacy scrub covers (#364's `forms`), in files, logs, the record and an environment.
/** The names of the forms of `secret` that `text` holds. */
export const formsIn = (text: string, secret: string): string[] => forms(secret).filter((f) => f.find(text)).map((f) => f.name);
/** Every regular file under `dir`, recursively, with its bytes; a socket or a link is no file here. */
function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = [];
  const walk = (d: string): void => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const name of names) {
      const path = join(d, name);
      let st;
      try { st = lstatSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) try { out.push({ path, bytes: readFileSync(path) }); } catch { /* gone */ }
    }
  };
  walk(dir);
  return out;
}
/** Each file under `dir` holding a form of `secret`, read as UTF-8 and as UTF-16LE: one line per file and form. */
export function filesHolding(dir: string, secret: string): string[] {
  return filesUnder(dir).flatMap(({ path, bytes }) =>
    [...new Set([...formsIn(bytes.toString('utf8'), secret), ...formsIn(bytes.toString('utf16le'), secret)])].map((form) => `${path} holds the token (${form})`));
}
/**
 * An agent's environment, as DeepBuild can set one in this home: a shell started as Claude Code starts a session's
 * commands, with what `~/.claude/settings.json` puts in its `env` applied, printing `env` (README, Readings).
 */
export async function agentEnvironment(home: string): Promise<string> {
  const set = readJson(join(home, '.claude', 'settings.json'))?.env;
  const extra: Record<string, string> = {};
  if (set && typeof set === 'object') for (const [k, v] of Object.entries(set as Line)) if (typeof v === 'string') extra[k] = v;
  const r = await run('/bin/sh', ['-c', 'env'], { env: childEnv(home, extra), cwd: home });
  return r.stdout;
}

// ---- Keys on disk (AC5, AC6): any 32-byte Ed25519 seed a file holds in text, whose public key we know.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyOfSeed = (seed: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
/** The raw public key of a seed, base64url, as device.pair takes it. */
const publicOf = (seed: Buffer): string => String(createPublicKey(keyOfSeed(seed)).export({ format: 'jwk' }).x);
/** A device's 32-byte seed, as the base app keeps it in device.json: base64url, no padding. */
const seedOf = (device: Device): Buffer => Buffer.from(String(device.key.export({ format: 'jwk' }).d), 'base64url');
/**
 * Every value a file's text holds that could be an Ed25519 private key: a 32-byte seed, a 64-byte seed-and-public-key or
 * a PKCS #8 key, in base64, base64url or hex.
 */
function seedsIn(bytes: Buffer): Buffer[] {
  const text = bytes.toString('latin1');
  const values: Buffer[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{40,}={0,2}/g)) values.push(Buffer.from(m[0].replaceAll('-', '+').replaceAll('_', '/'), 'base64'));
  for (const m of text.matchAll(/[0-9a-fA-F]{64,}/g)) if (m[0].length === 64 || m[0].length === 128) values.push(Buffer.from(m[0], 'hex'));
  const seeds: Buffer[] = [];
  for (const v of values) {
    if (v.length === 32) seeds.push(v);
    else if (v.length === 64) seeds.push(v.subarray(0, 32));
    else if (v.length === 48 && v.subarray(0, 16).equals(PKCS8_ED25519)) seeds.push(v.subarray(16));
  }
  return seeds;
}
/** The devices the hub paired and hasn't unpaired, by their public key: `devices.json` under its root (base: paths.ts). */
export function pairedDevices(root: string): Map<string, string> {
  const all = readJson(join(root, 'devices.json')) as unknown;
  const out = new Map<string, string>();
  for (const d of Array.isArray(all) ? (all as Line[]) : []) if (d.kind === undefined && d.unpaired === undefined) out.set(String(d.public_key), String(d.device));
  return out;
}
/** Each file under `dir` that holds the private key of a device in `publics`: one line naming the path and the device. */
export function keyHolders(dir: string, publics: Map<string, string>): string[] {
  const out: string[] = [];
  for (const { path, bytes } of filesUnder(dir)) {
    for (const s of seedsIn(bytes)) {
      const device = publics.get(publicOf(s));
      if (device) out.push(`${path} holds the private key of ${device}, the app's device`);
    }
  }
  return [...new Set(out)];
}

// ---- AC6: a process running as you, outside the app, with every file under ~/.deepbuild in hand.
interface Attempt { device: string; key: string; reply: Line }
/**
 * Reads every file under the hub's root, and with the control token found there signs an Allow on `ask` for each
 * device ID any file names, with each key pair a file holds (a seed whose public key some file holds too) and with a
 * key of its own, in the design's format (#1579's signer), and sends each as `ask.answer` on a cli connection.
 */
export async function steal(w: World, ask: Seeded): Promise<Attempt[]> {
  const files = filesUnder(w.root);
  const token = readFileSync(join(w.root, 'control.token'), 'utf8').trim();
  // Every 32-byte value the files hold, base64url: where a public key would be.
  const publics = new Set(files.flatMap(({ bytes }) => seedsIn(bytes).map((s) => s.toString('base64url'))));
  const pairs: { seed: Buffer; from: string }[] = [];
  for (const { path, bytes } of files) for (const seed of seedsIn(bytes)) if (publics.has(publicOf(seed))) pairs.push({ seed, from: `the key pair in ${path}` });
  const devices = new Set<string>();
  for (const { bytes } of files) for (const m of bytes.toString('latin1').matchAll(/device:[0-9A-Za-z]{10,}/g)) devices.add(m[0]);
  if (!devices.size) devices.add('device:01JZ0000000000000000000000');
  const conn = await openAs(w.hub.socket, 'cli', token);
  conns.push(conn);
  const hub = String(conn.hello?.hub ?? '');
  const out: Attempt[] = [];
  for (const device of devices) {
    for (const { seed, from } of [...pairs, { seed: randomBytes(32), from: 'a key of its own' }]) {
      const signer: Device = { name: device, key: keyOfSeed(seed), publicKey: publicOf(seed), id: device };
      const reply = await conn.call('ask.answer', signNew('ask.answer', approve(ask), signer, { hub, at: Date.now() }), 30_000);
      out.push({ device, key: from, reply });
    }
  }
  return out;
}
/** What's wrong with the attempts: one counted, or was refused with something other than `credential`; or the ask closed. */
export async function stolenFailures(w: World, ask: Seeded, attempts: Attempt[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of attempts) {
    if (!('error' in a.reply)) out.push(`${ask.handle} was answered by a signed Allow this test process made as ${a.device} with ${a.key}: ${JSON.stringify(a.reply.result).slice(0, 300)}`);
    else if (a.reply.error?.code !== 'credential') out.push(`${ask.handle}: the signed Allow made as ${a.device} with ${a.key} was refused with ${String(a.reply.error?.code)}, not credential: ${JSON.stringify(a.reply.error).slice(0, 400)}`);
  }
  return [...out, ...(await answeredNothing(await connect(w), ask.handle))];
}

// ---- An older app's device (AC6, AC9): a key paired with the hub and kept as the merge base's app keeps it.
/**
 * Pairs a key as the app (`DeepBuild on this Mac`), with the OS stand-in saying yes, and writes it where and as the base's
 * app keeps it: `~/.deepbuild/app/device.json`, `{"device", "seed"}`, the seed base64url, readable only by you.
 */
export async function olderAppKey(w: World): Promise<{ device: Device; seed: Buffer; file: string }> {
  const device = newDevice(APP_NAME);
  await pair(w, device);
  const seed = seedOf(device);
  const file = join(w.root, 'app', 'device.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ device: device.id, seed: seed.toString('base64url') }), { mode: 0o600 });
  return { device, seed, file };
}
/** `deep` commands in this home offer no setup, and the app's window opens on the shell (#1454's fixture). */
export function setupFinished(root: string): void {
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
}

// ---- The real app's builds (README, Surfaces): each copied out of the target folder under its own name, as #1454's are.
/** Cargo features of `deep-app`, none in a shipped build: the OS prompt's and the OS store's stand-ins, and the plant. */
export type AppFeature = 'test-confirm' | 'test-secrets' | 'plant-key-in-file';
const BIN = join(tmpdir(), `da1606-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
async function cargo(args: string[]): Promise<void> {
  const r = await run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, timeoutMs: 1_800_000 });
  if (r.code !== 0) throw Error(`cargo build ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
}
/** The app built with `features`, copied out; the plain build runs after, so target/debug holds the plain app. */
function appBinary(...features: AppFeature[]): Promise<string> {
  const key = features.join('+') || 'plain';
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      mkdirSync(BIN, { recursive: true });
      const out = join(BIN, `deep-app-${key}`);
      await cargo(['-p', 'deep-app', '--bin', 'deep-app', ...features.flatMap((f) => ['--features', f])]).catch((error: Error) => {
        const missing = /does not contain (?:this|these) features?:? *([\w-]+)/.exec(error.message);
        throw Error(missing ? `crates/deep-app/Cargo.toml has no feature ${missing[1]} (README, Surfaces), so this build can't be made` : error.message);
      });
      copyFileSync(target('deep-app'), out);
      if (features.length) await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
      return out;
    })();
    built.set(key, build);
  }
  return build;
}
/** Whether this checkout's app is the merge base's own code, which keeps its key in a file and reaches no Keychain. */
const baseApp = (): boolean => spawnSync('git', ['-C', REPO, 'diff', '--quiet', BASE, '--', 'crates/deep-app'], { stdio: 'ignore' }).status === 0;
/**
 * The app with both stand-ins (`test-confirm`, `test-secrets`) and `plants`. Where the crate has no `test-secrets` and
 * its code is the merge base's own, the base's `test-confirm` build, saying what was missing; otherwise BLOCKED, so no
 * test ever starts an app that could reach your login Keychain.
 */
export async function appWith(...plants: AppFeature[]): Promise<{ binary: string; missing?: string }> {
  try {
    return { binary: await appBinary('test-confirm', 'test-secrets', ...plants) };
  } catch (error) {
    const why = (error as Error).message;
    if (!plants.length && baseApp()) return { binary: await appBinary('test-confirm'), missing: why };
    throw Error(`BLOCKED: ${why}`);
  }
}
/** The app's store stand-in and OS prompt stand-in for a world: files beside the home, outside ~/.deepbuild. */
export function appEnv(w: { home: string }, confirm: 'confirmed' | 'cancelled'): Record<string, string> {
  const answer = join(dirname(w.home), 'app-confirm');
  writeFileSync(answer, `${confirm}\n`);
  return { DEEP_APP_TEST_SECRETS: join(dirname(w.home), 'app-secrets.json'), DEEP_APP_TEST_CONFIRM: answer };
}
/** The app started on `home` with no window probe (AC6): its process and what it wrote to stderr. */
interface Started { child: ChildProcess; err(): string }
export function launchApp(home: string, binary: string, env: Record<string, string>): Started {
  const child = spawn(binary, [], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'ignore', 'pipe'] });
  own(child.pid);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  return { child, err: () => err };
}
/** Waits until the app runs: `deep open` reaches it and it answers (#1460), whatever it says of the address. */
export async function appRuns(home: string, app: Started, address: string, ms = 180_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    if (app.child.exitCode !== null || app.child.signalCode !== null) throw Error(`BLOCKED: deep-app exited (${app.child.exitCode ?? app.child.signalCode}) before it ran: ${app.err().slice(-800)}`);
    const r = await deep(home, ['open', address], { timeoutMs: 20_000 });
    if (!/the app is not running/.test(r.stderr) && (r.code === 0 || r.stdout.trim())) return;
    if (Date.now() > end) throw Error(`BLOCKED: deep-app didn't answer deep open within ${ms} ms: ${app.err().slice(-800)}`);
    await sleep(1000);
  }
}

// ---- deep-hook as an agent's hook entry runs it, with the hub stopped (AC1, AC7): #1503's payloads and readings.
interface Session { id: string; cwd: string; transcript: string }
export function newSession(home: string): Session {
  const id = randomUUID();
  const cwd = join(dirname(home), 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** The fail_closed block entries of a rules file whose match reads a path: the guards a denied read may name. */
export function readGuards(rules: string): string[] {
  const entries = (JSON.parse(rules) as { entries: Record<string, { match: string; mode: string; fail_closed: boolean }> }).entries;
  return Object.entries(entries).filter(([, g]) => g.mode === 'block' && g.fail_closed && /(^|\s)read:/.test(g.match)).map(([name]) => name);
}
export const shippedRules = (): string => readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8');
/**
 * A home whose hub was started on it and stopped by its PID, so deep-hook gets no answer and applies the fail_closed
 * entries; then `rules` as its rules.json, and `plant` writes the file under test.
 */
export async function stoppedHome(rules: string, plant: (root: string) => void): Promise<{ home: string; root: string }> {
  const w = await hubWorld();
  await stopHub(w.hub);
  writeFileSync(join(w.root, 'rules.json'), rules);
  plant(w.root);
  return { home: w.home, root: w.root };
}
/** deep-hook built from the pinned merge base (crates/deep-hook and crates/deep-contracts, offline), and its shipped rules. */
let base: Promise<{ binary: string; rules: string }> | undefined;
export function baseHook(): Promise<{ binary: string; rules: string }> {
  base ??= (async () => {
    const dir = join(REPO, 'target', 'base-1606', BASE.slice(0, 12));
    const src = join(dir, 'src');
    const binary = join(dir, 'target', 'debug', 'deep-hook');
    if (!existsSync(binary)) {
      rmSync(src, { recursive: true, force: true });
      mkdirSync(src, { recursive: true });
      const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'Cargo.lock', 'crates/deep-hook', 'crates/deep-contracts', 'adapters/claude-code.facts.json'], { maxBuffer: 256 * 1024 * 1024 });
      execFileSync('tar', ['-x', '-C', src], { input: tar });
      writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
      const r = await run('cargo', ['build', '--offline', '-q', '-p', 'deep-hook', '--manifest-path', join(src, 'Cargo.toml'), '--target-dir', join(dir, 'target')], { env: CARGO_ENV, cwd: src, timeoutMs: 900_000 });
      if (r.code !== 0 || !existsSync(binary)) throw Error(`BLOCKED: deep-hook at the merge base ${BASE} did not build: exit ${r.code}: ${r.stderr.slice(-2000)}`);
    }
    return { binary, rules: readFileSync(join(src, 'crates/deep-hook/default-rules.json'), 'utf8') };
  })();
  return base;
}

// ---- An agent session (AC8): #667's stand-in, its hooks establishing it, its shell running a command as its Bash tool does.
const AGENT = fileURLToPath(new URL('../667/fixtures/agent.mjs', import.meta.url));
export const DEEP_ANSWER = join(SUITE, 'fixtures', 'deep-answer.mjs');
export class Agent {
  private n = 0;
  private seq = BigInt(Date.now()) * 1_000_000n;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly session: Session) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  /** An agent process working in a folder beside the home, its transcript where Claude Code keeps it. */
  static start(home: string): Agent {
    const session = newSession(home);
    writeFileSync(session.transcript, `${JSON.stringify({ type: 'user', sessionId: session.id, cwd: session.cwd, message: { role: 'user', content: 'start' } })}\n`);
    const child = spawn(NODE, [AGENT], { cwd: session.cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child, session);
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(socket: string): Promise<void> {
    const s = this.session;
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
      const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
      if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
      if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'tidy the release notes', prompt_id: randomUUID() });
      if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
      const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
      const r = await this.send({ op: 'hook', socket, request, cwd: s.cwd });
      if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: setup: the hub didn't acknowledge ${event} from the agent: ${JSON.stringify(r)}`);
    }
  }
  /** `argv` run by the agent through its own shell, as its Bash tool runs a command: the agent is above it. */
  async run(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const r = await this.send({ op: 'run', argv, cwd: this.session.cwd });
    return { code: r.code as number, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
  }
}
