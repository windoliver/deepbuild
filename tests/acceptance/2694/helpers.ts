// Test-side tools for the #2694 acceptance tests (README: The surface under test). They drive the hub's canvas side,
// `deep-show canvas` (#806), as the hub's packages/hub/src/canvas.ts does: one JSON line in (`{"world": …}` or
// `{"call": …}`), one answer line out, one at a time. Nothing here stands in for the side, the stand-in's hub, the
// terminal or the document check: every reply, revision and count read here is the program's own. The expected values
// are the issue's, or the merge base's for the same calls, which `deep-show run` gives (README: The merge base's
// replies).
//
// A failed check is node:assert's AssertionError from `must`, thrown here or in a test file; a process that can't be
// run throws a plain Error starting `BLOCKED:` or `INCONCLUSIVE:`. Nothing unrun passes.

import { AssertionError, deepStrictEqual } from 'node:assert';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this suite is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: '#2694.de4fbd51',
  2: '#2694.00d72883',
  3: '#2694.5ca7dce2',
  4: '#2694.685bdd90',
  5: '#2694.b3f057c6',
} as const;

/** One test's own limit: the proof lanes stop a file at 20 minutes. */
export const TIMEOUT = 18 * 60_000;

/**
 * How long a test's reads may take before it stops, INCONCLUSIVE, leaving the rest of its 18 minutes to what follows
 * them: a side that slows with every read (the merge base) never reaches the 14,400th within it.
 */
export const READS_MS = TIMEOUT - 4 * 60_000;

/** The failed check: an AssertionError thrown from this suite's own files. */
export function must(ok: unknown, message: string): asserts ok {
  if (!ok) throw new AssertionError({ message, actual: ok, expected: true, operator: '==' });
}

/** Where `a` and `b` differ, as node:assert words it; '' when they are deeply equal. */
export function difference(a: unknown, b: unknown): string {
  try {
    deepStrictEqual(a, b);
    return '';
  } catch (error) {
    return (error as Error).message.slice(0, 4000);
  }
}

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: unknown, n = 400): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
/** 1st, 2nd, 3rd, 4th … 10,000th. */
export function nth(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n.toLocaleString('en-US')}${suffix}`;
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show`, from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build.

const supplied = process.env.DEEP_BIN_DIR;
const binDir = supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied);
/** The side's binary. */
export const SHOW_BIN = join(binDir, 'deep-show');

/**
 * Builds deep-show once per file, unless the proof run supplied it, as #393's suite does (the environment as given, so
 * the build is the one #393's and #806's suites find); BLOCKED when it can't.
 */
export function prebuild(): void {
  beforeAll(() => {
    if (supplied === undefined) {
      const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (run.error || run.status !== 0) throw Error(`BLOCKED: cargo build --locked --bin deep-show failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
    }
    try {
      accessSync(SHOW_BIN, constants.X_OK);
    } catch {
      throw Error(`BLOCKED: ${SHOW_BIN} is missing or not executable`);
    }
  }, TIMEOUT);
}

// ---------------------------------------------------------------------------------------------------
// Folders: each test's own under /tmp/dh2694-*, removed after the file.

const made: string[] = [];
export function tempDir(tag: string): string {
  let dir: string;
  try {
    dir = mkdtempSync(`/tmp/dh2694-${tag}-`);
  } catch (error) {
    throw Error(`BLOCKED: no temporary folder: ${(error as Error).message}`);
  }
  made.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------------------------------
// The side: `deep-show canvas`, long-lived, one line at a time.

const started: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  // Only the processes this test started, by PID, each waited for.
  await Promise.all(started.splice(0).map((child) => new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return done();
    child.once('exit', () => done());
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* it has just ended */ }
  })));
});
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface Side {
  pid: number;
  /** Sends one line and resolves with the side's answer line, whole. */
  send(line: JsonObject): Promise<JsonObject>;
  /** `{"call": call}`: the answer line, whole (`ok`, `reply`, `presented`, and what README: held adds). */
  call(call: JsonObject): Promise<JsonObject>;
  close(): void;
}

/** Starts `deep-show canvas` and gives it the hub's world; BLOCKED when it can't start or refuses the world. */
export async function openSide(world: JsonObject): Promise<Side> {
  const child = spawn(SHOW_BIN, ['canvas'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  started.push(child);
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting: ((line: JsonObject) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value: JsonObject;
    try {
      const parsed = JSON.parse(line) as JsonValue;
      value = isObject(parsed) ? parsed : { ok: false, code: 'not_an_object', line: line.slice(0, 600) };
    } catch {
      value = { ok: false, code: 'bad_output', line: line.slice(0, 600) };
    }
    waiting.shift()?.(value);
  });
  const gone = () => { for (const wake of waiting.splice(0)) wake({ ok: false, code: 'canvas_core_exited', said: said.trim() }); };
  child.once('exit', gone);
  child.once('error', gone);
  const send = (line: JsonObject): Promise<JsonObject> => new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done({ ok: false, code: 'canvas_core_exited', said: said.trim() });
    waiting.push(done);
    child.stdin.write(`${JSON.stringify(line)}\n`);
  });
  const set = await send({ world });
  if (set['ok'] !== true) throw Error(`BLOCKED: deep-show canvas doesn't take the world: ${brief(set, 800)}`);
  if (!child.pid) throw Error('BLOCKED: deep-show canvas has no PID');
  return {
    pid: child.pid,
    send,
    call: (call) => send({ call }),
    close() {
      try { if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(child.pid, 'SIGKILL'); } catch { /* it has just ended */ }
    },
  };
}

/** The answer's reply, which every call this suite sends gets; the answer itself otherwise, for the message. */
export function replyOf(answer: JsonObject, what: string): JsonObject {
  must(answer['ok'] === true && isObject(answer['reply']), `${what}: the side answers ok with a reply; it answered ${brief(answer, 800)}`);
  return answer['reply'] as JsonObject;
}

/** README, held: the count of calls the side keeps, which every answer to a call carries. */
export function heldOf(answer: JsonObject, what: string): number {
  const held = answer['held'];
  must(typeof held === 'number' && Number.isInteger(held) && held >= 0, `the side's answer to ${what} doesn't say how many calls it holds (README: \`held\`, a whole number): \`held\` is ${brief(held)} in ${brief(answer, 300)}`);
  return held;
}

// ---------------------------------------------------------------------------------------------------
// The hub's world and its calls, shaped as packages/hub/src/canvas.ts shapes them.

export const SESSION = 'sess-2694';
export const DOC = '01JB7D00000000000000002694';

/** One session bound, one document minted on the app's canvas panel, no record objects: the world the hub sends. */
export function world(evidence: string): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-2694', name: 'Claude Code: terminal tab', process: { pid: 0, start: 0 } } },
    record: {},
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { [DOC]: { panel: 'main' } },
  };
}

const rect = (id: string, name: string, box: number[], order: string, role: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
function board(title: string, bar: number): JsonObject {
  return {
    format: 1,
    profile: 'board',
    title,
    description: `${title}, drawn by a test agent through deep_show.`,
    size: [320, 200],
    items: {
      back: rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
      bar: rect('bar', 'Progress bar', [16, 120, bar, 16], 'a1', 'muted'),
    },
  };
}
/** The first and the second document the agent shows: the second moves the bar on. */
export const FIRST = board('Build progress', 80);
export const SECOND = board('Build progress', 240);

/** deep_show from the session, as the hub sends it (hub-canvas.ts `show`). */
export const show = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc: DOC, document, include: ['issues'] });
/** The app's Terminal tab's read, every 250 ms (crates/deep-app/src/views.rs `read_terminal`), through `canvas.user`. */
export const CELLS: JsonObject = { call: 'cells', session: SESSION, tab: 'terminal' };
/** The hub's read of a document's revisions (hub-canvas.ts `show`, for a render-back of the current one). */
export const REVISIONS: JsonObject = { call: 'revisions', doc: DOC };

// ---------------------------------------------------------------------------------------------------
// The side's clock, and the merge base's replies for the same calls.

/** Flicks a second (crates/deep-show `shared::FLICKS`). */
export const FLICKS = 705_600_000;
/**
 * The side's clock as the merge base keeps it (crates/deep-show/src/main.rs `CANVAS_CLOCK`, `CANVAS_SPACING`): 120 Hz,
 * the latch 2 ms before vsync, half a millisecond a check, and each call ten frames after the one before, the first
 * at ten frames. "Replies are the ones given today for the same calls in the same order" keeps it.
 */
export const CLOCK = { refresh_hz: 120, lead: 1_411_200, check: 352_800 };
export const SPACING = 10 * (FLICKS / 120);
/** The calls whose time the merge base's side writes as `arrives` (their `at` means something else). */
const ARRIVES = ['deep_query', 'geometry', 'fn', 'deep_kinds'];

/**
 * The scenario the merge base's side builds for these calls (main.rs `CanvasSide::scenario_of_world`): the world, the
 * clock, and every call at its place on the clock, the n-th at n spacings.
 */
export function baseScenario(w: JsonObject, calls: JsonObject[]): JsonObject {
  return { ...w, clock: CLOCK, calls: calls.map((c, i) => ({ ...c, [ARRIVES.includes(String(c['call'])) ? 'arrives' : 'at']: (i + 1) * SPACING })) };
}

/**
 * The merge base's replies for these calls: its side plays them as this one scenario through a new hub, which is what
 * `deep-show run` (#393's stand-in, unchanged by this issue) runs, once. BLOCKED when it can't run.
 */
export function baseReplies(w: JsonObject, calls: JsonObject[]): JsonObject[] {
  const run = spawnSync(SHOW_BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(baseScenario(w, calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 10 * 60_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`BLOCKED: deep-show run couldn't run: ${run.error.message}`);
  let answer: JsonValue = null;
  try { answer = JSON.parse(run.stdout.split('\n').filter(Boolean).at(-1) ?? 'null') as JsonValue; } catch { /* below */ }
  if (!isObject(answer) || answer['ok'] !== true || !Array.isArray(answer['replies']) || answer['replies'].length !== calls.length) {
    throw Error(`BLOCKED: deep-show run gave no reply per call for the merge base's scenario (exit ${String(run.status)}): ${run.stdout.slice(0, 600)} ${run.stderr.slice(-600)}`);
  }
  return answer['replies'] as JsonObject[];
}

// ---------------------------------------------------------------------------------------------------
// Readings of the live side, from the kernel's own counters by the benchmarks' reader (benchmarks/process-reader.mjs,
// #2698): instructions retired, and the physical footprint, what macOS counts as the process's memory.

interface Reading { processes: { pid: number; instructions: number | null; footprintBytes: number | null }[] }
type Reader = { startReading(pid: number): { stop(): Reading }; readSinceStart(pid: number): Reading };
let reader: Reader | undefined;
async function processReader(): Promise<Reader> {
  reader ??= (await import(pathToFileURL(join(REPO, 'benchmarks', 'process-reader.mjs')).href)) as Reader;
  return reader;
}

/** The instructions the side retires answering one call; INCONCLUSIVE where the host can't read them (never 0). */
export async function instructionsOf(side: Side, call: JsonObject, what: string): Promise<{ answer: JsonObject; instructions: number }> {
  const span = (await processReader()).startReading(side.pid);
  const answer = await side.call(call);
  const reading = span.stop();
  const own = reading.processes.find((p) => p.pid === side.pid)?.instructions ?? null;
  if (own === null || own <= 0) throw Error(`INCONCLUSIVE: this host gives no count of the instructions the side retired for ${what} (benchmarks/process-reader.mjs read ${brief(reading)})`);
  return { answer, instructions: own };
}

/** The side's resident memory now, as its physical footprint in bytes (README: Memory); INCONCLUSIVE where it can't be read. */
export async function residentBytes(pid: number): Promise<number> {
  const reading = (await processReader()).readSinceStart(pid);
  const own = reading.processes.find((p) => p.pid === pid)?.footprintBytes ?? null;
  if (own === null || own <= 0) throw Error(`INCONCLUSIVE: this host gives no physical footprint for the side (PID ${pid}; benchmarks/process-reader.mjs read ${brief(reading)})`);
  return own;
}
export const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/** The median of a list of numbers. */
export function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
