// AC8 #70.047e3c2e: `systemctl --user restart` of the hub's service leaves a hosted terminal's program and a kept run
// running, and the hub reattaches both; a unit whose kept processes stay in its cgroup loses them at the restart and
// fails, naming the terminal.
//
// The hub is the real user service and the restart the real systemctl, whose default KillMode kills everything in the
// unit's cgroup. Scope names the mechanism: each program runs in a user scope of its own, outside the service's cgroup,
// read off /proc. A terminal counts as reattached when the new hub shows output written since the restart and its input
// reaches the program, which only the holder of the hub's lock can do (packages/extension-host/src/terminals.ts). A
// kept run counts as reattached when the new hub tracks a process the run starts after the restart. The kept run writes
// to its stdout throughout, as any run does, so one whose output pipe died with the old hub dies of SIGPIPE here.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC8, UNIT, allEvents, call, cgroupOf, cleanup, failure, mainPid, makeHome, notBlocked, own, requireBubblewrap, requireService, restartService, sleep, startOf, startService, tag, ulid,
  waitFor, type Home, type Hub,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface Tab { screen: string[]; scrollback: string[]; ended: boolean; input: boolean; notice: string | null }
const tabOf = async (hub: Hub, terminal: string) => (await call(hub, 'app', 'terminal.tab', { terminal })) as unknown as Tab;
/** The newest beat a terminal's tab shows. */
const beats = (tab: Tab): number => Math.max(0, ...[...tab.scrollback, ...tab.screen].flatMap((l) => [...l.matchAll(/beat (\d+)/g)].map((m) => Number(m[1]))));

/** A program on a hosted terminal: writes `beat N` ten times a second, and logs each line it reads. */
function terminalProgram(h: Home): { script: string; typed: string } {
  const typed = join(h.tmp, 'typed');
  const script = join(h.tmp, 'beats.sh');
  writeFileSync(script, `n=0\n( while :; do n=$((n+1)); echo "beat $n"; sleep 0.1; done ) &\nwhile IFS= read -r line; do printf '%s\\n' "$line" >> '${typed}'; done\n`);
  return { script, typed };
}
/** A kept run: notes its PID and each start, writes to stdout throughout, and starts a child when `fork` appears. */
function keptProgram(h: Home): { script: string; pid: string; starts: string; fork: string; child: string } {
  const [pid, starts, fork, child, script] = ['kept.pid', 'kept.starts', 'kept.fork', 'kept.child', 'kept.sh'].map((f) => join(h.tmp, f)) as [string, string, string, string, string];
  writeFileSync(script, `echo $$ > '${pid}'\necho started >> '${starts}'\nwhile :; do\n  echo tick\n  if [ -f '${fork}' ] && [ ! -f '${child}' ]; then sleep 600 & echo $! > '${child}'; fi\n  sleep 0.1\ndone\n`);
  return { script, pid, starts, fork, child };
}
async function trackedPids(hub: Hub, run: string, after = 0): Promise<number[]> {
  return (await allEvents(hub, after)).filter((e) => e.kind === 'process.tracked' && e.data.run === run).map((e) => Number(e.data.pid));
}

/** Where `pid` runs, as a problem naming `who`, or undefined when it is in a user scope outside the service's cgroup. */
function misplaced(who: string, pid: number): string | undefined {
  const cgroup = cgroupOf(pid);
  if (cgroup === undefined) return undefined; // a process of the run that already ended
  if (cgroup.includes(UNIT)) return `${who}: process ${pid} stays in the hub service's cgroup ${cgroup}`;
  return /\.scope$/.test(cgroup) ? undefined : `${who}: process ${pid} isn't in a user scope: ${cgroup}`;
}

async function scenario(plant?: string): Promise<void> {
  requireService();
  requireBubblewrap();
  const h = makeHome();
  const hub = await startService(h, { plant });
  const problems: string[] = [];

  // A hosted terminal and a kept run, both through the hub.
  const tp = terminalProgram(h);
  const t = (await call(hub, 'app', 'terminal.open', { argv: ['/bin/sh', tp.script], cwd: h.tmp, cols: 80, rows: 24, title: 'beats' })) as { terminal: string; run: string; pid: number };
  const terminal = `terminal ${t.terminal}`;
  own(t.pid);
  const kp = keptProgram(h);
  const { run } = (await call(hub, 'cli', 'run.start', { check: 'kept', claim: `claim:${ulid(Date.now())}`, commit: '0'.repeat(40), argv: ['/bin/sh', kp.script], cwd: h.tmp, keep: true })) as { run: string };
  const keptPid = await waitFor(() => (existsSync(kp.pid) ? Number(readFileSync(kp.pid, 'utf8')) || undefined : undefined), 30_000, `the kept run ${run} to start`);
  own(keptPid);
  const keptRun = `kept run ${run}`;

  // Every process of each sits in a scope of its own, outside the service's cgroup.
  const processes = async (name: string, runId: string, pid: number) => {
    const pids = await waitFor(async () => { const p = await trackedPids(hub, runId); return p.length ? p : undefined; }, 30_000, `${name}'s processes in the record`);
    pids.forEach(own);
    for (const p of new Set([...pids, pid])) { const wrong = misplaced(name, p); if (wrong) problems.push(wrong); }
  };
  await processes(terminal, t.run, t.pid);
  await processes(keptRun, run, keptPid);
  if (cgroupOf(t.pid) === cgroupOf(keptPid)) problems.push(`${terminal} and ${keptRun} share ${cgroupOf(t.pid)}: each runs in a scope of its own`);

  const seen = await waitFor(async () => { const n = beats(await tabOf(hub, t.terminal)); return n >= 3 ? n : undefined; }, 30_000, `${terminal} to show its output`);
  const before = { terminal: startOf(t.pid), kept: startOf(keptPid), hub: mainPid(), pos: (await allEvents(hub)).at(-1)!.log_pos };

  await restartService(hub);
  if (mainPid() === before.hub) throw Error('BLOCKED: the hub\'s service kept its PID through the restart');
  await sleep(1000);

  // Both programs run on, the same processes.
  const terminalLives = startOf(t.pid) !== undefined && startOf(t.pid) === before.terminal;
  const keptLives = startOf(keptPid) !== undefined && startOf(keptPid) === before.kept;
  if (!terminalLives) problems.push(`${terminal}: its program (PID ${t.pid}) died at the restart`);
  if (!keptLives) problems.push(`${keptRun}: its program (PID ${keptPid}) died at the restart`);

  // The new hub reattaches the terminal: output since the restart, and your input reaching the program.
  if (terminalLives) {
    try {
      const tab = await tabOf(hub, t.terminal);
      if (tab.ended || !tab.input) problems.push(`${terminal}: the new hub shows it ended or read-only: ${JSON.stringify({ ended: tab.ended, input: tab.input, notice: tab.notice })}`);
      await waitFor(async () => beats(await tabOf(hub, t.terminal)) > seen + 20, 30_000, `new output in ${terminal}`);
      const text = `typed-${tag()}`;
      await call(hub, 'app', 'terminal.input', { terminal: t.terminal, text: `${text}\r` });
      await waitFor(() => existsSync(tp.typed) && readFileSync(tp.typed, 'utf8').includes(text), 10_000, `the program in ${terminal} to read your input`);
    } catch (error) {
      problems.push(`${terminal}: the hub didn't reattach it: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The new hub reattaches the kept run: it tracks what the run starts now, and never started it again.
  if (keptLives) {
    writeFileSync(kp.fork, '');
    try {
      const child = await waitFor(() => (existsSync(kp.child) ? Number(readFileSync(kp.child, 'utf8')) || undefined : undefined), 10_000, `the kept run's child`);
      own(child);
      await waitFor(async () => (await trackedPids(hub, run, before.pos)).includes(child), 30_000, `the new hub to track process ${child} of ${keptRun}`);
    } catch (error) {
      problems.push(`${keptRun}: the hub didn't reattach it: ${error instanceof Error ? error.message : String(error)}`);
    }
    const starts = readFileSync(kp.starts, 'utf8').trim().split('\n').length;
    if (starts !== 1) problems.push(`${keptRun}: it was started ${starts} times; a restart reattaches it and never runs it again`);
  }

  if (problems.length) throw Error(`${AC8} ${problems.join('; ')}`);
}

describe(`${AC8} systemctl --user restart of the hub's service leaves a hosted terminal's program and a kept run running, and the hub reattaches both`, () => {
  it(`${AC8} each runs in a user scope of its own outside the service's cgroup, the same processes run on through the restart, and the new hub reattaches both`, () => scenario(), 300_000);

  it(`${AC8} (wrong program) a unit whose kept processes stay in its cgroup (kept-in-service-cgroup) loses them at the restart and fails, naming the terminal`, async () => {
    const message = await failure(() => scenario('kept-in-service-cgroup'));
    notBlocked(message);
    expect(message).toMatch(/terminal term:[0-9A-Za-z]+: its program \(PID \d+\) died at the restart/);
    expect(message).toMatch(/terminal term:[0-9A-Za-z]+: process \d+ stays in the hub service's cgroup/);
  }, 300_000);
});
