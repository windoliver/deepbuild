// The live route tests' side (README: The live sessions): real interactive Claude Code sessions run by the agent test
// harness (#48) in a pseudo-terminal, never `claude -p`, with DeepBuild's entries as `deep setup` wrote them into the
// temporary home's user settings, a real hub, and your answers given with `deep inbox answer`. The harness runs the
// sessions; this file gives the answers at the route's moment, read off the hub's record and the session's live
// transcript, and then reads what reached the session from Claude Code's side: its hook payloads, as the harness's own
// hooks recorded them, and its transcript.

import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  childEnv, control, CURRENT, deep, eventsAfter, jsonLines, makeHome, msOf, NODE, parseObject, processTable, readLines, readSettings, REPO, run,
  setup, shellWords, shown, sleep, startHub, treeOf, waiterEntry, type Conn, type Ev, type Home, type Hub, type Line, type Ran,
} from './helpers.ts';

const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export type Route = 'stop-hold' | 'idle-wake' | 'next-prompt' | 'resume';

/** The real `claude` for a live run, or BLOCKED naming what's missing. Nothing skips. */
export function requireLive(): string {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: live tests start real Claude Code sessions on your plan; run them by hand with DEEP_HARNESS_LIVE=1');
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Error('BLOCKED: the live sessions run under a temporary HOME and sign in with CLAUDE_CODE_OAUTH_TOKEN (make one with `claude setup-token`)');
  const which = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  const claude = which.stdout.trim();
  if (which.status !== 0 || !claude) throw Error('BLOCKED: no claude on PATH');
  return claude;
}

export interface Typed { at: number; text: string }
export interface LiveSession { name: string; sessionId: string; transcript: string; hooks: Line[]; typed: Typed[]; entries: Line[] }
export interface Answered { round: number; handle: string; id: string; chosen: string; other: string; at: number; ids: string[] }
export interface Live { line: Line; hub: Hub; h: Home; sessions: LiveSession[]; answers: Answered[]; killed: number[]; events: Ev[] }

/** The live transcript Claude Code is writing for a session in `work` (facts: transcripts.path). */
const transcriptOf = (h: Home, work: string, session: string) => join(h.home, '.claude/projects', work.replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);

/** The record and the session as they stand, for the driver's waits; every wait gives up once the harness has exited. */
class Watch {
  events: Ev[] = [];
  exited = false;
  constructor(private readonly conn: Conn, readonly h: Home, readonly work: string) {}
  async read(): Promise<Ev[]> {
    this.events.push(...(await eventsAfter(this.conn, this.events.at(-1)?.log_pos ?? 0)));
    return this.events;
  }
  async until<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, what: string, timeoutMs = 600_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await probe();
      if (value !== undefined && value !== false) return value;
      if (this.exited) throw Error(`the harness exited while this test waited for ${what}`);
      if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
      await sleep(250);
    }
  }
  sessions = async () => (await this.read()).filter((e) => e.kind === 'session.start').map((e) => e.session!).filter((s, i, all) => all.indexOf(s) === i);
  ask = (session: string, round?: number) => this.until(async () => (await this.read()).find((e) => e.kind === 'ask.created' && e.session === session && (round === undefined || JSON.stringify(e.data).includes(`round ${round}`))), `the deep_ask of ${session}${round ? ` in round ${round}` : ''}`);
  stopAfter = (session: string, after: Ev) => this.until(async () => (await this.read()).find((e) => e.kind === 'agent.stop' && e.session === session && e.log_pos > after.log_pos), `${session}'s Stop after ${after.kind}`);
  ended = (session: string) => this.until(async () => (await this.read()).find((e) => e.kind === 'session.end' && e.session === session), `${session}'s SessionEnd`);
  /** The turn is over once Claude Code wrote its `turn_duration` entry after the stop: its Stop hooks, the hold among them, are done. */
  turnOver = (session: string, since: number) => this.until(() => readLines(transcriptOf(this.h, this.work, session))
    .find((e) => e.type === 'system' && e.subtype === 'turn_duration' && Date.parse(String(e.timestamp)) >= since - 1000), `${session}'s turn to end after its stop (a turn_duration entry)`);
}

/** Your answer, option b, with `deep inbox answer`; the record's ask.answered time is read after the run. */
async function answer(w: Watch, ask: Ev, round: number): Promise<Answered> {
  const options = (ask.data?.options ?? []) as { id: string; label: string }[];
  const chosen = options.find((o) => o.id === 'b') ?? options[1];
  const other = options.find((o) => o !== chosen);
  if (!chosen || !other) throw Error(`BLOCKED: the session's deep_ask must offer two options, as the harness's prompt asks: ${JSON.stringify(ask.data).slice(0, 600)}`);
  const at = Date.now();
  const r: Ran = await deep(w.h, ['inbox', 'answer', `ask:${ask.id}`, chosen.id]);
  if (r.code !== 0) throw Error(`deep inbox answer ask:${ask.id} ${chosen.id} must exit 0: ${shown(r)}`);
  return { round, handle: `ask:${ask.id}`, id: ask.id, chosen: chosen.label, other: other.label, at, ids: [] };
}

/** Claude Code's processes under the harness running DeepBuild's waiter entry, stopped as Claude Code stops one at its timeout. */
async function stopWaiter(h: Home, harnessPid: number): Promise<number[]> {
  const words = shellWords(String(waiterEntry(readSettings(h)).hook.command));
  const mine = treeOf(processTable(), harnessPid).filter((p) => p.pid !== harnessPid && p.args.includes(words.join(' ')));
  const pids = mine.flatMap((p) => treeOf(processTable(), p.pid).map((q) => q.pid));
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(3000);
  for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  return mine.map((p) => p.pid);
}

/** The route's answers, given at the route's moment (README: The live sessions, per route). */
async function drive(route: Route, w: Watch, go: string, rounds: number, harness: () => number | undefined): Promise<{ answers: Answered[]; killed: number[] }> {
  const answers: Answered[] = [];
  let killed: number[] = [];
  const [a] = await w.until(async () => { const s = await w.sessions(); return s.length ? s : undefined; }, 'the first session\'s SessionStart in the record');
  if (route === 'stop-hold') {
    const ask = await w.ask(a!);
    await w.stopAfter(a!, ask);
    await sleep(2000); // the stop is held: the hub has it, and the hold runs for up to 60 s
    answers.push(await answer(w, ask, 1));
  } else if (route === 'idle-wake') {
    for (let round = 1; round <= rounds; round++) {
      const ask = await w.ask(a!, round);
      const stopped = await w.stopAfter(a!, ask);
      await w.turnOver(a!, msOf(stopped.ts));
      await sleep(1000);
      answers.push(await answer(w, ask, round));
    }
  } else if (route === 'next-prompt') {
    const ask = await w.ask(a!);
    const stopped = await w.stopAfter(a!, ask);
    await w.turnOver(a!, msOf(stopped.ts));
    await sleep(1000);
    killed = await stopWaiter(w.h, harness()!);
    answers.push(await answer(w, ask, 1));
    await sleep(5000);
    writeFileSync(go, 'go\n');
  } else {
    const ask = await w.ask(a!);
    await w.stopAfter(a!, ask);
    await w.ended(a!);
    answers.push(await answer(w, ask, 1));
    writeFileSync(go, 'go\n');
  }
  return { answers, killed };
}

/** One live run of a route through the harness's deep-answer scenario, with a plant or none. */
export async function live(route: Route, o: { plant?: string; rounds?: number; timeoutMs: number }): Promise<Live> {
  const claude = requireLive();
  const env = o.plant ? { DEEP_HUB_PLANT: o.plant } : {};
  const h = makeHome();
  const hub = await startHub(h, o.plant);
  await setup(h, env);
  // Claude Code's own first-run screens are done in this home; the harness answers the folder's trust prompt.
  const state = join(h.home, '.claude.json');
  writeFileSync(state, JSON.stringify({ ...(existsSync(state) ? parseObject(readFileSync(state, 'utf8')) : {}), hasCompletedOnboarding: true, theme: 'dark' }));
  const work = join(h.tmp, 'work');
  mkdirSync(work);
  // The deep MCP server the session starts itself, as setup registers it (README: Additions, 1).
  const mcp = join(h.tmp, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { deep: { type: 'stdio', command: NODE, args: [CURRENT.cli, 'mcp'] } } }, null, 2));
  const go = join(h.tmp, 'go');
  const args = [HARNESS, 'run', '--scenario', 'deep-answer', '--route', route, '--workdir', work, '--mcp-config', mcp, '--go', go,
    ...(o.rounds ? ['--rounds', String(o.rounds)] : []), '--claude', claude, '--timeout-ms', String(o.timeoutMs), '--out', join(h.tmp, 'out'),
    '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', ...(o.plant ? ['--pass-env', 'DEEP_HUB_PLANT'] : [])];
  const conn = await control(hub);
  const w = new Watch(conn, h, work);
  let harnessPid: number | undefined;
  const ran = run(NODE, args, { env: childEnv(h, { ...env, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }), timeoutMs: o.timeoutMs + 180_000, onStart: (c: ChildProcess) => (harnessPid = c.pid) })
    .finally(() => { w.exited = true; });
  const driven = drive(route, w, go, o.rounds ?? 1, () => harnessPid).catch((e: Error) => e);
  const [r, d] = await Promise.all([ran, driven]);
  const line = jsonLines(r.stdout).find((l) => typeof l.run === 'string');
  if (!line) throw Error(`BLOCKED: the harness printed no run line for the deep-answer scenario (route ${route}): ${shown(r)}`);
  if (line.verdict === 'BLOCKED') throw Error(`BLOCKED: the deep-answer run (route ${route}) was BLOCKED: ${line.reason}`);
  if (d instanceof Error) throw Error(`INCONCLUSIVE: the ${route} run never reached the moment to answer (${d.message}); harness: ${JSON.stringify(line).slice(0, 1500)}`);
  const listed = (line.evidence?.sessions ?? []) as { name: string; sessionId: string; transcript: string; hooks: string; typed: Typed[] }[];
  if (!listed.length || listed.some((s) => !s.sessionId || !s.hooks || !existsSync(s.hooks))) throw Error(`BLOCKED: the run line must name each session with its ID, transcript, hook log and typed prompts: ${JSON.stringify(line.evidence)}`);
  const sessions = listed.map((s) => ({
    name: s.name, sessionId: s.sessionId, transcript: s.transcript, typed: s.typed ?? [],
    hooks: readLines(s.hooks).filter((p) => p.session_id === s.sessionId || !p.session_id),
    entries: s.transcript && existsSync(s.transcript) ? readLines(s.transcript) : [],
  }));
  const events = await w.read();
  // The answer's IDs: its ask's, and every event the record keeps about it once answered (ask.answered, deliveries).
  for (const a of d.answers) {
    a.ids = [a.id, ...events.filter((e) => e.id !== a.id && (e.subject === a.handle || JSON.stringify(e.data ?? {}).includes(a.id))).map((e) => e.id)];
    const answered = events.find((e) => e.kind === 'ask.answered' && (e.subject === a.handle || JSON.stringify(e.data ?? {}).includes(a.id)));
    if (answered) a.at = msOf(answered.ts);
  }
  conn.close();
  return { line, hub, h, sessions, answers: d.answers, killed: d.killed, events };
}

// ---- Reading what reached a session, from Claude Code's side.

export const iso = (ms: number) => new Date(ms).toISOString();
const typedText = (s: LiveSession) => new Set(s.typed.map((t) => t.text.trim()));
/** A UserPromptSubmit the harness didn't type: a wake (design: the waiter's wake starts a turn with a task-notification). */
export const wakes = (s: LiveSession, after = 0) => s.hooks.filter((p) => p.hook_event_name === 'UserPromptSubmit' && p.at >= after && !typedText(s).has(String(p.prompt ?? '').trim()));
export const stops = (s: LiveSession) => s.hooks.filter((p) => p.hook_event_name === 'Stop');
/** Whether text carries the answer: one of its IDs, or the chosen option's label. */
export const carries = (text: unknown, a: Answered) => { const t = typeof text === 'string' ? text : JSON.stringify(text ?? ''); return t.includes(a.chosen) || a.ids.some((id) => t.includes(id)); };
/**
 * Transcript entries that brought the answer into the session from outside it: not the agent's own words, not a tool's
 * result, not a prompt the harness typed, not Claude Code's queue bookkeeping or its stop-hook summary.
 */
export function deliveries(s: LiveSession, a: Answered, after = 0): Line[] {
  const typed = typedText(s);
  return s.entries.filter((e) => {
    if (Date.parse(String(e.timestamp)) < after - 1000 || e.type === 'assistant' || e.type === 'queue-operation') return false;
    if (e.type === 'system' && ['stop_hook_summary', 'turn_duration'].includes(String(e.subtype))) return false;
    const content = e.message?.content;
    if (Array.isArray(content) && content.some((c: Line) => c?.type === 'tool_result')) return false;
    if (e.type === 'user' && typeof content === 'string' && typed.has(content.trim())) return false;
    return carries(e, a);
  });
}
export const said = (stop: Line | undefined) => String(stop?.last_assistant_message ?? '');
