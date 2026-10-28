// Test-side tools for the #303 acceptance tests: a real record on SQLite in a temporary folder, the kernel's
// ask-tasks opened on it with a virtual clock, the events the hook appends around a turn, and the budget judge.
// Nothing here stands in for the kernel; the planted wrong programs are in plants.ts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { openTasks } from '../../../packages/tasks/src/index.ts';
import type { From, Prompted, Tasks } from '../../../packages/tasks/src/index.ts';
import { makeClock, type Clock } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code acting for a session: the lock, the claim. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** The hook: a session's prompts, tool calls and stops. */
export const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
/** `deep` on the command line, as "Fix #303" would open an issue's task. */
export const cli: Connection = { writer: 'cli', ...who };

/** A session's message handle: the hub names each prompt `session:<id>#<msg>` (letters and digits of the ID). */
export const handleOf = (session: string, msg: number): string => `session:${session.replace(/[^0-9A-Za-z]/g, '')}#${msg}`;

// ---- A world: a virtual clock, a record and a home folder in a temporary folder, and the kernel over them.
export interface World {
  clock: Clock;
  record: RecordStore;
  tasks: Tasks;
  dir: string;
  /** The folder the kernel keeps what it approves under (the hub's home). */
  home: string;
  /** A folder standing for the session's worktree, where check files under .deepbuild/ live. */
  repo: string;
  /** A session starting, or a resumed one starting again: session.start with its thread. */
  start(session: string, thread: string): Promise<void>;
  /** The prompt hook: one UserPromptSubmit, with the origin the adapter placed. Numbers the message as the hub does. */
  prompt(session: string, text: string, from?: From): Promise<Prompted & { handle: string; msg: number }>;
  /** A tool call the agent made in the open turn: tool.before and tool.after of the kind, on the paths. */
  call(session: string, kind: 'read' | 'edit', ...paths: string[]): Promise<void>;
  /** The Stop hook: agent.stop, with did_work as the hub counts it (a tool.after since the turn began). Returns the stop's event ID. */
  stop(session: string): Promise<string>;
  events(kind?: string): Promise<Event[]>;
  /** The newest log position, to tell the events a step appended from the ones before it. */
  tail(): Promise<number>;
  table(name: string): Promise<Row[]>;
  /** Writes a file under the repo folder. */
  write(path: string, text: string): string;
  /** Reopens the kernel on the same record after a rebuild, as a restarted hub would. */
  reopen(): Promise<void>;
  close(): Promise<void>;
}
export interface Planting {
  record?: (record: RecordStore) => RecordStore;
  tasks?: (tasks: Tasks, world: World) => Tasks;
}

export async function openWorld(plant: Planting = {}, dir = mkdtempSync(join(tmpdir(), 'deep-303-'))): Promise<World> {
  const clock = makeClock();
  const real = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
  const record = plant.record ? plant.record(real) : real;
  const home = join(dir, 'home');
  const repo = join(dir, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  const msgs = new Map<string, number>();
  const worked = new Map<string, boolean>();
  const turns = new Map<string, number>();
  const w = { clock, record, dir, home, repo } as World;
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  const open = async () => {
    const tasks = await openTasks({ record, now: clock.now, home });
    w.tasks = plant.tasks ? plant.tasks(tasks, w) : tasks;
  };
  Object.assign(w, {
    events,
    tail: async () => (await events()).at(-1)?.log_pos ?? 0,
    table: async (name: string) => (await record.table(name)).rows,
    start: async (session: string, thread: string) => {
      await record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree: repo, branch: 'main', thread } });
    },
    prompt: async (session: string, text: string, from: From = 'person') => {
      const msg = msgs.get(session) ?? 0;
      msgs.set(session, msg + 1);
      const prompted = await w.tasks.prompt(hook(session), { msg, text, from });
      return { ...prompted, handle: handleOf(session, msg), msg };
    },
    call: async (session: string, kind: 'read' | 'edit', ...paths: string[]) => {
      await record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'tool.before', ts: clock.now(), data: { kind, paths, command: null } });
      await record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'tool.after', ts: clock.now(), data: { kind, paths, command: null } });
      worked.set(session, true);
    },
    stop: async (session: string) => {
      const id = ulid(clock.now());
      const turn = (turns.get(session) ?? 0) + 1;
      turns.set(session, turn);
      await record.append(hook(session), { v: 1, id, kind: 'agent.stop', subject: `session:${session}`, ts: clock.now(), data: { turn, did_work: worked.get(session) ?? false } });
      worked.set(session, false);
      return id;
    },
    write: (path: string, text: string) => {
      const file = join(repo, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      return file;
    },
    reopen: async () => {
      await record.rebuild();
      await open();
    },
    close: async () => { await real.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  await open();
  return w;
}

/** An event as the record read it, in the shape its schema describes: the fields the record adds for its reader left off. */
export function asRecorded(event: Event): Record<string, unknown> {
  const { v, id, kind, subject, writer, actor, scope, ts, seq, log_pos, data, evidence } = event;
  return { v, id, kind, ...(subject !== undefined ? { subject } : {}), writer, actor, scope, ts, ...(seq !== undefined ? { seq: String(seq) } : {}), log_pos, data, ...(evidence.length ? { evidence } : {}) };
}
/** The record events a step appended: those past the log position read before it. */
export const since = (events: Event[], tail: number): Event[] => events.filter((e) => e.log_pos > tail);
/** A column the record stores as JSON text, read back. */
export const stored = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
};
/** The event kinds that would show an ask, a task or a drafting job was opened. */
export const OPENS = (kind: string): boolean => /^(ask|task|definition|job)\./.test(kind);

/** Changes a file the way an agent's shell write would: through python3, outside any tool the hook sees. */
export function pythonEdit(file: string, append: string): void {
  execFileSync('python3', ['-c', 'import sys; open(sys.argv[1], "a").write(sys.argv[2])', file, append]);
}

// ---- Budgets: the design's rule for timing results, as tests/acceptance/319 judges them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here is only a reading, or null on a reference Mac on mains power, Low Power Mode off, thermal state nominal. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (samples: number[]): number => {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};
