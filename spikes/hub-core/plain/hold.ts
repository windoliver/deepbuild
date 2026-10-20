// One held hook: wait for a port, run the check up to four times, each attempt in a process group
// of its own that is stopped and gone before the next attempt starts or the port goes back.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { killGroup, waitGroupGone } from './ledger.ts';
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

export async function runHold(hold: Hold, signal: AbortSignal, pool: Pool, ledger: Ledger): Promise<Result> {
  // A hold aborted from outside reports why: its timeout, or a cancel of its session or the hub.
  const ended = (attempts: number): Result => ({ outcome: signal.reason === 'timeout' ? 'timeout' : 'cancelled', attempts });
  const port = await pool.acquire(hold.session, hold.id, signal);
  if (port === undefined) return ended(0);
  try {
    for (let attempt = 1; ; attempt++) {
      if (signal.aborted) return ended(attempt - 1);
      const node = childOf(signal);
      const end = await runAttempt(hold.argv, port, node.signal, ledger);
      node.abort();
      if ('error' in end) return { outcome: 'blocked', attempts: attempt, error: { message: end.error.message, stack: end.error.stack ?? '' } };
      if (signal.aborted) return ended(attempt);
      if (end.code === 0) return { outcome: 'pass', attempts: attempt };
      if (attempt === ATTEMPTS) return { outcome: 'fail', attempts: attempt };
    }
  } finally {
    pool.release(port);
  }
}

// Runs one attempt with PORT set. Resolves once the check has exited or been stopped by an abort,
// and every process left in its group is gone.
function runAttempt(argv: Hold['argv'], port: number, signal: AbortSignal, ledger: Ledger): Promise<AttemptEnd> {
  const [command, ...args] = argv;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
    } catch (cause) {
      resolve({ error: couldNotStart(cause) });
      return;
    }
    const pgid = child.pid;
    if (pgid === undefined) {
      child.once('error', (cause) => resolve({ error: couldNotStart(cause) }));
      return;
    }
    ledger.started(pgid);
    // The check and its children ignore SIGTERM, so a stop is SIGKILL to the whole group.
    const stop = () => killGroup(pgid);
    signal.addEventListener('abort', stop, { once: true });
    child.once('exit', async (code) => {
      signal.removeEventListener('abort', stop);
      killGroup(pgid);
      await waitGroupGone(pgid);
      ledger.gone(pgid);
      resolve({ code });
    });
  });
}

// Node's own spawn error names only Node's internals, so wrap it in one made here.
function couldNotStart(cause: unknown): Error {
  return new Error(`the check couldn't start: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}
