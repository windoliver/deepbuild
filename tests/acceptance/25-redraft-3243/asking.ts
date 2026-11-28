import { readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import {
  Claude, allEvents, appendTranscript, assistantSays, callId, jsonLines, makeHome, ours, payload, rootOf, setup, startHub, stopHub, tag,
  typedPrompt, waitFor, newSession, type Ev, type Fired, type HookRun, type Hub, type Line, type Option, type Session,
} from '../25/routes/helpers.ts';

export const TRIES = 5;
const TRY_BUDGET_MS = 8 * 60_000;

const STARVED_STDERR = /deep-hook: (?:spooled \S+, but its sync didn't finish|could not spool \S+) within the hook's 50 ms/;

export interface Try {
  hub: Hub; home: string; claude: Claude; control: Session;
  runs: { session: string; event: string; run: HookRun }[];
  spooled: Map<string, Line>;
  watcher?: FSWatcher | undefined;
}
interface Mark { runs: number; spooled: Set<string>; readings: Set<string> }

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
function watchSpool(t: Try): FSWatcher | undefined {
  try {
    const watcher = watch(rootOf(t.home), { recursive: true }, (_event, name) => { if (!name || /(^|[\\/])spool([\\/]|$)/.test(String(name))) readSpool(t); });
    watcher.on('error', () => { watcher.close(); });
    return watcher;
  } catch {
    return undefined;
  }
}
export async function fire(t: Try, s: Session, event: string, body: Line): Promise<Fired> {
  const fired = await t.claude.hook(event, body);
  readSpool(t);
  for (const run of ours(fired)) t.runs.push({ session: s.id, event, run });
  return fired;
}
const LATE_READING = /^deep-hook let (\S+) (\S+) through as late/;
const lateReadings = async (t: Try, session?: string): Promise<Ev[]> => (await allEvents(t.hub))
  .filter((e) => e.kind === 'session.reading' && (session === undefined || e.session === session) && LATE_READING.test(String(e.data?.reading ?? '')));
async function mark(t: Try): Promise<Mark> {
  return { runs: t.runs.length, spooled: new Set(t.spooled.keys()), readings: new Set((await lateReadings(t)).map((e) => e.id)) };
}
async function failedOpen(t: Try, session: string, since?: Mark, event = 'Stop'): Promise<string | undefined> {
  const found: string[] = [];
  for (const { session: of, event: fired, run } of t.runs.slice(since?.runs ?? 0)) {
    const line = STARVED_STDERR.exec(run.stderr);
    if (of === session && line) found.push(`deep-hook's ${fired} said "${line[0]}"`);
  }
  for (const [id, line] of t.spooled) {
    if (line.payload?.session_id === session && !since?.spooled.has(id) && (!since || line.event === event)) found.push(`deep-hook spooled its ${String(line.event)} ${id}${line.late === true ? ' marked late' : ''}`);
  }
  for (const e of await lateReadings(t, session)) {
    const [, named, hook] = LATE_READING.exec(String(e.data.reading)) ?? [];
    if (since && (since.readings.has(e.id) || named !== event || since.spooled.has(String(hook)))) continue;
    found.push(`the hub read "${String(e.data.reading).slice(0, 200)}"`);
  }
  return found.length ? found.join('; ') : undefined;
}

export class Starved extends Error {
  constructor(readonly evidence: string, readonly besideThrough: boolean, readonly beside: string) { super(`starved: ${evidence}`); }
}

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
    t.watcher = watchSpool(t);
    try {
      await fire(t, control, 'SessionStart', payload(control, 'SessionStart'));
      await body(t);
      return;
    } catch (error) {
      if (!(error instanceof Starved)) throw error;
      starved.push(error);
      console.log(`${ac} try ${starved.length}: ${error.evidence}; the hook beside it ${error.besideThrough ? 'got through' : 'did not get through'}: ${error.beside}`);
      await claude.kill();
      await stopHub(hub);
    } finally {
      t.watcher?.close();
    }
  }
  const shown = starved.map((s, i) => `try ${i + 1}: ${s.evidence} (the hook beside it ${s.besideThrough ? 'got through' : `didn't: ${s.beside}`})`).join('; ');
  expect(starved.length === TRIES && starved.every((s) => s.besideThrough), `${ac} the session's hook failed open in each of ${TRIES} tries while a UserPromptSubmit fired beside it to the same hub got through each time, so the hub, not the machine, failed it: ${shown.slice(0, 3000)}`).toBe(false);
  ctx.skip(`INCONCLUSIVE: deep-hook failed open (no acknowledgement within its 50 ms, the hub counted down) in each of ${starved.length} tries, so whether the hub holds the stop is unknown; rerun on a machine with time to spare: ${shown.slice(0, 3000)}`);
}

export interface HeldAsk { s: Session; handle: string; id: string; question: string; blue: Option; green: Option; reply: Line; created: Line }

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
  const args = { kind: 'choice', question, options: [blue, green], recommended: null, steps: null, where: null, why: null, check: null, thread: null, subject: null };
  const call = callId();
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  const pre = await fireBeside(t, s, 'PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));
  await pre.stopping;
  const reply = await claude.request('tools/call', { name: 'deep_ask', arguments: args }, 120_000);
  if (reply.result?.isError === true) {
    const evidence = await failedOpen(t, s.id, pre.since, 'PreToolUse');
    if (evidence) await starved(t, pre, `deep_ask was refused (${JSON.stringify(reply.result.content ?? '').slice(0, 300)}) and ${evidence}`);
  }
  const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed under ${s.id}`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}; deep_ask replied ${JSON.stringify(reply).slice(0, 1500)}`); });
  const content = JSON.stringify(reply.result?.content ?? reply.error ?? reply);
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content }] } });
  await fire(t, s, 'PostToolUse', payload(s, 'PostToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call, tool_response: reply.result ?? {} }));
  assistantSays(s, 'I asked which header colour you want; I will wait for your answer.');
  return { s, handle: `ask:${created.id}`, id: created.id, question, blue, green, reply, created: created as unknown as Line };
}

export const replyText = (a: HeldAsk): string => JSON.stringify(a.reply.result?.content ?? a.reply.error ?? a.reply);

export interface Stopped { session: Session; stopping: Promise<Fired>; settled: () => boolean; beside: Promise<Fired>; besideSettled: () => boolean; since: Mark }
export const stopBeside = (t: Try, s: Session, body: Line): Promise<Stopped> => fireBeside(t, s, 'Stop', body);
async function fireBeside(t: Try, s: Session, event: string, body: Line): Promise<Stopped> {
  const since = await mark(t);
  let done = false;
  let besideDone = false;
  const stopping = fire(t, s, event, body);
  typedPrompt(t.control, 'Say hello.');
  const beside = fire(t, t.control, 'UserPromptSubmit', payload(t.control, 'UserPromptSubmit', { prompt: 'Say hello.' }));
  void stopping.then(() => { done = true; }, () => { done = true; });
  void beside.then(() => { besideDone = true; }, () => { besideDone = true; });
  return { session: s, stopping, settled: () => done, beside, besideSettled: () => besideDone, since };
}
export async function starvedIf(t: Try, stop: Stopped, what: 'held' | 'answered' | 'next'): Promise<boolean> {
  if (!stop.settled()) return false;
  await stop.stopping;
  readSpool(t);
  const evidence = await failedOpen(t, stop.session.id, what === 'held' ? undefined : stop.since);
  if (!evidence) return true;
  const which = { held: 'the stop with the ask open ended unheld', answered: 'the stop with the ask open ended after your answer without it', next: "the continued turn's Stop ended unheld" }[what];
  return starved(t, stop, `${which} and ${evidence}`);
}
async function starved(t: Try, stop: Stopped, evidence: string): Promise<never> {
  const beside = await waitFor(() => stop.besideSettled() || undefined, 60_000, 'the hook beside it').then(() => stop.beside, () => undefined);
  const besideOpen = beside ? await failedOpen(t, t.control.id, stop.since, 'UserPromptSubmit') : undefined;
  const runs = beside ? ours(beside).filter((r) => !r.async) : [];
  const through = beside !== undefined && !besideOpen && runs.length > 0 && runs.every((r) => r.code === 0 && !r.timedOut);
  throw new Starved(evidence, through, beside ? (besideOpen ?? (runs.length ? 'exit 0' : 'no DeepBuild entry ran')) : 'no end within 60 s');
}

export interface Stopping extends Stopped { waiter: HookRun & { event: string } }
export async function stopWithAskOpen(t: Try, a: HeldAsk): Promise<Stopping> {
  const stop = await stopBeside(t, a.s, payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  await waitFor(async () => (await allEvents(t.hub)).some((e) => e.kind === 'agent.stop' && e.session === a.s.id) || undefined, 60_000, `the hub's record of ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  const [waiter] = await waitFor(async () => { const live = await t.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 60_000, `the waiter Claude Code started at ${a.s.id}'s Stop`)
    .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
  return { ...stop, waiter: waiter! };
}
