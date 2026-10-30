// Test-side tools for the #34 acceptance tests. The hub as a process, the line-protocol client, hook requests,
// temp homes and cleanup are #16's (tests/acceptance/16/helpers.ts), reused as they are; what is new here is
// what #34's surface needs (README, The surface): asks put in the record before a hub starts, the OS
// confirmation's stand-in, a paired device's key and its signature, the judges each criterion's failure
// message comes from, and the planted wrong hubs, which sit between a client and a real hub.
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { shownPlanHash, withPlans } from '../plans.ts';
import { Conn, fromHere, hookRequest, newSession, openAs, result, sendHook, sleep, tempDir, tokenOf, type Line, type Session } from '../16/helpers.ts';

export {
  alive, allEvents, cleanup, CLI, Conn, control, DAY, deep, fromHere, judge, hookRequest, installedRoot, makeHome, newSession, NODE,
  openAs, own, p95, REPO, result, run, sendHook, sleep, spawnHub, startHub, stopHub, tempDir, tokenOf, ulid, waitFor, walk,
  type Ev, type Hub, type HubOptions, type Line, type Session,
} from '../16/helpers.ts';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- Asks in the record before the hub starts (the hub's asks core reads them from the log at its start).

export interface Seeded { handle: string; question: string; options: { id: string; label: string; decision: string }[]; kind: string; plan_hash: string | null }
/**
 * Raises each ask through the asks core (#318) on the hub root's ledger, as the core would, before any hub runs
 * there: `source` is a row of ask.sources@1, and the ask is that row's fixture with its own question, key,
 * pinned_to and a deadline a day away, so it is open when the hub starts.
 */
export async function seedAsks(root: string, asks: { source: string; question: string }[]): Promise<Seeded[]> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = withPlans(await openAsks({ record, now, deliver: () => undefined }));
  const out: Seeded[] = [];
  for (const { source, question } of asks) {
    const row = askSources().find((r) => r.source === source);
    if (!row) throw Error(`BLOCKED: setup: ask.sources@1 has no row ${source}`);
    const ask: Line = { ...(row.fixture.ask as Line), question, key: sha256(`#34 ${question}`), deadline: now() + 86_400_000 };
    ask.pinned_to = { ...(ask.pinned_to as Line), ref: (ask.pinned_to as Line).kind === 'commit' ? sha256(question).slice(0, 40) : sha256(question) };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, source, ask);
    out.push({ handle, question, options: ask.options as Seeded['options'], kind: row.kind, plan_hash: await shownPlanHash(core, handle) });
  }
  await record.close();
  return out;
}

/** The inbox row for an ask, through inbox.read. */
export async function inboxRow(conn: Conn, ask: string): Promise<Line | undefined> {
  const inbox = result(await conn.call('inbox.read', {}));
  return (inbox.asks as Line[]).find((row) => row.ask === ask);
}
/** Every event about an ask whose kind is given, through events.read. */
export async function eventsAbout(conn: Conn, ask: string, kind: string): Promise<Line[]> {
  const out: Line[] = [];
  let after = 0;
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 1000 }, 30_000));
    const events = page.events as Line[];
    if (!events.length) return out;
    out.push(...events.filter((e) => e.kind === kind && e.subject === ask));
    after = events[events.length - 1]!.log_pos as number;
  }
}

// ---- Moving the log to a log_pos: one PreToolUse hook appends one tool.before.

/** The log's last log_pos, through events.read. */
export async function logEnd(conn: Conn): Promise<number> {
  let after = 0;
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 1000 }, 30_000));
    const events = page.events as Line[];
    if (!events.length) return after;
    after = events[events.length - 1]!.log_pos as number;
  }
}
/** One PreToolUse hook from this process, stamped `seq` if given; resolves once the hub acknowledged it. */
export async function hook(socket: string, s: Session, seq?: string): Promise<void> {
  const request = fromHere(hookRequest(s, 'PreToolUse'));
  if (seq) request.seq = seq;
  const r = await sendHook(socket, request);
  if (!r.ack) throw Error(`BLOCKED: setup: the hub didn't acknowledge a hook: ${JSON.stringify(r)}`);
}
/** Hooks until the log ends at `target` exactly; BLOCKED when the hub's own events move it past. */
export async function fillTo(hub: { socket: string; home: string }, conn: Conn, target: number): Promise<void> {
  const s = newSession(hub.home, 'claude-code');
  await sleep(300);   // what the hub appends at its start (an ask's batch, say) lands first
  for (let end = await logEnd(conn); end < target; end = await logEnd(conn)) {
    const n = target - end;
    for (let i = 0; i < n; i++) await hook(hub.socket, s);
    const deadline = Date.now() + 10_000;
    while ((await logEnd(conn)) < end + n && Date.now() < deadline) await sleep(20);
  }
  const end = await logEnd(conn);
  if (end !== target) throw Error(`BLOCKED: setup: the log should end at ${target} and ends at ${end}`);
}

// ---- The OS confirmation's stand-in (README, Test-only settings: DEEP_HUB_TEST_CONFIRM).

/**
 * Stands in for Touch ID, your password or polkit, the boundary the hub doesn't own: an executable the hub runs
 * once per confirmation with the prompt as its one argument. It records each prompt and exits 0 (you
 * confirmed) only while the test has said yes.
 */
export class Confirmer {
  readonly dir = tempDir();
  readonly path = join(this.dir, 'confirm.sh');
  constructor() {
    // Each prompt kept on one line, base64, whatever it holds.
    writeFileSync(this.path, `#!/bin/sh\nprintf '%s' "$1" | /usr/bin/base64 | tr -d '\\n' >> '${join(this.dir, 'prompts.txt')}'\necho >> '${join(this.dir, 'prompts.txt')}'\n[ "$(cat '${join(this.dir, 'answer')}' 2>/dev/null)" = yes ]\n`);
    chmodSync(this.path, 0o700);
    this.say(false);
  }
  /** What the person does at the next prompt: confirm (true) or not. */
  say(yes: boolean): void { writeFileSync(join(this.dir, 'answer'), yes ? 'yes' : 'no'); }
  prompts(): string[] {
    const file = join(this.dir, 'prompts.txt');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((b64) => Buffer.from(b64, 'base64').toString('utf8')) : [];
  }
}
export const confirmEnv = (c: Confirmer) => ({ DEEP_HUB_TEST_CONFIRM: c.path });

// ---- A device's key, pairing and a signed answer.

export interface Device { name: string; key: KeyObject; publicKey: string; id?: string }
/** An Ed25519 key pair, as the app keeps its own; `publicKey` is the raw 32 bytes, base64url. */
export function newDevice(name: string): Device {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { name, key: privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x) };
}
/** `device.pair`: resolves with the hub's reply line; on success the device's ID is set. */
export async function pair(conn: Conn, device: Device): Promise<Line> {
  const reply = await conn.call('device.pair', { name: device.name, public_key: device.publicKey }, 20_000);
  if (reply.result && typeof reply.result.device === 'string') device.id = reply.result.device;
  return reply;
}
/** The answer's params with `device` and `signature`: Ed25519 over the RFC 8785 bytes of every other param. */
export function signed(params: Line, device: Device, as: { id?: string } = {}): Line {
  const body = { ...params, device: as.id ?? device.id ?? '' };
  const signature = sign(null, canonicalize(body as JsonValue), device.key).toString('base64url');
  return { ...body, signature };
}
/** A click's token, as the question card hands one to an approval (#318). */
export const clickToken = (): string => `click-${sha256(String(Math.random())).slice(0, 16)}`;

// ---- Judges. Each returns the failure the criterion names, or null; the tests assert null.

/** AC2's judge: an answer that must not count was refused, recorded nothing and left its ask open. */
export function judgeNotCounted(ask: string, reply: Line, answered: Line[], row: Line | undefined): string | null {
  if (!('error' in reply)) return `${ask} was answered without the trusted path: the hub replied ${JSON.stringify(reply.result)}`;
  if (answered.length) return `${ask} was recorded as answered without the trusted path (${answered.length} ask.answered)`;
  if (!row || row.outcome !== 'unanswered') return `${ask} left the inbox open state: ${JSON.stringify(row)}`;
  return null;
}
/** AC7's judge: what a consumer got before its cut-off and after it resumed, against every log_pos appended. */
export function judgeResume(expected: readonly number[], before: readonly number[], cut: boolean, after: readonly number[]): string | null {
  const got = [...before, ...after];
  const seen = new Set<number>();
  for (const p of got) {
    if (seen.has(p)) return `log_pos ${p} arrived twice`;
    seen.add(p);
  }
  for (let i = 1; i < got.length; i++) if (got[i]! < got[i - 1]!) return `log_pos ${got[i]} arrived after ${got[i - 1]}, out of order`;
  const lost = expected.find((p) => !seen.has(p));
  if (lost !== undefined) return `log_pos ${lost} was lost${cut ? '' : ' with no fell_behind'}: the consumer never got it`;
  if (!cut) return 'the consumer was never cut off with fell_behind';
  return null;
}
/** AC9's judge: every form of the token found in what the files and outputs hold, as "<where> <form>". */
export function judgeToken(token: string, texts: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [where, text] of Object.entries(texts)) for (const hit of formsOf(text, token)) hits.push(`${where}: ${hit}`);
  return hits;
}
function formsOf(text: string, token: string): string[] {
  const bytes = Buffer.from(token, 'utf8');
  const forms: Record<string, string> = {
    raw: token,
    hex: bytes.toString('hex'),
    'URL-encoded': encodeURIComponent(token),
  };
  for (const k of [0, 1, 2]) {
    const std = Buffer.concat([Buffer.from('r:'.slice(2 - k)), bytes]).toString('base64');
    const core = std.slice(Math.ceil((8 * k) / 6), Math.floor((8 * (k + bytes.length)) / 6));
    forms[`base64 at offset ${k}`] = core;
    forms[`base64url at offset ${k}`] = core.replace(/\+/g, '-').replace(/\//g, '_');
  }
  return Object.entries(forms).filter(([, form]) => form.length >= 8 && text.includes(form)).map(([name]) => name);
}
/** AC12's judge: each stamp must come back on the stream's raw text as the exact JSON string. */
export function judgeSeq(raw: string, stamps: readonly string[]): string | null {
  for (const stamp of stamps) {
    if (!raw.includes(`"seq":"${stamp}"`)) return `no event on the stream carries seq "${stamp}" as that exact string${raw.includes(`"seq":${stamp}`) ? '; it came back as a JSON number' : ''}`;
  }
  return null;
}

// ---- The stream, as a test consumer reads it.

export interface Frame { log_pos: number; raw: string }
/** The frames of one subscription on a connection, from line `from`; the cut-off line, if any. */
export function framesOf(conn: Conn, sub: string, from = 1): { frames: number[]; cut: Line | undefined } {
  const frames: number[] = [];
  let cut: Line | undefined;
  for (const r of conn.received.slice(from)) {
    const line = r.json;
    if (!line || line.id !== sub) continue;
    if (line.event) frames.push(line.event.log_pos as number);
    else if (line.error && line.error.code === 'fell_behind') cut = line;
  }
  return { frames, cut };
}

// ---- Planted wrong hubs: a real hub behind a socket that changes what passes, kept in the test folder.

export interface Plant { path: string; close(): Promise<void> }
/**
 * "A hub that drops its frames silently" (AC7): it reads the hub's stream at once, so the hub never sees a slow
 * consumer, and drops every frame it can't hand on while more than `room` frames wait for the consumer.
 */
export function silentDropper(dir: string, target: string, room = 10_000): Promise<Plant> {
  return planted(dir, 'drop.sock', target, (toClient, line, client) => {
    const parsed = safeParse(line);
    if (parsed?.event && client.writableLength > room * 200) return;   // a frame is about 200 bytes or more
    toClient(line);
  });
}
/**
 * "A hub that counts one carrying only the control token" (AC2): the real hub behind a signer that holds a
 * paired key and signs every answer that comes without a signature, so the control token alone makes it count.
 */
export function tokenOnlySigner(dir: string, target: string, device: Device): Promise<Plant> {
  return planted(dir, 'sign.sock', target, (toClient, line) => toClient(line), (toHub, line) => {
    const parsed = safeParse(line);
    if (parsed?.method === 'ask.answer' && parsed.params && !parsed.params.signature) {
      const { device: _d, signature: _s, ...params } = parsed.params as Line;
      return toHub(`${JSON.stringify({ ...parsed, params: signed(params, device) })}\n`);
    }
    toHub(line);
  });
}
function safeParse(line: string): Line | undefined {
  try { return JSON.parse(line) as Line; } catch { return undefined; }
}
type Pass = (send: (line: string) => void, line: string, socket: net.Socket) => void;
function planted(dir: string, name: string, target: string, down: Pass, up: Pass = (send, line) => send(line)): Promise<Plant> {
  const path = join(dir, name);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const hub = net.connect(target);
    sockets.add(client); sockets.add(hub);
    const lines = (from: net.Socket, each: (line: string) => void) => {
      let buffer = '';
      from.setEncoding('utf8').on('data', (d: string) => {
        buffer += d;
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) { each(buffer.slice(0, i + 1)); buffer = buffer.slice(i + 1); }
      });
    };
    lines(hub, (line) => down((l) => { if (!client.destroyed) client.write(l); }, line, client));
    lines(client, (line) => up((l) => { if (!hub.destroyed) hub.write(l); }, line, hub));
    client.on('error', () => hub.destroy()); hub.on('error', () => client.destroy());
    client.on('close', () => hub.end()); hub.on('close', () => client.end());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }) }));
  });
}

// ---- A connection as the app or the CLI, by the hub's current token.
export const asApp = (hub: { socket: string; root: string }) => openAs(hub.socket, 'app', tokenOf(hub.root));
export const asCli = (hub: { socket: string; root: string }) => openAs(hub.socket, 'cli', tokenOf(hub.root));

// ---- The reference Mac. Budgets count only there; elsewhere a reading is INCONCLUSIVE. Power isn't gated on.
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro' }, { model: 'Mac15,12', chip: 'Apple M3' }];
/** Why this machine isn't the reference Mac, or null when it is. */
export function notReferenceMac(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
    const chip = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim();
    return REFERENCE_MACS.some((m) => m.model === model && m.chip === chip) ? null : `not a reference Mac: ${model} / ${chip}`;
  } catch (error) {
    return `cannot read the machine: ${(error as Error).message}`;
  }
}
