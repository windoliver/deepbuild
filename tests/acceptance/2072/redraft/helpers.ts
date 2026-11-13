// Test-side tools for #2072's acceptance tests. Everything is #363's own: its real hub (`deep hub run`), its stocks
// plug-in installed with `deep install`, its agent stand-in whose `deep-actions` server (`deep mcp actions`) takes
// `call_action`, and the hub's record read over its socket. What this file adds is the person's answer: the card the
// app shows for an ask (`ask.card`) and the app's signed `ask.answer`, sent as the app sends it (a device paired with
// the hub; the OS confirmation is the stub #363's hub already runs with). No hub, CLI or extension-host module is
// imported, and nothing here stands in for an owned component.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { expect } from 'vitest';
import { canonicalize, type JsonValue } from '../../../../packages/contracts/src/index.ts';
import { openAs, tokenOf } from '../../16/helpers.ts';
import { sleep, requestId } from '../../363/helpers.ts';
import type { HubWorld, Line, Outcome } from '../../363/hub.ts';

export { hubWorld } from '../../363/hub.ts';
export { pkg, requestId, sleep } from '../../363/helpers.ts';
export type { HubWorld, Line, Outcome } from '../../363/hub.ts';

export const SEND = 'ext.stocks.send_digest';
export const CHANGE = 'ext.stocks.set_alert';

/** One call_action through the agent's deep-actions server, with the request ID the test names. */
export const callAction = (w: HubWorld, action: string, input: unknown, request: string, timeoutMs = 60_000): Promise<Outcome> =>
  w.agent.callTool('deep-actions', 'call_action', { action, request, input: JSON.stringify(input) }, timeoutMs);

const said = (o: Outcome): string => JSON.stringify(o.reply).slice(0, 1200);

/** How many times the stocks plug-in's change and send handlers have run (its `runs` read action). */
export async function runs(w: HubWorld): Promise<{ set_alert: number; send_digest: number }> {
  const o = await callAction(w, 'ext.stocks.runs', {}, requestId());
  expect(o.isError, `the runs read must succeed: ${said(o)}`).toBe(false);
  return o.value.output;
}

/** The record's action.* events for a request ID, as the hub wrote them. */
export const actionEventsFor = async (w: HubWorld, request: string): Promise<Line[]> =>
  (await w.events()).filter((e) => String(e.kind).startsWith('action.') && (e.data as Line | undefined)?.request === request);

export const lastPos = async (w: HubWorld): Promise<number> => {
  const all = await w.events();
  return all.length ? all[all.length - 1]!.log_pos : 0;
};

/**
 * The call an agent makes, left to hold: it is not awaited (a held call may or may not return at once), and the ask it
 * raises under the agent's session is read from the record. BLOCKED, not a pass or a fail, when no ask comes.
 */
export async function holdCall(w: HubWorld, action: string, input: unknown, request: string): Promise<{ ask: string; question: string; card: Line | undefined }> {
  const from = await lastPos(w);
  void callAction(w, action, input, request, 120_000).catch(() => undefined);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const created = (await w.events()).find((e) => e.kind === 'ask.created' && e.session === w.session.id && e.log_pos > from && e.data?.kind === 'authority');
    if (created) {
      const ask = `ask:${created.id}`;
      return { ask, question: String(created.data.question ?? ''), card: await cardOf(w, ask) };
    }
    if (Date.now() > deadline) throw Error(`BLOCKED: ${action} (request ${request}) raised no authority ask under the agent's session within 30 s; nothing to judge`);
    await sleep(200);
  }
}

async function cardOf(w: HubWorld, ask: string): Promise<Line | undefined> {
  const conn = await openAs(w.hub.socket, 'cli', tokenOf(join(w.hub.home, '.deepbuild')));
  try {
    const reply = await conn.call('ask.card', { ask }, 60_000);
    return reply.error ? undefined : (reply.result as Line);
  } finally { conn.close(); }
}

const devices = new WeakMap<object, { id: string; key: KeyObject; hub: string }>();
async function deviceOf(w: HubWorld): Promise<{ id: string; key: KeyObject; hub: string }> {
  const known = devices.get(w.hub);
  if (known) return known;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const conn = await openAs(w.hub.socket, 'cli', tokenOf(join(w.hub.home, '.deepbuild')));
  try {
    const hub = String((conn.received[0]?.json as Line | undefined)?.hub ?? '');
    if (!hub) throw Error(`BLOCKED: the hub's hello names no hub ID`);
    const paired = await conn.call('device.pair', { name: 'DeepBuild app', public_key: String(publicKey.export({ format: 'jwk' }).x) }, 60_000);
    if (paired.error || typeof paired.result?.device !== 'string') throw Error(`BLOCKED: device.pair was refused: ${JSON.stringify(paired)}`);
    const device = { id: String(paired.result.device), key: privateKey, hub };
    devices.set(w.hub, device);
    return device;
  } finally { conn.close(); }
}

/** Your yes: the card's allow option, answered as the app answers it (`ask.answer`, signed by the paired device). */
export async function sayYes(w: HubWorld, held: { ask: string; card: Line | undefined }): Promise<void> {
  const card = held.card ?? (await cardOf(w, held.ask));
  const allow = ((card?.options ?? []) as Line[]).find((o) => o.decision === 'allow');
  if (!allow) throw Error(`BLOCKED: ${held.ask}'s card offers no option that allows: ${JSON.stringify(card?.options)}`);
  const device = await deviceOf(w);
  const params: Line = { ask: held.ask, option: String(allow.id), plan_hash: card?.plan?.hash ?? null, token: `click-${randomBytes(8).toString('hex')}` };
  const signed = { device: device.id, method: 'ask.answer', hub: device.hub, at: Date.now(), once: randomBytes(18).toString('base64url'), params: createHash('sha256').update(canonicalize(params as JsonValue)).digest('hex') };
  const sig = sign(null, canonicalize(signed as JsonValue), device.key).toString('base64url');
  const conn = await openAs(w.hub.socket, 'app', tokenOf(join(w.hub.home, '.deepbuild')));
  try {
    const reply = await conn.call('ask.answer', { ...params, signature: { signed, sig } }, 180_000);
    if (reply.error) throw Error(`BLOCKED: the answer to ${held.ask} was refused: ${JSON.stringify(reply.error)}`);
  } finally { conn.close(); }
  const deadline = Date.now() + 30_000;
  while (!(await w.events()).some((e) => e.kind === 'ask.answered' && e.subject === held.ask && e.data?.decision === 'allow')) {
    if (Date.now() > deadline) throw Error(`BLOCKED: ${held.ask} was not recorded as answered yes within 30 s`);
    await sleep(200);
  }
}

/**
 * The same request ID and the same input called again, as the hold's message tells the agent, until it is no longer
 * held (a send may wait out a countdown first). The last outcome.
 */
export async function runAllowed(w: HubWorld, action: string, input: unknown, request: string): Promise<Outcome> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const o = await callAction(w, action, input, request);
    const held = !o.isError && (o.value as Line | undefined)?.status === 'held';
    if (!held || Date.now() > deadline) return o;
    await sleep(2000);
  }
}

/** A refusal: the call came back as an error, and (the issue's scope) it names the request ID. */
export function expectRefused(o: Outcome, what: string, request: string): void {
  expect(o.isError, `${what}: expected it refused, but the call was answered: ${said(o)}`).toBe(true);
  expect(JSON.stringify(o.reply), `${what}: the refusal names the request ID ${request}`).toContain(request);
}
