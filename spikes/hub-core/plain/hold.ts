// One held hook: wait for a port, run the check up to four times, each attempt in a process group
// of its own that is stopped and gone before the next attempt starts or the port goes back.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { groupAlive, killGroup, waitGroupGone } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import type { Pool } from './pool.ts';

export const HOLD_MS = 2000;
const ATTEMPTS = 4; // one try and three retries, back to back

export type Outcome = 'pass' | 'fail' | 'timeout' | 'cancelled' | 'blocked';

export interface Result {
  outcome: Outcome;
  attempts: number;
  error?: { message: string; stack: string };
}

export interface Hold {
  id: string;
  session: string;
  argv: [string, ...string[]];
}

type AttemptEnd = { code: number | null } | { error: Error };

// A node of the cancel tree (hub, session, hold, attempt). Aborting a node aborts every node under
// it with the same reason, and detaches it from its parent, so aborting is also how a node that
// finished leaves the tree.
export function childOf(parent: AbortSignal): AbortController {
  const node = new AbortController();
  if (parent.aborted) {
    node.abort(parent.reason);
    return node;
  }
  const follow = () => node.abort(parent.reason);
  parent.addEventListener('abort', follow, { once: true });
  node.signal.addEventListener('abort', () => parent.removeEventListener('abort', follow), { once: true });
  return node;
}

// `result` resolves as soon as the hold's outcome is decided, so a reply never waits on a slow
// process exit; `released` once the last attempt's group is gone and the port is back.
export function runHold(hold: Hold, signal: AbortSignal, pool: Pool, ledger: Ledger): { result: Promise<Result>; released: Promise<void> } {
  let attempts = 0;
  let decided: Result | undefined;
  let settle = (_: Result): void => {};
  const result = new Promise<Result>((resolve) => {
    settle = resolve;
  });
  const decide = (outcome: Result) => {
    decided ??= outcome;
    settle(decided);
  };
  // A hold aborted from outside reports why: its timeout, or a cancel of its session or the hub.
  const ended = () => decide({ outcome: signal.reason === 'timeout' ? 'timeout' : 'cancelled', attempts });
  if (signal.aborted) ended();
  else signal.addEventListener('abort', ended, { once: true });

  const released = (async () => {
    const port = await pool.acquire(hold.session, hold.id, signal);
    if (port === undefined) return;
    try {
      while (!decided) {
        attempts++;
        const node = childOf(signal);
        const attempt = runAttempt(hold.argv, port, node.signal, ledger);
        const end = await attempt.exited;
        node.abort();
        if ('error' in end) decide({ outcome: 'blocked', attempts, error: { message: end.error.message, stack: end.error.stack ?? '' } });
        else if (end.code === 0) decide({ outcome: 'pass', attempts });
        else if (attempts === ATTEMPTS) decide({ outcome: 'fail', attempts });
        await attempt.gone;
      }
    } finally {
      pool.release(port);
    }
  })();
  return { result, released };
}

// Runs one attempt with PORT set. `exited` resolves when the check exits, is stopped by an abort,
// or can't start; `gone` once every process left in its group is gone too.
function runAttempt(argv: Hold['argv'], port: number, signal: AbortSignal, ledger: Ledger): { exited: Promise<AttemptEnd>; gone: Promise<void> } {
  const [command, ...args] = argv;
  let child: ChildProcess;
  try {
    child = spawn(command, args, { detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
  } catch (cause) {
    return { exited: Promise.resolve({ error: couldNotStart(cause) }), gone: Promise.resolve() };
  }
  const pgid = child.pid;
  if (pgid === undefined) {
    const failed = new Promise<AttemptEnd>((resolve) => child.once('error', (cause) => resolve({ error: couldNotStart(cause) })));
    return { exited: failed, gone: Promise.resolve() };
  }
  ledger.started(pgid);
  // The check and its children ignore SIGTERM, so a stop is SIGKILL to the whole group, sent once:
  // under endpoint security each delivered signal costs milliseconds, and a probe with 0 doesn't.
  let stopped = false;
  const stop = () => {
    stopped = true;
    killGroup(pgid);
  };
  signal.addEventListener('abort', stop, { once: true });
  const exited = new Promise<AttemptEnd>((resolve) => {
    child.once('exit', (code) => {
      signal.removeEventListener('abort', stop);
      if (!stopped && groupAlive(pgid)) killGroup(pgid);
      resolve({ code });
    });
  });
  const gone = exited.then(() => waitGroupGone(pgid)).then(() => ledger.gone(pgid));
  return { exited, gone };
}

// Node's own spawn error names only Node's internals, so wrap it in one made here.
function couldNotStart(cause: unknown): Error {
  return new Error(`the check couldn't start: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}
