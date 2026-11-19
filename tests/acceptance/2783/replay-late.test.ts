// #2783: a hub core that couldn't start, on a root where a spool file is waiting, asks for no further spool replay
// once a hook reaches it; the spool stays for the next start; a core that started replays a late spool as before.
//
// Every core here runs in a process of its own (core-child.mjs), never in this worker: at the base the failed-start
// core spins its whole process once a hook reaches it, and no timer of that process fires again. This file starts
// each child, reads the log the child appends synchronously, and kills the child by PID at its limit, so at the base
// AC1 fails at that limit and the run goes on.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHILD = fileURLToPath(new URL('./core-child.mjs', import.meta.url));
const DEEP_HOOK = fileURLToPath(new URL('../../../target/debug/deep-hook', import.meta.url));
/** Real time a loaded machine gets for a core's start, or its failure to start, and for each later step of a core that started. */
const ROOM = 120_000;
/** Real time the failed-start core's process gets after the hook reached it: the 2 s window, stop()'s 5 s, and room. Then SIGKILL. */
const LIMIT = 30_000;

type Line = { step: string; at: number; ms?: number; how?: string; why?: string; starts?: { session: string | null; log_pos: number }[]; spool?: boolean };
interface Run { lines: Line[]; killed: string | undefined; code: number | null; signal: NodeJS.Signals | null }

const temp = mkdtempSync(join(tmpdir(), 'dh2783-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A hook request's ID, a ULID as deep-hook makes one. */
function ulid(): string {
  let s = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) s = CROCKFORD[Number(t & 31n)] + s;
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}

interface Fixture { home: string; root: string; spool: string; spooled: string; line: string; hook: { session: string; cwd: string; transcript: string } }
/** A temp HOME and a root of its own for one test: the session a spool line starts, and the session whose hook reaches the core. */
function fixture(name: string): Fixture {
  const home = join(temp, name);
  const root = join(home, 'deepbuild');
  const cwd = join(home, 'work');
  mkdirSync(join(root, 'spool'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(home, '.claude', 'projects', 'dh2783'), { recursive: true });
  const session = () => {
    const id = randomUUID();
    const transcript = join(home, '.claude', 'projects', 'dh2783', `${id}.jsonl`);
    writeFileSync(transcript, '');
    return { session: id, cwd, transcript };
  };
  const spooled = session();
  // One SessionStart line, as deep-hook spools a request.
  const line = `${JSON.stringify({
    v: 1, agent: 'claude-code', event: 'SessionStart', seq: String(BigInt(Date.now()) * 1_000_000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
    payload: { session_id: spooled.session, transcript_path: spooled.transcript, cwd, hook_event_name: 'SessionStart', source: 'startup' },
  })}\n`;
  return { home, root, spool: join(root, 'spool', 'spool.jsonl'), spooled: spooled.session, line, hook: session() };
}

function read(log: string): Line[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
}
/**
 * One core in its own process. It gets `startRoom` to reach `step` and `after` from there to end by itself; past
 * either, it is killed (SIGKILL, by its PID) and the run says which limit it met.
 */
async function child(f: Fixture, mode: 'failed-start' | 'start' | 'late-spool', step: string, after: number): Promise<Run> {
  const log = join(f.home, `${mode}-${randomUUID().slice(0, 8)}.log`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(DEEP_|DH2783_|GH_|GITHUB_|CLAUDE_|CODEX_|VITEST|NODE_OPTIONS$)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: f.home, CLAUDE_CONFIG_DIR: join(f.home, '.claude'), CODEX_HOME: join(f.home, '.codex'), XDG_CONFIG_HOME: join(f.home, '.config'), DH2783_PLAN: JSON.stringify({ mode, root: f.root, log, hook: f.hook, late: f.line }) });
  const proc = spawn(process.execPath, [CHILD], { env, stdio: 'ignore' });
  let ended: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exit = new Promise<void>((done) => proc.on('exit', (code, signal) => { ended = { code, signal }; done(); }));
  const began = Date.now();
  let killed: string | undefined;
  while (!ended) {
    const reached = read(log).find((l) => l.step === step);
    if (!reached && Date.now() - began > ROOM) killed = `it didn't reach "${step}" within ${ROOM} ms`;
    else if (reached && Date.now() - reached.at > after) killed = `it was still running ${after} ms after "${step}"`;
    if (killed) {
      proc.kill('SIGKILL');
      await exit;
      break;
    }
    await Promise.race([exit, new Promise((tick) => setTimeout(tick, 100))]);
  }
  return { lines: read(log), killed, code: ended!.code, signal: ended!.signal };
}
const steps = (run: Run) => run.lines.filter((l) => l.step !== 'tick').map((l) => l.step).join(' > ');
const of = (starts: Line['starts'], session: string) => (starts ?? []).filter((s) => s.session === session);
function needsDeepHook(): void {
  if (!existsSync(DEEP_HOOK)) throw Error('BLOCKED: target/debug/deep-hook is missing, and a core starts only with it; build it first: cargo build -p deep-hook');
}

describe('#2783: a core whose start failed (ledger.db a folder) on a root with spool/spool.jsonl waiting, after one hook reaches it', () => {
  let f: Fixture;
  let bytes: Buffer;
  let run: Run;
  beforeAll(async () => {
    f = fixture('failed');
    mkdirSync(join(f.root, 'ledger.db'));
    writeFileSync(f.spool, f.line);
    bytes = readFileSync(f.spool);
    run = await child(f, 'failed-start', 'hook-sent', LIMIT);
  }, ROOM + LIMIT + 60_000);

  it('AC1: a 50 ms timer in its process keeps firing (at least 20 times in 2 s), and stop() settles within 5 s', () => {
    // Preconditions: the state the criterion names was reached, with the timer seen firing before the hook.
    const at = (step: string) => run.lines.find((l) => l.step === step);
    expect(at('start-rejected'), `precondition: the core's start failed (${steps(run)})`).toBeDefined();
    expect(at('timer-fires-before-the-hook'), `precondition: the 50 ms timer fired before the hook (${steps(run)})`).toBeDefined();
    expect(at('hook-sent'), `precondition: one hook reached the core (${steps(run)})`).toBeDefined();

    const ticks = run.lines.filter((l) => l.step === 'tick' && l.ms! <= 2000).length;
    expect(ticks, `the 50 ms timer fired ${ticks} times in the 2 s after the hook; the core's process: ${run.killed ? `killed, ${run.killed}` : `ended by itself, status ${run.code}`}`).toBeGreaterThanOrEqual(20);

    const stop = at('stop-settled');
    expect(stop, `stop() settled (${steps(run)}); the core's process: ${run.killed ? `killed, ${run.killed}` : `ended by itself, status ${run.code}`}`).toBeDefined();
    expect(stop!.ms, 'stop() settled within 5 s').toBeLessThanOrEqual(5000);
    expect(run.killed, 'the core\'s process ended by itself, inside its limit').toBeUndefined();
  });

  it('AC2: after that, spool/spool.jsonl holds the same bytes, and a core started on the same root once ledger.db can open records the spooled session\'s start once', async () => {
    needsDeepHook();
    // "After that": AC1's run. Where it didn't end by itself this test fails here, and still reads the rest.
    expect.soft(run.lines.some((l) => l.step === 'stop-settled') && !run.killed, `"after that": the failed-start core took its hook and stopped (${steps(run)}${run.killed ? `; killed, ${run.killed}` : ''})`).toBe(true);

    expect.soft(existsSync(f.spool), 'spool/spool.jsonl is still there').toBe(true);
    expect.soft(existsSync(f.spool) ? readFileSync(f.spool).equals(bytes) : false, 'spool/spool.jsonl holds the same bytes').toBe(true);

    // ledger.db can open again: the folder in its place is gone.
    expect(statSync(join(f.root, 'ledger.db')).isDirectory(), 'precondition: ledger.db was still the folder').toBe(true);
    rmSync(join(f.root, 'ledger.db'), { recursive: true });
    const next = await child(f, 'start', 'started', ROOM);
    expect(next.lines.some((l) => l.step === 'started'), `precondition: a core started on the same root (${steps(next)}; ${next.lines.find((l) => l.why)?.why ?? next.killed ?? ''})`).toBe(true);
    const starts = next.lines.find((l) => l.step === 'starts')?.starts;
    expect(starts, `the started core's record was read (${steps(next)}${next.killed ? `; killed, ${next.killed}` : ''})`).toBeDefined();
    expect(of(starts, f.spooled).length, `session.start events of the spooled session, of ${JSON.stringify(starts)}`).toBe(1);
  }, 2 * ROOM + 60_000);
});

describe('#2783: no change for a core that started', () => {
  it('AC3: a core that started still replays a spool written after its start, on its next hook, once', async () => {
    needsDeepHook();
    const f = fixture('late');
    const run = await child(f, 'late-spool', 'started', 3 * ROOM);
    expect(run.lines.some((l) => l.step === 'started'), `precondition: the core started (${steps(run)}; ${run.lines.find((l) => l.why)?.why ?? run.killed ?? ''})`).toBe(true);
    expect(run.lines.some((l) => l.step === 'spool-written'), `precondition: the spool was written after the start (${steps(run)})`).toBe(true);
    expect(run.lines.find((l) => l.step === 'hook-settled')?.how, `precondition: the core took its next hook (${steps(run)})`).toBe('resolved');

    // Once the next hook's own event is in the record, so is the spooled session's start: the hook replayed the spool.
    const then = run.lines.find((l) => l.step === 'starts-after-the-hook')?.starts;
    expect(then, `the record was read after the hook (${steps(run)}${run.killed ? `; killed, ${run.killed}` : ''})`).toBeDefined();
    expect(of(then, f.hook.session).length, `precondition: the hook's own session.start is recorded, of ${JSON.stringify(then)}`).toBe(1);
    expect(of(then, f.spooled).length, `session.start events of the spooled session once the hook's own is recorded, of ${JSON.stringify(then)}`).toBe(1);

    // Once: 5 s later the record holds no second one.
    const later = run.lines.find((l) => l.step === 'starts-later')?.starts;
    expect(later, `the record was read again 5 s later (${steps(run)}${run.killed ? `; killed, ${run.killed}` : ''})`).toBeDefined();
    expect(of(later, f.spooled).length, `session.start events of the spooled session 5 s later, of ${JSON.stringify(later)}`).toBe(1);
    expect(run.killed, 'the core\'s process ended by itself, inside its limit').toBeUndefined();
  }, 4 * ROOM + 60_000);
});
