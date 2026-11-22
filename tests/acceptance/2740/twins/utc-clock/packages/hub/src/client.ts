// The deep commands' side of the hub's socket: one call as the cli role, presenting the control token and, for a
// call the peer check judges, naming this process as the peer, so the hub can tell whether an agent's process tree
// runs the command.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { checkCompat, type Hello } from './compat.js';
import { refusedGeneration, StaleHub } from './generations.js';
import { CONTRACT, startOf, type Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** The hub's answer to one call: its result, or its refusal. */
export type Reply = { result: Obj } | { error: Refusal };

/** A hub nothing answered for: no socket, nothing listening on it, or a connection closed before the hub said hello. */
export class Unanswered extends Error {}

/** `at` as a clock time in your time zone: 16:40. */
// The planted wrong program (#2740's twin utc-clock): the clock time in UTC, not in your time zone.
export const clock = (at: number): string => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? 'Invalid Date' : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** The one sentence in a home that is set up: since when, if the record says, and the one fix. */
export const notAnsweringSince = (since: number | undefined): string => `The hub isn't answering${since === undefined ? '' : `, since ${clock(since)}`}; start it with deep hub start.`;
/**
 * The one sentence every deep command prints for a hub that isn't answering (#1812): that it isn't, since when if the
 * record says (its newest event), and the one fix, `deep setup` in a home that isn't set up, else `deep hub start`.
 * No path and no errno: what failed underneath is the hub's logs' to say.
 */
export async function notAnswering(socket?: string): Promise<string> {
  const root = rootOf(installedRoot());
  // Set up as the first command reads it (packages/cli/src/main.ts): finished, or a folder no stopped setup left.
  const setUp = existsSync(join(root.dir, 'setup-finished.json')) || (existsSync(root.dir) && !existsSync(join(root.dir, 'setup-stopped.json')));
  if (!setUp) return "The hub isn't answering; set this home up with deep setup.";
  let since: number | undefined;
  const ledger = [...(socket ? [join(dirname(socket), 'ledger.db')] : []), root.ledger].find((p) => existsSync(p));
  if (ledger) {
    try {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(ledger, { readonly: true, fileMustExist: true });
      try {
        since = (db.prepare('SELECT ts FROM events ORDER BY log_pos DESC LIMIT 1').get() as { ts: number } | undefined)?.ts;
      } finally {
        db.close();
      }
    } catch { /* a record that can't be read says nothing of since when */ }
  }
  return notAnsweringSince(since);
}

/**
 * What a deep command says when its call to the hub failed, from this one place (#1812): for a hub that isn't
 * answering (an `Unanswered` call, or no control token where a hub would have written one), the one sentence; for any
 * other failure (a hub on another contract, a copy left behind), its own words.
 */
export async function failure(error: unknown, socket?: string): Promise<string> {
  const tokenless = typeof (error as { path?: unknown })?.path === 'string' && (error as { path: string }).path.endsWith('control.token');
  return error instanceof Unanswered || tokenless ? notAnswering(socket) : error instanceof Error ? error.message : String(error);
}
/** `failure`'s words on stderr, and the exit of a call that decided nothing: 3. */
export async function notAnswered(error: unknown, socket?: string): Promise<3> {
  process.stderr.write(`${await failure(error, socket)}\n`);
  return 3;
}

/**
 * polkit prompts the process it's asked about (confirm.ts), so on Linux, at a terminal, this process holds an agent of
 * its own while `work` runs, and the password prompt comes here. With no terminal there is no agent: polkit refuses,
 * and what needed you doesn't count.
 */
export async function withPrompt<T>(work: () => Promise<T>): Promise<T> {
  if (process.platform !== 'linux' || !process.stdin.isTTY) return work();
  const agent = spawn('/usr/bin/pkttyagent', ['--process', String(process.pid), '--notify-fd', '3', '--fallback'], { stdio: ['inherit', 'inherit', 'inherit', 'pipe'] });
  // It closes its fourth descriptor once registered, and the descriptor goes with it if it can't register.
  await new Promise<void>((ready) => {
    agent.once('error', () => ready());
    (agent.stdio[3] as NodeJS.ReadableStream | undefined)?.on('error', () => undefined).once('close', () => ready()).resume();
  });
  try {
    return await work();
  } finally {
    agent.kill();
  }
}

/** One call on the hub's socket with the cli role; rejects only when the hub can't be reached or doesn't answer. */
export async function call(socket: string, token: string, method: string, params: Obj, peer?: { pid: number; start: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let hello = false;
    sock.setEncoding('utf8');
    sock.on('error', (error) => reject(new Unanswered(`can't reach the hub at ${socket}: ${error.message}`)));
    sock.on('close', () => reject(hello ? Error('the hub closed the connection before it answered') : new Unanswered(`the hub at ${socket} closed the connection before it said hello`)));
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        let reply: Obj;
        try {
          reply = JSON.parse(buffer.slice(0, i)) as Obj;
        } catch {
          sock.destroy();
          return reject(Error(`the hub answered a line that isn't JSON: ${buffer.slice(0, i).slice(0, 200)}`));
        }
        buffer = buffer.slice(i + 1);
        if (!hello) {
          hello = true;
          // A hub on another contract is one screen naming the older side and its fix, before any call (#41).
          const compat = checkCompat(reply as Hello, { contract: CONTRACT, features: [] });
          if (!compat.ok) {
            sock.destroy();
            return reject(Error(compat.screen));
          }
          // A hub older than one this client has seen is a copy left behind (#1338): nothing is sent to it.
          const stale = refusedGeneration(typeof reply.hub === 'string' ? reply.hub : `unix:${socket}`, reply.generation);
          if (stale) {
            sock.destroy();
            return reject(new StaleHub(stale));
          }
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, ...(peer ? { peer } : {}) })}\n`);
        } else if (reply.role !== undefined) {
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (reply.id === 1) {
          sock.destroy();
          resolve(reply.error ? { error: reply.error as Refusal } : { result: reply.result as Obj });
        }
      }
    });
  });
}

/** Refusals that leave nothing done and nothing decided: not confirmed, an agent's command, or a hub that couldn't. */
export const UNDECIDED_CODES = new Set(['unconfirmed', 'role', 'unavailable']);

/**
 * One call to the installed hub as this process, so its peer check can tell whether an agent's process tree runs it:
 * the result of a call the hub did, or, once stderr says why, the exit code of one it didn't: 1 refused, 2 refused
 * at the door, 3 not decided.
 */
export async function callAsYou(method: string, params: Obj): Promise<Obj | number> {
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
    reply = await withPrompt(() => call(hubAddress().path, token, method, params, peer));
  } catch (error) {
    return notAnswered(error);
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return UNDECIDED_CODES.has(reply.error.code) ? 3 : 2;
  }
  if (reply.result.status === 'refused') {
    process.stderr.write(`REFUSED: ${String(reply.result.reason)}\n`);
    return 1;
  }
  return reply.result;
}
