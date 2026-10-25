// #315 AC1 and AC13: deep-hook fails open fast. With the hub stopped (in each way a hub can be stopped) a normal
// command is allowed in under 50 ms; with a hub that is there but late (three test hubs) the fail_closed entries
// in rules.json apply, everything else is allowed, within 50 ms of the hook's start, and each call is spooled
// marked late, then recorded once, marked late, naming the guard entries it matched. A hold the hub acknowledged
// waits for its answer. Timings run from the spawn to the exit (helpers.ts, runTimed), so they include the
// process's own start and exit.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, cleanup, decision, heldAnswer, hook, hookTimed, makeHome, MATCHED, newSession, readSpool, setAddress, settleEvents, shown,
  startHub, startTestHub, stopHub, tempDir, writeRules, type Line, type Ran, type TestHubMode,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LIMIT_MS = 50;
/** How long a hook may run before the test stands in for the agent's hook timeout and kills it. */
const HOOK_TIMEOUT_MS = 10_000;

describe('AC1 #315.f0560928 with the hub stopped, a normal command is allowed in under 50 ms', () => {
  it('AC1 a PreToolUse for `ls` is allowed in under 50 ms, ten times each, with no hub, a hub stopped by SIGTERM, one killed with its socket left behind, and one stopped with SIGSTOP', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    writeRules(home);
    const s = newSession(home);
    const failures: string[] = [];
    const tenCalls = (form: string) => {
      for (let i = 0; i < 10; i++) {
        const r = hookTimed(home, s, 'PreToolUse', bash(s, 'ls'), { binary, timeoutMs: HOOK_TIMEOUT_MS });
        if (decision(r) !== 'allow') failures.push(`${form}, call ${i + 1}: \`ls\` was not allowed: ${shown(r)}`);
        else if (r.ms >= LIMIT_MS) failures.push(`${form}, call ${i + 1}: \`ls\` took ${r.ms.toFixed(1)} ms, not under ${LIMIT_MS} ms`);
      }
    };
    tenCalls('no hub has ever run');
    let hub = await startHub({ home });
    await stopHub(hub, 'SIGTERM');
    tenCalls('the hub stopped by SIGTERM');
    hub = await startHub({ home });
    await stopHub(hub, 'SIGKILL');
    tenCalls('the hub killed with SIGKILL, its socket left behind');
    hub = await startHub({ home });
    process.kill(hub.pid, 'SIGSTOP');
    try {
      tenCalls('the hub stopped with SIGSTOP');
    } finally {
      process.kill(hub.pid, 'SIGCONT');
      await stopHub(hub);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 300_000);
});

/** One call against one test hub. */
interface Call { hub: string; command: string; callId: string; ran: Ran }
interface FailOpen { calls: Call[]; held: { ran: Ran; nonce: string }; spool: Line[]; recorded: Line[]; working: string }
const HUBS: { name: string; what: string }[] = [
  { name: 'accepts-never-reads', what: 'accepts and never reads' },
  { name: 'reads-never-replies', what: 'reads and never replies' },
  { name: 'sigstopped', what: 'was stopped with SIGSTOP' },
];

/** The AC13 scenario with one deep-hook binary: the three late hubs, the held push, then a working hub reading the spool. */
async function observe(binary: string): Promise<FailOpen> {
  const home = makeHome();
  writeRules(home);
  const s = newSession(home);
  const calls: Call[] = [];
  const twoCalls = (hubName: string) => {
    for (const command of ['ls', 'pkill -f node']) {
      const body = bash(s, command);
      calls.push({ hub: hubName, command, callId: body.tool_use_id as string, ran: hookTimed(home, s, 'PreToolUse', body, { binary, timeoutMs: HOOK_TIMEOUT_MS }) });
    }
  };
  for (const mode of ['accepts-never-reads', 'reads-never-replies'] as TestHubMode[]) {
    const t = await startTestHub(mode);
    setAddress(home, `unix:${t.socket}`);
    twoCalls(mode);
    await t.stop();
  }
  // A real hub on a root of its own, stopped with SIGSTOP; killed before the working hub starts, so the requests it
  // never read die with it and only the spool can bring them to the record.
  const stopped = await startHub({ home, root: join(tempDir(), 'c') });
  setAddress(home, `unix:${stopped.socket}`);
  process.kill(stopped.pid, 'SIGSTOP');
  try {
    twoCalls('sigstopped');
  } finally {
    // SIGKILL while still stopped: it never gets to read what is waiting on its socket.
    process.kill(stopped.pid, 'SIGKILL');
    await stopped.proc.exit;
  }
  // A held push: acknowledged at once with a hold 40 s ahead, answered after 30 s.
  const nonce = `n${Date.now().toString(36)}`;
  const holding = await startTestHub('held-push', nonce);
  setAddress(home, `unix:${holding.socket}`);
  const ran = await hook(home, s, 'PreToolUse', bash(s, 'git push origin main'), { binary, timeoutMs: 60_000 });
  await holding.stop();
  // The working hub: the installed one, at the default address.
  setAddress(home, undefined);
  const spool = readSpool(home).requests.map((r) => r.json);
  const lateIds = spool.filter((l) => calls.some((c) => c.callId === l.payload?.tool_use_id)).map((l) => l.id as string);
  const hub = await startHub({ home });
  const recorded = await settleEvents(hub, (events) => lateIds.length > 0 && lateIds.every((id) => events.some((e) => e.id === id)));
  await stopHub(hub);
  return { calls, held: { ran, nonce }, spool, recorded, working: hub.root };
}

/** Throws, naming the hub and the call, at the first way the observation misses AC13. */
function judgeFailOpen(o: FailOpen): void {
  for (const c of o.calls) {
    const hub = HUBS.find((h) => h.name === c.hub)!;
    const where = `the test hub that ${hub.what} (${hub.name}), \`${c.command}\``;
    if (c.ran.timedOut) throw Error(`deep-hook waited ${c.ran.ms.toFixed(0)} ms on ${where}: it never failed open and was killed at the agent's hook timeout`);
    const want = c.command === 'ls' ? 'allow' : 'deny';
    if (decision(c.ran) !== want) throw Error(`on ${where}, deep-hook must ${want}: ${shown(c.ran)}`);
    if (c.ran.ms >= LIMIT_MS) throw Error(`on ${where}, deep-hook decided after ${c.ran.ms.toFixed(1)} ms, not within ${LIMIT_MS} ms of the hook's start`);
  }
  const answer = heldAnswer(o.held.nonce);
  if (o.held.ran.timedOut || o.held.ran.ms < 30_000 || o.held.ran.stdout.trim() !== answer) {
    throw Error(`deep-hook let the held push through before its answer: the hub acknowledged a hold 40 s ahead and answered after 30 s; deep-hook ended with ${shown(o.held.ran)}`);
  }
  for (const c of o.calls) {
    const lines = o.spool.filter((l) => l.payload?.tool_use_id === c.callId);
    const where = `${c.hub}, \`${c.command}\``;
    if (lines.length !== 1) throw Error(`${where}: the spool holds ${lines.length} requests for the call, not one`);
    const line = lines[0]!;
    if (line.late !== true) throw Error(`${where}: the call was not spooled marked late: ${JSON.stringify(line).slice(0, 400)}`);
    const events = o.recorded.filter((e) => e.id === line.id);
    if (events.length !== 1) throw Error(`${where}: once the working hub read the spool, ${line.id} is in the record ${events.length} times, not once`);
    const e = events[0]!;
    if (e.data?.late !== true) throw Error(`${where}: event ${e.id} is not marked late (data.late): ${JSON.stringify(e.data)}`);
    const matched = Array.isArray(e.data?.matched) ? [...(e.data.matched as string[])].sort() : e.data?.matched;
    if (JSON.stringify(matched) !== JSON.stringify([...MATCHED[c.command]!].sort())) throw Error(`${where}: event ${e.id} names the guard entries ${JSON.stringify(e.data?.matched)}, not ${JSON.stringify(MATCHED[c.command])}`);
  }
}

describe('AC13 #315.d4f95b29 three late test hubs: ls allowed, pkill -f node denied within 50 ms, each spooled and recorded late with its matched entries; a held push waits for its answer', () => {
  it('AC13 against a hub that accepts and never reads, one that reads and never replies and one stopped with SIGSTOP, then a hub that holds a push 30 s, then a working hub reading the spool', async () => {
    judgeFailOpen(await observe(await buildDeepHook()));
  }, 600_000);

  it('AC13 (wrong program) a deep-hook with only a connect timeout waits for the agent\'s hook timeout and fails this test, naming the hub', async () => {
    const o = await observe(await buildDeepHook({ features: ['plant-connect-timeout-only'] }));
    expect(() => judgeFailOpen(o)).toThrow(/waited \d+ ms on the test hub that accepts and never reads \(accepts-never-reads\)/);
  }, 900_000);

  it('AC13 (wrong program) a deep-hook that cuts every reply at a fixed deadline lets the held push through before its answer and fails this test', async () => {
    const o = await observe(await buildDeepHook({ features: ['plant-fixed-deadline'] }));
    expect(() => judgeFailOpen(o)).toThrow(/let the held push through before its answer/);
  }, 900_000);
});
