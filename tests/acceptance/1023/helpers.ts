// Test-side tools for #1023 (README.md). A real hub and the real deep-hook, from #39's helpers by import: temp homes under
// /tmp/dh39-*, `deep hub run`, `deep setup`, `events.read`, Codex threads whose identity is their payload's. One Codex CLI
// process per session stands in for `codex --no-daemon`: #39's daemon stand-in (fixtures/daemon.mjs), the parent of each
// of its hooks and of its one `deep mcp`, so the hub sees its PID as each hook's parent. Ctrl-C is SIGINT to that process,
// by its PID. The three ends' payloads are fixtures/ctrl-c-ends.json, reconstructed from Codex 0.160.0's hook schemas.
// Nothing here stands in for DeepBuild.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allEvents, alive, childEnv, CLI, deep, FIXTURES as FIXTURES_39, HOOK, NODE, newThread, ofSession, own, parseObject, shown, sleep, startHub, type Ev, type Home, type Hub, type Line, type Ran, type Thread,
} from '../39/helpers.ts';

export { allEvents, answer, asksOf, choice, cleanup, hubWithSetup, makeHome, ofSession, run, shown, sleep, tag, waitFor, type Ev, type Home, type Hub, type Line } from '../39/helpers.ts';

// The criteria, by their order in the issue and their ID: the first 8 hex digits of SHA-256 of each criterion's text,
// trimmed, white space collapsed (scripts/proof-change.mjs, criterionId).
export const AC1 = 'AC1 #1023.f4fb4c83';
export const AC2 = 'AC2 #1023.6b9c173d';
export const AC3 = 'AC3 #1023.88d3d827';

/** The issue's "within one minute of its process ending". */
export const WITHIN_MS = 60_000;
/** The planted adapter (README: Assumed surfaces): the hub records no end for a Codex session whose process exits without a SessionEnd. */
export const PLANT = 'leaves-codex-session-open';
/** How long a SessionEnd hook's own end may take to reach the record. */
const HOOK_SETTLE_MS = 10_000;

interface Run { run: number; process: { ends: 'SIGINT'; after: string }; hooks: Line[] }
const ENDS = JSON.parse(readFileSync(new URL('./fixtures/ctrl-c-ends.json', import.meta.url), 'utf8')) as { runs: Run[] };
export const runOf = (n: number): Run => ENDS.runs.find((r) => r.run === n)!;

/** One Codex CLI process: every hook it runs is its own child, so the hook's parent PID is this process's. */
export class CodexCli {
  readonly pid: number;
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, (l: Line) => void>();
  private readonly exited: Promise<void>;
  private n = 0;
  private rpc = 0;
  constructor(h: Home, cwd: string) {
    this.child = spawn(NODE, [join(FIXTURES_39, 'daemon.mjs')], { cwd, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(this.child.pid);
    this.pid = this.child.pid!;
    this.exited = new Promise((done) => this.child.on('exit', () => done()));
    let buffer = '';
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const l = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (l && typeof l.n === 'number') this.waiting.get(l.n)?.(l);
      }
    });
  }
  private send(cmd: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`BLOCKED: the Codex CLI stand-in (pid ${this.pid}) gave no answer to ${cmd.op}`)), timeoutMs);
      this.waiting.set(n, (l) => { clearTimeout(timer); if (l.failed) reject(Error(l.failed)); else resolve(l); });
      this.child.stdin!.write(`${JSON.stringify({ n, ...cmd })}\n`);
    });
  }
  /** `deep-hook codex <event>`, the payload on stdin, run as this process's child. */
  async hook(payload: Line, cwd: string): Promise<{ code: number; stdout: string; stderr: string; reply: Line | undefined }> {
    const l = await this.send({ op: 'hook', binary: HOOK, event: payload.hook_event_name, payload, cwd });
    return { code: l.code as number, stdout: String(l.stdout), stderr: String(l.stderr), reply: parseObject(String(l.stdout).trim()) };
  }
  async mcp(method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
    const l = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', id: ++this.rpc, method, params }, timeoutMs }, timeoutMs + 5000);
    own(l.pid as number);
    return l.reply as Line;
  }
  async init(): Promise<void> {
    await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '0.160.0' } });
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  /** Ctrl-C in the terminal: SIGINT to this process by its PID; resolves at its exit, with the time it ended. */
  async ctrlC(): Promise<number> {
    process.kill(this.pid, 'SIGINT');
    await Promise.race([this.exited, sleep(10_000)]);
    if (alive(this.pid)) throw Error(`BLOCKED: the Codex CLI stand-in (pid ${this.pid}) was still running 10 s after SIGINT`);
    return Date.now();
  }
}

/** One replayed run: its thread (a rollout under the temp CODEX_HOME), its own Codex CLI process, its hooks filled in. */
export interface Replay { run: number; t: Thread; cli: CodexCli; hooks: Line[]; sent: number; firesSessionEnd: boolean }
function fill(v: unknown, t: Thread, turn: string, call: string): unknown {
  if (typeof v === 'string') return v.replaceAll('{session}', t.id).replaceAll('{transcript}', t.transcript).replaceAll('{cwd}', t.cwd).replaceAll('{turn}', turn).replaceAll('{call}', call);
  if (Array.isArray(v)) return v.map((x) => fill(x, t, turn, call));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, t, turn, call)]));
  return v;
}
export function replay(h: Home, n: number): Replay {
  const r = runOf(n);
  const t = newThread(h, { version: '0.160.0' });
  const turn = randomUUID();
  const call = `call_${randomUUID().slice(0, 12)}`;
  const hooks = r.hooks.map((x) => fill(x, t, turn, call) as Line);
  return { run: n, t, cli: new CodexCli(h, t.cwd), hooks, sent: 0, firesSessionEnd: hooks.some((x) => x.hook_event_name === 'SessionEnd') };
}
/** Sends the run's next hooks, through the one named (inclusive); SessionEnd only when `endRun` asks. */
export async function sendThrough(rp: Replay, event: string): Promise<void> {
  while (rp.sent < rp.hooks.length) {
    const p = rp.hooks[rp.sent]!;
    if (p.hook_event_name === 'SessionEnd' && event !== 'SessionEnd') return;
    rp.sent++;
    const r = await rp.cli.hook(p, rp.t.cwd);
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook codex ${p.hook_event_name} for session ${rp.t.id} exited ${r.code}: ${r.stderr.slice(-800)}`);
    if (p.hook_event_name === event) return;
  }
}
/** The run's turn, as recorded: SessionStart, UserPromptSubmit, the tool call, Stop. */
export const replayTurn = async (h: Home, n: number): Promise<Replay> => { const rp = replay(h, n); await sendThrough(rp, 'Stop'); return rp; };
/** A `deep_ask` in the run's turn: Codex's PreToolUse for `mcp__deep__deep_ask`, then the call on this process's `deep mcp`. */
export async function askIn(rp: Replay, args: Line): Promise<void> {
  const stop = rp.hooks.find((x) => x.hook_event_name === 'Stop')!;
  const pre = { session_id: rp.t.id, turn_id: stop.turn_id, transcript_path: rp.t.transcript, cwd: rp.t.cwd, hook_event_name: 'PreToolUse', model: 'gpt-reserve', permission_mode: 'default', tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `call_${randomUUID().slice(0, 12)}` };
  await rp.cli.hook(pre, rp.t.cwd);
  void rp.cli.mcp('tools/call', { name: 'deep_ask', arguments: args }).catch(() => undefined);
}

/** The log's end now: what was on record before the process ended. */
export const logEnd = async (hub: Hub): Promise<number> => Math.max(0, ...(await allEvents(hub)).map((e) => e.log_pos));
export interface Ended { before: number; endedAt: number }
/** How the run ends: its SessionEnd if Codex fired one, on record before the process goes; then Ctrl-C ends the process. */
export async function endRun(hub: Hub, rp: Replay): Promise<Ended> {
  if (rp.firesSessionEnd) {
    await sendThrough(rp, 'SessionEnd');
    const end = Date.now() + HOOK_SETTLE_MS;
    while (!ofSession(await allEvents(hub), rp.t.id, 'session.end').length && Date.now() < end) await sleep(200);
  }
  const before = await logEnd(hub);
  return { before, endedAt: await rp.cli.ctrlC() };
}

// ---- `deep hub status` (README: Assumed surfaces): its one JSON line's `sessions`, each `{id, closed}`.
export interface HubStatus { ran: Ran; line: Line | undefined }
export async function hubStatus(h: Home): Promise<HubStatus> {
  const ran = await deep(h, ['hub', 'status']);
  return { ran, line: parseObject(ran.stdout.trim().split('\n').at(-1) ?? '') };
}
export const listed = (line: Line | undefined, id: string): Line | undefined => (Array.isArray(line?.sessions) ? (line.sessions as Line[]).find((s) => s?.id === id) : undefined);
export const shownClosed = (line: Line | undefined, id: string): boolean => listed(line, id)?.closed === true;
export const statusShown = (s: HubStatus): string => `deep hub status: ${shown(s.ran)}`;

// ---- The record's reading of an end (README: Assumed surfaces).
/** A reading that says Codex fired no SessionEnd and the hub closed the session from its process's exit. */
export const saysClosedFromExit = (text: string): boolean => /SessionEnd/.test(text) && /\b(process|daemon)\b/i.test(text) && /\b(exit|exited|ended|gone|closed)\b/i.test(text);
const said = (events: readonly Ev[]) => events.map((e) => `${e.kind}${e.kind === 'session.end' ? JSON.stringify(e.data) : ''}`).join(', ');

/**
 * What's wrong with how the record ends one session, each problem naming the session. A session whose SessionEnd fired
 * ends once, with the payload's reason. One whose SessionEnd never fired ends once, after its process ended (after
 * `before`), not as a hook's event, with a reading saying so.
 */
export function endProblems(events: readonly Ev[], id: string, o: { reason: string } | { before: number }): string[] {
  const mine = ofSession(events, id);
  const ends = mine.filter((e) => e.kind === 'session.end');
  const problems: string[] = [];
  if (ends.length !== 1) problems.push(`session ${id}: ${ends.length} session.end on record, not one; its events: ${said(mine)}`);
  if ('reason' in o) {
    if (ends[0] && ends[0].data?.reason !== o.reason) problems.push(`session ${id}: its session.end's reason is ${JSON.stringify(ends[0].data?.reason)}, not its SessionEnd payload's ${JSON.stringify(o.reason)}`);
    return problems;
  }
  const end = ends[0];
  if (end && end.log_pos <= o.before) problems.push(`session ${id}: its session.end (log_pos ${end.log_pos}) is on record before its process ended (log end ${o.before})`);
  if (end && end.writer === 'hook') problems.push(`session ${id}: its session.end is recorded as a hook's, though Codex fired no SessionEnd`);
  const readings = mine.filter((e) => e.kind === 'session.reading' && e.log_pos > o.before && saysClosedFromExit(String(e.data?.reading ?? '')));
  if (!readings.length) problems.push(`session ${id}: no reading after its process ended says Codex fired no SessionEnd and the hub closed it from its process's exit; its readings: ${JSON.stringify(mine.filter((e) => e.kind === 'session.reading').map((e) => e.data?.reading))}`);
  return problems;
}

/**
 * The judge for a session Codex ended without a SessionEnd (AC1's record, and with `status` AC2's `deep hub status`):
 * polls each second until both hold or 60 s from the process's end pass, then reads the record once more, 2 s on, so a
 * second end shows. Every problem names the session; none means it passed.
 */
export async function judgeClosed(hub: Hub, id: string, at: Ended, o: { status: boolean }): Promise<{ problems: string[]; closedMs?: number; last?: HubStatus }> {
  const deadline = at.endedAt + WITHIN_MS;
  let closedMs: number | undefined;
  let last: HubStatus | undefined;
  for (;;) {
    const recorded = endProblems(await allEvents(hub), id, { before: at.before }).length === 0;
    if (o.status && closedMs === undefined) {
      last = await hubStatus(hub.h);
      if (shownClosed(last.line, id)) closedMs = Date.now() - at.endedAt;
    }
    if ((recorded && (!o.status || closedMs !== undefined)) || Date.now() > deadline) break;
    await sleep(1000);
  }
  await sleep(2000);
  const problems = endProblems(await allEvents(hub), id, { before: at.before });
  if (o.status && closedMs === undefined) problems.push(`session ${id} doesn't show closed in deep hub status within ${WITHIN_MS / 1000} s of its process ending; it shows ${JSON.stringify(listed(last?.line, id) ?? null)}; ${last ? statusShown(last) : 'deep hub status never ran'}`);
  return { problems, ...(closedMs === undefined ? {} : { closedMs }), ...(last ? { last } : {}) };
}

/** A hub started with the planted adapter, then `deep setup`, as hubWithSetup does unplanted. */
export async function plantedHub(h: Home): Promise<Hub> {
  const hub = await startHub(h, { env: { DEEP_HUB_PLANT: PLANT } });
  const r = await deep(h, ['setup']);
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(r)}`);
  return hub;
}

/** The delivery outcomes the record holds for one ask. */
export const outcomesOf = (events: readonly Ev[], ask: string): Line[] => events.filter((e) => e.kind === 'delivery.outcome' && (e.data?.delivery === `ask:${ask}` || String(e.subject ?? '').includes(ask))).map((e) => e.data as Line);
export const onTask = (o: Line): boolean => o.via === 'on_task' && o.outcome === 'waiting';
