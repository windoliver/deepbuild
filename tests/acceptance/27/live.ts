// The live tests' side (README: The live sessions): real interactive Claude Code sessions run by the agent test harness
// (#48) in a pseudo-terminal, never `claude -p`, with DeepBuild's entries as `deep setup` wrote them into the temporary
// home's user settings, a real hub, and your answer given with `deep inbox answer`. The harness runs the sessions (its
// `deep-answer` scenario); this file answers at the route's moment, read off the hub's record and the session's live
// transcript, then reads what reached each session from Claude Code's side: the hook payloads the harness's own hooks
// recorded, and the transcript. Adapted from tests/acceptance/25/live/live.ts (same repo, same license).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLI, Conn, NODE, REPO, childEnv, deep, jsonLines, makeHome, makeRepo, msOf, parseObject, readLines, run, setup, shown, sleep, startHub,
  type Ev, type Home, type Hub, type Line,
} from './helpers.ts';

const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export type Route = 'idle-wake' | 'repeat';

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
export interface Answered { handle: string; id: string; chosen: string; other: string; at: number }
export interface Live { line: Line; hub: Hub; h: Home; sessions: LiveSession[]; answers: Answered[]; events: Ev[]; inbox: string }

/** The live transcript Claude Code writes for a session working in `work` (facts: transcripts.path). */
const transcriptOf = (h: Home, work: string, session: string) => join(h.home, '.claude/projects', work.replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);

/** The record and the sessions as they stand, for the driver's waits; every wait gives up once the harness has exited. */
class Watch {
  events: Ev[] = [];
  exited = false;
  constructor(private readonly conn: Conn, readonly h: Home, readonly work: string) {}
  async read(): Promise<Ev[]> {
    for (;;) {
      const page = (await this.conn.call('events.read', { after: this.events.at(-1)?.log_pos ?? 0, limit: 1000 })).events as Ev[];
      if (!page.length) return this.events;
      this.events.push(...page);
    }
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
  firstSession = () => this.until(async () => (await this.read()).find((e) => e.kind === 'session.start')?.session, 'the first session\'s SessionStart in the record');
  ask = (session: string) => this.until(async () => (await this.read()).find((e) => e.kind === 'ask.created' && e.session === session), `the deep_ask of ${session}`);
  stopAfter = (session: string, after: Ev) => this.until(async () => (await this.read()).find((e) => e.kind === 'agent.stop' && e.session === session && e.log_pos > after.log_pos), `${session}'s Stop after its ask`);
  /** The turn is over once Claude Code wrote its `turn_duration` entry after the stop: its Stop hooks, the hold among them, are done. */
  turnOver = (session: string, since: number) => this.until(() => readLines(transcriptOf(this.h, this.work, session))
    .find((e) => e.type === 'system' && e.subtype === 'turn_duration' && Date.parse(String(e.timestamp)) >= since - 1000), `${session}'s turn to end after its stop (a turn_duration entry)`);
}

/** Your answer, option b, with `deep inbox answer`, once the session is idle (its turn over, 1 s more). */
async function answerIdle(w: Watch, session: string): Promise<Answered> {
  const ask = await w.ask(session);
  const stopped = await w.stopAfter(session, ask);
  await w.turnOver(session, msOf(stopped.ts));
  await sleep(1000);
  const options = (ask.data?.options ?? []) as { id: string; label: string }[];
  const chosen = options.find((o) => o.id === 'b') ?? options[1];
  const other = options.find((o) => o !== chosen);
  if (!chosen || !other) throw Error(`BLOCKED: the session's deep_ask must offer two options, as the harness's prompt asks: ${JSON.stringify(ask.data).slice(0, 600)}`);
  const at = Date.now();
  const r = await deep(w.h.home, ['inbox', 'answer', `ask:${ask.id}`, chosen.id]);
  if (r.code !== 0) throw Error(`deep inbox answer ask:${ask.id} ${chosen.id} must exit 0: ${shown(r)}`);
  return { handle: `ask:${ask.id}`, id: ask.id, chosen: chosen.label, other: other.label, at };
}

/** One live run of a route through the harness's deep-answer scenario; a BLOCKED or INCONCLUSIVE run fails naming `ac`. */
export async function live(ac: string, route: Route, o: { timeoutMs: number }): Promise<Live> {
  try {
    return await liveRun(route, o);
  } catch (error) {
    throw Error(`${ac} ${(error as Error).message}`);
  }
}
async function liveRun(route: Route, o: { timeoutMs: number }): Promise<Live> {
  const claude = requireLive();
  const h = makeHome();
  const repo = makeRepo(h.home);
  const hub = await startHub(h.home);
  await setup(h.home);
  // Claude Code's first-run screens are done in this home; the harness answers the folder's trust prompt.
  const state = join(h.home, '.claude.json');
  writeFileSync(state, JSON.stringify({ ...(existsSync(state) ? parseObject(readFileSync(state, 'utf8')) : {}), hasCompletedOnboarding: true, theme: 'dark' }));
  const mcp = join(h.tmp, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { deep: { type: 'stdio', command: NODE, args: [CLI, 'mcp'] } } }, null, 2));
  const go = join(h.tmp, 'go');
  const args = [HARNESS, 'run', '--scenario', 'deep-answer', '--route', route, '--workdir', repo.dir, '--mcp-config', mcp, '--go', go,
    '--rounds', '1', '--claude', claude, '--timeout-ms', String(o.timeoutMs), '--out', join(h.tmp, 'out'), '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN'];
  const conn = await Conn.open(hub.socket);
  await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
  const w = new Watch(conn, h, repo.dir);
  const ran = run(NODE, args, { env: childEnv(h.home, { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }), timeoutMs: o.timeoutMs + 180_000 })
    .finally(() => { w.exited = true; });
  // Both routes: you answer session A's question once A is idle. In `repeat`, B's question is never yours to answer.
  const driven = (async () => [await answerIdle(w, await w.firstSession())])().catch((e: Error) => e);
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
  for (const a of d) {
    const answered = events.find((e) => e.kind === 'ask.answered' && (e.subject === a.handle || JSON.stringify(e.data ?? {}).includes(a.id)));
    if (answered) a.at = msOf(answered.ts);
  }
  const inbox = await deep(h.home, ['inbox']);
  conn.close();
  return { line, hub, h, sessions, answers: d, events, inbox: inbox.stdout };
}

// ---- Reading what reached a session, from Claude Code's side.
const typedText = (s: LiveSession) => new Set(s.typed.map((t) => t.text.trim()));
/** A UserPromptSubmit the harness didn't type: a wake (#80: the waiter's wake starts a turn with a task-notification). */
export const wakes = (s: LiveSession, after = 0) => s.hooks.filter((p) => p.hook_event_name === 'UserPromptSubmit' && p.at >= after && !typedText(s).has(String(p.prompt ?? '').trim()));
export const stops = (s: LiveSession) => s.hooks.filter((p) => p.hook_event_name === 'Stop');
export const said = (stop: Line | undefined) => String(stop?.last_assistant_message ?? '');
/** A reply that is the chosen option's label and not the other's. */
export const replies = (stop: Line | undefined, a: Answered) => said(stop).includes(a.chosen) && !said(stop).includes(a.other);
