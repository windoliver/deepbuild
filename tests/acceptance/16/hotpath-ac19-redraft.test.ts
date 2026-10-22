// AC19 (issue #16), blind redraft: "While 30 scripted sessions send 1,000 PreToolUse hooks, one session's
// PostToolUse carries a 16 MB tool output holding a scrub-list value: every other session's acknowledgement
// arrives within 20 ms of its request being read and the socket round trip stays under 2 ms at p95, and the
// large call's event is appended once with only its kind's catalogue fields and no form of the scrub-list
// value. A hub that parses and scrubs on its event loop holds the next acknowledgements past 20 ms and fails,
// naming the first late one."
// Written from the issue, docs/technical-design.md at 4f6dec5, the base's contracts and evidence packages and
// this suite's README, helpers and fixtures, never from an implementation. See AC19-REDRAFT.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import {
  allEvents, childEnv, cleanup, control, everyForm, evidenceFile, FIXTURES, formsIn, makeHome, newSession, NODE, p95,
  run, sleep, startHub, tempDir, tokenOf, type Ev, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup);

const SESSIONS = 30;
const HOOKS = 1000;
const INTERVAL_MS = 50;           // each session's pace; staggered, some session writes every 50/30 ms
const BIG_SESSION = 0;
const BIG_AT = 8;                 // of about 33 hooks per session: about 25 per session still to come after it
const BIG_BYTES = 16 * 1024 * 1024;
const ACK_LIMIT_MS = 20;          // design, Hook protocol: "within 20 ms of reading the request"
const ROUND_TRIP_P95_MS = 2;
const FILLER = 'build output line that says nothing in particular';   // the output's text, as fixtures/load-held.mjs writes it

/** One PreToolUse exchange as fixtures/load-held.mjs timed it, in ms since the epoch. */
interface Hook {
  id: string; session: string; n: number;
  openAt: number; helloAt: number | null; writeAt: number | null; ackAt: number | null; replyAt: number | null;
  end: string; error?: Line;
}
interface Big extends Omit<Hook, 'n' | 'writeAt'> { bytes: number; writeStart: number | null; writeEnd: number | null }
interface Load { hooks: Hook[]; big: Big | null; starts: { id: string; end: string }[] }
interface Scenario { hub: Hub; token: string; load: Load; big: Big }

const ms = (x: number) => `${x.toFixed(2)} ms`;

/**
 * The run: a hub (planted or not), 30 sessions, 1,000 PreToolUse hooks from fixtures/load-held.mjs, and one
 * PostToolUse whose 16 MB output holds the hub's control token (a value on its scrub list, README Readings) in
 * every form #15 names, and whose command holds them too. Fails, as BLOCKED, when the scenario itself didn't
 * run: the hub didn't start, a session wasn't started, the large call never got through, or the other sessions
 * didn't keep requests in flight across it.
 */
async function scenario(plant?: string): Promise<Scenario> {
  const home = makeHome();
  const hub = await startHub({ home, ...(plant !== undefined && { plant }) });
  const token = tokenOf(hub.root);
  if (token.length < 16) throw Error(`BLOCKED: the control token is ${token.length} characters, too short for a scrub-list value`);
  const forms = everyForm(token).map((f) => f.printed);
  const sessions = Array.from({ length: SESSIONS }, () => newSession(home, 'claude-code'));
  const spec = {
    sessions: sessions.map(({ id, cwd, transcript }) => ({ id, cwd, transcript })),
    hooks: HOOKS, intervalMs: INTERVAL_MS,
    big: { session: BIG_SESSION, at: BIG_AT, bytes: BIG_BYTES, forms, command: `cat logs/${token}/build.log # ${forms.join(' ')}` },
  };
  const specFile = join(tempDir(), 'spec.json');
  writeFileSync(specFile, JSON.stringify(spec));
  const ran = await run(NODE, [join(FIXTURES, 'load-held.mjs'), hub.socket, specFile], { env: childEnv(home), timeoutMs: 240_000 });
  const last = ran.stdout.trim().split('\n').pop() ?? '';
  let load: Load;
  try {
    load = JSON.parse(last) as Load;
  } catch {
    throw Error(`BLOCKED: the load fixture gave no result (exit ${ran.code}, signal ${ran.signal}): ${ran.stderr.slice(0, 2000)}`);
  }
  const unstarted = load.starts.filter((s) => s.end !== 'reply');
  if (unstarted.length) throw Error(`BLOCKED: ${unstarted.length} SessionStart hooks weren't answered, the first ${unstarted[0]!.id} (${unstarted[0]!.end})`);
  if (load.hooks.length !== HOOKS) throw Error(`BLOCKED: the load sent ${load.hooks.length} PreToolUse hooks, not ${HOOKS}`);
  const big = load.big;
  if (!big) throw Error('BLOCKED: the large call was never sent');
  if (big.bytes !== BIG_BYTES) throw Error(`BLOCKED: the large call's output is ${big.bytes} bytes, not ${BIG_BYTES}`);
  if (big.writeEnd === null) throw Error(`BLOCKED: the large call ${big.id} was never written whole (${big.end}; hello ${big.helloAt === null ? 'never came' : 'came'})`);
  if (big.end !== 'reply' || big.ackAt === null || big.error !== undefined) {
    throw Error(`the large call ${big.id} wasn't acknowledged and answered: ${big.end}, ack ${big.ackAt === null ? 'none' : 'read'}${big.error !== undefined ? `, refused: ${JSON.stringify(big.error)}` : ''}`);
  }
  // Requests in flight across the large call: every other session kept writing after its last byte went out.
  const writeEnd = big.writeEnd;
  for (const s of sessions) {
    if (s.id === big.session) continue;
    const after = load.hooks.filter((h) => h.session === s.id && h.writeAt !== null && h.writeAt > writeEnd).length;
    if (after < 10) throw Error(`BLOCKED: session ${s.id} wrote only ${after} requests after the large call's last byte, so the run didn't keep requests in flight across it`);
  }
  return { hub, token, load, big };
}

/** Other sessions' requests whose acknowledgement didn't arrive within 20 ms of the request being written, earliest written first. */
function lateAcks(load: Load, big: Big): Hook[] {
  const late = load.hooks.filter((h) => h.session !== big.session
    && (h.writeAt === null || h.ackAt === null || h.ackAt - h.writeAt > ACK_LIMIT_MS));
  return late.sort((a, b) => (a.writeAt ?? a.openAt) - (b.writeAt ?? b.openAt));
}
function lateness(h: Hook, big: Big): string {
  const when = h.writeAt === null ? '' : `, written ${ms(h.writeAt - big.writeEnd!)} after the large call's last byte`;
  if (h.writeAt === null) return `never sent: no hello on its connection (${h.end})${when}`;
  if (h.ackAt === null) return `no acknowledgement (${h.end})${when}`;
  return `acknowledged ${ms(h.ackAt - h.writeAt)} after its request was written${when}`;
}
/** Throws, naming the first late acknowledgement's request ID, when any other session's ack took more than 20 ms. */
function checkAcks(load: Load, big: Big): void {
  const late = lateAcks(load, big);
  if (!late.length) return;
  const first = late[0]!;
  const others = load.hooks.filter((h) => h.session !== big.session).length;
  throw Error(`${late.length} of ${others} other sessions' acknowledgements arrived more than ${ACK_LIMIT_MS} ms after the request could first be read; `
    + `the first late one is request ${first.id} (session ${first.session}, its hook ${first.n}): ${lateness(first, big)}. `
    + `Next late: ${late.slice(1, 4).map((h) => `${h.id} (${lateness(h, big)})`).join('; ') || 'none'}`);
}
/** Throws unless the round trip, request written to reply read, is under 2 ms at p95 over the 1,000 hooks. */
function checkRoundTrip(load: Load): void {
  const trips = load.hooks.map((h) => (h.end === 'reply' && h.writeAt !== null && h.replyAt !== null && h.error === undefined ? h.replyAt - h.writeAt : Number.POSITIVE_INFINITY));
  const at95 = p95(trips);
  if (at95 < ROUND_TRIP_P95_MS) return;
  const slow = load.hooks.map((h, i) => ({ h, t: trips[i]! })).filter((x) => x.t >= ROUND_TRIP_P95_MS).sort((a, b) => b.t - a.t);
  throw Error(`the socket round trip is ${ms(at95)} at p95 over ${trips.length} hooks (limit under ${ROUND_TRIP_P95_MS} ms); `
    + `${slow.length} took ${ROUND_TRIP_P95_MS} ms or more, the slowest request ${slow[0]!.h.id} (${Number.isFinite(slow[0]!.t) ? ms(slow[0]!.t) : `no reply: ${slow[0]!.h.end}`})`);
}

/** Every event in the log once the large call's event is readable and the log has stopped growing. */
async function settledEvents(hub: Hub, id: string): Promise<Ev[]> {
  const conn = await control(hub);
  try {
    const deadline = Date.now() + 60_000;
    let events = await allEvents(conn);
    while (!events.some((e) => e.id === id)) {
      if (Date.now() > deadline) throw Error(`the large call's event ${id} wasn't appended within 60 s (${events.length} events in the log)`);
      await sleep(250);
      events = await allEvents(conn);
    }
    for (let quiet = 0; quiet < 4 && Date.now() < deadline;) {
      await sleep(250);
      const next = await allEvents(conn);
      quiet = next.length === events.length ? quiet + 1 : 0;
      events = next;
    }
    return events;
  } finally {
    conn.close();
  }
}
/** The large call's event: appended once, tool.after@1 with only its catalogue fields, no form of the value in it or its evidence. */
function checkBigEvent(events: Ev[], big: Big, root: string, token: string): void {
  const mine = events.filter((e) => e.id === big.id);
  if (mine.length !== 1) throw Error(`the large call's event ${big.id} is appended ${mine.length} times (log_pos ${mine.map((e) => e.log_pos).join(', ')}), not once`);
  const ev = mine[0]!;
  if (ev.kind !== 'tool.after') throw Error(`the large call's event ${big.id} is ${ev.kind}, not tool.after`);
  // The record's JSON adds what the connection proved (session, project, agent) and the hub adds `verified`;
  // everything else must be tool.after@1's, whose data has additionalProperties false.
  const { verified: _v, session: _s, project: _p, agent: _a, ...rest } = ev as Ev & { project?: string; agent?: string };
  const valid = validate('tool.after@1', rest);
  if (!valid.ok) throw Error(`the large call's event ${big.id} holds more than tool.after@1's catalogue fields: ${valid.issues.map((i) => JSON.stringify(i)).join('; ')}`);
  const text = JSON.stringify(ev);
  if (text.includes(FILLER)) throw Error(`the large call's event ${big.id} keeps the tool output's text (${text.length} characters of JSON)`);
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(ev);
  const hits = formsIn(`${text}\n${strings.join('\n')}`, { 'the control token': token });
  if (hits.length) throw Error(`the large call's event ${big.id} holds the scrub-list value: ${hits.join(', ')}`);
  for (const hash of ev.evidence) {
    const file = evidenceFile(root, hash);
    if (!existsSync(file)) continue;
    const found = formsIn(readFileSync(file, 'utf8'), { 'the control token': token });
    if (found.length) throw Error(`evidence ${hash}, which the large call's event ${big.id} cites, holds the scrub-list value: ${found.join(', ')}`);
  }
}

describe('AC19 #16.8f097301 a 16 MB output with a scrub-list value: others\' acks within 20 ms, round trip under 2 ms at p95, its event once, catalogue fields only, no form of the value (redraft)', () => {
  it('AC19 while 30 sessions send 1,000 PreToolUse hooks, one PostToolUse carries 16 MB holding the control token: every other ack within 20 ms of its request, round trip under 2 ms at p95, the event once, tool.after@1 fields only, no form of the token', async () => {
    const { hub, token, load, big } = await scenario();
    checkAcks(load, big);
    checkRoundTrip(load);
    checkBigEvent(await settledEvents(hub, big.id), big, hub.root, token);
  }, 300_000);

  it('AC19 (wrong program) a hub that parses and scrubs on its event loop holds the next acknowledgements past 20 ms and fails, naming the first late one', async () => {
    const { hub, load, big } = await scenario('parse-on-event-loop');
    // The plant ran the scenario: it read, parsed and appended the large call.
    await settledEvents(hub, big.id);
    const late = lateAcks(load, big);
    expect(late.length, 'the planted hub held no other session\'s acknowledgement past 20 ms').toBeGreaterThan(0);
    // The hold is the large line's: requests written after its last byte went out are among the late ones.
    const held = late.filter((h) => h.writeAt !== null && h.writeAt >= big.writeEnd!);
    expect(held.length, 'no request written after the large call\'s last byte was late').toBeGreaterThan(0);
    expect(() => checkAcks(load, big)).toThrow(`the first late one is request ${late[0]!.id}`);
  }, 300_000);
});
