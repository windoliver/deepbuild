// AC14 (issue #16): "During 1,000 hooks, a preload that records `child_process` calls, directory reads and process
// listing on the hub's main thread finds none. A planted hub that runs `git rev-parse` in its hook handler fails,
// naming the call".
// Blind redraft: written from the issue, docs/technical-design.md, the base commit and this suite's README, helpers
// and fixtures, never from an implementation. See AC14-REDRAFT.md.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, childEnv, cleanup, control, FIXTURES, fromHere, health, hookRequest, makeHome, newSession, run, sendHook,
  sleep, startHub, stopHub, tempDir, type Line, type Session,
} from './helpers.ts';

afterEach(cleanup);

/** One call the preload (fixtures/preload.mjs) recorded on the hub's main thread. */
interface Recorded { at: number; call: string; args: string[]; stack: string }

const SESSIONS = 10;
const HOOKS_PER_SESSION = 100;

/**
 * One session's 100 hooks, in the order an agent sends them: it starts, takes a prompt, makes 48 tool calls (each a
 * PreToolUse and its PostToolUse), takes another prompt and ends. No Stop: a Stop may be held by the gate, and a
 * hold is not what this criterion is about.
 */
function plan(): { event: string; extra: Line }[] {
  const steps: { event: string; extra: Line }[] = [{ event: 'SessionStart', extra: {} }, { event: 'UserPromptSubmit', extra: {} }];
  for (let i = 0; i < 48; i++) {
    const tool = { tool_name: 'Bash', tool_input: { command: `ls -la src/${i}` }, tool_use_id: `toolu_ac14_${i}` };
    steps.push({ event: 'PreToolUse', extra: tool }, { event: 'PostToolUse', extra: { ...tool, tool_response: { stdout: `file${i}\n`, stderr: '', interrupted: false } } });
  }
  steps.push({ event: 'UserPromptSubmit', extra: {} }, { event: 'SessionEnd', extra: {} });
  return steps;
}

/** A session working in a git repository with a remote, as sessions do, so a hub that asks git about it would. */
async function sessionInARepo(home: string): Promise<Session> {
  const s = newSession(home, 'claude-code');
  for (const args of [['init', '-q', s.cwd], ['-C', s.cwd, 'remote', 'add', 'origin', 'https://example.invalid/ac14.git']]) {
    const r = await run('git', args, { env: childEnv(home) });
    if (r.code !== 0) throw Error(`BLOCKED: git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return s;
}

/**
 * The scenario: a hub started with the main-thread preload, 10 sessions sending 1,000 hooks side by side, each
 * acknowledged and answered, until every hook's event is in the log. Returns what the preload recorded from just
 * before the first hook to that point. Throws (BLOCKED) when the scenario itself can't run.
 */
async function mainThreadCallsDuringHooks(plant?: string): Promise<Recorded[]> {
  const home = makeHome();
  const log = join(tempDir(), 'preload.jsonl');
  const hub = await startHub({ home, preload: join(FIXTURES, 'preload.mjs'), env: { DEEP_TEST_PRELOAD_LOG: log }, ...(plant && { plant }) });

  // The preload ran in the process that announced ready and that answers on the socket.
  const loaded = JSON.parse(readFileSync(log, 'utf8').split('\n')[0] ?? '{}') as Line;
  if (loaded.loaded !== true || loaded.pid !== hub.pid) throw Error(`BLOCKED: the preload didn't load in the hub (pid ${hub.pid}): ${JSON.stringify(loaded)}`);
  const cli = await control(hub);
  const h = await health(cli);
  if (h.pid !== hub.pid) throw Error(`BLOCKED: hub.health answers from pid ${String(h.pid)}, not the preloaded hub ${hub.pid}`);

  const sessions: Session[] = [];
  for (let i = 0; i < SESSIONS; i++) sessions.push(await sessionInARepo(home));
  const steps = plan();
  if (steps.length !== HOOKS_PER_SESSION || SESSIONS * HOOKS_PER_SESSION !== 1000) throw Error(`BLOCKED: the plan has ${steps.length * SESSIONS} hooks, not 1,000`);

  // The window opens just before the first hook.
  const from = statSync(log).size;
  const sent: string[] = [];
  await Promise.all(sessions.map(async (s) => {
    for (const step of steps) {
      const request = fromHere(hookRequest(s, step.event, step.extra));
      sent.push(request.id);
      const r = await sendHook(hub.socket, request, 10_000);
      if (r.ack?.ack !== request.id || !r.reply) {
        throw Error(`BLOCKED: hook ${request.id} (${step.event}, session ${s.id}) wasn't acknowledged and answered: ${JSON.stringify({ end: r.end, lines: r.lines }).slice(0, 1000)}`);
      }
    }
  }));

  // ... and closes once every hook's event is in the log, so whatever the hub does for a hook falls inside it.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ids = new Set((await allEvents(cli)).map((e) => e.id));
    const missing = sent.filter((id) => !ids.has(id));
    if (!missing.length) break;
    if (Date.now() > deadline) throw Error(`BLOCKED: ${missing.length} of the 1,000 hooks' events never reached the log, first ${missing[0]}`);
    await sleep(50);
  }
  const during = readFileSync(log).subarray(from).toString('utf8');
  cli.close();
  await stopHub(hub);
  return during.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Recorded);
}

/**
 * The criterion's check: nothing recorded. Its message names every distinct call (call and arguments, as the preload
 * shows them) with its count and the stack of its first occurrence. Vitest shortens the values it compares in a
 * message (an array to "[ …(n) ]", a long string to its first 40 characters), so the names go in the assertion's
 * own message, which it keeps whole.
 */
function expectNoneOnMainThread(found: Recorded[]): void {
  const distinct = new Map<string, { n: number; stack: string }>();
  for (const r of found) {
    const key = `${r.call}(${r.args.join(', ')})`;
    const seen = distinct.get(key);
    if (seen) seen.n++;
    else distinct.set(key, { n: 1, stack: r.stack });
  }
  const named = [...distinct].map(([key, { n, stack }]) => `${key} x${n}, first ${stack}`).join('\n  ');
  expect(found.length, `child_process calls, directory reads or process listings on the hub's main thread during 1,000 hooks:\n  ${named}\n`).toBe(0);
}

describe("AC14 #16.82e2f65c the hub's main thread runs no child process, reads no folder and lists no process during 1,000 hooks (redraft)", () => {
  it('AC14 during 1,000 hooks from 10 sessions the main-thread preload records no child_process call, directory read or process listing', async () => {
    expectNoneOnMainThread(await mainThreadCallsDuringHooks());
  }, 180_000);

  it('AC14 (wrong program) a hub that runs git rev-parse in its hook handler fails the same check, naming the call', async () => {
    const found = await mainThreadCallsDuringHooks('git-in-hook-handler');
    expect(() => expectNoneOnMainThread(found)).toThrow(/\bgit\b[^\n]*\brev-parse\b/);
  }, 180_000);
});
