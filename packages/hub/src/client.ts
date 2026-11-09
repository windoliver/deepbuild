// The deep commands' side of the hub's socket: one call as the cli role, presenting the control token and, for a
// call the peer check judges, naming this process as the peer, so the hub can tell whether an agent's process tree
// runs the command.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { checkCompat, type Hello } from './compat.js';
import { CONTRACT, startOf, type Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** The hub's answer to one call: its result, or its refusal. */
export type Reply = { result: Obj } | { error: Refusal };

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
    sock.on('error', (error) => reject(Error(`can't reach the hub at ${socket}: ${error.message}`)));
    sock.on('close', () => reject(Error('the hub closed the connection before it answered')));
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
 * at the door, 3 not decided (`nothing` says what was left undone).
 */
export async function callAsYou(method: string, params: Obj, nothing: string): Promise<Obj | number> {
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
    reply = await withPrompt(() => call(hubAddress().path, token, method, params, peer));
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; ${nothing}\n`);
    return 3;
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
