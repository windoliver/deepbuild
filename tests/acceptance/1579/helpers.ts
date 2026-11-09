// Test-side tools for the #1579 acceptance tests (README, The surface). The hub as a process, the socket client, temp
// homes and cleanup are #16's; the OS confirmation's stand-in, a device's key and pairing are #34's, reused as they are.
// What is new here is the signature's new format (README, Pinned here), the hub's clock as these tests move it, asks
// that take their default, the judges each criterion's failure message comes from, and the verifier's kit (AC5).
import { createHash, randomBytes, sign } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { withPlans } from '../plans.ts';
import {
  asApp, asCli, Confirmer, confirmEnv, eventsAbout, inboxRow, installedRoot, makeHome, newDevice, pair, sleep, startHub,
  type Conn, type Device, type Hub, type Line,
} from '../34/helpers.ts';

export {
  asApp, asCli, cleanup, Confirmer, confirmEnv, eventsAbout, inboxRow, installedRoot, makeHome, newDevice, pair, REPO, result, run, sleep, startHub, stopHub, tempDir,
  type Conn, type Device, type Hub, type Line,
} from '../34/helpers.ts';

export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// ---- The signature's new format (README, Pinned here: 1 to 3).

/** What a paired device signs: these six fields, under `params.signature.signed`. */
export interface Signed { device: string; method: string; hub: string; at: number; once: string; params_hash: string }
/** RFC 8785 bytes of the params with `signature` left out, SHA-256, lower-case hex. */
export const paramsHash = (params: Line): string => {
  const { signature: _s, ...body } = params;
  return sha256(canonicalize(body as JsonValue));
};
/** A fresh once-only ID: 16 random bytes, base64url. */
export const freshOnce = (): string => randomBytes(16).toString('base64url');
/**
 * `params` signed for `method` in the new format: `signature: { signed, sig }`, where `sig` is Ed25519 over the RFC 8785
 * bytes of `signed`, base64url. `over` changes any signed field, to make the wrong ones the criteria name.
 */
export function signFor(method: string, params: Line, device: Device, hub: string, at: number, over: Partial<Signed> = {}): Line {
  const signed: Signed = { device: device.id ?? '', method, hub, at, once: freshOnce(), params_hash: paramsHash(params), ...over };
  const sig = sign(null, canonicalize(signed as unknown as JsonValue), device.key).toString('base64url');
  return { ...params, signature: { signed, sig } };
}
/** The base's format (packages/hub/src/trusted.ts at 6042ef5a): `device` in the params, Ed25519 over every other param. */
export function signOld(params: Line, device: Device): Line {
  const body = { ...params, device: device.id ?? '' };
  return { ...body, signature: sign(null, canonicalize(body as JsonValue), device.key).toString('base64url') };
}

// ---- A hub with taste asks seeded, a paired device, and the hub's clock.

export interface Seeded { handle: string; question: string; options: string[] }
/** Raises taste calls through the asks core on the root's ledger before any hub runs there, each with its own deadline. */
export async function seed(root: string, asks: { question: string; deadlineIn: number }[]): Promise<Seeded[]> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const core = withPlans(await openAsks({ record, now, deliver: () => undefined }));
  const row = askSources().find((r) => r.source === 'deep_ask.taste');
  if (!row) throw Error('BLOCKED: setup: ask.sources@1 has no row deep_ask.taste');
  const out: Seeded[] = [];
  for (const { question, deadlineIn } of asks) {
    const ask: Line = { ...(row.fixture.ask as Line), question, key: sha256(`#1579 ${question}`), deadline: now() + deadlineIn };
    ask.pinned_to = { ...(ask.pinned_to as Line), ref: (ask.pinned_to as Line).kind === 'commit' ? sha256(question).slice(0, 40) : sha256(question) };
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, 'deep_ask.taste', ask);
    out.push({ handle, question, options: (ask.options as { id: string }[]).map((o) => o.id) });
  }
  await record.close();
  return out;
}

export interface World { hub: Hub; confirm: Confirmer; asks: Seeded[]; app: Conn; cli: Conn; device: Device; hubId: string }
/**
 * A hub (`plant` its DEEP_HUB_PLANT) whose record holds `open` taste calls due in 30 days and `defaulting` ones due in an
 * hour, which the tests let default by moving the hub's clock; the app's key paired, with the OS stand-in confirming you.
 */
export async function world(o: { open?: number; defaulting?: number; plant?: string } = {}): Promise<World> {
  const home = makeHome();
  const confirm = new Confirmer();
  const asks = await seed(installedRoot(home), [
    ...Array.from({ length: o.open ?? 0 }, (_, i) => ({ question: `Which header colour on page ${i}?`, deadlineIn: 30 * DAY })),
    ...Array.from({ length: o.defaulting ?? 0 }, (_, i) => ({ question: `Which footer colour on page ${i}?`, deadlineIn: HOUR })),
  ]);
  const hub = await startHub({ home, ...(o.plant ? { plant: o.plant } : {}), env: { ...confirmEnv(confirm), DEEP_HUB_TEST_CLOCK_STEPS: '1' } });
  const app = await asApp(hub);
  const cli = await asCli(hub);
  const hubId = app.hello?.hub;
  if (typeof hubId !== 'string' || !hubId) throw Error(`BLOCKED: the hub's hello carries no hub ID: ${JSON.stringify(app.hello)}`);
  const device = newDevice('this Mac\'s app');
  confirm.say(true);
  const reply = await pair(app, device);
  confirm.say(false);
  if (!device.id) throw Error(`BLOCKED: device.pair didn't pair the app's key with the OS confirming you: ${JSON.stringify(reply)}`);
  return { hub, confirm, asks, app, cli, device, hubId };
}
/** Pairs one more device, as a phone would be. */
export async function another(w: World, name: string): Promise<Device> {
  const device = newDevice(name);
  w.confirm.say(true);
  await pair(w.app, device);
  w.confirm.say(false);
  if (!device.id) throw Error(`BLOCKED: device.pair didn't pair ${name}`);
  return device;
}
/** The hub's now, by `test.clock` with no step (README, The surface: the hub's clock). */
export async function hubNow(w: World): Promise<number> {
  const r = await w.cli.call('test.clock', { advance_ms: 0 });
  if (!r.result || typeof r.result.now !== 'number') throw Error(`BLOCKED: the hub serves no test.clock: ${JSON.stringify(r)}`);
  return r.result.now as number;
}
/** Moves the hub's clock forward by `ms`. */
export async function step(w: World, ms: number): Promise<void> {
  const r = await w.cli.call('test.clock', { advance_ms: ms });
  if (!r.result) throw Error(`BLOCKED: test.clock didn't step the hub's clock: ${JSON.stringify(r)}`);
}
/** The ask's inbox outcome (unanswered, answered, defaulted, ...). */
export const outcomeOf = async (w: World, ask: string): Promise<string | undefined> => (await inboxRow(w.app, ask))?.outcome as string | undefined;
/** Moves the hub's clock an hour at a time until the ask has taken its default; BLOCKED if it never does. */
export async function letDefault(w: World, ask: string): Promise<void> {
  for (let i = 0; i < 72; i++) {
    if ((await outcomeOf(w, ask)) === 'defaulted') return;
    await step(w, HOUR);
    for (let t = 0; t < 30 && (await outcomeOf(w, ask)) !== 'defaulted'; t++) await sleep(100);
  }
  throw Error(`BLOCKED: setup: ${ask} never took its default with the hub's clock moved 72 hours: ${JSON.stringify(await inboxRow(w.app, ask))}`);
}

// ---- Judges. Each returns the failure the criterion names, or null; the tests assert null.

/** A signature refused, naming `field` (README, Pinned here: 4), with nothing done. */
export function judgeRefused(field: string, reply: Line, effect: string | null): string | null {
  if (!('error' in reply)) return `the signature with the wrong ${field} counted: the hub replied ${JSON.stringify(reply.result)}`;
  const path = String(reply.error?.path ?? '');
  if (path !== `/params/signature/signed/${field}`) return `the refusal doesn't name ${field}: its path is ${JSON.stringify(path)} (${String(reply.error?.remediation ?? '').slice(0, 300)})`;
  if (effect) return `refused, naming ${field}, yet ${effect}`;
  return null;
}
/** An answer counted: replied with a result, recorded answered once, and Needs you shows it answered. */
export async function judgeCounted(w: World, ask: string, reply: Line): Promise<string | null> {
  if ('error' in reply) return `${ask}'s signed answer was refused: ${JSON.stringify(reply.error)}`;
  const answered = await eventsAbout(w.app, ask, 'ask.answered');
  if (answered.length !== 1) return `${ask} is recorded answered ${answered.length} times, not once`;
  const outcome = await outcomeOf(w, ask);
  if (outcome !== 'answered') return `${ask} shows ${String(outcome)} in Needs you, not answered`;
  return null;
}
/** What an answer left, as the effect a refused one must not have had; null when the ask is still open and unanswered. */
export async function answerEffect(w: World, ask: string): Promise<string | null> {
  const answered = await eventsAbout(w.app, ask, 'ask.answered');
  if (answered.length) return `${ask} was recorded answered (${answered.length} ask.answered)`;
  const outcome = await outcomeOf(w, ask);
  return outcome === 'unanswered' ? null : `${ask} left Needs you's open state: ${String(outcome)}`;
}
/** What an undo left, as the effect a refused one must not have had; null while the ask stays defaulted. */
export async function undoEffect(w: World, ask: string): Promise<string | null> {
  const outcome = await outcomeOf(w, ask);
  return outcome === 'defaulted' ? null : `${ask} opened again: Needs you shows ${String(outcome)}`;
}

// ---- The verifier's kit (AC5): every wrong signature the criteria name, against one hub. A verifier that misses one
// fails the kit, naming the case; the real hub passes every case.

export interface KitCase { case: string; failure: string | null }
export async function verifierKit(w: World): Promise<KitCase[]> {
  const [good, method, hub, at, params, undoAsk] = w.asks;
  if (!good || !method || !hub || !at || !params || !undoAsk) throw Error('BLOCKED: setup: the kit needs five open asks and one that defaults, world({ open: 5, defaulting: 1 })');
  const out: KitCase[] = [];
  const answer = (a: Seeded): Line => ({ ask: a.handle, option: a.options[1]! });
  // A good signature counts: the kit is no wall.
  out.push({ case: 'good', failure: await judgeCounted(w, good.handle, await w.app.call('ask.answer', signFor('ask.answer', answer(good), w.device, w.hubId, await hubNow(w)), 20_000)) });
  // Signed for an undo, sent as an answer.
  const asUndo = signFor('ask.undo', answer(method), w.device, w.hubId, await hubNow(w));
  out.push({ case: 'method', failure: judgeRefused('method', await w.app.call('ask.answer', asUndo, 20_000), await answerEffect(w, method.handle)) });
  // Signed for another hub.
  const otherHub = signFor('ask.answer', answer(hub), w.device, sha256(`not ${w.hubId}`), await hubNow(w));
  out.push({ case: 'hub', failure: judgeRefused('hub', await w.app.call('ask.answer', otherHub, 20_000), await answerEffect(w, hub.handle)) });
  // Signed over other params than the ones sent.
  const swapped = { ...signFor('ask.answer', answer(params), w.device, w.hubId, await hubNow(w)), option: params.options[0]! };
  out.push({ case: 'params_hash', failure: judgeRefused('params_hash', await w.app.call('ask.answer', swapped, 20_000), await answerEffect(w, params.handle)) });
  // Signed now, presented 11 minutes later on the hub's clock.
  const stale = signFor('ask.answer', answer(at), w.device, w.hubId, await hubNow(w));
  await step(w, 11 * MINUTE);
  out.push({ case: 'at', failure: judgeRefused('at', await w.app.call('ask.answer', stale, 20_000), await answerEffect(w, at.handle)) });
  // A signed undo that counted, replayed from another connection once the ask has defaulted again.
  await letDefault(w, undoAsk.handle);
  const undo = signFor('ask.undo', { ask: undoAsk.handle }, w.device, w.hubId, await hubNow(w));
  const first = await w.app.call('ask.undo', undo, 20_000);
  if ('error' in first) out.push({ case: 'once', failure: `the first signed undo of ${undoAsk.handle} was refused: ${JSON.stringify(first.error)}` });
  else {
    await letDefault(w, undoAsk.handle);
    const other = await asApp(w.hub);
    out.push({ case: 'once', failure: judgeRefused('once', await other.call('ask.undo', undo, 20_000), await undoEffect(w, undoAsk.handle)) });
    other.close();
  }
  return out;
}

// ---- A socket between the app and the hub that keeps every line the app sends (AC3), so the test reads what it signed.

export interface Tap { path: string; sent: Line[]; close(): Promise<void> }
export function tap(dir: string, target: string): Promise<Tap> {
  const path = join(dir, 'tap.sock');
  const sent: Line[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const hub = net.connect(target);
    sockets.add(client); sockets.add(hub);
    let buffer = '';
    client.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try { sent.push(JSON.parse(line) as Line); } catch { /* not a line the app sends */ }
      }
      if (!hub.destroyed) hub.write(d);
    });
    hub.on('data', (d) => { if (!client.destroyed) client.write(d); });
    client.on('error', () => hub.destroy()); hub.on('error', () => client.destroy());
    client.on('close', () => hub.end()); hub.on('close', () => client.end());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, sent, close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }) }));
  });
}
