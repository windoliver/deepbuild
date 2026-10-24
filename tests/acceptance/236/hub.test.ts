// #236 through the hub (#16): AC2, a process your agent built run by the hub's supervisor and kept off the
// hub's socket and an agent's inbox socket; AC7, a crash's leftovers reaped on restart from the record alone,
// with a decoy left running; AC13's hub half, every start, signal and wait of a check run going through the
// `host@1` the test harness put in place of `local`. These tests reach the hub only through `deep hub run`,
// its socket and the files under its root (README, The surface: the hub).
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, binsIn, cleanup, Client, closeListeners, COMMIT, crashHub, expectDenied, own, ownPidDir, pidsIn, proc, runFinished, startHub, stopHub, sub,
  tempDir, tried, ulid, unixListener, waitFor, type Line,
} from './helpers.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

const claim = () => `claim:${ulid()}`;

describe('AC2 #236.0c11913d a process your agent built can\'t reach the hub\'s socket or a session\'s inbox socket', () => {
  it('AC2 run by the hub\'s supervisor, it fails to connect to the hub\'s socket and to CLAUDE_CODE_MESSAGING_SOCKET, and the message it tries to post starts no turn', async () => {
    const dir = tempDir();
    const hub = await startHub(sub(dir, 'root'));
    const inbox = await unixListener(join(sub(dir, 'cc'), 'inbox.sock'));
    const cwd = sub(dir, 'run');
    const b = binsIn(cwd);
    const out = sub(cwd, 'out');
    const file = join(out, 'tries.json');
    const client = await Client.open(hub);
    try {
      const before = (await client.events()).length;
      const { run } = await client.call('run.start', {
        check: 'agent-built', claim: claim(), commit: COMMIT, cwd, grant: { write: [out] },
        argv: [b.probe, '-o', file, 'unix', hub.socket, 'unix', inbox.path],
        env: { CLAUDE_CODE_MESSAGING_SOCKET: inbox.path },
      });
      await runFinished(client, run as string);
      expectDenied(tried(file, 'unix', hub.socket), 'a connect to the hub\'s socket');
      expectDenied(tried(file, 'unix', inbox.path), 'a connect to the session\'s inbox socket');
      expect(inbox.connections, 'the inbox socket was reached').toBe(0);
      expect(inbox.text(), 'a message reached the inbox, which would start a turn').toBe('');
      const after = (await client.events()).slice(before);
      expect(after.filter((e) => e.writer === 'hook').map((e) => e.kind), 'the hub took a hook line from the sandboxed process').toEqual([]);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 60_000);
});

describe('AC7 #236.61bc1ccd a crash\'s leftovers are reaped on restart, and a decoy survives', () => {
  it('AC7 after kill -9 of the hub, a restart that finds only the record reaps every process of the run (setsid, bare and late-forked included) and leaves a look-alike with no token running', async () => {
    const dir = tempDir();
    const root = sub(dir, 'root');
    const hub = await startHub(root);
    const cwd = sub(dir, 'run');
    const b = binsIn(cwd);
    const pids = ownPidDir(sub(cwd, 'pids'));
    const client = await Client.open(hub);
    const { run } = await client.call('run.start', { check: 'crash-check', claim: claim(), commit: COMMIT, cwd, grant: { write: [pids] }, argv: [b.tree, pids, 'all'] });
    const roles = ['server', 'a', 'b', 'g'] as const;
    const left = new Map<string, number>();
    for (const role of roles) left.set(role, await waitFor(() => pidsIn(pids)[role]?.[0], 10_000, `the run's ${role} process`));
    await waitFor(() => proc(left.get('g')!)?.command === 'sleep 600', 5000, 'the late grandchild to exec');
    // Each is owned in the record before the crash.
    await waitFor(async () => {
      const tracked = (await client.events()).filter((e: Line) => e.kind === 'process.tracked' && e.data?.run === run).map((e: Line) => e.data.pid as number);
      return [...left.values()].every((pid) => tracked.includes(pid));
    }, 10_000, `process.tracked for each of ${[...left.entries()].map(([r, p]) => `${r} ${p}`).join(', ')}`);
    // A decoy: the same program, in the same folder, started by hand with no run token.
    const decoyPids = ownPidDir(sub(dir, 'decoy'));
    const decoy = spawn(b.tree, [decoyPids, 'all'], { cwd, env: { PATH: '/usr/bin:/bin' }, detached: true, stdio: 'ignore' });
    own(decoy.pid);
    const decoys: number[] = [];
    for (const role of roles) decoys.push(await waitFor(() => pidsIn(decoyPids)[role]?.[0], 10_000, `the decoy's ${role} process`));

    client.close();
    await crashHub(hub);
    for (const [role, pid] of left) expect(alive(pid), `BLOCKED: the run's ${role} (${pid}) died with the hub, so there is nothing to reap`).toBe(true);
    // Only the record is left: ownership lives in the event log.
    for (const name of readdirSync(root)) if (!/^ledger\.db/.test(name) && name !== 'evidence') rmSync(join(root, name), { recursive: true, force: true });

    const again = await startHub(root);
    try {
      for (const [role, pid] of left) await waitFor(() => !alive(pid), 15_000, `the crash's leftover ${role} (PID ${pid}) to be reaped`);
      for (const pid of decoys) expect(alive(pid), `the decoy ${pid}, which has no run token, was stopped`).toBe(true);
    } finally {
      await stopHub(again);
    }
  }, 90_000);
});

/** The recording host the test harness puts in place of `local`: it logs every call, then hands it on. */
function recordingHost(dir: string): { module: string; log: string } {
  const module = join(dir, 'recording-host.mjs');
  const log = join(dir, 'host.log');
  writeFileSync(module, `import { appendFileSync } from 'node:fs';
const log = (entry) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
export default function recording(local) {
  return {
    name: local.name,
    async start(spec) { log({ call: 'start', run: spec.run }); return local.start(spec); },
    async signal(run, signal) { log({ call: 'signal', run, signal }); return local.signal(run, signal); },
    async wait(run) { log({ call: 'wait', run }); return local.wait(run); },
    facts: () => local.facts(),
  };
}
`);
  writeFileSync(log, '');
  return { module, log };
}
const logOf = (file: string): Line[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);

/** One deterministic check run on a hub; its outcome and evidence. */
async function checkRun(client: Client, cwd: string, check: string): Promise<{ run: string; outcome: unknown; evidence: unknown }> {
  const b = binsIn(cwd);
  const { run } = await client.call('run.start', { check, claim: claim(), commit: COMMIT, cwd, argv: [b.probe, 'print', 'the check ran'] });
  const finished = await runFinished(client, run as string);
  return { run: run as string, outcome: finished.data.outcome, evidence: finished.data.evidence };
}

/** AC13's hub half: a check run's start, wait and signal all show in the recording host's log. */
async function throughHost(plant?: string): Promise<void> {
  const dir = tempDir();
  const local = await startHub(sub(dir, 'local'));
  const host = recordingHost(dir);
  const recorded = await startHub(sub(dir, 'recorded'), { DEEP_HUB_TEST_HOST: host.module, ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
  const a = await Client.open(local);
  const c = await Client.open(recorded);
  try {
    const onLocal = await checkRun(a, sub(dir, 'r1'), 'unit');
    const check = 'unit';
    const onHost = await checkRun(c, sub(dir, 'r2'), check);
    const calls = logOf(host.log).filter((l) => l.run === onHost.run).map((l) => l.call);
    if (!calls.includes('start')) throw Error(`the check ${check}'s run ${onHost.run} started a process the host's log doesn't show`);
    expect(calls, `the check ${check}'s run waited through the host`).toContain('wait');
    expect({ outcome: onHost.outcome, evidence: onHost.evidence }, 'the verdict and evidence on the recording host equal those on local').toEqual({ outcome: onLocal.outcome, evidence: onLocal.evidence });
    // A run in flight when the hub stops is signalled through the host.
    const cwd = sub(dir, 'r3');
    const b = binsIn(cwd);
    const { run } = await c.call('run.start', { check: 'slow', claim: claim(), commit: COMMIT, cwd, argv: [b.probe, 'sleep', '30000'] });
    await waitFor(() => logOf(host.log).some((l) => l.run === run && l.call === 'start'), 5000, `the start of ${run as string} in the host's log`);
    c.close();
    await stopHub(recorded);
    expect(logOf(host.log).filter((l) => l.run === run).map((l) => l.call), `the hub's stop signalled ${run as string} through the host`).toContain('signal');
  } finally {
    a.close();
    c.close();
    await stopHub(local);
    await stopHub(recorded);
  }
}

describe('AC13 #236.6e7cc737 check runs start, signal and wait only through host@1 (the hub\'s half)', () => {
  it('AC13 with a recording host in place of local, a check run\'s start, wait and signal each show in its log, and its outcome and evidence equal those on local', async () => {
    await throughHost();
  }, 90_000);

  it('AC13 (wrong program) a hub whose check runs spawn their process themselves leaves a start out of the log and fails, naming the check', async () => {
    await expect(throughHost('run-spawns-itself')).rejects.toThrow(/the check unit's run .* started a process the host's log doesn't show/);
  }, 90_000);
});
