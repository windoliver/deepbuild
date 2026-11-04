// #824 AC4, what holds on any machine: the per-session reading is in the local preflight; it reads every process
// DeepBuild runs for 1, 10 and 30 open, idle sessions (the hub, each session's deep mcp and deep mcp actions, each
// waiter, and their children), counting shared pages once; the sessions it reads really were open at the hub then (read
// back from the record, never from the benchmark's word); its growth per added session is recomputed here from the raw
// readings and its verdict must agree with it; and a platform that can't read the memory is BLOCKED, never PASS.
// The budget itself is budgets.long.test.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, MINUTE, recorded, REPO, sizesNamed } from '../helpers.ts';
import { AC4, bench, BENCH_PATH, COUNTS, CRITERION, grewMost, LIMIT, lineFrom, PER_SESSION_ROLES, perSessionGrowth, roleGrowth, ROLES, shown, TRANSCRIPT_BYTES, worded, type Line, type Ran, type Role } from './helpers.ts';

afterAll(cleanup, MINUTE);

const METHOD: Record<string, string> = { linux: 'pss', darwin: 'phys_footprint' };
/** The record's time stamps: milliseconds, or nanoseconds on some kinds. */
const msOf = (ts: number) => (ts > 1e14 ? Math.round(ts / 1e6) : ts);

let healthy: Promise<Ran> | undefined;
const run = () => (healthy ??= bench());

describe(`${AC4} ${CRITERION}: the per-session reading`, () => {
  it(`${AC4} the local preflight runs it: a lane in scripts/lanes.mjs or a task in benchmarks/budgets.json names ${BENCH_PATH}`, async () => {
    const lanes = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: unknown[]; releaseLanes: unknown[] };
    const budgets = readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8');
    const named = [JSON.stringify(lanes.checks), JSON.stringify(lanes.releaseLanes), budgets].some((text) => text.includes(BENCH_PATH));
    expect(named, `no lane or perf task runs ${BENCH_PATH}`).toBe(true);
  });

  it(`${AC4} 1, 10 and 30 sessions: every process DeepBuild runs for them read, summed, and the growth per added session computed from them`, async () => {
    const r = await run();
    const line = lineFrom(r);
    expect(line.platform, 'the platform it read on').toBe(process.platform);
    expect(line.method, `shared pages counted once: ${METHOD[process.platform] ?? 'no method on this platform'}`).toBe(METHOD[process.platform]);
    expect(line.limitBytes, 'the issue\'s limit, 25 MB per added session').toBe(LIMIT);
    expect(line.readings.map((x) => x.sessions), 'readings at 1, 10 and 30 sessions, in that order').toEqual(COUNTS);
    for (let i = 1; i < line.readings.length; i++) expect(line.readings[i]!.at, 'each reading after the last').toBeGreaterThan(line.readings[i - 1]!.at);

    for (const reading of line.readings) {
      const { sessions, processes } = reading;
      const at = `at ${sessions} sessions`;
      const own = processes.filter((p) => !p.child);
      expect(own.filter((p) => p.role === 'hub').length, `${at}: one hub`).toBe(1);
      for (const role of PER_SESSION_ROLES) expect(own.filter((p) => p.role === role).length, `${at}: one ${role} per session`).toBe(sessions);
      expect(new Set(processes.map((p) => p.pid)).size, `${at}: each process read once`).toBe(processes.length);
      for (const p of processes) {
        expect((ROLES as readonly string[]).includes(p.role), `${at}: a role the README names: ${JSON.stringify(p)}`).toBe(true);
        expect(Number.isSafeInteger(p.bytes) && p.bytes > 0, `${at}: a reading in bytes: ${JSON.stringify(p)}`).toBe(true);
        if (p.child) expect(processes.some((q) => q.pid === p.ppid), `${at}: a child is read under a process of the set: ${JSON.stringify(p)}`).toBe(true);
      }
      // Who each process is, by its command line as the OS shows it.
      const commands: [Role, RegExp][] = [['hub', /\bhub run\b/], ['deep mcp', /\bmcp$/], ['deep mcp actions', /\bmcp actions$/], ['waiter', /deep-hook\S* claude-code waiter$/]];
      for (const [role, shape] of commands) for (const p of own.filter((q) => q.role === role)) expect(p.command, `${at}: the ${role} runs as DeepBuild starts it`).toMatch(shape);
      expect(own.find((p) => p.role === 'hub')!.bytes, `${at}: the hub's own memory is measured, not a stub`).toBeGreaterThanOrEqual(5_000_000);
      for (const p of own.filter((q) => q.role === 'deep mcp')) expect(p.bytes, `${at}: a Node MCP server holds at least 1 MB of its own: ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(1_000_000);
      expect(reading.totalBytes, `${at}: the sum is the processes' readings summed`).toBe(processes.reduce((sum, p) => sum + p.bytes, 0));
    }
    const mcps = line.readings.at(-1)!.processes.filter((p) => p.role === 'deep mcp').map((p) => p.bytes);
    expect(new Set(mcps).size, 'the readings are measured, not one number repeated').toBeGreaterThan(1);

    const growth = perSessionGrowth(line);
    console.log(`#824 per added session: ${growth} B (${Object.fromEntries(ROLES.map((role) => [role, Math.round(roleGrowth(line, role))]))}); the benchmark says ${line.perSessionBytes} B, the most from ${line.grew.role}`);
    expect(Math.abs(line.perSessionBytes - growth), 'its reading is the most any step added per session').toBeLessThanOrEqual(1);
    expect(line.grew.role, 'the process that grew is the role that grew most per added session').toBe(grewMost(line));
    expect(Math.abs(line.grew.perSessionBytes - roleGrowth(line, line.grew.role)), 'with its own growth per added session').toBeLessThanOrEqual(1);

    // Its verdict agrees with the growth recomputed here.
    if (growth >= LIMIT) {
      expect(r.code, `${growth} B per added session is over the limit, so the run fails: ${shown(r)}`).not.toBe(0);
      const fail = worded(r, 'FAIL');
      expect(fail, `it prints a line starting FAIL: ${shown(r)}`).toBeDefined();
      expect(sizesNamed(fail!).some((n) => Math.abs(n - growth) <= growth * 0.15), `the FAIL line names the growth per added session: "${fail}" against ${growth} B`).toBe(true);
      expect(fail, 'and the process that grew').toContain(line.grew.role);
    } else {
      expect(worded(r, 'FAIL'), `${growth} B per added session is under the limit: no FAIL`).toBeUndefined();
      expect(r.code, `an under-limit run exits 0: ${shown(r)}`).toBe(0);
    }
    expect(worded(r, 'BLOCKED'), 'every reading was taken').toBeUndefined();
  }, 30 * MINUTE);

  it(`${AC4} the sessions it read were open and idle at the hub: started, stopped, not ended, as many as each reading says, each with its 32 MiB transcript`, async () => {
    const r = await run();
    const line = lineFrom(r);
    type Event = { kind: string; session_id?: string; session?: string; ts: number };
    const events = (await recorded(r.home)) as unknown as Event[];
    const sessionOf = (e: Event) => e.session_id ?? e.session;
    const first = (kind: string) => {
      const at = new Map<unknown, number>();
      for (const e of events) if (e.kind === kind && !at.has(sessionOf(e))) at.set(sessionOf(e), msOf(e.ts));
      return at;
    };
    const [started, stopped, ended] = [first('session.start'), first('agent.stop'), first('session.end')];
    expect(started.size, 'one session started for each of the 30 it reads at the end').toBe(COUNTS.at(-1));
    for (const reading of line.readings) {
      const open = [...started].filter(([s, t]) => t <= reading.at && !((ended.get(s) ?? Infinity) <= reading.at));
      expect(open.length, `sessions open at the hub when the reading at ${reading.sessions} was taken`).toBe(reading.sessions);
      expect(open.filter(([s]) => !((stopped.get(s) ?? Infinity) <= reading.at)).map(([s]) => s), `each open session's turn had stopped: idle, its waiter waiting`).toEqual([]);
    }
    const transcripts: string[] = [];
    const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.jsonl') && transcripts.push(join(dir, e.name)); };
    walk(join(r.home, '.claude', 'projects'));
    const sized = [...started.keys()].map((s) => transcripts.find((t) => t.endsWith(`${String(s)}.jsonl`)));
    expect(sized.filter((t) => !t || statSync(t).size < TRANSCRIPT_BYTES), `each session's transcript under the home holds at least ${TRANSCRIPT_BYTES} bytes`).toEqual([]);
  }, 30 * MINUTE);

  it(`${AC4} BLOCKED, never PASS, where the platform can't read a process's memory: sessions-no-memory-read`, async () => {
    const r = await bench({ plant: 'sessions-no-memory-read' });
    expect(r.code, `a BLOCKED run doesn't exit 0: ${shown(r)}`).not.toBe(0);
    expect(worded(r, 'BLOCKED'), `it prints a line starting BLOCKED: ${shown(r)}`).toBeDefined();
    expect(r.words, 'it never says PASS').not.toMatch(/\bPASS\b/);
    expect(worded(r, 'FAIL'), 'nothing was measured, so nothing failed').toBeUndefined();
    const line: Line | undefined = r.line;
    expect(line?.readings?.some((x) => x.processes.length > 0) ?? false, 'it prints no readings it could not take').toBe(false);
  }, 15 * MINUTE);
});
