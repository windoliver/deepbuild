// #822 AC3, the hub's check-run deadline, redrafted blind after #2073 (REDRAFT.md): the `deadline:` a check gives in
// the repo's `.deepbuild/done.yaml`, which deep_run passes to its run. A deadline past 2³¹ − 1 ms (`30d`) waits its
// full time; one that isn't a positive whole number of ms as done.yaml writes it (`0m`, `-5m`, `1.5h`, `soon`, `.inf`)
// is refused before the run starts, naming the field and the value as written.
//
// The surface is the original's (tests/acceptance/822/README.md, The surface under test, 4): the hub's core in this
// process, constructed by `createCore` from `packages/hub/dist/hub-runtime.js` with `CoreOptions.clock` injected, a
// session met through a SessionStart line in the root's spool, its deep mcp calls sent as `mcp.call` with the session
// bound (deep_claim, then deep_run), and the fake clock of the frozen helpers turned on once the core has started.
//
// What #2073's Scope changes is the fixture, and nothing a test asserts of the deadline: deep_run is refused in a
// project the core's trust decision doesn't mark trusted, and in a trusted one runs the check on the claim's commit
// in a temporary checkout, as a claim's checks run. So the repo is a git repo with one commit, the core's decision
// marks it trusted before the core starts (as #2073's own suite records it), the claim is made at that commit with
// the worktree as the commit holds it, and each check's command is `node hold.mjs`, a file of the commit: one Node
// process that runs for an hour and prints nothing, which the base's deep_run runs with /bin/sh and a claim's checks
// count (design: Traced programs), where the original's `sh -c 'sleep 3600; …'` is uncounted before a process starts.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The frozen suite's helpers first: they set HOME to a temp folder before the hub's modules load.
import { MAX_TIMER, MINUTE, THIRTY_DAYS, alive, fakeClock, namesValue, own, realSleep, stopOwn, tempDir, tracked, until } from '../822/helpers.ts';
import { openRecord, openTrust } from '../../../packages/record/src/index.ts';
import type { Core } from '../../../packages/hub/src/core.ts';

/**
 * The hub's core as the hub runs it: its built module, since the core reads process start times from a thread it
 * starts from its own folder's children-worker.js, which only the build writes (tests/acceptance/822/README.md, How to run).
 */
const BUILT = new URL('../../../packages/hub/dist/hub-runtime.js', import.meta.url);
async function coreFactory(): Promise<typeof import('../../../packages/hub/src/hub-runtime.ts').createCore> {
  if (!existsSync(BUILT)) throw Error('BLOCKED: packages/hub/dist/hub-runtime.js is missing; build the hub first: node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json');
  return ((await import(BUILT.href)) as typeof import('../../../packages/hub/src/hub-runtime.ts')).createCore;
}

// The check's `node` is this test's own Node both ways: a run as you finds it on this process's PATH, and the command
// check kind links the Node its hub runs on.
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;

type Ev = { log_pos: number; kind: string; ts: number; subject?: string; session?: string; data?: Record<string, unknown> };
/** Real time a loaded machine gets for one step of a run: its start, its first process, its end once its deadline passed. */
const ROOM = 120_000;
/** hold.mjs, as #822's checks-command test writes it: its process runs for an hour of real time and prints nothing. */
const HOLD = 'setTimeout(() => {}, 3_600_000);\n';
/** One step of the fake clock: short beside the minute each reading leaves around the deadline. */
const STEP = 10_000;
/**
 * Moves the fake clock ahead, running each timer that comes due, as the frozen helpers' `advance` does, but a step at
 * a time: the promise work the timers queue runs after each step, within 10 s of fake time, and the rest of the event
 * loop's work once the move ends. `advance` gives the event loop a turn after every timer, and on this base a run's
 * start puts the supervisor's 100 ms scan of its sandbox on the fake clock, 864,000 timers a fake day: there 30 days
 * take 40 minutes and more of real time (REDRAFT.md, The fake clock's steps).
 */
async function move(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= STEP) {
    vi.advanceTimersByTime(Math.min(left, STEP));
    await new Promise<void>((drained) => { process.nextTick(drained); });
  }
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A hook request's ID, a ULID as deep-hook makes one. */
function ulid(): string {
  let s = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) s = CROCKFORD[Number(t & 31n)] + s;
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}
/** git in the fixture repo, with the test's own HOME and no hooks, signing or system config; a failure is BLOCKED. */
function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
    }).trim();
  } catch (error) {
    throw Error(`BLOCKED: git ${args.join(' ')} failed in the fixture repo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Hub {
  core: Core;
  events(): Promise<Ev[]>;
  runsOf(check: string): Promise<{ started?: Ev; finished?: Ev }>;
  /** deep_claim at the repo's commit, then deep_run of `check`, as the session's deep mcp sends them; deep_run's answer or refusal, tracked. */
  run(check: string): Promise<ReturnType<typeof tracked<unknown>>>;
  close(): Promise<void>;
}
const hubs: Hub[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const h of hubs.splice(0)) await h.close();
  stopOwn();
}, 180_000);

/**
 * A git repo whose one commit holds hold.mjs and a done.yaml naming `checks`, each with its deadline as written; the
 * core's decision marking it trusted (your answer on the trusted path, appended to the root's record through
 * `openTrust` before the core starts; the temp HOME holds no Claude Code workspace trust and no Codex config); a
 * session in it met through the spool; and the hub's core started on that root.
 */
async function openHub(checks: Record<string, string>): Promise<Hub> {
  const dir = tempDir('hub');
  const SESSION = randomUUID();
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  const lines = ['checks:'];
  for (const [name, deadline] of Object.entries(checks)) lines.push(`  ${name}:`, '    type: command', `    run: "node hold.mjs dh822${name}"`, `    deadline: ${deadline}`);
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), `${lines.join('\n')}\n`);
  writeFileSync(join(repo, 'hold.mjs'), HOLD);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'fixture');
  const commit = git(repo, 'rev-parse', 'HEAD');
  const projects = join(process.env.HOME!, '.claude', 'projects', 'dh822');
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, `${SESSION}.jsonl`);
  writeFileSync(transcript, '');
  const root = join(dir, 'deepbuild');
  mkdirSync(join(root, 'spool'), { recursive: true });
  const line = {
    v: 1, agent: 'claude-code', event: 'SessionStart', seq: String(BigInt(Date.now()) * 1_000_000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
    payload: { session_id: SESSION, transcript_path: transcript, cwd: repo, hook_event_name: 'SessionStart', source: 'startup' },
  };
  writeFileSync(join(root, 'spool', 'spool.jsonl'), `${JSON.stringify(line)}\n`);
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
  try {
    await (await openTrust({ record, now: Date.now })).answer({ writer: 'app', actor: 'you', scope: 'you' }, repo, true);
  } finally {
    await record.close();
  }
  const core = (await coreFactory())({ root, clock: { start: Date.now(), real: Date.now() }, held: [] }, () => undefined);
  await core.started();
  const events = async (): Promise<Ev[]> => {
    const out: Ev[] = [];
    for (let after = 0; ;) {
      const page = (await core.call('events.read', { after, limit: 1000 }, { role: 'cli' })) as { log_pos: number; events: string };
      const evs = JSON.parse(page.events) as Ev[];
      out.push(...evs);
      if (evs.length < 1000) return out;
      after = page.log_pos;
    }
  };
  const mcp = (tool: string, args: Record<string, unknown>) => core.call('mcp.call', { tool, arguments: args }, { role: 'mcp', session: SESSION });
  const runsOf = async (check: string) => {
    const all = await events();
    const started = all.find((e) => e.kind === 'run.started' && e.data?.check === check);
    const finished = started ? all.find((e) => e.kind === 'run.finished' && (e.subject === started.subject || e.data?.run === started.data?.run)) : undefined;
    // The run's processes, by the IDs the supervisor recorded for it: stopped by them if a test leaves them.
    for (const e of all) if (started && e.kind === 'process.tracked' && (e.subject === started.subject || e.data?.run === started.data?.run)) own(Number(e.data?.pgid ?? e.data?.pid));
    return { ...(started ? { started } : {}), ...(finished ? { finished } : {}) };
  };
  let closed = false;
  const hub: Hub = {
    core, events, runsOf,
    run: async (check) => {
      const claimed = await mcp('deep_claim', { task_ref: `session:${SESSION.replace(/[^0-9A-Za-z]/g, '')}#start`, attempt: 1, commit, scope: 'session', predictions: null });
      expect(JSON.stringify(claimed), `precondition: deep_claim records the session's claim: ${JSON.stringify(claimed).slice(0, 600)}`).toMatch(/claim:/);
      return tracked(mcp('deep_run', { check, claim: null }));
    },
    close: async () => {
      if (closed) return;
      closed = true;
      vi.useRealTimers();
      // Each run that started and hasn't finished: its process group, once the supervisor tracked it (its sandbox can
      // take seconds to start), kept to be stopped by its ID if the hub's own stop leaves it.
      const open = async (): Promise<Ev[]> => {
        const all = await events();
        const of = (e: Ev, run: Ev) => e.subject === run.subject || e.data?.run === run.data?.run;
        for (const e of all) if (e.kind === 'process.tracked') own(Number(e.data?.pgid ?? e.data?.pid));
        return all.filter((r) => r.kind === 'run.started' && !all.some((e) => (e.kind === 'run.finished' || e.kind === 'process.tracked') && of(e, r)));
      };
      await until(async () => (await open()).length === 0, 30_000);
      // events.read builds its next page on a setImmediate with no catch: let it run before the record closes.
      await realSleep(100);
      await core.stop('test').catch(() => undefined);
    },
  };
  hubs.push(hub);
  // The fixture's own state, read back before any test reads a run: the session met from the spool, which the core
  // replays as it starts, and the trust decision in the core's record. Either missing is the fixture's, never a result.
  if (!(await until(async () => (await events()).some((e) => e.kind === 'session.start' && e.session === SESSION), ROOM))) throw Error(`BLOCKED: the core didn't meet session ${SESSION} from the spool within ${ROOM / 1000} s`);
  if (!(await events()).some((e) => e.kind === 'decision.created' && e.data?.answer === 'trusted')) throw Error('BLOCKED: the record holds no trust decision for the fixture repo');
  return hub;
}
/** The pid of a run's leader, as the supervisor recorded it. */
async function leader(h: Hub, run: string): Promise<number | undefined> {
  const e = (await h.events()).find((x) => x.kind === 'process.tracked' && (x.subject === run || x.data?.run === run));
  return typeof e?.data?.pid === 'number' ? e.data.pid : undefined;
}
/** Every string a value holds, one a line (a refusal's message and its value among them). */
const words = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(words) : v && typeof v === 'object' ? Object.values(v).flatMap(words) : [];
async function said(p: Promise<unknown>): Promise<{ threw: boolean; text: string; value?: unknown }> {
  try {
    const value = await p;
    return { threw: false, text: words(value).join('\n'), value };
  } catch (error) {
    return { threw: true, text: [error instanceof Error ? error.message : String(error), ...words((error as { refusal?: unknown })?.refusal)].join('\n') };
  }
}

describe('AC3 #822 a check run\'s deadline of 30d in done.yaml waits its full time', () => {
  it('AC3 hub deep_run: a check with deadline: 30d is still running after 24.8 days on a fake clock, and ends overran at 30 days (redraft 2073)', async () => {
    const h = await openHub({ month: '30d' });
    fakeClock();
    // The fake clock just before deep_run is called: the run's deadline is armed no earlier, so it is due no earlier
    // than 30 days from here, however long this machine takes to start the run and its process.
    const t0 = Date.now();
    const reach = (at: number): Promise<void> => move(at - Date.now());
    const going = await h.run('month');
    // deep_run answers once its run is recorded as started (with its outcome, or `running` when its wait runs out),
    // so an answer with no run.started is a refusal; neither within the wait is this machine's, not a result.
    await until(async () => going.settled() || (await h.runsOf('month')).started !== undefined, ROOM);
    const begun = (await h.runsOf('month')).started;
    if (!begun && !going.settled()) throw Error(`INCONCLUSIVE: no run.started for the check and no answer from deep_run within ${ROOM / 1000} s of real time`);
    expect(begun, `the check run started; deep_run answered with no run: ${begun ? '' : (await said(going.promise)).text}`).toBeDefined();
    const run = String(begun!.subject ?? begun!.data?.run);
    // Its process, or its end with none, which is read below as ended at its start.
    if (!(await until(async () => (await leader(h, run)) !== undefined || (await h.runsOf('month')).finished !== undefined, ROOM))) throw Error(`INCONCLUSIVE: ${run} started, and within ${ROOM / 1000} s of real time no process of it was tracked and it didn't end`);
    const pid = await leader(h, run);

    // Just after its start: Node keeps a delay past 2³¹ − 1 ms as 1 ms, so a deadline armed with it stops the run here.
    await realSleep(1_500);
    // The fake clock with the run's process started: its deadline is armed by now, so it is due within 30 days of here.
    const t1 = Date.now();
    const start = await h.runsOf('month');
    expect(start.finished?.data, `a 30-day deadline ended the run at its start: ${JSON.stringify(start.finished?.data)}`).toBeUndefined();
    expect(alive(pid), `its process ${String(pid)} is alive`).toBe(true);

    await reach(t1 + MAX_TIMER + MINUTE);
    await realSleep(300);
    const past = await h.runsOf('month');
    expect(past.finished?.data, `ended before 30 days, after 24.8: ${JSON.stringify(past.finished?.data)}`).toBeUndefined();
    expect(alive(pid), 'its process is alive after 24.8 days').toBe(true);

    await reach(t0 + THIRTY_DAYS - MINUTE);
    await realSleep(300);
    const before = await h.runsOf('month');
    // The fake clock moves with real time too: a reading that itself came 30 days after t0 can't say the run ended early.
    if (before.finished && Date.now() - t0 >= THIRTY_DAYS) throw Error('INCONCLUSIVE: over a minute of real time passed between the fake clock reaching a minute before 30 days and the reading, so the run\'s end by then says nothing');
    expect(before.finished?.data, 'ended a minute before 30 days').toBeUndefined();

    await reach(t1 + THIRTY_DAYS + MINUTE);
    expect(await until(async () => (await h.runsOf('month')).finished !== undefined, ROOM), `no run.finished within ${ROOM / 1000} s of real time once 30 days passed`).toBe(true);
    const end = (await h.runsOf('month')).finished!;
    expect(end.data?.outcome, `ended at its deadline: ${JSON.stringify(end.data)}`).toBe('overran');
    expect(alive(pid), 'its process is gone').toBe(false);
    await Promise.race([going.promise.catch(() => undefined), realSleep(5_000)]);
  }, 600_000);
});

describe('AC3 #822 a check run\'s deadline in done.yaml that is not a positive whole number of ms is refused before the run starts, naming it', () => {
  // As done.yaml writes them: zero, a negative, a fraction, no number at all, and YAML's infinity.
  const BAD_WRITTEN: { written: string; names: string[] }[] = [
    { written: '0m', names: ['0m'] },
    { written: '-5m', names: ['-5m'] },
    { written: '1.5h', names: ['1.5h'] },
    { written: 'soon', names: ['soon'] },
    // YAML reads `.inf` as a number, so a hub may name it as written or as the number it read.
    { written: '.inf', names: ['.inf', 'Infinity'] },
  ];
  for (const bad of BAD_WRITTEN) {
    it(`AC3 hub deep_run: a check with deadline: ${bad.written} is refused before its run starts, naming deadline and ${bad.written} (redraft 2073)`, async () => {
      const h = await openHub({ odd: bad.written });
      // A refusal is deep_run's answer with no run, and a hub that takes the deadline starts a run before it answers:
      // the wait ends at the answer or at a run's start; neither within the wait is this machine's, not a result.
      const going = await h.run('odd');
      await until(async () => going.settled() || (await h.runsOf('odd')).started !== undefined, ROOM);
      if (!going.settled() && !(await h.runsOf('odd')).started) throw Error(`INCONCLUSIVE: no answer from deep_run and no run.started for the check within ${ROOM / 1000} s of real time`);
      const got = going.settled() ? await said(going.promise) : { threw: false, text: 'deep_run gave no answer: it holds it for the run that started', value: {} };
      await realSleep(500);
      const { started, finished } = await h.runsOf('odd');
      expect(started?.data, `a run started for a check with deadline: ${bad.written}`).toBeUndefined();
      if (!got.threw) expect(words(got.value).join(' '), `deep_run answered as if the check ran: ${got.text}`).not.toMatch(/\b(passed|overran|running)\b/);
      expect(finished, 'no run finished').toBeUndefined();
      expect(got.text, `the refusal names the field: ${got.text}`).toContain('deadline');
      expect(bad.names.some((n) => namesValue(got.text, n)), `the refusal names the value ${bad.written} as written: ${got.text}`).toBe(true);
    }, 300_000);
  }
});
