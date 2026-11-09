// The replay for #1023 (README): three Codex CLI sessions ended with Ctrl-C, through a real hub and real deep-hook.
// Each session's agent process is a stand-in for `codex --no-daemon`: a real process, the parent of the session's hooks
// and of its `deep mcp`, ended by SIGINT to its PID as Ctrl-C ends the TUI. Run 2 fires SessionEnd {reason: "other"}
// first; runs 1 and 3 fire none, and their last events are the turn's. The temp home, the hub, `deep setup` and the
// control calls are #39's helpers, imported by path; the stand-in's body is #39's daemon fixture, run as its own process
// per session. The hooks and rollout are the 0.160.0 corpus recording `tools`, re-keyed per run.
import { expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLI, FIXTURES, HOOK, NODE, REPO, allEvents, asksOf, childEnv, choice, deep, makeHome, own, parseObject, shown, sleep, startHub, statusRows, stopHub, tag, waitFor,
  type Ev, type Home, type Line,
} from '../39/helpers.ts';

export const AC = { 1: 'AC1 #1023.f4fb4c83', 2: 'AC2 #1023.6b9c173d', 3: 'AC3 #1023.88d3d827' } as const;
/** The plant an implementation of #1023 registers (README: AC3): a hub that never reads a Codex process's exit as its session's end. */
export const PLANT = 'codex-exit-leaves-session-open';
/** How long after its process ends a session must show closed in `deep hub status` (AC2). */
export const WITHIN_MS = 60_000;

export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const CORPUS = join(REPO, 'adapters/corpus/codex/0.160.0/tools');
const RECORDED = '01a1581d-33f7-7b62-8f4f-c790574d966f';
const RECORDED_CWD = '/private/tmp';

/** One Ctrl-C end, as the replay saw it. */
export interface Run {
  n: 1 | 2 | 3;
  id: string;
  /** Whether Codex fired SessionEnd before its process ended (run 2 only). */
  sessionEnd: boolean;
  pid: number;
  /** When the process was seen to end (ms since epoch), and the record's last log_pos before the SIGINT. */
  exitedAt: number;
  exitPos: number;
  /** The ask left waiting when the process ended (run 3 only). */
  ask?: string;
  /** `deep hub status` before the SIGINT, and each poll after the process ended, with its time. */
  before: string;
  polls: { at: number; text: string }[];
  /** `deep inbox answer`'s result for the waiting ask, after the process ended. */
  answered?: { code: number | null; out: string };
}
export interface World { h: Home; runs: Run[]; events: Ev[]; rows: Line[] }

// ---- The recording, re-keyed: a fresh session ID, the run's own folder, a rollout where Codex 0.160.0 keeps it.
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
function rekey(line: string, id: string, cwd: string, rollout: string): Line {
  const each = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => each(x));
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, each(x, k)]));
    if (typeof v !== 'string') return v;
    if (key === 'transcript_path') return rollout;
    const moved = v === RECORDED_CWD ? cwd : v.startsWith(`${RECORDED_CWD}/`) ? `${cwd}${v.slice(RECORDED_CWD.length)}` : v;
    return moved.replaceAll(RECORDED, id);
  };
  return each(JSON.parse(line)) as Line;
}

/** The stand-in for one `codex --no-daemon` process: #39's daemon fixture, its argv[0] the home's `codex`. */
class Codex {
  private waiting = new Map<number, (l: Line) => void>();
  private n = 0;
  private ids = 0;
  readonly exited: Promise<number>;
  private constructor(private readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { const l = parseObject(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (l && typeof l.n === 'number') this.waiting.get(l.n)?.(l); }
    });
    this.exited = new Promise((resolve) => child.on('exit', () => resolve(Date.now())));
  }
  get pid(): number { return this.child.pid!; }
  static start(h: Home, cwd: string): Codex {
    const c = spawn(NODE, [join(FIXTURES, 'daemon.mjs'), '--no-daemon'], { argv0: join(h.bin, 'codex'), cwd, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(c.pid);
    return new Codex(c);
  }
  private send(cmd: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`the codex stand-in gave no answer to ${cmd.op}`)), timeoutMs);
      void this.exited.then(() => { clearTimeout(timer); reject(Error('the codex stand-in ended')); });
      this.waiting.set(n, (l) => { clearTimeout(timer); if (l.failed) reject(Error(l.failed)); else resolve(l); });
      this.child.stdin!.write(`${JSON.stringify({ n, ...cmd })}\n`);
    });
  }
  /** `deep-hook codex <event>` as this process's child, the payload on stdin; BLOCKED unless it exits 0. */
  async hook(p: Line, cwd: string): Promise<void> {
    const l = await this.send({ op: 'hook', binary: HOOK, event: p.hook_event_name, payload: p, cwd });
    if (l.code !== 0) throw Error(`BLOCKED: deep-hook codex ${String(p.hook_event_name)} must exit 0: exit ${l.code}, ${String(l.stderr).slice(-800)}`);
  }
  async mcp(method: string, params: Line | undefined, timeoutMs = 120_000): Promise<Line> {
    const line = params === undefined ? { jsonrpc: '2.0', method, params: {} } : { jsonrpc: '2.0', id: ++this.ids, method, params };
    const l = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(l.pid as number);
    return l.reply as Line;
  }
  /** Ctrl-C: SIGINT to this process's PID; resolves when it has ended. */
  async ctrlC(): Promise<number> { process.kill(this.pid, 'SIGINT'); return this.exited; }
}

interface Prepared { run: Run; codex: Codex; cwd: string; hooks: Line[] }
function prepare(h: Home, n: 1 | 2 | 3): Omit<Prepared, 'codex' | 'run'> & { id: string; rollout: string; transcript: string[] } {
  const id = randomUUID();
  const cwd = join(h.tmp, `run${n}`);
  mkdirSync(cwd, { recursive: true });
  const now = new Date();
  const p2 = (x: number) => String(x).padStart(2, '0');
  const day = join(h.codexHome, 'sessions', String(now.getFullYear()), p2(now.getMonth() + 1), p2(now.getDate()));
  mkdirSync(day, { recursive: true });
  const rollout = join(day, `rollout-${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}-${p2(now.getMinutes())}-${p2(now.getSeconds())}-${id}.jsonl`);
  const hooks = lines(join(CORPUS, 'events.jsonl')).map((l) => rekey(l, id, cwd, rollout).payload as Line);
  const transcript = lines(join(CORPUS, 'transcript.jsonl')).map((l) => {
    const e = rekey(l, id, cwd, rollout);
    // Changed from the recording: the CLI's own originator and source, as the issue's runs were in the Codex CLI.
    if (e.type === 'session_meta') Object.assign(e.payload as Line, { originator: 'codex_cli_rs', source: 'cli' });
    return JSON.stringify(e);
  });
  for (const p of hooks) if (p.session_id !== id || p.transcript_path !== rollout || p.cwd !== cwd) throw Error(`BLOCKED: the recording didn't re-key: ${JSON.stringify(p).slice(0, 300)}`);
  return { id, cwd, hooks, rollout, transcript };
}

/** The three runs on one hub, `plant` set on the hub when given; `only` limits the runs (AC3's planted hub runs 1). */
export async function replay(o: { plant?: string; only?: (1 | 2 | 3)[] } = {}): Promise<World> {
  const h = makeHome();
  const hub = await startHub(h, o.plant ? { env: { DEEP_HUB_PLANT: o.plant } } : {});
  try {
    const setup = await deep(h, ['setup']);
    if (setup.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(setup)}`);
    const prepared: Prepared[] = [];
    for (const n of o.only ?? [1, 2, 3] as const) {
      const p = prepare(h, n);
      const codex = Codex.start(h, p.cwd);
      const tools = p.hooks.slice(0, -1);
      const stop = p.hooks.at(-1)!;
      if (stop.hook_event_name !== 'Stop' || tools[0]?.hook_event_name !== 'SessionStart') throw Error('BLOCKED: the recording `tools` must run SessionStart to Stop');
      const run: Run = { n, id: p.id, sessionEnd: n === 2, pid: codex.pid, exitedAt: 0, exitPos: 0, before: '', polls: [] };
      if (n === 3) {
        // Run 3 ends mid-turn, its ask open: the rollout up to the turn's last tool output, then deep_ask on its deep mcp.
        const last = p.transcript.findLastIndex((l) => (JSON.parse(l) as Line).type === 'response_item' && (JSON.parse(l) as Line).payload?.type === 'custom_tool_call_output');
        writeFileSync(p.rollout, `${p.transcript.slice(0, last + 1).join('\n')}\n`);
        for (const hook of tools) await codex.hook(hook, p.cwd);
        await codex.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '0.160.0' } });
        await codex.mcp('notifications/initialized', undefined);
        const question = `Which header for ${tag()}?`;
        const args = choice(question);
        await codex.hook({ ...tools.find((x) => x.hook_event_name === 'PreToolUse')!, tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: `call_${tag(6)}` }, p.cwd);
        void codex.mcp('tools/call', { name: 'deep_ask', arguments: args }).catch(() => undefined);
        const asked = await waitFor(async () => asksOf(await allEvents(hub), question)[0], 60_000, `run 3's ask`).catch((e: Error) => { throw Error(`BLOCKED: run 3's deep_ask made no ask.created: ${e.message}`); });
        run.ask = asked.id;
      } else {
        writeFileSync(p.rollout, `${p.transcript.join('\n')}\n`);
        for (const hook of p.hooks) await codex.hook(hook, p.cwd);
        // Run 2: Codex fires SessionEnd before its process ends; no recorded payload has one, so it is the SessionStart's
        // fields with the event's name and the reason the issue's record shows.
        if (n === 2) {
          const { source: _source, ...start } = tools[0]!;
          await codex.hook({ ...start, hook_event_name: 'SessionEnd', reason: 'other' }, p.cwd);
        }
      }
      prepared.push({ run, codex, cwd: p.cwd, hooks: p.hooks });
    }
    const events0 = await allEvents(hub);
    for (const { run } of prepared) {
      if (!events0.some((e) => e.kind === 'session.start' && e.session === run.id)) throw Error(`BLOCKED: run ${run.n}: no session.start under ${run.id}`);
      run.before = await hubStatus(h, `run ${run.n}, before Ctrl-C`);
      run.exitPos = Math.max(0, ...events0.map((e) => e.log_pos));
    }
    // Ctrl-C ends all three processes, by PID.
    await Promise.all(prepared.map(async ({ run, codex }) => { run.exitedAt = await codex.ctrlC(); }));
    // `deep hub status` every two seconds, for a minute after the last process ended, or until each run shows closed.
    const end = Math.max(...prepared.map((p) => p.run.exitedAt)) + WITHIN_MS;
    while (Date.now() < end) {
      const text = await hubStatus(h, 'after Ctrl-C');
      const at = Date.now();
      for (const { run } of prepared) run.polls.push({ at, text });
      if (prepared.every(({ run }) => closedIn(text, run.id))) break;
      await sleep(2000);
    }
    // The waiting ask is answered once the process has ended; the answer's delivery is read from the record.
    for (const { run } of prepared) {
      if (!run.ask) continue;
      const r = await deep(h, ['inbox', 'answer', `ask:${run.ask}`, 'green']);
      run.answered = { code: r.code, out: `${r.stdout}${r.stderr}`.slice(-600) };
      await waitFor(async () => outcomesOf(await allEvents(hub), run.ask!).length > 0, 20_000, 'a delivery.outcome').catch(() => undefined);
    }
    await sleep(1000);
    const events = await allEvents(hub);
    const rows = await statusRows(hub);
    expect(events.length, 'BLOCKED: the record is empty').toBeGreaterThan(0);
    return { h, runs: prepared.map((p) => p.run), events, rows };
  } finally {
    await stopHub(hub);
  }
}
async function hubStatus(h: Home, when: string): Promise<string> {
  const r = await deep(h, ['hub', 'status']);
  if (r.code !== 0) throw Error(`BLOCKED: deep hub status must read the hub (exit 0) ${when}: ${shown(r)}`);
  return r.stdout;
}

// ---- How each criterion is read (README). Each returns why the run fails it, naming the session, or undefined.
const said = (events: readonly Ev[]) => events.map((e) => `${e.kind}${e.kind === 'session.reading' ? ` "${String(e.data?.reading)}"` : ''}`).join(', ') || 'nothing';
const ENDS = ['session.end', 'session.gone'];

/** AC1: one end on record; run 2's is its SessionEnd with the payload's reason; runs 1 and 3 the hub's, with a reading saying so. */
export function endRead(events: readonly Ev[], run: Pick<Run, 'n' | 'id' | 'sessionEnd' | 'exitPos'>): string | undefined {
  const mine = events.filter((e) => e.session === run.id);
  const ends = mine.filter((e) => ENDS.includes(e.kind));
  const tail = `the record holds for session ${run.id}: ${said(mine.slice(-12))}`;
  if (ends.length !== 1) return `run ${run.n}: session ${run.id} has ${ends.length} ends on record (session.end or session.gone), not one; ${tail}`;
  const [e] = ends;
  if (run.sessionEnd) {
    if (e!.kind !== 'session.end' || e!.data?.reason !== 'other') return `run ${run.n}: session ${run.id}'s SessionEnd {reason: "other"} isn't its one end: ${e!.kind} ${JSON.stringify(e!.data)}; ${tail}`;
    return undefined;
  }
  if (e!.writer === 'hook') return `run ${run.n}: Codex fired no SessionEnd, yet session ${run.id}'s end is a hook's: ${e!.kind} ${JSON.stringify(e!.data)}`;
  const reading = mine.find((r) => r.kind === 'session.reading' && r.log_pos > run.exitPos && /SessionEnd|process|exit/i.test(String(r.data?.reading)));
  if (!reading) return `run ${run.n}: session ${run.id} was closed by the hub (${e!.kind}) with no reading saying it was read from its process's end; ${tail}`;
  return undefined;
}

/** Every object in `deep hub status`'s JSON naming the session, by `id` or `session`, in either form. */
function named(text: string, id: string): Line[] {
  const found: Line[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object' || v === null) return;
    const o = v as Line;
    const at = typeof o.id === 'string' ? o.id : typeof o.session === 'string' ? o.session.replace(/^session:/, '') : undefined;
    if (at !== undefined && letters(at) === letters(id)) found.push(o);
    Object.values(o).forEach(walk);
  };
  try { walk(JSON.parse(text)); } catch { /* not JSON: names nothing */ }
  return found;
}
const CLOSED = /^(closed|ended|gone|exited)$/i;
/** Whether `deep hub status` shows the session closed: an object naming it with a closed state or status, or `closed`/`ended` true. */
export function closedIn(text: string, id: string): boolean {
  return named(text, id).some((o) => [o.state, o.status].some((v) => typeof v === 'string' && CLOSED.test(v)) || o.closed === true || o.ended === true);
}
/** AC2, first half: open in `deep hub status` before Ctrl-C, closed within a minute of the process's end. */
export function closedInTime(run: Pick<Run, 'n' | 'id' | 'exitedAt' | 'before' | 'polls'>): string | undefined {
  if (closedIn(run.before, run.id)) return `run ${run.n}: deep hub status showed session ${run.id} closed before its process ended: ${run.before.slice(0, 600)}`;
  const first = run.polls.find((p) => closedIn(p.text, run.id));
  if (first && first.at - run.exitedAt <= WITHIN_MS) return undefined;
  const last = run.polls.at(-1);
  const shownAs = last ? named(last.text, run.id) : [];
  return `run ${run.n}: session ${run.id} isn't shown closed in deep hub status within ${WITHIN_MS / 1000} s of its process ending${first ? ` (first at ${Math.round((first.at - run.exitedAt) / 1000)} s)` : ''}; its last output (${run.polls.length} polls) ${shownAs.length ? `names it as ${JSON.stringify(shownAs).slice(0, 400)}` : 'names it nowhere'}: ${last?.text.slice(0, 400) ?? 'none'}`;
}
export const outcomesOf = (events: readonly Ev[], ask: string) => events.filter((e) => e.kind === 'delivery.outcome' && (e.data?.delivery === `ask:${ask}` || String(e.subject ?? '').includes(ask)));
/** AC2, second half: the answer to the ask left waiting goes by its task, not by a resume: it waits on the task, never delivered or held for the session. */
export function byTask(events: readonly Ev[], run: Pick<Run, 'n' | 'id' | 'ask' | 'answered'>): string | undefined {
  if (!run.ask) return `BLOCKED: run ${run.n} left no ask waiting`;
  if (run.answered?.code !== 0) return `run ${run.n}: the answer to ask:${run.ask}, waiting for session ${run.id} when its process ended, was refused by deep inbox answer: exit ${run.answered?.code}, ${run.answered?.out}`;
  const out = outcomesOf(events, run.ask);
  const shown2 = JSON.stringify(out.map((e) => e.data));
  const onTask = out.some((e) => /task/.test(String(e.data?.via)) && e.data?.outcome === 'waiting');
  const other = out.filter((e) => !/task/.test(String(e.data?.via)) || e.data?.outcome === 'delivered');
  if (!onTask || other.length) return `run ${run.n}: the answer to ask:${run.ask} for session ${run.id}, whose process ended with no SessionEnd, doesn't go by its task: its delivery outcomes are ${shown2 || 'none'}`;
  return undefined;
}
/** Every way the world leaves a run's session open (AC3 reads this): each message names the session. */
export function leftOpen(w: Pick<World, 'events'>, run: Run): string[] {
  return [endRead(w.events, run), run.sessionEnd ? undefined : closedInTime(run), run.ask ? byTask(w.events, run) : undefined].filter((m): m is string => m !== undefined);
}
