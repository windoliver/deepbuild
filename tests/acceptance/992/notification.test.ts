// AC4 #992.f70129f6: an idle-prompt notification after a waiting session clears its waiting; a permission-prompt
// notification with no PermissionRequest sets it; neither opens an ask or appears as evidence on a claim; a planted
// adapter that opens an ask from one fails, naming the hook. The notifications are Claude Code's Notification hook,
// replayed from this suite's stand-ins and then from the corpus's recorded payloads (README: What the implementation
// must provide, 1); "never evidence" is read as the README's Criteria to tests says.
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { AC4, allEvents, type CaseLine, callOf, cleanup, deepStatus, inboxRead, label, mustRecord, mustTag, type Recorded, replay, type Replay, send, settle, standIn, statusOf, statusWithin, taggedLine } from './helpers.ts';

afterAll(cleanup);

const WITHIN = 5_000;
/** Kinds a session-state signal never maps to: an ask, a prompt, a tool call or permission, or a claim's evidence. */
const NOT_STATE = /^(ask|user|tool|permission|claim|verdict|run|check|evidence)\./;

/** The recorded Notification payload of this type, tagged as the README asks, or BLOCKED. */
function notificationLine(tag: string, type: string): { r: Recorded; line: CaseLine } {
  const found = taggedLine(tag, 'Notification');
  if (!found) throw Error(`BLOCKED: no recorded Claude Code Notification hook tagged ${tag} in adapters/corpus/claude-code (README: What the implementation must provide, 1)`);
  if (found.line.payload.notification_type !== type) throw Error(`BLOCKED: ${label(found.r)}'s Notification tagged ${tag} has notification_type ${found.line.payload.notification_type}, not ${type}`);
  // Its stored events are session-state signals: never an ask, never evidence (adapters/corpus/README.md: Expected events).
  const kinds = (found.line.expect ?? []).map((e) => String(e.kind));
  expect(found.line.expect, `${label(found.r)}: its ${type} Notification is stored with the events it maps to`).toBeDefined();
  expect(kinds.filter((k) => NOT_STATE.test(k) || !k.startsWith('session.')), `${label(found.r)}: its ${type} Notification maps only to session-state signals`).toEqual([]);
  return found;
}

/**
 * Sends the notification into the replay and judges what it did, besides the state: every way it fails, each naming
 * the hook, empty when it opened no ask and wrote nothing a claim could take as evidence.
 */
async function judged(rp: Replay, note: CaseLine): Promise<string[]> {
  return (await sent(rp, note)).failures;
}
/** judged's failures, and the IDs of the events the hook's call added for the session. */
async function sent(rp: Replay, note: CaseLine): Promise<{ failures: string[]; ids: string[] }> {
  const hook = `the Notification hook (notification_type ${note.payload.notification_type})`;
  const before = Math.max(0, ...(await allEvents(rp.hub)).map((e) => e.log_pos));
  await send(rp, note.payload);
  await settle(rp.hub);
  const after = (await allEvents(rp.hub)).filter((e) => e.log_pos > before);
  const failures: string[] = [];
  for (const e of after.filter((x) => x.session === rp.session && (NOT_STATE.test(x.kind) || x.kind === 'ask.created'))) failures.push(`${hook} wrote ${e.kind} ${JSON.stringify(e.data).slice(0, 300)} for session ${rp.session}`);
  const asks = (await inboxRead(rp.hub)).filter((a) => JSON.stringify(a).includes(rp.session) || JSON.stringify(a).includes(rp.session.replace(/-/g, '')));
  for (const a of asks) failures.push(`${hook} opened an ask in your inbox for session ${rp.session}: ${JSON.stringify(a).slice(0, 300)}`);
  return { failures, ids: after.filter((x) => x.session === rp.session).map((x) => x.id) };
}
/**
 * The session goes on as recorded after line `at` to its stop, where the hub files the turn's claim: no claim, verdict
 * or check run of the session cites an event the notification added, or carries the notification's own words.
 */
async function cited(rp: Replay, r: Recorded, at: number, note: CaseLine, ids: string[]): Promise<string[]> {
  writeFileSync(rp.transcript, r.transcript.split(rp.recordedCwd).join(rp.cwd));
  for (const line of r.lines.slice(at + 1)) await send(rp, line.payload);
  await settle(rp.hub);
  const words = String(note.payload.message ?? '');
  return (await allEvents(rp.hub)).filter((e) => e.session === rp.session && /^(claim|verdict|run|check|evidence)\./.test(e.kind))
    .filter((e) => ids.some((id) => JSON.stringify(e).includes(id)) || (words.length > 8 && JSON.stringify(e).includes(words)))
    .map((e) => `the Notification hook (notification_type ${note.payload.notification_type}) appears as evidence on ${e.kind} ${e.id}: ${JSON.stringify(e.data).slice(0, 300)}`);
}

describe(AC4, () => {
  test(`${AC4}: an idle-prompt notification after a waiting session clears its waiting, opening no ask and writing no evidence`, async () => {
    const pairs: [() => Recorded, () => CaseLine][] = [
      [() => standIn('permission-terminal-closed'), () => standIn('permission-answered').lines.find((l) => l.tag === 'notification-idle-prompt')!],
      [() => mustRecord('permission-terminal-closed', 'a permission prompt left open while its terminal closed'), () => notificationLine('notification-idle-prompt', 'idle_prompt').line],
    ];
    for (const [waitingOf, idleOf] of pairs) {
      const waiting = waitingOf();
      const idle = idleOf();
      mustTag(waiting, 'permission-terminal-closed', 'PermissionRequest');
      const rp = await replay(waiting);
      const pre = statusOf(await deepStatus(rp.h), rp.session);
      expect(pre.state, `${label(waiting)}: session ${rp.session} waits at its permission prompt before the idle prompt:\n${pre.text}`).toBe('needs you');
      const failures = await judged(rp, idle);
      const read = await statusWithin(rp.h, rp.session, WITHIN, (s) => s.state !== 'needs you');
      expect(read.state, `${label(waiting)}: session ${rp.session}, waiting at its prompt, then the Notification hook (notification_type idle_prompt): it still reads ${read.state} (${read.why}) in deep status ${WITHIN / 1000} s on:\n${read.text}`).not.toBe('needs you');
      expect(failures, `${label(waiting)}: the idle-prompt notification opens no ask and is no evidence`).toEqual([]);
    }
  }, 240_000);

  test(`${AC4}: a permission-prompt notification with no PermissionRequest sets waiting, opening no ask and writing no evidence`, async () => {
    const pairs: [() => Recorded, () => CaseLine][] = [
      [() => standIn('permission-answered'), () => standIn('permission-denied-esc').lines.find((l) => l.tag === 'notification-permission-prompt')!],
      [() => mustRecord('permission-answered', 'a permission prompt answered'), () => notificationLine('notification-permission-prompt', 'permission_prompt').line],
    ];
    for (const [sessionOf, noteOf] of pairs) {
      const r = sessionOf();
      const note = noteOf();
      // Up to the call the prompt is for, and no further: the PermissionRequest itself is never sent.
      const at = mustTag(r, 'permission-answered', 'PermissionRequest');
      const call = callOf(r, at);
      const through = r.lines.findIndex((l) => l.payload.tool_use_id === call && l.payload.hook_event_name === 'PreToolUse');
      const rp = await replay(r, { through });
      const pre = statusOf(await deepStatus(rp.h), rp.session);
      expect(pre.state, `${label(r)}: session ${rp.session} is at work in its call before the notification:\n${pre.text}`).not.toBe('needs you');
      const { failures, ids } = await sent(rp, note);
      const read = await statusWithin(rp.h, rp.session, WITHIN, (s) => s.state === 'needs you');
      expect(read.state, `${label(r)}: session ${rp.session}, in its ${String(r.lines[through]!.payload.tool_name)} call with no PermissionRequest, then the Notification hook (notification_type permission_prompt): it reads ${read.state ?? 'no row'}${read.why ? ` (${read.why})` : ''} in deep status ${WITHIN / 1000} s on, not needs you:\n${read.text}`).toBe('needs you');
      expect(failures, `${label(r)}: the permission-prompt notification opens no ask and is no evidence`).toEqual([]);
      // Its call then runs and its turn stops, as recorded: the claim the hub files for the turn doesn't cite it.
      expect(await cited(rp, r, at, note, ids), `${label(r)}: the permission-prompt notification is no evidence on the turn's claim`).toEqual([]);
    }
  }, 240_000);

  test(`${AC4}: a planted adapter that opens an ask from a notification fails, naming the hook`, async () => {
    // On a hub with no such planted adapter, as the merge base, there is nothing for the judge to catch.
    const rp = await replay(standIn('permission-terminal-closed'), { plant: 'ask-from-notification' }).catch((error: Error) => error);
    expect(rp instanceof Error ? rp.message : '', 'the hub runs the planted adapter DEEP_HUB_PLANT=ask-from-notification (README: What the implementation must provide, 3)').not.toMatch(/BLOCKED: the hub didn't start/);
    if (rp instanceof Error) throw rp;
    const failures = await judged(rp, standIn('permission-answered').lines.find((l) => l.tag === 'notification-idle-prompt')!);
    expect(failures.length, 'with DEEP_HUB_PLANT=ask-from-notification the idle-prompt notification must open an ask, and the judge must say so').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the hook').toMatch(/the Notification hook/);
  }, 240_000);
});
