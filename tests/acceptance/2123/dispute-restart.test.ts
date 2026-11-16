// #2123.750aef7f A dispute is settled as standing only after the redrafts its rule needs have run. Given a dispute
// whose first redraft passed on the work and whose second was never submitted (the hub stopped there), when the hub
// starts, then a second redraft job is submitted and the dispute has no outcome yet.
//
// The world is #1328's (tests/acceptance/1328/helpers.ts, imported): a real hub (`deep hub run --root`) with the real
// runner, record and test runner, a real git repository with an attempt's work on its branch, and a dispute raised
// through `acceptance.dispute`. Only the agent a runner job would launch stands in (#1328's fake Claude Code, which
// writes what the test plans for each job) and the forge (the hub's recorded GitHub answers).
//
// The hub is stopped where the criterion says, for real: the first redraft passes on the work, the hub saves that
// draft and turns to the second redraft; the moment the runner lists that job, before the hub has recorded it on the
// dispute, the hub's process is killed, by its PID. The same root is then started again, as #1328's stage starts one.
// Whether the stop landed there is read back from `acceptance.status`: the dispute must not list the job the stopped
// hub was submitting. A stop that came too late is no test of this criterion, and the scene is played again.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BLUE, ISSUE, NAME, NAVY, OWNER, REPO, Stage, redraft, removeTemp, type Dispute, type Line, type Status } from '../1328/helpers.ts';
import { AC, eventually } from './helpers.ts';

const CLI = join(REPO, 'packages/cli/dist/main.js');
const LINK = `https://github.com/${OWNER}/${NAME}/issues/${ISSUE}`;
/** The hubs this file started again, stopped by their own handles when the file ends. */
const restarted: ChildProcess[] = [];
afterAll(async () => {
  for (const child of restarted) child.kill('SIGTERM');
  await eventually(() => (restarted.every((c) => c.exitCode !== null || c.signalCode !== null) ? true : undefined), 15_000);
  for (const child of restarted) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  removeTemp();
}, 60_000);

/** The stage's hub among this process's own children: the one `deep hub run --root` started on its root. */
function hubPid(root: string): number {
  const rows = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m && Number(m[2]) === process.pid && m[3]!.includes(`hub run --root ${root}`) ? [Number(m[1])] : [];
  });
  if (rows.length !== 1) throw Error(`BLOCKED: ${rows.length} children of this process run the hub on ${root}, not one`);
  return rows[0]!;
}
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The hub's socket as the cli role, one line a call. */
class Hub {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, at)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(at + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  private async seen(probe: (line: Line) => boolean, what: string): Promise<Line> {
    const line = await eventually(() => this.lines.find(probe) ?? (this.sock.destroyed ? {} : undefined), 120_000, 20);
    if (!line || !probe(line)) throw Error(`BLOCKED: the restarted hub never sent ${what}`);
    return line;
  }
  static async open(socket: string, token: string): Promise<Hub> {
    const sock = net.connect(socket);
    await new Promise<void>((done, failed) => { sock.once('connect', done); sock.once('error', failed); });
    const hub = new Hub(sock);
    await hub.seen(() => true, 'its hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    await hub.seen((line) => line.role === 'cli', 'the cli role');
    return hub;
  }
  async call(method: string, params: Line): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.seen((line) => line.id === id, `its reply to ${method}`);
    if (reply.error) throw Error(`BLOCKED: the restarted hub refused ${method}: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}

/** Starts the hub on a root again, as #1328's stage starts it: the same command, HOME and recorded forge. */
async function startAgain(dir: string): Promise<Hub> {
  const root = join(dir, 'root');
  const child = spawn(process.execPath, [CLI, 'hub', 'run', '--root', root], {
    cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', DEEP_HUB_TEST_GITHUB: join(dir, 'forge.json') },
  });
  restarted.push(child);
  let out = '', err = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
  await eventually(() => (out.includes('\n') || child.exitCode !== null ? true : undefined), 300_000, 20);
  let socket: string | undefined;
  try { socket = (JSON.parse(out.split('\n')[0] ?? '') as Line).socket as string; } catch { /* no ready line */ }
  if (!socket) throw Error(`BLOCKED: the hub didn't start again on ${root}: ${err.slice(-1500)}`);
  return Hub.open(socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
}

interface Scene { stopped: string; first: string; dispute: Dispute; jobs: string[] }
/**
 * One play: a dispute whose first redraft passes on the work, the hub killed as it submits the second, and the hub
 * started again. `stopped` is the job the first hub was submitting; `dispute` and `jobs` are what the restarted hub
 * says once the dispute has an outcome or a second redraft, whichever comes first.
 */
async function play(): Promise<Scene> {
  const s = await Stage.open({});
  const pid = hubPid(join(s.dir, 'root'));
  try {
    const status = await s.ready(ISSUE, NAVY);
    const work = s.work(status);
    // The first redraft expects blue: it passes on the work and fails on the base at its assertion.
    s.plans.push(redraft(ISSUE, BLUE));
    const first = String((await s.dispute(work)).job);
    // The hub stopped there: the first draft is saved, and the second redraft is on its way to the runner.
    const stopped = await eventually(async () => (await s.jobs()).find((job) => job !== status.jobs[0] && job !== first), 600_000, 10);
    process.kill(pid, 'SIGKILL');
    if (!stopped) throw Error(`BLOCKED: the hub started no second redraft within 10 minutes of the dispute, so there was nowhere to stop it`);
    await eventually(() => (alive(pid) ? undefined : true), 60_000, 20);

    // When the hub starts.
    const hub = await startAgain(s.dir);
    try {
      await hub.call('windows.report', { agent: 'claude-code', account: '0a0a0a0a-1111-4222-8333-555555555555', rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 10_800 }, seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 400_000 } } });
      const read = async (): Promise<Dispute | undefined> => ((await hub.call('acceptance.status', { issue: LINK })) as unknown as Status).disputes.at(-1);
      const dispute = await eventually(async () => { const d = await read(); return d && (d.outcome !== null || d.jobs.length > 1) ? d : undefined; }, 600_000, 50) ?? await read();
      if (!dispute) throw Error(`BLOCKED: the restarted hub knows no dispute on ${LINK}`);
      const jobs = ((await hub.call('job.list', {})).jobs as Line[]).filter((j) => j.kind === 'acceptance').map((j) => String(j.job));
      return { stopped, first, dispute, jobs };
    } finally {
      hub.close();
    }
  } finally {
    // The stage's own close signals its hub by PID; that hub is gone, so its PID is no longer ours to signal.
    if (alive(pid)) await s.close();
  }
}

describe(`${AC.dispute} A dispute is settled as standing only after the redrafts its rule needs have run`, () => {
  it(`${AC.dispute} a dispute whose first redraft passed on the work, the hub stopped before the second was submitted: when the hub starts, a second redraft job is submitted and the dispute has no outcome yet`, async () => {
    let scene: Scene | undefined;
    for (let tries = 0; tries < 3; tries++) {
      scene = await play();
      // The stop landed where the criterion says when the dispute never recorded the job the stopped hub was submitting.
      if (!scene.dispute.jobs.includes(scene.stopped)) break;
      scene = undefined;
    }
    if (!scene) throw Error('BLOCKED: in three plays the hub recorded its second redraft before it could be stopped, so the Given never held');
    const said = `after the restart the dispute reads ${JSON.stringify(scene.dispute)}; the hub stopped while submitting ${scene.stopped}; acceptance jobs ${JSON.stringify(scene.jobs)}`;
    expect(scene.dispute.jobs[0], `the dispute's first redraft is still its first: ${said}`).toBe(scene.first);
    expect(scene.dispute.outcome, `the dispute has no outcome yet: ${said}`).toBeNull();
    expect(scene.dispute.jobs, `the dispute's redrafts, the first and the one the restarted hub submitted: ${said}`).toHaveLength(2);
    expect(scene.jobs, `the second redraft is a job the runner lists: ${said}`).toContain(scene.dispute.jobs[1]);
  }, 2_400_000);
});
