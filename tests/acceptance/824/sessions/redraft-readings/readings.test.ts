// #824 AC4, what holds on any machine: the per-session reading is in the local preflight; at 1, 10 and 30 sessions it
// reads and sums every process DeepBuild runs for them (checked against the OS's own process table, and on Linux
// against each process's Pss read by this test); its growth per added session, the role that grew and its verdict are
// recomputed from its raw readings; the sessions it read were open and idle at the hub (from the record, through
// events.read), each with its 32 MiB transcript; and a platform that can't read memory is BLOCKED, never PASS.
// The 25 MB budget itself counts only on the reference Mac (README, Choices).
import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC4, bench, BENCH_PATH, cleanupRun, COUNTS, LIMIT, lineFrom, mergeBase, MINUTE, perSession, recorded, REPO, ROLES,
  shown, sizesNamed, TRANSCRIPT_BYTES, worded, type Line, type Ran, type Reading, type Role, type Sample,
} from './helpers.ts';

// One healthy run serves the second and third tests: 30 sessions with 32 MiB transcripts each is minutes and a GB of
// disk. Whichever test comes first starts it; its home is removed only after the file, so neither test's cleanup can
// take the other's data.
let shared: Promise<Ran> | undefined;
const healthy = () => (shared ??= bench({ args: ['--merge-base'] }));
afterAll(async () => { if (shared) await cleanupRun(await shared.catch(() => undefined)); }, MINUTE);

const at = (line: Line, n: number): Reading => {
  const r = line.readings.find((x) => x.sessions === n);
  expect(r, `a reading at ${n} sessions: ${JSON.stringify(line.readings.map((x) => x.sessions))}`).toBeDefined();
  return r!;
};
const own = (r: Reading, role: Role) => r.processes.filter((p) => p.role === role && !p.child);
/** What a role's processes, its children included, hold together in one reading. */
const roleBytes = (r: Reading, role: Role) => r.processes.filter((p) => p.role === role).reduce((s, p) => s + p.bytes, 0);
/** The command of each role's own process, as the OS shows it: `deep mcp actions` is not `deep mcp`. */
const COMMAND: Record<Role, RegExp> = { hub: /\bhub\b/, 'deep mcp': /\bmcp\b(?!\s+actions\b)/, 'deep mcp actions': /\bmcp\s+actions\b/, waiter: /\bwaiter\b/ };
/** Each own process's least size, in bytes: Node for the hub (with its SQLite record) and the MCP servers, Rust for the waiter. */
const FLOOR: Record<Role, number> = { hub: 10_000_000, 'deep mcp': 3_000_000, 'deep mcp actions': 3_000_000, waiter: 100_000 };
/** No process DeepBuild runs holds 2 GB idle: a number past it is virtual size, not memory. */
const CEILING = 2_000_000_000;
/** A role named in words, where `deep mcp` must not match inside `deep mcp actions`. */
const names = (text: string, role: Role) => (role === 'deep mcp' ? /deep mcp(?!\s+actions)/ : new RegExp(role)).test(text);

/** The last look at the table that ended before `t`, and the first that began after it. */
function around(samples: Sample[], t: number): [Sample | undefined, Sample | undefined] {
  return [samples.filter((s) => s.t1 <= t).at(-1), samples.find((s) => s.t0 >= t)];
}

describe(`${AC4} On the reference Mac, compared with the merge base, each session added past the first raises the summed memory of DeepBuild's own processes by under 25 MB: the per-session reading`, () => {
  it(`${AC4} the local preflight runs it: a lane in scripts/lanes.mjs or a task in benchmarks/budgets.json names ${BENCH_PATH}`, async () => {
    const lanes = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: unknown[]; releaseLanes: unknown[] };
    const budgets = readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8');
    const named = [JSON.stringify(lanes.checks), JSON.stringify(lanes.releaseLanes), budgets].some((text) => text.includes(BENCH_PATH));
    expect(named, `no lane or perf task runs ${BENCH_PATH}`).toBe(true);
  });

  it(`${AC4} at 1, 10 and 30 sessions every process DeepBuild runs for them is read and summed; the growth per added session, the process that grew and the verdict agree with the raw readings`, async () => {
    const r = await healthy();
    if (process.platform !== 'linux' && process.platform !== 'darwin') {
      expect(r.code, `no way to read memory here: ${shown(r)}`).not.toBe(0);
      expect(worded(r, 'BLOCKED'), `BLOCKED on ${process.platform}: ${shown(r)}`).toBeDefined();
      expect(r.words).not.toMatch(/\bPASS\b/);
      return;
    }
    const line = lineFrom(r);
    expect([line.platform, line.method, line.limitBytes], 'the platform, its method that counts shared pages once, and the issue\'s limit')
      .toEqual([process.platform, process.platform === 'linux' ? 'pss' : 'phys_footprint', LIMIT]);
    expect(line.readings.map((x) => x.sessions), 'one reading at each of the issue\'s counts, in order').toEqual([...COUNTS]);
    expect(line.readings.map((x) => x.at), 'each reading taken after the one before').toEqual([...line.readings.map((x) => x.at)].sort((a, b) => a - b));

    let hubPid: number | undefined;
    let earlier = new Set<number>();
    for (const reading of line.readings) {
      const n = reading.sessions;
      const where = `at ${n} sessions`;
      const pids = reading.processes.map((p) => p.pid);
      expect(new Set(pids).size, `${where}: each process read once`).toBe(pids.length);
      for (const p of reading.processes) {
        expect(ROLES, `${where}: a role of the surface's: ${JSON.stringify(p)}`).toContain(p.role);
        expect(Number.isSafeInteger(p.bytes) && p.bytes > 0 && p.bytes < CEILING, `${where}: memory in bytes: ${JSON.stringify(p)}`).toBe(true);
        if (!p.child) {
          expect(p.command, `${where}: the ${p.role}'s command, as the OS shows it`).toMatch(COMMAND[p.role]);
          expect(p.bytes, `${where}: a ${p.role} holds at least ${FLOOR[p.role]} bytes: ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(FLOOR[p.role]);
        } else {
          const parent = reading.processes.find((q) => q.pid === p.ppid);
          expect(parent, `${where}: a child runs under a process that was read: ${JSON.stringify(p)}`).toBeDefined();
          expect(parent!.role, `${where}: a child takes its parent's role`).toBe(p.role);
        }
      }
      expect(reading.totalBytes, `${where}: the total is the sum of what was read`).toBe(reading.processes.reduce((s, p) => s + p.bytes, 0));
      // One hub, and one of each per open session.
      const hubs = own(reading, 'hub');
      expect(hubs.length, `${where}: one hub`).toBe(1);
      hubPid ??= hubs[0]!.pid;
      expect(hubs[0]!.pid, 'the same hub at every count').toBe(hubPid);
      for (const role of ['deep mcp', 'deep mcp actions', 'waiter'] as const) expect(own(reading, role).length, `${where}: one ${role} per session`).toBe(n);
      // Sessions are added and stay open: what was read before is read again.
      const ownPids = new Set(reading.processes.filter((p) => !p.child).map((p) => p.pid));
      expect([...earlier].filter((pid) => !ownPids.has(pid)), `${where}: every session read before is still open`).toEqual([]);
      earlier = ownPids;

      // The OS's own table: each process read was running then, with that parent and that command...
      for (const p of reading.processes) {
        const seen = r.samples.map((s) => s.procs.get(p.pid)).find((x) => x && x.ppid === p.ppid && (x.args.includes(p.command.replace(/\s+/g, ' ').trim()) || p.command.replace(/\s+/g, ' ').includes(x.args)));
        expect(seen, `${where}: process ${p.pid} (${p.role}) ran, under ${p.ppid}, as "${p.command}"`).toBeDefined();
      }
      // ...and every process alive under a read process across the reading was read.
      const [pre, post] = around(r.samples, reading.at);
      if (n < 30) expect(pre && post, `${where}: the test saw the table on both sides of the reading`).toBeTruthy();
      if (pre && post) {
        const read = new Set(pids);
        const missed = [...post.procs].filter(([pid, x]) => read.has(x.ppid) && !read.has(pid) && pre.procs.get(pid)?.args === x.args)
          .map(([pid, x]) => `${pid} under ${x.ppid}: ${x.args}`);
        expect(missed, `${where}: processes running under DeepBuild's across the reading, not read`).toEqual([]);
      }
    }

    // On Linux the test reads each process's Pss itself: the 30-session total must be the same memory, within a quarter.
    if (line.method === 'pss') {
      const last = at(line, 30);
      const near = r.samples.filter((s) => last.processes.every((p) => s.procs.get(p.pid)?.pss !== undefined))
        .sort((a, b) => Math.abs(a.t0 - last.at) - Math.abs(b.t0 - last.at))[0];
      expect(near && Math.abs(near.t0 - last.at) < 30_000, 'the test read every process\'s Pss within 30 s of the 30-session reading').toBe(true);
      const ours = last.processes.reduce((s, p) => s + near!.procs.get(p.pid)!.pss!, 0);
      expect(last.totalBytes / ours, `the benchmark's total (${last.totalBytes}) beside the Pss the test read (${ours})`).toBeGreaterThan(0.75);
      expect(last.totalBytes / ours, `the benchmark's total (${last.totalBytes}) beside the Pss the test read (${ours})`).toBeLessThan(1.33);
    }

    // The reading, recomputed.
    const total = (n: number) => at(line, n).totalBytes;
    expect(Math.abs(line.perSessionBytes - perSession(total)), 'the growth per added session, from the totals').toBeLessThanOrEqual(1);
    const byRole = ROLES.map((role) => ({ role, growth: perSession((n) => roleBytes(at(line, n), role)) }));
    const most = Math.max(...byRole.map((x) => x.growth));
    expect(byRole.filter((x) => x.growth >= most - 1).map((x) => x.role), `the role that grew most per added session: ${JSON.stringify(byRole)}`).toContain(line.grew.role);
    expect(Math.abs(line.grew.perSessionBytes - byRole.find((x) => x.role === line.grew.role)!.growth), 'the role\'s growth per added session').toBeLessThanOrEqual(1);
    expect(line.mergeBase?.commit, 'the merge base it compares with').toBe(mergeBase());
    expect(typeof line.mergeBase?.perSessionBytes === 'number' || (typeof line.mergeBase?.initial === 'string' && line.mergeBase.initial.length > 0),
      `the merge base's reading, or the reason in words why it has none: ${JSON.stringify(line.mergeBase)}`).toBe(true);

    // The verdict agrees with the reading.
    expect(worded(r, 'BLOCKED'), `it read memory, so nothing is BLOCKED: ${shown(r)}`).toBeUndefined();
    if (line.perSessionBytes >= LIMIT) {
      expect(r.code, `over 25 MB a session it fails: ${shown(r)}`).not.toBe(0);
      const fail = worded(r, 'FAIL');
      expect(fail, `a line starting FAIL: ${shown(r)}`).toBeDefined();
      expect(sizesNamed(fail!).some((b) => Math.abs(b - line.perSessionBytes) <= 0.15 * line.perSessionBytes), `it names the growth per added session: ${fail}`).toBe(true);
      expect(names(fail!, line.grew.role), `it names the process that grew, ${line.grew.role}: ${fail}`).toBe(true);
    } else {
      expect(worded(r, 'FAIL'), `under 25 MB a session nothing fails: ${shown(r)}`).toBeUndefined();
      expect(r.code, `under 25 MB a session it exits 0: ${shown(r)}`).toBe(0);
    }
  }, 45 * MINUTE);

  it(`${AC4} the sessions read were open and idle at the hub when read, each with its own 32 MiB transcript`, async () => {
    const r = await healthy();
    const line = lineFrom(r);
    // The transcripts the benchmark left in its home, one per session, named by its ID.
    const projects = join(r.home, '.claude', 'projects');
    const transcripts = readdirSync(projects).flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => join(projects, d, f)));
    const ids = new Set(transcripts.map((f) => f.slice(f.lastIndexOf('/') + 1, -'.jsonl'.length)));
    expect(ids.size, `30 sessions, each with its transcript: ${transcripts.join(', ')}`).toBe(30);
    for (const file of transcripts) {
      expect(statSync(file).size, `${file} holds at least 32 MiB`).toBeGreaterThanOrEqual(TRANSCRIPT_BYTES);
      const fd = openSync(file, 'r');
      const head = Buffer.alloc(65_536);
      const got = readSync(fd, head, 0, head.length, 0);
      closeSync(fd);
      const lines = head.subarray(0, got).toString('utf8').split('\n').slice(0, -1);
      expect(lines.length, `${file} is written in lines`).toBeGreaterThan(0);
      for (const text of lines) expect(() => JSON.parse(text), `${file}: a transcript line is one JSON object`).not.toThrow();
    }

    // The record, through events.read on the benchmark's home: never the benchmark's word.
    type Ev = { kind: string; session_id?: string | null; ts: number; data?: unknown };
    const events = (await recorded(r.home)) as unknown as Ev[];
    const data = (e: Ev) => (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Record<string, unknown>;
    const started = events.filter((e) => e.kind === 'session.start');
    expect(new Set(started.map((e) => e.session_id)), 'the hub met exactly the 30 sessions whose transcripts were written').toEqual(ids);
    expect(new Set(started.map((e) => String(data(e).worktree))).size, 'each session in a working folder of its own').toBe(30);
    const TURN = ['user.ask', 'tool.before', 'tool.after', 'agent.stop'];
    for (const n of COUNTS) {
      const reading = at(line, n);
      const before = events.filter((e) => e.ts <= reading.at);
      const open = new Set(before.filter((e) => e.kind === 'session.start').map((e) => e.session_id));
      expect(open.size, `${n} sessions had started at the hub when ${n} were read`).toBe(n);
      expect(before.filter((e) => e.kind === 'session.end').map((e) => e.session_id), `none had ended when ${n} were read`).toEqual([]);
      for (const s of open) {
        const turn = before.filter((e) => e.session_id === s && TURN.includes(e.kind));
        expect(turn.some((e) => e.kind === 'user.ask'), `session ${s} had a prompt before ${n} were read`).toBe(true);
        expect(turn.at(-1)?.kind, `session ${s} was idle when ${n} were read: its turn had stopped, with nothing after`).toBe('agent.stop');
      }
    }
  }, 45 * MINUTE);

  it(`${AC4} BLOCKED, never PASS, where the platform can't read memory: sessions-no-memory-read`, async () => {
    let r: Ran | undefined;
    try {
      r = await bench({ plant: 'sessions-no-memory-read' });
      expect(r.code, `a BLOCKED run doesn't exit 0: ${shown(r)}`).not.toBe(0);
      expect(worded(r, 'BLOCKED'), `a line starting BLOCKED: ${shown(r)}`).toBeDefined();
      expect(r.words, 'it never says PASS').not.toMatch(/\bPASS\b/);
      expect(worded(r, 'FAIL'), 'nothing was measured, so nothing failed').toBeUndefined();
      const taken = (r.line?.readings ?? []).filter((x) => typeof x.totalBytes === 'number' || x.processes?.some((p) => typeof p.bytes === 'number'));
      expect(taken, 'no readings printed as taken').toEqual([]);
      expect(typeof r.line?.perSessionBytes, 'no growth printed as read').not.toBe('number');
    } finally {
      await cleanupRun(r);
    }
  }, 45 * MINUTE);
});
