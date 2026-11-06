// Test-side tools for the #1510 acceptance tests. The hub, the record seeding, the socket and process cleanup are
// #24's (../24/helpers.ts): a real hub (`deep hub run`) in a temporary home, its record seeded beforehand through the
// real record and asks core, the real `deep` CLI as a child process. What this file adds: `deep` run with its stdout
// kept as bytes, an ask raised with the question and plan this suite chooses, a finished turn whose tool call holds a
// command, and the byte checks the criteria name. Processes are stopped by PID only (../24/helpers.ts, cleanup).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, PlanInput } from '../../../packages/asks/src/index.ts';
import { withPlans } from '../plans.ts';
import { askData, childEnv, CLI, DAY, NODE, own, PROJECT, REPO, rootOf, sourceOf, ulid } from '../24/helpers.ts';

export { cleanup, events, startHub, stopHub, tempDir, type Ev, type Hub } from '../24/helpers.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The call the first criterion names: a force push, an escape that erases its line, a return, and another command. */
export const ESC_CALL = 'git push --force\x1b[2K\rgit status';
/** The same two commands with a newline between them: the scope keeps a call's newlines to one line. */
export const NEWLINE_CALL = 'git push --force\ngit status';

export interface Bytes { code: number | null; stdout: Buffer; stderr: string }
/** `deep <args>` from the built CLI, run by you, with its stdout kept byte for byte. */
export function deepBytes(home: string, args: readonly string[], timeoutMs = 60_000): Promise<Bytes> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(out), stderr }); });
  });
}

const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code raising an ask for a session of the repo `shop`, as #24's suite raises them. */
const core = (session: string): Connection => ({ writer: 'core', ...who, session, project: PROJECT });
/** A session's own hooks. */
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, project: PROJECT, agent: 'claude-code' });

export interface Seeding {
  record: RecordStore;
  asks: Asks;
  /** Moves the seeding clock. */
  at(ms: number): void;
}
/** Seeds <home>/.deepbuild/ledger.db with the hub stopped, through the real record and asks core, then closes it (as ../24's seed). */
export async function seed(home: string, fill: (s: Seeding) => Promise<void>, start = Date.now()): Promise<void> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  let now = start;
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  const asks = withPlans(await openAsks({ record, now: () => now, deliver: () => undefined }));
  try {
    await fill({ record, asks, at: (ms) => { now = ms; } });
  } finally {
    await record.close();
  }
}

/** session.start for a session of the repo `shop`, as its hook would append it. */
export async function startSession(s: Seeding, session: string, at: number): Promise<void> {
  s.at(at);
  await s.record.append(hook(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: session } });
}
/** An authority ask whose question quotes `call`, and whose one-step plan runs it; its handle. */
export function raiseCall(s: Seeding, session: string, call: string, raised: number): Promise<string> {
  s.at(raised);
  const plan: PlanInput = { steps: [{ does: call, changes: ['origin/main'], undo: 'Revert it', public: true, cost: 0 }], diff: sha256(call) };
  return s.asks.raise(core(session), sourceOf('authority'), { ...askData('authority', call, raised, raised + DAY), question: questionOf(call) }, plan);
}
/** The question an authority ask quoting `call` asks. */
export const questionOf = (call: string): string => `Run \`${call}\` in shop?`;
/** A taste ask with exactly this question; its handle. */
export function raiseQuestion(s: Seeding, session: string, question: string, raised: number): Promise<string> {
  s.at(raised);
  return s.asks.raise(core(session), sourceOf('taste'), { ...askData('taste', question, raised, raised + DAY), question });
}

/** A stop's usage, as packages/contracts/fixtures/agent.stop@5/01.json carries it. */
const STOP_USAGE = { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 2, exact: true }, cached: { value: 0, exact: true }, output: { value: 1, exact: true }, context_fill: 0.1, cost: { usd: 0.0001, basis: 'estimated', rate_card: 'anthropic-2026-10' } };
/**
 * A finished turn of `session`, as its hooks would record it: a prompt, one shell call running `command` and its
 * result, and the stop. `deep status` lists a finished session's last turn's tool calls (#668).
 */
export async function finishedTurn(s: Seeding, session: string, command: string, at: number): Promise<void> {
  const call = `toolu_${ulid(at).slice(-12)}`;
  const append = async (ts: number, event: Record<string, unknown>) => { s.at(ts); await s.record.append(hook(session), { id: ulid(ts), ts, ...event } as never); };
  await append(at, { v: 2, kind: 'user.ask', data: { msg: 1, text: 'tidy the branch', tasks: [], from: 'person', disposition: 'handled' } });
  await append(at + 1, { v: 3, kind: 'tool.before', data: { kind: 'shell', paths: [], command, call } });
  await append(at + 2, { v: 3, kind: 'tool.after', data: { kind: 'shell', paths: [], command, call, outcome: 'ok' } });
  await append(at + 3, { v: 5, kind: 'agent.stop', subject: `session:${session}`, data: { turn: 1, did_work: true, claim: false, cause: 'unknown', outcome: 'finished', usage: STOP_USAGE } });
}

// ---- Bytes.
/** Every control byte in `out` but a line end (`\n`): C0 (0x00–0x1F but 0x0A), DEL (0x7F) and C1 (U+0080–U+009F). */
export function controlBytes(out: Buffer): { at: number; byte: string }[] {
  const found: { at: number; byte: string }[] = [];
  for (let i = 0; i < out.length; i++) {
    const b = out[i]!;
    if ((b < 0x20 && b !== 0x0a) || b === 0x7f) found.push({ at: i, byte: `0x${b.toString(16).padStart(2, '0')}` });
    // A C1 control in UTF-8 is 0xC2 then 0x80–0x9F.
    else if (b === 0xc2 && i + 1 < out.length && out[i + 1]! >= 0x80 && out[i + 1]! <= 0x9f) found.push({ at: i, byte: `U+00${out[i + 1]!.toString(16).toUpperCase()}` });
  }
  return found;
}
/** The stdout's lines as bytes, split only at `\n`, each with its text as JSON shows it (every control byte escaped). */
export function linesOf(out: Buffer): { bytes: Buffer; shown: string }[] {
  const lines: { bytes: Buffer; shown: string }[] = [];
  for (let start = 0; start <= out.length;) {
    let end = out.indexOf(0x0a, start);
    if (end < 0) end = out.length;
    const bytes = out.subarray(start, end);
    if (bytes.length || end < out.length) lines.push({ bytes, shown: JSON.stringify(bytes.toString('utf8')) });
    start = end + 1;
  }
  return lines;
}
/**
 * The criterion's own check: no control byte in a command's stdout but its line ends. Its failure names the row each
 * one is on: the ask whose row it is, or under whose row it is printed (its plan's steps), by handle, the line's
 * number, and the line itself escaped.
 */
export function expectNoControlBytes(out: Buffer, command: string, handles: readonly string[]): void {
  const problems: string[] = [];
  let under: string | undefined;
  for (const [n, line] of linesOf(out).entries()) {
    const text = line.bytes.toString('utf8');
    const own = handles.find((h) => text.includes(h));
    if (own) under = own;
    else if (/^\S/.test(text)) under = undefined;
    const bad = controlBytes(line.bytes);
    if (bad.length) problems.push(`${own ? `the row of ${own}` : under ? `a line under the row of ${under}` : 'a row'} (stdout line ${n + 1}) holds raw ${bad.map((b) => b.byte).join(', ')}: ${line.shown}`);
  }
  expect(problems.length, `${command}'s stdout holds no control byte but its line ends; ${problems.length} line(s) do:\n${problems.join('\n')}`).toBe(0);
}
/** The line of `out` holding `handle`, and the indented lines printed under it (its plan's steps), as text. */
export function rowOf(out: Buffer, handle: string): { row: string | undefined; under: string[] } {
  const lines = linesOf(out).map((l) => l.bytes.toString('utf8'));
  const at = lines.findIndex((l) => l.includes(handle));
  if (at < 0) return { row: undefined, under: [] };
  const under: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (!/^\s/.test(l)) break;
    under.push(l);
  }
  return { row: lines[at], under };
}

/**
 * ESC shown as visible text. The scope writes it `\x1b`; the other common spellings a program prints for it count
 * too, since the issue fixes none of them: `\x1b`, `\x1B`, `\u001b`, `\u001B`, `\e`, `\033`, `^[`, `␛` (U+241B), `<ESC>`.
 */
export const VISIBLE_ESC = /\\x1b|\\u001b|\\u\{1b\}|\\e|\\033|\^\[|␛|<esc>/i;
