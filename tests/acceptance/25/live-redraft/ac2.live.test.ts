// #25 AC2, live, redrafted blind (README): an idle interactive Claude Code session, run by the agent test harness (#48)
// in a pseudo-terminal and never with `claude -p`, wakes on each answer, carrying it, within 2 s of the record's
// ask.answered at p95. The live tests spend plan usage, so they run only by hand:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/25/live-redraft
// Without the opt-in, the token, a `claude` on PATH or the harness's deep-answer scenario they fail BLOCKED; nothing
// skips. The runs, the answers and the harness surface are ../live's (its README, The live sessions and Additions).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, cleanup, environmentProblem, judge, jsonLines, load, msOf, percentile, REPO, type Ev, type Line } from '../live/helpers.ts';
import { iso, live, type Answered, type Live, type LiveSession } from '../live/live.ts';

afterAll(cleanup, 60_000);

const MINUTE = 60_000;
const ROUNDS = 6; // round 1 warms up; rounds 2 to 6 are the five judged runs
const LIMIT_MS = 2000;
/** How far before the record's ask.answered a wake may be stamped and still be read as this answer's (two clocks, one Mac). */
const SKEW_MS = 1000;

// ---- Reading what Claude Code shows, so that nothing unreadable becomes a number.

/** A time in epoch ms, or undefined: a missing, empty or unparseable stamp is never NaN and never a reading. */
const timeOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const textOf = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));
/**
 * Whether text carries this answer: it holds one of the answer's IDs, or the chosen option's label without the other's.
 * A text naming both labels is the ask prompt the harness typed, or a quote of it, never the answer.
 */
export function carriesAnswer(v: unknown, a: Answered): boolean {
  const t = textOf(v);
  if (a.ids.some((id) => id.length >= 6 && t.includes(id))) return true;
  return a.chosen.length > 0 && t.includes(a.chosen) && !(a.other.length > 0 && t.includes(a.other));
}

/** What the harness typed into a session: the texts, the prompt IDs Claude Code gave them, and when each was typed. */
function typedOf(s: LiveSession): { texts: Set<string>; promptIds: Set<string>; times: number[] } {
  const texts = new Set(s.typed.map((t) => String(t.text ?? '').trim()).filter(Boolean));
  const promptIds = new Set<string>();
  const times = s.typed.flatMap((t) => { const at = timeOf(t.at); return at === undefined ? [] : [at]; });
  for (const e of s.entries) {
    if (e.type !== 'user' || !(e.promptSource === 'typed' || e.origin?.kind === 'human')) continue;
    if (typeof e.promptId === 'string') promptIds.add(e.promptId);
    if (typeof e.message?.content === 'string') texts.add(e.message.content.trim());
    const at = timeOf(e.timestamp);
    if (at !== undefined) times.push(at);
  }
  return { texts, promptIds, times };
}
const isTypedPrompt = (p: Line, typed: ReturnType<typeof typedOf>) =>
  typed.texts.has(String(p.prompt ?? '').trim()) || (typeof p.prompt_id === 'string' && typed.promptIds.has(p.prompt_id));

/**
 * A transcript entry that starts a turn nobody typed, the wake reaching the session: the prompt Claude Code queued for
 * it (`queue-operation` enqueue) or the prompt itself (a `user` entry), never a prompt the harness typed, a tool's
 * result or a subagent's entry. Output Claude Code merely shows without starting a turn is not a wake.
 */
function wakeShaped(e: Line, typed: ReturnType<typeof typedOf>): boolean {
  if (e.isSidechain === true) return false;
  if (e.type === 'queue-operation') return e.operation === 'enqueue' && !typed.texts.has(String(e.content ?? '').trim());
  if (e.type !== 'user') return false;
  const content = e.message?.content;
  if (Array.isArray(content) && content.some((c: Line) => c?.type === 'tool_result')) return false;
  return !(e.promptSource === 'typed' || e.origin?.kind === 'human' || (typeof content === 'string' && typed.texts.has(content.trim())));
}

export interface WakeReading {
  /** When Claude Code first showed the wake: the earliest readable stamp in the window, or undefined. */
  at?: number | undefined;
  from?: string | undefined;
  /** Pieces of the wake Claude Code showed in the window, with a readable time. */
  timed: number;
  /** Pieces carrying the answer whose time can't be read: they prove a wake, never a time. */
  untimed: number;
}
/**
 * The wake that carried answer `a` into session `s`, read from Claude Code's side: a UserPromptSubmit the harness didn't
 * type (#80: the waiter's stderr as a task-notification), as the harness's hook stamped it, and the transcript entries
 * Claude Code wrote for it (the queued task-notification and its prompt) with their own timestamps. Only what
 * is stamped from `a.at` less the skew up to `until` (the next prompt the harness typed) counts: past it, the answer
 * could have come with that prompt instead.
 */
export function readWake(s: LiveSession, a: Answered, until = Infinity): WakeReading {
  const typed = typedOf(s);
  const from = a.at - SKEW_MS;
  const found: { at: number; from: string }[] = [];
  let untimed = 0;
  const place = (at: number | undefined, what: string) => {
    if (at === undefined) untimed++;
    else if (at >= from && at < until) found.push({ at, from: what });
  };
  for (const p of s.hooks) {
    if (p.hook_event_name === 'UserPromptSubmit' && !isTypedPrompt(p, typed) && carriesAnswer(p.prompt, a)) place(timeOf(p.at), 'its UserPromptSubmit hook');
  }
  for (const e of s.entries) {
    if (wakeShaped(e, typed) && carriesAnswer(e, a)) place(timeOf(e.timestamp), `its transcript's ${String(e.type)}${e.operation ? ` ${String(e.operation)}` : ''} entry`);
  }
  found.sort((x, y) => x.at - y.at);
  return { at: found[0]?.at, from: found[0]?.from, timed: found.length, untimed };
}

/** The record's time for your answer: its ask.answered event, or undefined when the record holds none with a readable time. */
function answeredAt(events: Ev[], a: Answered): number | undefined {
  const ev = events.find((e) => e.kind === 'ask.answered' && (e.subject === a.handle || JSON.stringify(e.data ?? {}).includes(a.id)));
  return ev && typeof ev.ts === 'number' ? timeOf(msOf(ev.ts)) : undefined;
}

/** AC2's check of one live run: each answer wakes the idle session, carrying it, and the agent replies with it; each round's delay. */
export function wakeProblems(r: Live, rounds: number): { problems: string[]; delays: (number | undefined)[] } {
  const s = r.sessions.find((x) => x.name === 'A');
  if (!s) throw Error(`BLOCKED: the run line names no session A: ${r.sessions.map((x) => x.name).join(', ')}`);
  const problems: string[] = r.line.verdict === 'PASS' ? [] : [`${AC2} the harness's idle-wake run ended ${r.line.verdict}: ${r.line.reason}`];
  const delays: (number | undefined)[] = [];
  if (r.answers.length < rounds) problems.push(`${AC2} only ${r.answers.length} of ${rounds} rounds reached an idle session to answer`);
  const typedTimes = typedOf(s).times;
  for (const given of r.answers) {
    const at = answeredAt(r.events, given);
    if (at === undefined) {
      problems.push(`${AC2} round ${given.round}: the record holds no ask.answered with a readable time for ${given.handle}, so its wake can't be timed`);
      delays.push(undefined);
      continue;
    }
    const a = { ...given, at };
    const until = Math.min(Infinity, ...typedTimes.filter((t) => t > at));
    const wake = readWake(s, a, until);
    const window = `between your answer at ${iso(at)} and ${Number.isFinite(until) ? `the next prompt the harness typed at ${iso(until)}` : 'the end of the run'}`;
    if (!wake.timed && !wake.untimed) problems.push(`${AC2} round ${a.round}: idle session ${s.sessionId} didn't wake on your answer to ${a.handle}: nothing ${window} that it didn't type carries the answer`);
    else if (wake.at === undefined) problems.push(`${AC2} round ${a.round}: ${s.sessionId} shows a wake carrying ${a.handle}, but no time can be read for it ${window} (${wake.untimed} piece(s) without a timestamp), so it can't count`);
    const reply = s.hooks.find((p) => {
      const t = timeOf(p.at);
      return p.hook_event_name === 'Stop' && t !== undefined && t > (wake.at ?? at) && t < until;
    });
    const said = String(reply?.last_assistant_message ?? '');
    if (wake.at !== undefined && !(said.includes(a.chosen) && !said.includes(a.other))) {
      problems.push(`${AC2} round ${a.round}: ${s.sessionId} woke at ${iso(wake.at)} but its reply ${JSON.stringify(said.slice(0, 300))} isn't your answer to ${a.handle}, ${a.chosen}`);
    }
    delays.push(wake.at === undefined ? undefined : wake.at - at);
  }
  return { problems, delays };
}

/** One live run with the machine's load read every 15 s through it, and before and after it. */
async function liveWithLoad(o: Parameters<typeof live>[1]): Promise<{ r: Live; loads: { one: number; cores: number }[] }> {
  const loads = [await load()];
  const timer = setInterval(() => { void load().then((l) => loads.push(l)); }, 15_000);
  try {
    const r = await live('idle-wake', o);
    loads.push(await load());
    return { r, loads };
  } finally {
    clearInterval(timer);
  }
}

describe(`${AC2} An idle session wakes within 2 s of an answer at p95 (live, redraft)`, () => {
  it(`${AC2} (live) in ${ROUNDS} rounds an idle session wakes on each answer, carrying it, and replies with it; on the reference Mac rounds 2 to ${ROUNDS} wake within 2 s of the record's ask.answered at p95`, async (ctx) => {
    const { r, loads } = await liveWithLoad({ rounds: ROUNDS, timeoutMs: 30 * MINUTE });
    const { problems, delays } = wakeProblems(r, ROUNDS);
    expect(problems).toEqual([]);
    const judged = delays.slice(1);
    if (judged.length !== ROUNDS - 1 || judged.some((d) => d === undefined || !Number.isFinite(d))) {
      throw Error(`${AC2} the judged rounds must each have a readable delay: ${JSON.stringify(delays)}`);
    }
    const runs = judged as number[];
    const p95 = percentile(runs, 95);
    const verdict = judge(`${AC2} answer (ask.answered) to wake of an idle interactive session, rounds 2 to ${ROUNDS}, p95 ${p95.toFixed(0)} ms`, runs, LIMIT_MS, 'ms', false);
    console.log(`${verdict.verdict} ${verdict.text}; round 1 (warm-up) ${delays[0]?.toFixed(0)} ms`);
    const machine = environmentProblem(loads);
    if (machine) ctx.skip(`INCONCLUSIVE (reading only: ${machine}): ${verdict.text}`);
    expect(verdict.verdict, verdict.text).not.toBe('FAIL');
    if (verdict.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${verdict.text}`);
    expect(p95).toBeLessThanOrEqual(LIMIT_MS);
  }, 45 * MINUTE);

  it(`${AC2} (live, wrong program) a waiter that exits without waking the session when its answer comes (waiter-never-wakes) fails the check, naming the ask`, async () => {
    const { r } = await liveWithLoad({ rounds: 1, plant: 'waiter-never-wakes', timeoutMs: 5 * MINUTE });
    const a = r.answers[0];
    if (!a) throw Error('INCONCLUSIVE: the waiter-never-wakes run never reached an idle session to answer');
    const { problems } = wakeProblems(r, 1);
    expect(problems.find((p) => p.includes(a.handle) && p.includes("didn't wake")), `the check must fail on waiter-never-wakes, naming ${a.handle}: ${problems.join('\n')}`).toBeDefined();
  }, 15 * MINUTE);
});

describe(`${AC2} the wake reader on a recorded Claude Code transcript (instrument, any machine)`, () => {
  // adapters/corpus/claude-code/2.1.304/child-gates: a session that went idle and was woken at 23:15:22.205Z by a
  // task-notification (queued, then its prompt at .218Z). Its hook payloads carry no `at`. The answer stands in as
  // option label `from-child`, the other option `corpus-task`; you "answered" at 23:15:10.000Z.
  const dir = join(REPO, 'adapters/corpus/claude-code/2.1.304/child-gates');
  const entries = jsonLines(readFileSync(join(dir, 'transcript.jsonl'), 'utf8'));
  const hooks = jsonLines(readFileSync(join(dir, 'events.jsonl'), 'utf8')).map((l) => l.payload as Line);
  const typed = entries.filter((e) => e.type === 'user' && e.promptSource === 'typed').map((e) => ({ at: Date.parse(e.timestamp), text: String(e.message.content) }));
  const answer: Answered = { round: 1, handle: 'ask:corpus', id: 'not-in-this-corpus-0001', chosen: 'from-child', other: 'corpus-task', at: Date.parse('2026-10-20T23:15:10.000Z'), ids: ['not-in-this-corpus-0001'] };
  const session = (edit: (e: Line) => Line | Line[] = (e) => e): LiveSession => ({ name: 'A', sessionId: 'corpus', transcript: '', hooks, typed, entries: entries.flatMap((e) => edit({ ...e })) });
  const isWake = (e: Line) => (e.type === 'queue-operation' && e.operation === 'enqueue') || (e.type === 'user' && e.origin?.kind === 'task-notification');

  it(`${AC2} (instrument) reads the wake's time from Claude Code's own stamps, skipping pieces without one, and never yields NaN or a time for an unreadable wake`, () => {
    // As recorded: the queued task-notification is the first stamp.
    expect(readWake(session(), answer).at! - answer.at).toBe(12_205);
    // The queue entry without a timestamp: the prompt's own stamp is read instead, not NaN.
    const noQueueStamp = readWake(session((e) => (e.type === 'queue-operation' && e.operation === 'enqueue' ? { ...e, timestamp: undefined } : e)), answer);
    expect(noQueueStamp.at! - answer.at).toBe(12_218);
    // No stamp anywhere on the wake (and the hooks have none): a wake is seen, with no time at all.
    const none = readWake(session((e) => (isWake(e) ? { ...e, timestamp: 'not a time' } : e)), answer);
    expect(none.at).toBeUndefined();
    expect(none.timed).toBe(0);
    expect(none.untimed).toBeGreaterThan(0);
  });

  it(`${AC2} (instrument) a quote of the ask prompt naming both option labels is never read as the wake`, () => {
    const quote = { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-20T23:15:15.000Z', content: 'Reply with only from-child or corpus-task' };
    const planted = session((e) => (e.type === 'queue-operation' && e.timestamp === '2026-10-20T23:15:22.205Z' ? [quote, e] : e));
    expect(readWake(planted, answer).at! - answer.at).toBe(12_205);
  });
});
