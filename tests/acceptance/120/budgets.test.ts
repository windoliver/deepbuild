// AC9 #120.a3880a7d: budgets, on the reference Mac in the local preflight, compared with the merge base: the line costs
// under 1 ms in the hook path, and an idle session costs no CPU while it waits.
//
// The hook path is the hub's: a hook request line (hook.request@3, as deep-hook sends it) over the socket, its
// acknowledgement and reply (README: Budgets). The line's cost is the difference between a PostToolUse whose reply
// carries the overrun line (its call has run 30 minutes of hub time) and one that carries none, medians over 150 calls
// each; the instrument first checks that the "with" replies do carry a line, so a hub that says nothing can't pass by
// costing nothing. The merge base's hub answers the same lines with none; its round trip is the reading nothing may
// regress from. An idle session is a Claude Code session that promised a check and stopped, its waiter waiting: the
// waiter's process group and the hub use no CPU over 3 s. Readings count only on a reference Mac (Mac15,7 or Mac15,12),
// Low Power Mode off, thermal state nominal, not loaded past its core count; anywhere else the test skips as
// INCONCLUSIVE with the readings, never PASS.
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import {
  AC9, allEvents, awaitEvent, bash, begin, callId, cleanup, CURRENT, edits, groupOf, hasDuration, hubWithSetup, inconclusiveIfLoaded, judge, load, makeHome, median,
  mergeBase, MINUTE, moveOn, newSession, payload, processes, QUOTE, rawHook, rawOutput, REPO, stop, stopHub, waitFor, wakeupEvents, type Checkout, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const FILE = 'tests/acceptance/120/budgets.test.ts';
const LINE_LIMIT_MS = 1;
const CALLS = 150;
const IDLE_S = 3;

interface Reading { checkout: string; withLine: number[]; without: number[]; lines: number; loads: { one: number; cores: number }[] }
const shownReading = (r: Reading) => `${r.checkout}: with the line median ${median(r.withLine).toFixed(2)} ms over ${r.withLine.length} (${r.lines} carried a line), without ${median(r.without).toFixed(2)} ms over ${r.without.length}; load ${r.loads.map((l) => l.one.toFixed(1)).join(' to ')} on ${r.loads[0]?.cores} cores`;

/** The hook output a PostToolUse reply gave the agent or the chat: a line (systemMessage or additionalContext) with a duration. */
function carriesLine(output: Record<string, unknown> | undefined): boolean {
  if (!output) return false;
  const texts = [output.systemMessage, (output.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext].filter((t): t is string => typeof t === 'string');
  return texts.some(hasDuration);
}
const post = (s: Session, call: string, command: string) => payload(s, 'PostToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: call, tool_response: { stdout: 'done', stderr: '', interrupted: false, isImage: false } });
const pre = (s: Session, call: string, command: string) => payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: bash(command), tool_use_id: call });

/** One measurement of a checkout's hub: the round trip of PostToolUse lines with and without the overrun line. */
async function measure(co: Checkout): Promise<Reading> {
  const h = makeHome(co);
  let hub = await hubWithSetup(h);
  const reading: Reading = { checkout: co.label, withLine: [], without: [], lines: 0, loads: [load()] };
  try {
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Run the long jobs, then stop.');
    // The calls that will have overrun: opened now, closed 30 minutes of hub time later.
    const open: string[] = [];
    for (let i = 0; i < CALLS; i++) {
      const call = callId();
      await rawHook(hub, 'claude-code', 'PreToolUse', pre(s, call, `make job${i}`));
      open.push(call);
    }
    await awaitEvent(hub, s, (e) => e.kind === 'tool.before' && e.data.call === open[CALLS - 1], 'the last opened call\'s tool.before', 60_000);
    hub = await moveOn(hub, 30 * MINUTE);
    // Warm the restarted hub with calls that overran nothing, then measure both kinds, interleaved.
    for (let i = 0; i < 10; i++) { const c = callId(); await rawHook(hub, 'claude-code', 'PreToolUse', pre(s, c, 'ls')); await rawHook(hub, 'claude-code', 'PostToolUse', post(s, c, 'ls')); }
    for (let i = 0; i < CALLS; i++) {
      const fresh = callId();
      await rawHook(hub, 'claude-code', 'PreToolUse', pre(s, fresh, `make quick${i}`));
      const plain = await rawHook(hub, 'claude-code', 'PostToolUse', post(s, fresh, `make quick${i}`));
      reading.without.push(plain.ms);
      const overran = await rawHook(hub, 'claude-code', 'PostToolUse', post(s, open[i]!, `make job${i}`));
      reading.withLine.push(overran.ms);
      if (carriesLine(rawOutput(overran))) reading.lines++;
    }
    reading.loads.push(load());
    claude.quit();
    return reading;
  } finally {
    await stopHub(hub);
  }
}

describe(`${AC9} Budgets, on the reference Mac in the local preflight, compared with the merge base: the line costs under ${LINE_LIMIT_MS} ms in the hook path, and an idle session costs no CPU while it waits`, () => {
  it(`${AC9} the local preflight runs ${FILE}: a check lane in scripts/lanes.mjs runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism')
        && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    const vitest = checks.flatMap((lane) => lane.commands.filter((c) => c.some((a) => /vitest/.test(a))).map((c) => `${lane.name}: ${c.slice(2).join(' ').slice(0, 300)}`));
    expect(runs.map((r) => r.lane), `some lane must run ${FILE} with --no-file-parallelism (it starts hubs and times them); the lanes' Vitest commands are:\n${vitest.join('\n')}`).not.toEqual([]);
  });

  it(`${AC9} on the reference Mac, a PostToolUse reply that carries the overrun line costs under ${LINE_LIMIT_MS} ms more than one that carries none, medians over ${CALLS} calls, five runs, compared with the merge base`, async (ctx: TestContext) => {
    const warm = await measure(CURRENT);
    console.log(`${AC9} warm-up: ${shownReading(warm)}`);
    // The instrument: the "with" replies carry the line, or there is nothing to cost.
    expect(warm.lines, `${AC9} the PostToolUse replies of calls that ran 30 minutes past their start must carry the overrun line (a systemMessage or additionalContext with a duration); ${shownReading(warm)}`).toBeGreaterThanOrEqual(Math.floor(CALLS * 0.9));
    const base = await measure(await mergeBase());
    console.log(`${AC9} merge base: ${shownReading(base)}`);
    inconclusiveIfLoaded(ctx, [...warm.loads, ...base.loads], `readings only. ${shownReading(warm)}. ${shownReading(base)}`);
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await measure(CURRENT));
      console.log(`${AC9} run ${i + 1}: ${shownReading(runs[i]!)}`);
      expect(runs[i]!.lines, `${AC9} run ${i + 1}: the "with" replies carry the line`).toBeGreaterThanOrEqual(Math.floor(CALLS * 0.9));
    }
    const costs = runs.map((r) => median(r.withLine) - median(r.without));
    const judged = judge(`${AC9} the line's cost in the hook path (median with minus median without)`, costs, LINE_LIMIT_MS, 'ms');
    console.log(`${judged.verdict} ${judged.text}`);
    const mine = median(runs.flatMap((r) => r.without));
    const theirs = median(base.without);
    console.log(`${AC9} a reply with no line: median ${mine.toFixed(2)} ms against the merge base's ${theirs.toFixed(2)} ms`);
    const regressed = mine > theirs * 1.5 && mine - theirs > 1 ? [`a reply with no line regressed: median ${mine.toFixed(2)} ms against the merge base's ${theirs.toFixed(2)} ms`] : [];
    inconclusiveIfLoaded(ctx, runs.flatMap((r) => r.loads), `readings only. ${judged.text}`);
    expect([...(judged.verdict === 'FAIL' ? [`FAIL ${judged.text}`] : []), ...regressed.map((r) => `FAIL ${AC9} ${r}`)], 'the line within its budget and no reading regressed from the merge base').toEqual([]);
    if (judged.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${judged.text}`);
  }, 7_200_000);

  it(`${AC9} on the reference Mac, an idle session that promised a check costs no CPU while it waits: its waiter's process group and the hub use none over ${IDLE_S} s`, async (ctx: TestContext) => {
    const h = makeHome();
    const hub: Hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
    await edits(claude, s);
    await stop(claude, s, QUOTE);
    const waiter = await waitFor(async () => (await claude.liveWaiters(s.id))[0], 30_000, 'the waiter, waiting once the stop went through');
    // The instrument: the session waits on a promised check, which the record carries.
    const wakeup = await waitFor(async () => wakeupEvents(await allEvents(hub), s.id)[0], 15_000, 'the wake-up recorded with the quote').catch(() => undefined);
    expect(wakeup, `${AC9} the idle session's promise ${JSON.stringify(QUOTE)} is recorded as a wake-up, so it waits on something; the session's events: ${(await allEvents(hub)).filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`).toBeDefined();
    const loads = [load()];
    const cpu = (table = processes()) => ({ waiter: groupOf(waiter.pid, table).reduce((sum, p) => sum + p.cpuS, 0), hub: table.find((p) => p.pid === hub.pid)?.cpuS ?? NaN });
    const samples: { waiter: number; hub: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const before = cpu();
      await new Promise((resolve) => setTimeout(resolve, IDLE_S * 1000));
      const after = cpu();
      samples.push({ waiter: after.waiter - before.waiter, hub: after.hub - before.hub });
    }
    loads.push(load());
    console.log(`${AC9} idle CPU over ${IDLE_S} s, five runs: waiter ${samples.map((x) => x.waiter.toFixed(2)).join(', ')} s; hub ${samples.map((x) => x.hub.toFixed(2)).join(', ')} s`);
    inconclusiveIfLoaded(ctx, loads, `readings only: ${JSON.stringify(samples)}`);
    expect(samples.some((x) => Number.isNaN(x.hub) || Number.isNaN(x.waiter)), 'ps read both the waiter and the hub').toBe(false);
    // No CPU: the waiter's group used none (ps counts hundredths of a second); the hub under 0.5% of a core (its idle budget).
    expect(Math.max(...samples.map((x) => x.waiter)), `${AC9} the waiter uses no CPU while it waits: ${JSON.stringify(samples)}`).toBeLessThanOrEqual(0.01);
    expect(Math.max(...samples.map((x) => x.hub)), `${AC9} the hub stays under 0.5% of a core while the session waits: ${JSON.stringify(samples)}`).toBeLessThanOrEqual(0.005 * IDLE_S + 0.01);
    await claude.end();
    await stopHub(hub);
  }, 300_000);
});
