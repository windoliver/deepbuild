// AC3, the hub's check-run deadline: the `deadline:` a check gives in the repo's `.deepbuild/done.yaml`, which deep_run
// passes to its run. A deadline past 2³¹ − 1 ms (`30d`) waits its full time; one that isn't a positive whole number of
// ms as done.yaml writes it (`0m`, `-5m`, `1.5h`, `soon`, `.inf`) is refused before the run starts, naming the field
// and the value as written; a check with no `deadline:` still runs with none.
//
// Read as (README, The surface under test, 4): a real hub process can't be put on a fake clock (its core runs in a
// worker thread of its own process, where this test's timers can't reach), so the hub's core runs in this process:
// `Core`, the class the hub runs in its worker (and inline, `coreInline`), loaded from the hub's build
// (`packages/hub/dist/core.js`, typed by `packages/hub/src/core.ts`), given its clock by injection (`CoreOptions.clock`). The session is met the way the hub meets one whose hook the hub missed:
// a SessionStart line, as deep-hook writes it, in the root's spool, which the core replays as it starts. The session's
// deep mcp calls go in as `mcp.call` with the session bound, as the server forwards them: deep_claim, then deep_run.
// Everything under the core is real: the record, the supervisor and the sandbox, so the check's command is a real
// process. The fake clock (helpers.ts, `fakeClock`) is turned on once the core has started, before deep_run.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// helpers.ts first: it sets HOME to a temp folder before the hub's modules load.
import { DAY, MAX_TIMER, MINUTE, THIRTY_DAYS, advance, alive, fakeClock, namesValue, own, realSleep, stopOwn, tempDir, tracked, until } from './helpers.ts';
import type { Core } from '../../../packages/hub/src/core.ts';

/**
 * The hub's core as the hub runs it: its built module, since the core reads process start times from a thread it
 * starts from its own folder's children-worker.js, which only the build writes (README, How to run).
 */
const BUILT = new URL('../../../packages/hub/dist/core.js', import.meta.url);
async function coreClass(): Promise<typeof Core> {
  if (!existsSync(BUILT)) throw Error('BLOCKED: packages/hub/dist/core.js is missing; build the hub first: node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json');
  return ((await import(BUILT.href)) as typeof import('../../../packages/hub/src/core.ts')).Core;
}

type Ev = { log_pos: number; kind: string; ts: number; subject?: string; session?: string; data?: Record<string, unknown> };
const COMMIT = 'c0ffee0000000000000000000000000000000822';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A hook request's ID, a ULID as deep-hook makes one. */
function ulid(): string {
  let s = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) s = CROCKFORD[Number(t & 31n)] + s;
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}

interface Hub {
  core: Core;
  events(): Promise<Ev[]>;
  runsOf(check: string): Promise<{ started?: Ev; finished?: Ev }>;
  /** deep_claim, then deep_run of `check`, as the session's deep mcp sends them; deep_run's answer or refusal, tracked. */
  run(check: string): Promise<ReturnType<typeof tracked<unknown>>>;
  close(): Promise<void>;
}
const hubs: Hub[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const h of hubs.splice(0)) await h.close();
  stopOwn();
}, 60_000);

/** A repo whose done.yaml names `checks`, a session in it met through the spool, and the hub's core started on a fresh root. */
async function openHub(checks: Record<string, string | undefined>): Promise<Hub> {
  const dir = tempDir('hub');
  const SESSION = randomUUID();
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  const lines = ['checks:'];
  for (const [name, deadline] of Object.entries(checks)) {
    lines.push(`  ${name}:`, '    type: command', `    run: "sh -c 'sleep 3600; : dh822${name}'"`);
    if (deadline !== undefined) lines.push(`    deadline: ${deadline}`);
  }
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), `${lines.join('\n')}\n`);
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
  const core = new (await coreClass())({ root, clock: { start: Date.now(), real: Date.now() }, held: [] }, () => undefined);
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
  // The spooled SessionStart is replayed as the core starts; its session is met once session.start is recorded.
  expect(await until(async () => (await events()).some((e) => e.kind === 'session.start' && e.session === SESSION), 30_000), `precondition: the core met session ${SESSION} from the spool`).toBe(true);
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
      const claimed = await mcp('deep_claim', { task_ref: `session:${SESSION.replace(/[^0-9A-Za-z]/g, '')}#start`, attempt: 1, commit: COMMIT, scope: 'session', predictions: null });
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
  it('AC3 hub deep_run: a check with deadline: 30d is still running after 24.8 days on a fake clock, and ends overran at 30 days', async () => {
    const h = await openHub({ month: '30d' });
    fakeClock();
    const going = await h.run('month');
    expect(await until(async () => (await h.runsOf('month')).started !== undefined, 30_000), 'the check run started').toBe(true);
    const run = String((await h.runsOf('month')).started!.subject ?? (await h.runsOf('month')).started!.data?.run);
    expect(await until(async () => (await leader(h, run)) !== undefined, 30_000), 'its process was tracked').toBe(true);
    const pid = await leader(h, run);

    // Just after its start: Node keeps a delay past 2³¹ − 1 ms as 1 ms, so a deadline armed with it stops the run here.
    await realSleep(1_500);
    const start = await h.runsOf('month');
    expect(start.finished?.data, `a 30-day deadline ended the run at its start: ${JSON.stringify(start.finished?.data)}`).toBeUndefined();
    expect(alive(pid), `its process ${String(pid)} is alive`).toBe(true);

    await advance(MAX_TIMER + MINUTE);
    await realSleep(300);
    const past = await h.runsOf('month');
    expect(past.finished?.data, `ended before 30 days, after 24.8: ${JSON.stringify(past.finished?.data)}`).toBeUndefined();
    expect(alive(pid), 'its process is alive after 24.8 days').toBe(true);

    await advance(THIRTY_DAYS - MINUTE - (MAX_TIMER + MINUTE));
    await realSleep(300);
    expect((await h.runsOf('month')).finished?.data, 'ended a minute before 30 days').toBeUndefined();

    await advance(2 * MINUTE);
    expect(await until(async () => (await h.runsOf('month')).finished !== undefined, 30_000), 'no run.finished within 30 s of real time once 30 days passed').toBe(true);
    const end = (await h.runsOf('month')).finished!;
    expect(end.data?.outcome, `ended at its deadline: ${JSON.stringify(end.data)}`).toBe('overran');
    expect(alive(pid), 'its process is gone').toBe(false);
    await Promise.race([going.promise.catch(() => undefined), realSleep(5_000)]);
  }, 180_000);
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
    it(`AC3 hub deep_run: a check with deadline: ${bad.written} is refused before its run starts, naming deadline and ${bad.written}`, async () => {
      const h = await openHub({ odd: bad.written });
      // deep_run waits a while for a run's outcome; a refusal comes at once, so 10 s without an answer is no refusal.
      const got = await said(Promise.race([(await h.run('odd')).promise, realSleep(10_000).then(() => ({ unanswered: 'deep_run gave no answer within 10 s' }))]));
      await realSleep(500);
      const { started, finished } = await h.runsOf('odd');
      expect(started?.data, `a run started for a check with deadline: ${bad.written}`).toBeUndefined();
      if (!got.threw) expect(words(got.value).join(' '), `deep_run answered as if the check ran: ${got.text}`).not.toMatch(/\b(passed|overran|running)\b/);
      expect(finished, 'no run finished').toBeUndefined();
      expect(got.text, `the refusal names the field: ${got.text}`).toContain('deadline');
      expect(bad.names.some((n) => namesValue(got.text, n)), `the refusal names the value ${bad.written} as written: ${got.text}`).toBe(true);
    }, 60_000);
  }

  it('AC3 hub deep_run: a check with no deadline: still runs with none, after 60 days on a fake clock', async () => {
    const h = await openHub({ open: undefined });
    fakeClock();
    await h.run('open');
    expect(await until(async () => (await h.runsOf('open')).started !== undefined, 30_000), 'the check run started').toBe(true);
    const run = String((await h.runsOf('open')).started!.subject ?? (await h.runsOf('open')).started!.data?.run);
    expect(await until(async () => (await leader(h, run)) !== undefined, 30_000), 'its process was tracked').toBe(true);
    const pid = await leader(h, run);
    await advance(60 * DAY);
    await realSleep(500);
    expect((await h.runsOf('open')).finished?.data, 'a check with no deadline ended within 60 days').toBeUndefined();
    expect(alive(pid), 'its process is alive after 60 days').toBe(true);
  }, 180_000);
});
