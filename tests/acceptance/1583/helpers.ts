// What the #1583 hub tests share (README, The surface). A real hub (`deep hub run`) in a temp home, the paseo channel
// installed with `deep install`, its provider #65's stand-in on 127.0.0.1, asks raised through the real asks core
// before the hub starts, a paired phone signing in #1579's format, and the OS confirmation's stand-in (#34). The world
// and the signer follow tests/acceptance/1580/helpers.ts (same repo, same license), which imports the same helpers:
// #16's hub process and cleanup, #34's Confirmer, #65's providers and record reads, and #65's redraft-1579 signer.
// Nothing here stands in for DeepBuild's code. Every process is stopped by PID, and the real ~/.deepbuild is never
// touched: HOME is the test's own.
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { childEnv, cleanup as cleanup16, CLI, deep, makeHome, NODE, own, REPO, startHub, type Hub, type Line } from '../16/helpers.ts';
import { Confirmer } from '../34/helpers.ts';
import { cardHash, Provider, type Answer, type Item } from '../65/fixtures/providers.ts';
import { events, ok, said, waitFor, type Ev } from '../65/helpers.ts';
import { hubOf } from '../65/redraft-1579/helpers.ts';
import { newOnce, paramsHash, sigOver } from '../65/redraft-1579/fixtures/phone.ts';
import type { Raised } from './texts.ts';

export { events, said, type Ev, type Item };
export const MINUTE = 60_000;
/** The one channel of these tests: paseo's, a device channel, so every open ask's card carries its options. */
const CHANNEL = 'paseo';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A paired device: an Ed25519 key, its public half the raw 32 bytes in base64url, and the ID device.pair gave it. */
export interface Device { name: string; key: KeyObject; publicKey: string; id: string }
/** An ask as raised, with the handle the asks core gave it. */
export interface Seeded extends Raised { handle: string }
export interface World { home: string; root: string; hub: Hub; hubId: string; relay: Provider; phone: Device; asks: Record<string, Seeded> }

const relays: Provider[] = [];

/** Raises each ask as a choice, through the real asks core, into the ledger of a hub that hasn't started. */
async function seed(root: string, raised: readonly Raised[]): Promise<Record<string, Seeded>> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = (): number => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  try {
    const core = await openAsks({ record, now, deliver: () => undefined });
    const row = askSources().find((r) => r.source === 'deep_ask.choice');
    if (!row) throw Error('BLOCKED: setup: ask.sources@1 has no row deep_ask.choice');
    const fixture = row.fixture.ask as Line;
    const out: Record<string, Seeded> = {};
    for (const a of raised) {
      const options = a.options.map((o) => ({ ...o, decision: 'none' }));
      const ask: Line = {
        ...fixture, question: a.question, options, recommended: options[0]!.id, default: options[0]!.id,
        key: sha256(`#1583 ${a.name}`), deadline: now() + 86_400_000, pinned_to: { ...(fixture.pinned_to as Line), ref: sha256(a.name) },
      };
      out[a.name] = { ...a, handle: await core.raise({ writer: 'core', actor: 'you', scope: 'you' }, 'deep_ask.choice', ask) };
    }
    return out;
  } finally {
    await record.close();
  }
}

/**
 * Raises the asks, writes channels.json (every kind of ask to paseo), starts the hub with the OS stand-in saying yes,
 * pairs the phone, installs the paseo channel and waits for its first call to its provider. Anything that doesn't
 * come up is BLOCKED, naming it.
 */
export async function world(raised: readonly Raised[]): Promise<World> {
  if (!existsSync(CLI)) throw Error('BLOCKED: setup: packages/cli/dist/main.js is not built (npm run build --workspaces)');
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const asks = await seed(root, raised);
  const relay = await Provider.start(CHANNEL);
  relays.push(relay);
  const routes = [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: [CHANNEL] }];
  writeFileSync(join(root, 'channels.json'), `${JSON.stringify({ channels: { [CHANNEL]: { api: relay.api } }, routes, quiet: null }, null, 2)}\n`, { mode: 0o600 });
  const confirmer = new Confirmer();
  confirmer.say(true);
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirmer.path, TZ: 'UTC' } }, 120_000);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const w: World = { home, root, hub, hubId: '', relay, phone: { name: 'Test phone', key: privateKey, publicKey: String(publicKey.export({ format: 'jwk' }).x), id: '' }, asks };
  w.hubId = await hubOf(w);
  w.phone.id = String((await ok(w, 'device.pair', { name: w.phone.name, public_key: w.phone.publicKey })).device);
  const folder = join(REPO, 'packages/channels', CHANNEL);
  const installed = await deep(home, ['install', folder], { timeoutMs: 300_000 });
  if (installed.code !== 0) throw Error(`BLOCKED: setup: deep install ${folder} exited ${installed.code}: ${installed.stdout.slice(-1500)} ${installed.stderr.slice(-1500)}`);
  await waitFor(() => relay.calls.length > 0, MINUTE, `the ${CHANNEL} channel's first call to its provider once installed`)
    .catch((e: Error) => { throw Error(`BLOCKED: setup: ${e.message}; the hub said: ${hub.proc.stderr().slice(-1500)}`); });
  return w;
}
/** Stops the stand-in providers, then every process these tests started, by PID, and removes their temp folders. */
export async function cleanup(): Promise<void> {
  for (const relay of relays.splice(0)) await relay.stop().catch(() => undefined);
  await cleanup16();
}

/** The card the relay shows for an ask; BLOCKED when the channel delivered none within a minute. */
export async function cardOf(w: World, ask: Seeded): Promise<Item> {
  return waitFor(() => w.relay.latest(ask.handle), MINUTE, `${ask.handle}'s card at the ${CHANNEL} relay`)
    .catch((e: Error) => { throw Error(`BLOCKED: setup: ${e.message} (the ${ask.name} ask); the relay holds cards for ${w.relay.posts.map((p) => p.item.thread_key).join(', ') || 'no ask'}`); });
}

export interface Bytes { code: number | null; stdout: Buffer; stderr: string }
/** `deep <args>` from the built CLI, run by you, its stdout kept byte for byte (as #1510's suite reads it). */
export function deepBytes(home: string, args: readonly string[]): Promise<Bytes> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a `deep` that never ends is stopped, by its PID, so the test fails where it would hang.
    const timer = setTimeout(() => child.kill('SIGKILL'), 2 * MINUTE);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr }); });
  });
}
/** The line of stdout holding `handle`, and the indented lines printed under it, as text. */
export function rowOf(out: Buffer, handle: string): { row: string | undefined; under: string[] } {
  const lines = out.toString('utf8').split('\n');
  const at = lines.findIndex((l) => l.includes(handle));
  if (at < 0) return { row: undefined, under: [] };
  const under: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s/.test(l)) break;
    under.push(l);
  }
  return { row: lines[at], under };
}

/**
 * The phone's answer to a card as it shows it, signed in #1579's format for `channel.answer` over `{ask, revision,
 * card_hash, answer}`, the params carried beside `signed`. `card_hash` is #65's: the SHA-256 of the RFC 8785 bytes of
 * `{summary, options}` of the card signed over.
 */
export function signedAnswer(w: World, shown: Item, option: string): Answer {
  if (!w.phone.id) throw Error('BLOCKED: setup: the phone was never paired');
  const params = { ask: shown.thread_key, revision: shown.revision, card_hash: cardHash(shown), answer: option };
  const signed = { device: w.phone.id, method: 'channel.answer', hub: w.hubId, at: Date.now(), once: newOnce(), params: paramsHash(params) };
  const signature = { signed, sig: sigOver(signed, w.phone.key), params };
  return { thread_key: shown.thread_key, answer: option, signature: signature as unknown as NonNullable<Answer['signature']> };
}
export const lastPos = async (w: World): Promise<number> => (await events(w)).at(-1)?.log_pos ?? 0;
/** The hub's first word on a thread after `since` (a log position): a refusal of a channel's answer, or the ask answered. */
export function outcomeOf(w: World, handle: string, since: number, what: string): Promise<Ev> {
  return waitFor(async () => (await events(w)).find((e) => e.log_pos > since && e.subject === handle && (e.kind === 'channel.refused' || e.kind === 'ask.answered')), MINUTE, what);
}
