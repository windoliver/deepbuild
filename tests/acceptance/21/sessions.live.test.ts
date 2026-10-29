// #21 AC1 and AC2, live: a day of real Claude Code sessions with the adapter installed, and the hub stopped for part
// of it. Real sessions spend plan usage, so these run only by hand, on your own sign-in:
//   DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/21 sessions.live.test.ts
// Without the opt-in, a `claude` on PATH or the harness's `bash-calls` scenario, each test fails with BLOCKED in its
// message; nothing skips. The stand-in for "a day" (README: The live day): five interactive sessions run by the agent
// test harness (#48) in a pseudo-terminal, never `claude -p`, each asked to make 210 Bash calls; the hub is up for
// the first, stopped (SIGTERM) for the second, up again (started anew) for the third, stopped with SIGSTOP for the
// fourth and resumed (SIGCONT) for the fifth. Each session's settings (`--hooks`) run deep-hook for the nine hooks,
// as #18's live test does, with HOME the test's home (where `deep hub run` listens and rules.json holds the shipped
// guard entries), each through the hook timer, so every real hook's time over its own start is read as exit - seq.
// Claude Code keeps the real HOME for its sign-in.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { failOpenProblems, joinHooks, overheadProblems, shown, summary, type Call, type Day, type Window } from './day.ts';
import {
  AC1, AC2, buildDeepHook, buildNoop, buildTimer, childEnv, cleanup, environmentProblem, jsonLines, makeHome, NODE, own, parseObject, readTimings, REPO,
  settle, shared, sleep, spooled, startHub, stateOf, stopHub, tempDir, writeDefaultRules, type Hub, type Line,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const NINE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const WINDOWS: Window[] = ['up', 'stopped', 'up', 'sigstopped', 'up'];
const CALLS_ASKED = 210;
const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

function requireLive(): string {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: these tests start real Claude Code sessions on your plan (about 1,050 Bash calls); run them by hand with DEEP_HARNESS_LIVE=1');
  const which = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  const claude = which.stdout.trim();
  if (which.status !== 0 || !claude) throw Error('BLOCKED: no claude on PATH');
  return claude;
}

/** The harness's run line for one session, or a BLOCKED failure naming why there is none. */
function harness(args: string[]): Promise<Line> {
  return new Promise((resolve, reject) => {
    // The harness keeps your HOME for Claude Code's sign-in; only DeepBuild's side lives in the test's home.
    const realHome = process.env.HOME ?? '/';
    const env = childEnv(realHome, { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME });
    const child = spawn(NODE, [join(REPO, 'scripts/agent-harness.mjs'), ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.on('close', () => {
      const line = out.split('\n').map(parseObject).find((l) => typeof l?.run === 'string');
      if (!line) return reject(Error(`BLOCKED: the harness printed no run line for the bash-calls scenario: ${out.slice(-3000)}`));
      if (line.verdict === 'BLOCKED') return reject(Error(`BLOCKED: the harness run was BLOCKED: ${line.reason}`));
      if (line.verdict !== 'PASS') return reject(Error(`INCONCLUSIVE: the bash-calls session didn't run to its end (${line.verdict}): ${line.reason} ${JSON.stringify(line).slice(0, 1500)}`));
      resolve(line);
    });
  });
}

/** The Bash calls a session made, from its transcript: each tool_use block named Bash. */
function bashCalls(transcript: string): string[] {
  const ids: string[] = [];
  for (const e of jsonLines(readFileSync(transcript, 'utf8'))) {
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const c of e.message.content as Line[]) if (c.type === 'tool_use' && c.name === 'Bash' && !ids.includes(String(c.id))) ids.push(String(c.id));
  }
  return ids;
}

/** The live day (README: The live day), made once and judged by both criteria. */
const liveDay = shared(async (): Promise<Day> => {
  const claude = requireLive();
  const [binary, timer, noop] = await Promise.all([buildDeepHook(), buildTimer(), buildNoop()]);
  const home = makeHome();
  writeDefaultRules(home);
  let hub: Hub | undefined = await startHub({ home });
  const timings = join(tempDir(), 't');
  mkdirSync(timings);
  const hooks: Line = Object.fromEntries(NINE.map((event) => [event, [{ hooks: [{ type: 'command', command: `HOME=${quote(home)} ${quote(timer)} ${quote(timings)} ${quote(binary)} claude-code ${event}` }] }]]));
  const settings = join(tempDir(), 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks }, null, 2));

  const calls: Call[] = [];
  const spoolAtEnd = new Map<number, Line[]>();
  const stoppedStates = new Map<number, string[]>();
  for (const [w, kind] of WINDOWS.entries()) {
    if (kind === 'stopped') { await stopHub(hub!, 'SIGTERM'); hub = undefined; }
    if (kind === 'sigstopped') { process.kill(hub!.pid, 'SIGSTOP'); stoppedStates.set(w, [stateOf(hub!.pid)]); }
    const work = join(tempDir(), 'work');
    mkdirSync(work);
    const line = await harness(['run', '--scenario', 'bash-calls', '--workdir', work, '--hooks', settings, '--calls', String(CALLS_ASKED), '--claude', claude,
      '--cost-cap-usd', '5', '--timeout-ms', '1500000', '--out', join(tempDir(), 'out')]);
    const session = String(line.sessionId);
    if (!line.transcript || !existsSync(String(line.transcript))) throw Error(`BLOCKED: the run line names no transcript: ${JSON.stringify(line).slice(0, 1000)}`);
    for (const call of bashCalls(String(line.transcript))) calls.push({ window: w, kind, session, call });
    if (kind === 'stopped') { spoolAtEnd.set(w, spooled(home)); hub = await startHub({ home }); }
    if (kind === 'sigstopped') { stoppedStates.get(w)!.push(stateOf(hub!.pid)); spoolAtEnd.set(w, spooled(home)); process.kill(hub!.pid, 'SIGCONT'); }
  }
  // The floor, through the same timer on the same machine, once the sessions are done.
  const floors = join(tempDir(), 'f');
  mkdirSync(floors);
  for (let i = 0; i < 1000; i++) spawnSync(timer, [floors, noop], { input: '', timeout: 30_000 });
  for (const until = Date.now() + 15_000; readTimings(floors).length < 1000 && Date.now() < until;) await sleep(100);
  const events = await settle(hub!, (all) => {
    const seen = new Set(all.filter((e) => e.kind === 'tool.before' || e.kind === 'tool.after').map((e) => `${e.kind} ${e.data?.call}`));
    return calls.every((c) => seen.has(`tool.before ${c.call}`) && seen.has(`tool.after ${c.call}`));
  }, { timeoutMs: 180_000, quietMs: 10_000 });
  const day: Day = { windows: WINDOWS, calls, hooks: joinHooks(timings, calls, events), floorMs: readTimings(floors).map((t) => Number(t.endNs - t.spawnNs) / 1e6), spoolAtEnd, stoppedStates, events };
  console.log(`live day: ${summary(day)}`);
  await stopHub(hub!);
  return day;
});

describe(`${AC1} p95 overhead under 10 ms on top of process start`, () => {
  it(`${AC1} (live) over a day of real Claude Code sessions, the hooks Claude Code ran with the hub up take under 10 ms at p95 over process start`, async (ctx: TestContext) => {
    const day = await liveDay();
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (a reading only): ${problem}`);
    expect(overheadProblems(day)).toEqual([]);
  }, 7_200_000);
});

describe(`${AC2} Over 1,000 real tool calls, with the hub stopped for 200 and SIGSTOPped for 200, no hook takes more than 50 ms over process start, and all 400 events are in the record once after the hub resumes`, () => {
  it(`${AC2} (live) over 1,000 or more real Claude Code tool calls, 200 or more with the hub stopped and 200 or more with it SIGSTOPped, no hook takes more than 50 ms over process start, and the windows' events are in the record once after the hub resumes`, async () => {
    const day = await liveDay();
    const problems = failOpenProblems(day);
    const short = problems.filter((p) => p.startsWith('INCONCLUSIVE'));
    if (short.length) throw Error(`${short.join('; ')} (the sessions made fewer calls than asked; run again)`);
    expect(shown(problems)).toEqual([]);
  }, 7_200_000);
});
