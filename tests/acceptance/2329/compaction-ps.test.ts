// #2329: a compaction in the process its session holds starts no `ps`. Through the real hub, with a `ps` on its PATH that
// logs every call, hooks sent as deep-hook sends them, and the agent a real process ps shows as Claude Code's binary.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sleep, withWorld } from './helpers.ts';

const SETTLE = 2500;

it('#2329.ac1 ten compactions from the process their session holds start no ps', async () => {
  await withWorld(async (w) => {
    const id = 'aaaaaaaa-2329-4000-8000-000000000001';
    const agent = w.agent();
    await w.hook(id, 'SessionStart', agent.pid, { source: 'startup' });
    // The second own hook makes the session watched: the hub's own once-a-half-minute check of its process reads ps
    // at its first tick, so let that go by before counting what the compactions do.
    await w.hook(id, 'SessionStart', agent.pid, { source: 'compact' });
    expect(await w.recorded(id, 'session.start', 2), 'setup: the start and a first compaction are recorded').toBe(2);
    await sleep(3500);
    expect(w.psCalls().length, "setup: the ps stand-in saw the start read the process (else it is not on the hub's PATH)").toBeGreaterThan(0);
    w.clearPsLog();

    for (let i = 0; i < 10; i++) await w.hook(id, 'SessionStart', agent.pid, { source: 'compact' });
    // Not merely acknowledged: all ten are in the record, checked as the session's own.
    expect(await w.recorded(id, 'session.start', 12), 'all ten compactions are recorded').toBe(12);
    await sleep(SETTLE);
    expect(w.starts(id), 'each compaction is checked against the session and bound to it').toEqual(Array(12).fill(0));
    expect(w.psCalls(), 'ps invocations over ten compactions in the held process').toEqual([]);
  });
}, 90_000);

it('#2329.ac2 a session resumed in a new process is bound to it, and the resume still reads the process', async () => {
  await withWorld(async (w) => {
    const id = 'aaaaaaaa-2329-4000-8000-000000000002';
    const a = w.agent();
    await w.hook(id, 'SessionStart', a.pid, { source: 'startup' });
    expect(await w.recorded(id, 'session.start', 1), 'setup: the start is recorded').toBe(1);
    // The first process goes away without a SessionEnd; a new Claude Code process resumes the session.
    await new Promise((resolve) => { a.once('exit', resolve); a.kill(); });
    const b = w.agent();
    w.clearPsLog();
    await w.hook(id, 'SessionStart', b.pid, { source: 'resume' });
    expect(await w.recorded(id, 'session.start', 2), 'the resume is recorded').toBe(2);
    await sleep(SETTLE);
    expect(w.psCalls(), "a resume in a new process reads that process's command line").toContain(`-o args= -p ${b.pid}`);
    // Bound to the new process: its next hook, a compaction, is the session's own too.
    await w.hook(id, 'SessionStart', b.pid, { source: 'compact' });
    expect(await w.recorded(id, 'session.start', 3), 'the compaction is recorded').toBe(3);
    expect(w.starts(id), 'the resume binds the session to the new process, and its compaction is checked as its own').toEqual([0, 0, 0]);
  });
}, 90_000);

it('#2329.ac2 a compaction from a PID another process took is refused', async () => {
  await withWorld(async (w) => {
    const id = 'aaaaaaaa-2329-4000-8000-000000000003';
    const agent = w.agent();
    await w.hook(id, 'SessionStart', agent.pid, { source: 'startup' });
    expect(await w.recorded(id, 'session.start', 1), 'setup: the start is recorded').toBe(1);
    // From here ps reads another start time for that PID, as it does once another process holds the PID.
    writeFileSync(join(w.home, 'reuse'), String(agent.pid));
    // This second hook makes the session watched; the hub's next check of its process sees the change and records it gone.
    await w.hook(id, 'SessionStart', agent.pid, { source: 'compact' });
    expect(await w.recorded(id, 'session.gone', 1), 'setup: the hub saw the PID taken by another process').toBe(1);
    await w.hook(id, 'SessionStart', agent.pid, { source: 'compact' });
    expect(await w.recorded(id, 'session.start', 3), 'the hook from the reused PID is recorded').toBe(3);
    expect(w.starts(id).at(-1), 'a compaction from a PID another process took is refused: its start is unverified').toBe(1);
  });
}, 90_000);
