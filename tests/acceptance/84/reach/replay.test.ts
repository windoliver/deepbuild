// #84 REPLAY: the month's recorded hand-backs (README, The replay). Each runs in a session of its own through one hub;
// how many went back with a tool is a reading, whatever its count. What this test fails on is a hand-back sent back
// with no tool the check found, one that neither went back nor reached you, and a reading that doesn't say what the
// replay saw. DEEP_HUB_PLANT=sends-back-no-tool is that wrong program.
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  REPLAY, asksOf, blocked, cardQuestion, cleanup, CodexSession, control, failureOf, item, lastPos, makeWorld, must, namesWord, replyText, Session, settle, startCodexOnItem,
  startHub, startOnItem, verdict, type Hub, type Line, type Reach, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

interface Handback { id: string; class: string; agent: 'claude-code' | 'codex'; stop?: string; card?: { id: string; header: string; question: string; options: string[] }; tools: string[] }
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/handbacks.json', import.meta.url), 'utf8')) as { reach: Reach; handbacks: Handback[] };
const FIRST = 700;

interface Replayed { h: Handback; session: string; reply: Ran; sent: boolean; reached: boolean }

async function replayOne(hub: Hub, w: Parameters<typeof startHub>[0], h: Handback, n: number): Promise<Replayed> {
  let since = 0;
  let reply: Ran;
  let session: { id: string };
  if (h.agent === 'codex') {
    const s = new CodexSession(w);
    session = s;
    await startCodexOnItem(hub, s, n, `${REPLAY} ${h.id}`);
    since = await lastPos(hub);
    reply = await s.card([cardQuestion(h.card!.id, h.card!.header, h.card!.question, h.card!.options)]);
  } else {
    const s = new Session(w);
    session = s;
    await startOnItem(hub, s, n, `${REPLAY} ${h.id}`);
    await s.bump();
    since = await lastPos(hub);
    reply = await s.stop(h.stop);
  }
  const events = await settle(hub, (all) => asksOf(all, session, since).length > 0, 3000);
  const reached = asksOf(events, session, since).length > 0;
  return { h, session: session.id, reply, reached, sent: blocked(reply) && !reached };
}

async function replay(handbacks: readonly Handback[], plant?: string): Promise<{ hub: Hub; out: Replayed[] }> {
  const w = makeWorld({ items: handbacks.map((_, i) => item(FIRST + i)), reach: FIXTURE.reach });
  const hub = await startHub(w, { plant });
  const out: Replayed[] = [];
  for (const [i, h] of handbacks.entries()) out.push(await replayOne(hub, w, h, FIRST + i));
  return { hub, out };
}

/** Each hand-back's outcome: back with a tool the check found, or to you. */
function outcomes(out: readonly Replayed[]): void {
  const wrong: string[] = [];
  for (const { h, reply, sent, reached } of out) {
    if (!sent && !reached) wrong.push(`hand-back ${h.id} (${h.class}) neither went back to the agent nor reached you: ${replyText(reply).slice(0, 200)}`);
    if (sent && !h.tools.some((t) => namesWord(replyText(reply), t))) wrong.push(`hand-back ${h.id} (${h.class}) was sent back with no tool named (the check can find ${h.tools.join(', ')}): ${replyText(reply).slice(0, 300)}`);
  }
  must(wrong.length === 0, `${REPLAY} ${wrong.length} of ${out.length}:\n${wrong.join('\n')}`);
}

describe(`${REPLAY} a replay of the month's recorded hand-backs records how many it sends back with the tool to use as a reading, and each one it sends back names a tool the check found`, () => {
  it(`${REPLAY} ${FIXTURE.handbacks.length} hand-backs of five classes: each goes back naming a tool or reaches you, and numbers.read reports how many went back over the sample, whatever the count`, async (ctx) => verdict(ctx, async () => {
    must(new Set(FIXTURE.handbacks.map((h) => h.class)).size === 5, `BLOCKED: ${REPLAY} the fixture holds the five classes the criterion names`);
    const { hub, out } = await replay(FIXTURE.handbacks);
    outcomes(out);
    const sent = out.filter((x) => x.sent).length;
    const { rows } = await control(hub, 'numbers.read', {}) as { rows: Line[] };
    const row = rows.find((r) => r.id === 'handbacks_sent_back');
    must(row !== undefined, `${REPLAY} numbers.read reports the reading handbacks_sent_back (README, Surfaces the implementer must provide): its readings are ${rows.map((r) => String(r.id)).join(', ')}`);
    // A reading, never a pass or a fail: only that it says what this replay saw.
    must(row.value === sent, `${REPLAY} the reading says how many went back with the tool to use: ${sent} did, it says ${String(row.value)}`);
    must(Array.isArray(row.detail) && row.detail.length === out.length, `${REPLAY} the reading is over the sample, one detail row per hand-back: ${out.length} replayed, ${JSON.stringify(row.detail)?.slice(0, 300)}`);
    ctx.annotate(`${sent} of ${out.length} went back with the tool to use`);
  }), 600_000);

  it(`${REPLAY} (wrong program) a hub that sends hand-backs back with no tool named (DEEP_HUB_PLANT=sends-back-no-tool) fails this test, naming the hand-back`, async (ctx) => verdict(ctx, async () => {
    const [first] = FIXTURE.handbacks;
    const { out } = await replay([first!], 'sends-back-no-tool');
    const failure = await failureOf(async () => outcomes(out));
    must(failure !== null, `${REPLAY} the planted hub must fail on hand-back ${first!.id}: it passed`);
    must(failure.includes(first!.id), `${REPLAY} the failure names the hand-back, ${first!.id}: ${failure}`);
  }), 600_000);
});
