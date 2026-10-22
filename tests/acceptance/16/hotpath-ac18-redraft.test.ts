// AC18 (issue #16): "With the test VFS holding every sync for 50 ms, 30 scripted sessions send 1,000 PreToolUse
// hooks while the hub commits ten verdicts with `synchronous=FULL`, checkpoints the WAL and backfills 50,000
// transcript events: the socket round trip stays under 2 ms at p95 and no reply takes 50 ms. A hub that commits
// through the synchronous binding on its event loop holds replies for the sync and fails, naming the first late
// reply".
// Blind redraft: written from the issue, docs/technical-design.md at 4f6dec5, the base checkout and this suite's
// README, helpers and fixtures, never from an implementation. See AC18-REDRAFT.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, childEnv, cleanup, control, FIXTURES, makeHome, mulberry32, newSession, NODE, p95, run, SEED, startHub,
  tempDir, tokenOf, word, type Ev, type Line, type Session,
} from './helpers.ts';

afterEach(cleanup);

const SESSIONS = 30;
const HOOKS = 1000;              // at least this many PreToolUse hooks; they keep coming until the load has returned
const INTERVAL_MS = 33;          // each session's hooks are due this far apart: about 900 hooks a second in all
const WARM_HOOKS = 100;          // hooks answered before the load call is sent, so the hooks are under way first
const TAIL_MS = 300;             // hooks keep coming this long after the load call returned
const SYNC_MS = 50;              // the test VFS holds every sync this long
const VERDICTS = 10;
const BACKFILL_EVENTS = 50_000;
const P95_MS = 2;                // "the socket round trip stays under 2 ms at p95"
const LATE_MS = 50;              // "no reply takes 50 ms"
/**
 * "Stays under 2 ms at p95": the p95 holds over every run of WINDOW hooks in a row (about 0.6 s of them), not only
 * over the whole run, so a hold isn't averaged away by however long the backfill keeps the hooks coming. A 50 ms
 * hold at about 900 hooks a second keeps some 43 hooks waiting more than 2 ms; 28 in a window break its p95.
 */
const WINDOW = 540;
/**
 * The load process's own timetable: a hook that starts more than LAG_MS after it was due shows the machine stalled
 * the test's process, not the hub. Hooks whose exchange overlaps such a stall (from the late hook's due time to 50 ms
 * after it started) aren't judged; when more than DISTURBED_SHARE of them are, the reading is INCONCLUSIVE.
 */
const LAG_MS = 10;
const DISTURBED_SHARE = 0.05;

interface HookTiming {
  id: string; session: string; k: number; dueAt: number;
  connectAt: number | null; helloAt: number | null; writeAt: number | null; ackAt: number | null; replyAt: number | null;
  end: string; endAt: number; error?: Line;
}
interface LoadOut {
  wallOffset: number; starts: string[]; hooks: HookTiming[]; warmAt: number | null;
  load: { sentAt: number; doneAt: number; reply: Line } | null; stopAt: number;
}
interface Scenario { out: LoadOut; pre: Ev[]; post: Ev[]; points: Line[]; backfill: Session }

/** A Claude Code transcript of `lines` entries, user and assistant by turns, from the recorded seed. */
function transcript(s: Session, lines: number): string {
  const rng = mulberry32(SEED);
  const out: string[] = [];
  let parent: string | null = null;
  for (let i = 0; i < lines; i++) {
    const uuid = `${word(rng, 8, '0123456789abcdef')}-${word(rng, 4, '0123456789abcdef')}-4${word(rng, 3, '0123456789abcdef')}-8${word(rng, 3, '0123456789abcdef')}-${word(rng, 12, '0123456789abcdef')}`;
    const timestamp = new Date(Date.UTC(2026, 9, 21, 9) + i * 1000).toISOString();
    const common = { parentUuid: parent, isSidechain: false, userType: 'external', cwd: s.cwd, sessionId: s.id, version: '2.0.0', uuid, timestamp };
    const entry = i % 2 === 0
      ? { ...common, type: 'user', message: { role: 'user', content: `step ${i}: ${word(rng, 24, 'abcdefghij klmnop')}` } }
      : {
        ...common, type: 'assistant', requestId: `req_${word(rng, 24)}`,
        message: {
          id: `msg_${word(rng, 24)}`, type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: word(rng, 40, 'abcdefghij klmnop') }], stop_reason: 'end_turn',
          usage: { input_tokens: 1 + Math.floor(rng() * 4000), output_tokens: 1 + Math.floor(rng() * 800) },
        },
      };
    out.push(JSON.stringify(entry));
    parent = uuid;
  }
  return `${out.join('\n')}\n`;
}

/** The scenario, on a fresh hub (planted with `plant` when given): what the sessions saw, the log before and after, the VFS's points. */
async function scenario(plant?: string): Promise<Scenario> {
  const home = makeHome();
  const pointsFile = join(tempDir(), 'points.jsonl');
  writeFileSync(pointsFile, '');
  const hub = await startHub({ home, vfs: { syncDelayMs: SYNC_MS, points: pointsFile }, ...(plant && { plant }) }, 60_000);
  const sessions = Array.from({ length: SESSIONS }, () => newSession(home, 'claude-code'));
  const backfill = newSession(home, 'claude-code');
  writeFileSync(backfill.transcript, transcript(backfill, BACKFILL_EVENTS));
  const conn = await control(hub);
  const pre = await allEvents(conn);
  const work = tempDir();
  const specFile = join(work, 'spec.json');
  const outFile = join(work, 'out.json');
  writeFileSync(specFile, JSON.stringify({
    sessions: sessions.map(({ id, cwd, transcript: t }) => ({ id, cwd, transcript: t })),
    intervalMs: INTERVAL_MS, warmHooks: WARM_HOOKS, warmTimeoutMs: 30_000, minHooks: HOOKS, tailMs: TAIL_MS,
    hookTimeoutMs: 10_000, loadTimeoutMs: 300_000, token: tokenOf(hub.root), out: outFile,
    load: { verdicts: VERDICTS, checkpoint: true, backfill: { agent: backfill.agent, session: backfill.id, transcript: backfill.transcript } },
  }));
  const ran = await run(NODE, [join(FIXTURES, 'load-ac18.mjs'), hub.socket, specFile], { env: childEnv(home), timeoutMs: 600_000 });
  if (ran.code !== 0) throw Error(`BLOCKED: the load process ended ${ran.code ?? ran.signal}: ${ran.stderr.slice(0, 2000)}`);
  const out = JSON.parse(readFileSync(outFile, 'utf8')) as LoadOut;
  const post = await allEvents(conn);
  conn.close();
  const points = readFileSync(pointsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
  return { out, pre, post, points, backfill };
}

const fmt = (ms: number) => (Number.isFinite(ms) ? `${ms.toFixed(3)} ms` : 'no reply');
/** A hook's round trip: from its connect to its reply line read, the whole exchange (the hello included); no reply is Infinity. */
const roundTrip = (h: HookTiming) => (h.end === 'reply' && h.replyAt !== null && h.connectAt !== null ? h.replyAt - h.connectAt : Number.POSITIVE_INFINITY);
const byConnect = (hooks: readonly HookTiming[]) => [...hooks].sort((a, b) => (a.connectAt ?? a.dueAt) - (b.connectAt ?? b.dueAt));

/**
 * Throws, naming what is missing, unless the scenario ran as the criterion sets it: the load call returned done,
 * at least 1,000 hooks from all 30 sessions ran beside it, from before it was sent to after it returned, ten
 * verdicts were appended during it, each in a FULL commit, and the backfill appended its 50,000 events.
 */
function checkScenario(s: Scenario): void {
  const { out } = s;
  const load = out.load;
  const replied = out.hooks.filter((h) => h.end === 'reply').length;
  if (!load) throw Error(`AC18 scenario: the load call was never sent: only ${replied} of the first ${WARM_HOOKS} hooks were answered`);
  if (load.reply.result?.done !== true) throw Error(`AC18 scenario: test.load didn't return done: ${JSON.stringify(load.reply)}`);
  if (out.hooks.length < HOOKS) throw Error(`AC18 scenario: ${out.hooks.length} PreToolUse hooks, fewer than ${HOOKS}`);
  const sessions = new Set(out.hooks.map((h) => h.session));
  if (sessions.size !== SESSIONS) throw Error(`AC18 scenario: hooks came from ${sessions.size} sessions, not ${SESSIONS}`);

  // The hooks ran beside the load: answered before it was sent and still starting after it returned. In between
  // they start on their timetable whatever the hub does; where the load process itself fell behind it, the hooks
  // aren't judged (judgeReplies).
  const answeredBefore = out.hooks.filter((h) => h.end === 'reply' && h.replyAt !== null && h.replyAt <= load.sentAt).length;
  if (answeredBefore < WARM_HOOKS) throw Error(`AC18 scenario: only ${answeredBefore} hooks were answered before the load call was sent (wanted ${WARM_HOOKS})`);
  const lastStart = Math.max(...out.hooks.map((h) => h.connectAt ?? h.dueAt));
  if (!(lastStart > load.doneAt)) throw Error(`AC18 scenario: no hook started after the load call returned (at ${load.doneAt.toFixed(1)} ms; last hook at ${lastStart.toFixed(1)} ms)`);

  // Ten verdicts, appended while the load call ran, each in a synchronous=FULL commit.
  const preIds = new Set(s.pre.map((e) => e.id));
  const before = s.pre.filter((e) => e.kind === 'verdict.made');
  if (before.length) throw Error(`AC18 scenario: the log held verdict.made ${before.map((e) => e.id).join(', ')} before the load call was sent`);
  const verdicts = s.post.filter((e) => e.kind === 'verdict.made' && !preIds.has(e.id));
  if (verdicts.length !== VERDICTS) throw Error(`AC18 scenario: the load appended ${verdicts.length} verdict.made events, not ${VERDICTS}: ${verdicts.map((e) => e.id).join(', ')}`);
  const [from, to] = [out.wallOffset + load.sentAt - 1, out.wallOffset + load.doneAt + 1];
  for (const v of verdicts) {
    if (v.ts < from || v.ts > to) throw Error(`AC18 scenario: verdict.made ${v.id} has ts ${v.ts}, outside the load call (${Math.floor(from)} to ${Math.ceil(to)})`);
    const commit = s.points.find((p) => p.kind === 'commit' && Array.isArray(p.ids) && (p.ids as string[]).includes(v.id));
    if (!commit) throw Error(`AC18 scenario: no commit point of the test VFS wrote verdict.made ${v.id}`);
    if (commit.mode !== 'full') throw Error(`AC18 scenario: verdict.made ${v.id} was committed with mode ${String(commit.mode)}, not full (point ${String(commit.n)})`);
  }

  // The backfill's 50,000 events: appended after the log as it stood before the load, and none of them a hook's or a verdict.
  const preHead = s.pre.reduce((m, e) => Math.max(m, e.log_pos), 0);
  const hookIds = new Set([...out.starts, ...out.hooks.map((h) => h.id)]);
  const backfilled = s.post.filter((e) => e.log_pos > preHead && !hookIds.has(e.id) && e.kind !== 'verdict.made').length;
  if (backfilled < BACKFILL_EVENTS) throw Error(`AC18 scenario: the backfill of ${s.backfill.transcript} appended ${backfilled} events, fewer than ${BACKFILL_EVENTS}`);
}

interface Judgement {
  judged: HookTiming[]; disturbed: HookTiming[]; late: HookTiming[];
  overall: number; worstWindow: { p95: number; from: number; to: number }; slow50: HookTiming[]; unanswered: HookTiming[];
}
/**
 * The hooks to judge and their late replies. Hooks whose exchange overlaps a stall of the load process (a hook that
 * started more than LAG_MS after it was due, from its due time to 50 ms after it started) are set aside. Of the
 * rest, in connect order, a reply is late when the hook was never answered, when it took 50 ms or more, or when it
 * is over 2 ms in a run of WINDOW judged hooks (or all of them) whose p95 is 2 ms or more.
 */
function judgeReplies(hooks: readonly HookTiming[]): Judgement {
  const stalls: Array<[number, number]> = [];
  for (const [from, to] of hooks
    .filter((h) => h.connectAt !== null && h.connectAt - h.dueAt > LAG_MS)
    .map((h) => [h.dueAt, h.connectAt! + LATE_MS] as const)
    .sort((a, b) => a[0] - b[0])) {
    const last = stalls[stalls.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else stalls.push([from, to]);
  }
  const overlaps = (h: HookTiming) => {
    const a = h.connectAt ?? h.dueAt;
    const b = h.endAt;
    return stalls.some(([from, to]) => a <= to && b >= from);
  };
  const all = byConnect(hooks);
  const disturbed = all.filter(overlaps);
  const sorted = all.filter((h) => !overlaps(h));
  const rt = sorted.map(roundTrip);
  const n = sorted.length;
  const late = new Array<boolean>(n).fill(false);
  rt.forEach((t, i) => { if (t >= LATE_MS) late[i] = true; });
  const overall = p95(rt);
  if (overall >= P95_MS) rt.forEach((t, i) => { if (t >= P95_MS) late[i] = true; });
  // Every run of WINDOW judged hooks in a row; a failing one marks its hooks over 2 ms late.
  const span = Math.min(WINDOW, n);
  const mark = new Array<number>(n + 1).fill(0);
  let worstWindow = { p95: Number.NEGATIVE_INFINITY, from: 0, to: span - 1 };
  for (let start = 0; start + span <= n; start++) {
    const p = p95(rt.slice(start, start + span));
    if (p > worstWindow.p95) worstWindow = { p95: p, from: start, to: start + span - 1 };
    if (p >= P95_MS) { mark[start]!++; mark[start + span]!--; }
  }
  let inFailing = 0;
  for (let i = 0; i < n; i++) {
    inFailing += mark[i]!;
    if (inFailing > 0 && rt[i]! >= P95_MS) late[i] = true;
  }
  return {
    judged: sorted, disturbed,
    late: sorted.filter((_, i) => late[i]),
    overall,
    worstWindow,
    slow50: sorted.filter((_, i) => rt[i]! >= LATE_MS),
    unanswered: sorted.filter((h) => h.end !== 'reply'),
  };
}

/** Why the reading can't be judged, or undefined: the load process fell behind its own timetable around too many hooks. */
function inconclusive(j: Judgement): string | undefined {
  const total = j.judged.length + j.disturbed.length;
  if (j.disturbed.length <= total * DISTURBED_SHARE && j.judged.length >= HOOKS) return undefined;
  const worst = j.disturbed.reduce((m, h) => Math.max(m, (h.connectAt ?? h.dueAt) - h.dueAt), 0);
  return `the load process fell behind its timetable by more than ${LAG_MS} ms (up to ${worst.toFixed(1)} ms) around ${j.disturbed.length} of ${total} hooks, leaving ${j.judged.length} to judge`;
}

/**
 * The criterion's check: round trip under 2 ms at p95 (overall and in every window) and no reply taking 50 ms.
 * Throws naming the first late reply; otherwise returns why the reading is INCONCLUSIVE, or undefined: it passed.
 */
function checkHotPath(s: Scenario): string | undefined {
  const j = judgeReplies(s.out.hooks);
  const sentAt = s.out.load?.sentAt ?? 0;
  const ww = j.worstWindow;
  const summary = `${j.judged.length} hooks judged (${j.disturbed.length} set aside): p95 ${fmt(j.overall)} overall, worst p95 ${fmt(ww.p95)} over judged hooks ${ww.from} to ${ww.to}; ${j.slow50.length} replies of ${LATE_MS} ms or more, ${j.unanswered.length} never answered`;
  console.log(`AC18 ${summary}`);
  const first = j.late[0];
  if (first) {
    const how = first.end !== 'reply' ? `never answered (${first.end}${first.error ? ` ${JSON.stringify(first.error)}` : ''})` : `${fmt(roundTrip(first))} from connect to reply`;
    throw Error(`AC18 FAIL: the first late reply is to ${first.id} (session ${first.session}, started ${((first.connectAt ?? first.dueAt) - sentAt).toFixed(1)} ms after the load call was sent): ${how}; ${summary}`);
  }
  return inconclusive(j);
}

describe('AC18 #16.0edb254f with every sync held 50 ms, the hooks stay fast beside FULL commits, a checkpoint and a backfill (redraft)', () => {
  it('AC18 30 sessions send 1,000 PreToolUse hooks beside ten FULL verdicts, a WAL checkpoint and a 50,000-event backfill: round trip under 2 ms at p95, no reply 50 ms', async (ctx) => {
    const s = await scenario();
    checkScenario(s);
    const why = checkHotPath(s);
    if (why) ctx.skip(`INCONCLUSIVE ${why}`);
  }, 900_000);

  it('AC18 (wrong program) commit-on-event-loop: the same check fails, naming the first late reply', async (ctx) => {
    const s = await scenario('commit-on-event-loop');
    // The scenario itself must run on the plant: a plant that skips the load, or the hooks, fails this test.
    checkScenario(s);
    const j = judgeReplies(s.out.hooks);
    const first = j.late[0];
    const why = inconclusive(j);
    if (!first && why) ctx.skip(`INCONCLUSIVE ${why}`);
    expect(first, 'the planted hub had no late reply').toBeDefined();
    expect(roundTrip(first!)).toBeGreaterThanOrEqual(P95_MS);
    expect(() => checkHotPath(s)).toThrow(first!.id);
  }, 900_000);
});
