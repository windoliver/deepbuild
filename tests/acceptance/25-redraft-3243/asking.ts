// A session that asks you a question its stop waits on, and stops (README: The ask). The agent calls `deep_ask` with
// a choice between two options and no recommended option: the design gives only "a taste call or a choice with a
// recommendation" work that goes on at once, and "a taste call or choice that isn't provisional leaves the agent
// waiting on you", so this question holds the session's stop until you answer. Everything is reached through the
// infrastructure of tests/acceptance/25/routes/helpers.ts: the Claude Code stand-in running deep-hook and `deep mcp`
// from the settings `deep setup` wrote, and the hub's record over its socket.
//
// A starved machine (README: A starved machine): "A hub that takes a request and doesn't acknowledge it within 50 ms
// of the hook's start counts as down for that call", and deep-hook then fails open. A Stop let through that way says
// nothing of the hold, so a try where deep-hook shows it failed open is no verdict: it is made again with a fresh home
// and hub, and after TRIES such tries the test reads INCONCLUSIVE, unless a Stop fired beside each of the TRIES to the
// same hub got through every time, which makes the fail-open the hub's: then it fails.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import {
  Claude, allEvents, appendTranscript, assistantSays, callId, jsonLines, makeHome, ours, payload, rootOf, setup, startHub, stopHub, tag,
  typedPrompt, waitFor, newSession, type Ev, type Fired, type HookRun, type Hub, type Line, type Option, type Session,
} from '../25/routes/helpers.ts';

/** Tries a starved machine gets before the test reads INCONCLUSIVE, and the time after which no new try starts. */
export const TRIES = 5;
const TRY_BUDGET_MS = 8 * 60_000;

/**
 * deep-hook's own words when it acted as with the hub down and even its spool ran out of the hook's 50 ms
 * (crates/deep-hook/src/main.rs, spool_by): the machine didn't give the hook its time. "could not spool <id>: <error>"
 * is a broken spool, not a starved hook, and isn't counted.
 */
const STARVED_STDERR = /deep-hook: (?:spooled \S+, but its sync didn't finish|could not spool \S+) within the hook's 50 ms/;

/** One try: a fresh home, hub and Claude Code, every hook fired for its sessions, and the lines of deep-hook's spool seen. */
export interface Try {
  hub: Hub; home: string; claude: Claude; control: Session;
  runs: { session: string; event: string; run: HookRun }[];
  /** The spool's lines, by ID: deep-hook spools a hook only when it let it through as with the hub down. */
  spooled: Map<string, Line>;
}
/** A point in a try: what deep-hook had shown so far, so a later Stop's own fail-open is told from an earlier hook's. */
interface Mark { runs: number; spooled: Set<string>; readings: Set<string> }

/**
 * The spool's lines, read as soon as a hook returns: the hub replays and removes them every 2 s. deep-hook spools a
 * hook only on its way through with the hub counted down (main.rs: after `exchange` gave no reply, and the watchdog's
 * let-through at 50 ms); one marked `"late":true` reached the hub and had no acknowledgement in time.
 */
function readSpool(t: Try): void {
  const dir = join(rootOf(t.home), 'spool');
  let names: string[] = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return; }
  for (const name of names) {
    let text = '';
    try { text = readFileSync(join(dir, name), 'utf8'); } catch { continue; }
    for (const line of jsonLines(text)) if (typeof line.id === 'string') t.spooled.set(line.id, line);
  }
}
/** Fires one hook for a session of the try, keeping its runs and the spool's lines. */
export async function fire(t: Try, s: Session, event: string, body: Line): Promise<Fired> {
  const fired = await t.claude.hook(event, body);
  readSpool(t);
  for (const run of ours(fired)) t.runs.push({ session: s.id, event, run });
  return fired;
}
const lateReadings = async (t: Try, session: string): Promise<Ev[]> => (await allEvents(t.hub))
  .filter((e) => e.kind === 'session.reading' && e.session === session && /^deep-hook let \S+ \S+ through as late/.test(String(e.data?.reading ?? '')));
async function mark(t: Try, session: string): Promise<Mark> {
  return { runs: t.runs.length, spooled: new Set(t.spooled.keys()), readings: new Set((await lateReadings(t, session)).map((e) => e.id)) };
}
/**
 * deep-hook's own evidence that it failed open for one of the session's hooks after `since` (every one of the try's
 * when `since` is undefined): its stderr saying the spool ran out of the hook's 50 ms, the hook's line in the spool, or
 * the hub's reading that deep-hook let the hook through as late. Undefined when there is none.
 */
async function failedOpen(t: Try, session: string, since?: Mark): Promise<string | undefined> {
  const found: string[] = [];
  for (const { session: of, event, run } of t.runs.slice(since?.runs ?? 0)) {
    const line = STARVED_STDERR.exec(run.stderr);
    if (of === session && line) found.push(`deep-hook's ${event} said "${line[0]}"`);
  }
  for (const [id, line] of t.spooled) {
    if (line.payload?.session_id === session && !since?.spooled.has(id)) found.push(`deep-hook spooled its ${String(line.event)} ${id}${line.late === true ? ' marked late' : ''}`);
  }
  for (const e of await lateReadings(t, session)) if (!since?.readings.has(e.id)) found.push(`the hub read "${String(e.data.reading).slice(0, 200)}"`);
  return found.length ? found.join('; ') : undefined;
}

/** A try the machine starved: no verdict. Says whether the Stop fired beside it got through, and how it went. */
export class Starved extends Error {
  constructor(readonly evidence: string, readonly besideThrough: boolean, readonly beside: string) { super(`starved: ${evidence}`); }
}

/**
 * Runs `body` in fresh tries until one isn't starved (its verdict is the test's), or reads INCONCLUSIVE after TRIES
 * starved ones (or TRY_BUDGET_MS), or fails when the Stop beside each starved one got through every time.
 */
export async function untilFed(ctx: TestContext, ac: string, body: (t: Try) => Promise<void>): Promise<void> {
  const starved: Starved[] = [];
  const until = Date.now() + TRY_BUDGET_MS; // deadline: no try starts past the budget, so the file stays inside its timeout
  while (starved.length < TRIES && Date.now() < until) { // deadline: bounds the tries by time as by count
    const { home } = makeHome();
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);
    const claude = Claude.start(home);
    const control = newSession(home);
    const t: Try = { hub, home, claude, control, runs: [], spooled: new Map() };
    try {
      await fire(t, control, 'SessionStart', payload(control, 'SessionStart'));
      await body(t);
      return;
    } catch (error) {
      if (!(error instanceof Starved)) throw error;
      starved.push(error);
      console.log(`${ac} try ${starved.length}: ${error.evidence}; the Stop beside it ${error.besideThrough ? 'got through' : 'did not get through'}: ${error.beside}`);
      await claude.kill();
      await stopHub(hub);
    }
  }
  const shown = starved.map((s, i) => `try ${i + 1}: ${s.evidence} (the Stop beside it ${s.besideThrough ? 'got through' : `didn't: ${s.beside}`})`).join('; ');
  expect(starved.length === TRIES && starved.every((s) => s.besideThrough), `${ac} the session's hook failed open in each of ${TRIES} tries while a Stop fired beside it to the same hub got through each time, so the hub, not the machine, didn't acknowledge it within 50 ms: ${shown.slice(0, 3000)}`).toBe(false);
  ctx.skip(`INCONCLUSIVE: deep-hook failed open (no acknowledgement within its 50 ms, the hub counted down) in each of ${starved.length} tries, so whether the hub holds the stop is unknown; rerun on a machine with time to spare: ${shown.slice(0, 3000)}`);
}

export interface HeldAsk { s: Session; handle: string; id: string; question: string; blue: Option; green: Option; reply: Line; created: Line }

/** Up to the agent's last words after its deep_ask call: the ask is open and the session is about to stop. */
export async function heldAsk(t: Try): Promise<HeldAsk> {
  const { hub, home, claude } = t;
  const s = newSession(home);
  await fire(t, s, 'SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Ask me which header colour to use, then stop.');
  await fire(t, s, 'UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Ask me which header colour to use, then stop.' }));
  await claude.initialize();
  const n = tag(4);
  const blue = { id: `blue${n}`, label: `Blue header ${n}` };
  const green = { id: `green${n}`, label: `Green header ${n}` };
  const question = `Which header colour do you want for ${n}?`;
  // Every field of the tool's strict schema, the ones a choice doesn't use null; no recommended option.
  const args = { kind: 'choice', question, options: [blue, green], recommended: null, steps: null, where: null, why: null, check: null, thread: null, subject: null };
  const call = callId();
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  await fire(t, s, 'PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));
  const reply = await claude.request('tools/call', { name: 'deep_ask', arguments: args }, 120_000);
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(reply).slice(0, 1500)}`); });
  const content = JSON.stringify(reply.result?.content ?? reply.error ?? reply);
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content }] } });
  await fire(t, s, 'PostToolUse', payload(s, 'PostToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
  assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
  return { s, handle: `ask:${created.id}`, id: created.id, question, blue, green, reply, created: created as unknown as Line };
}

/** What deep_ask told the agent: its reply's text, where it gave one. */
export const replyText = (a: HeldAsk): string => JSON.stringify(a.reply.result?.content ?? a.reply.error ?? a.reply);

/** A Stop under way, the try's control session's Stop fired beside it to the same hub at the same time. */
export interface Stopped { session: Session; stopping: Promise<Fired>; settled: () => boolean; beside: Promise<Fired>; besideSettled: () => boolean; since: Mark }
export async function stopBeside(t: Try, s: Session, body: Line): Promise<Stopped> {
  const since = await mark(t, s.id);
  let done = false;
  let besideDone = false;
  const stopping = fire(t, s, 'Stop', body);
  const beside = fire(t, t.control, 'Stop', payload(t.control, 'Stop'));
  void stopping.then(() => { done = true; }, () => { done = true; });
  void beside.then(() => { besideDone = true; }, () => { besideDone = true; });
  return { session: s, stopping, settled: () => done, beside, besideSettled: () => besideDone, since };
}
/**
 * Throws Starved when the Stop ended and deep-hook shows it failed open: for `what` 'held', any of the session's hooks
 * in the try (one let through unseen may leave the hub nothing to hold); otherwise only this Stop's. A Stop that ended
 * without that evidence returns, and its test's assertion judges it.
 */
export async function starvedIf(t: Try, stop: Stopped, what: 'held' | 'next'): Promise<void> {
  if (!stop.settled()) return;
  await stop.stopping;
  const evidence = await failedOpen(t, stop.session.id, what === 'held' ? undefined : stop.since);
  if (!evidence) return;
  const beside = await waitFor(() => stop.besideSettled() || undefined, 60_000, 'the Stop beside it').then(() => stop.beside, () => undefined);
  const besideOpen = beside ? await failedOpen(t, t.control.id, stop.since) : undefined;
  const through = beside !== undefined && !besideOpen && ours(beside).filter((r) => !r.async).every((r) => r.code === 0 && !r.timedOut);
  throw new Starved(`${what === 'held' ? 'the stop with the ask open' : "the continued turn's Stop"} ended unheld and ${evidence}`, through, beside ? (besideOpen ?? 'exit 0') : 'no end within 60 s');
}

export interface Stopping extends Stopped { waiter: HookRun & { event: string } }
/**
 * The session stops with its ask open. Returns once the hub has the Stop on its record and the waiter Claude Code
 * started at that Stop is running: the two events that show the Stop hook is out and the hub is holding it.
 */
export async function stopWithAskOpen(t: Try, a: HeldAsk): Promise<Stopping> {
  const stop = await stopBeside(t, a.s, payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  await waitFor(async () => (await allEvents(t.hub)).some((e) => e.kind === 'agent.stop' && e.session === a.s.id) || undefined, 60_000, `the hub's record of ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  const [waiter] = await waitFor(async () => { const live = await t.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 60_000, `the waiter Claude Code started at ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  return { ...stop, waiter: waiter! };
}
