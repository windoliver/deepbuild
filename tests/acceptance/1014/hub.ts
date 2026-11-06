// Test-side tools for the hub suite: `deep hub run` in a temporary home, Claude Code's hook lines on its socket as
// deep-hook writes them, `deep status` from the built CLI, and the record's tables read back. It keeps its own copies of
// the shapes in tests/acceptance/85/hub/helpers.ts, so a redraft of theirs never moves these tests. Processes are
// stopped by PID only.

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Row } from './reading.ts';

const CLI = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function until<T>(probe: () => T | undefined | false, ms = 15_000): Promise<T | undefined> {
  for (const end = Date.now() + ms; ; await sleep(25)) {
    const got = probe();
    if (got) return got;
    if (Date.now() >= end) return undefined;
  }
}

export interface Hub { home: string; root: string; ledger: string; socket: string; env: NodeJS.ProcessEnv; output: () => string; stop: () => Promise<void> }

/** Runs `body` against a hub on a temporary home; always stops it by PID and removes the home. */
export async function withHub<T>(extra: Record<string, string>, body: (hub: Hub) => Promise<T>): Promise<T> {
  const home = realpathSync(mkdtempSync('/tmp/hub-1014-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'ANTHROPIC_BASE_URL']) delete env[k];
  const child: ChildProcess = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr!.on('data', (d) => { output += d; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
  };
  try {
    let timer: NodeJS.Timeout | undefined;
    await new Promise((resolve, reject) => {
      child.stdout!.once('data', resolve);
      child.once('exit', (code) => reject(Error(`the hub exited with ${code} before it was ready: ${output.trim()}`)));
      timer = setTimeout(() => reject(Error("the hub wasn't ready within 60 s")), 60_000);
    }).finally(() => clearTimeout(timer));
    return await body({ home, root, ledger: join(root, 'ledger.db'), socket: join(root, 'hub.sock'), env, output: () => output, stop });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}

/** `deep status` as you run it; resolves with the state its listing gives the session. */
export async function deepStatus(hub: Hub, session: string): Promise<{ state: string | undefined; text: string }> {
  const { stdout } = await promisify(execFile)(process.execPath, [CLI, 'status'], { env: hub.env });
  const line = stdout.split('\n').find((l) => l.trimStart().startsWith(session.slice(0, 8)));
  return { state: line?.trim().split(/\s{2,}/)[1], text: stdout };
}

/** Rows of the record's database, read while or after the hub runs; integers past 2^53 as text. */
export function rows(hub: Hub, sql: string, ...params: string[]): Row[] {
  const db = new DatabaseSync(hub.ledger, { readOnly: true });
  try {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all(...params).map((row) => Object.fromEntries(Object.entries(row as Row).map(([k, v]) =>
      [k, typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v])));
  } finally { db.close(); }
}

/** Sends one hook line as deep-hook does: waits for the hello, writes the line, reads the acknowledgement. */
function sendLine(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      if (got.split('\n').length === 2) sock.write(line);
      if (got.split('\n').length > 2) { sock.destroy(); resolve(got.split('\n')[1]!); }
    });
    sock.on('error', reject);
  });
}

/** A Claude Code stand-in: a live process the hooks name as the agent, and a transcript file, stopped by PID. */
export class ClaudeCode {
  readonly id = randomUUID();
  private readonly cwd: string;
  private readonly transcript: string;
  private readonly agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  private stamp = Date.now();
  private promptId = '';
  constructor(private readonly hub: Hub) {
    this.cwd = join(hub.home, 'work');
    mkdirSync(this.cwd, { recursive: true });
    const project = join(hub.home, '.claude', 'projects', 'work');
    mkdirSync(project, { recursive: true });
    this.transcript = join(project, `${this.id}.jsonl`);
    writeFileSync(this.transcript, '');
  }
  end(): void { this.agent.kill('SIGTERM'); }
  /** One hook, stamped after the one before it, as deep-hook stamps each with its own start. */
  async hook(event: string, extra: Record<string, unknown> = {}): Promise<void> {
    const at = this.stamp = Math.max(this.stamp + 1, Date.now());
    let time = '';
    for (let t = at, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32]! + time;
    const line = { v: 1, agent: 'claude-code', event, seq: String(BigInt(at) * 1_000_000n), id: time + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join(''), pid: process.pid, ppid: this.agent.pid, matched: [],
      payload: { session_id: this.id, cwd: this.cwd, transcript_path: this.transcript, hook_event_name: event, ...(this.promptId ? { prompt_id: this.promptId } : {}), ...extra } };
    const ack = await sendLine(this.hub.socket, `${JSON.stringify(line)}\n`);
    if (!ack.includes('"ack"')) throw Error(`the hub didn't acknowledge ${event}: ${ack}`);
  }
  async prompt(text: string): Promise<void> {
    this.promptId = randomUUID();
    appendFileSync(this.transcript, `${JSON.stringify({ type: 'user', uuid: this.promptId, promptId: this.promptId, sessionId: this.id, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed' })}\n`);
    await this.hook('UserPromptSubmit', { prompt: text });
  }
  pre = (call: string, tool: string, input: Record<string, unknown>) => this.hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call });
  post = (call: string, tool: string, input: Record<string, unknown>) => this.hook('PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: 'done' });
  /** A subagent's stop, in the payload Claude Code 2.1.308 sends: under the parent's session ID, with `agent_id`. */
  subagentStop = (agentId: string) => this.hook('SubagentStop', { agent_id: agentId, agent_type: 'general-purpose', agent_transcript_path: `${this.transcript}.${agentId}`, stop_hook_active: false, last_assistant_message: 'the subagent is done' });
  ownStop = () => this.hook('Stop', { stop_hook_active: false, last_assistant_message: 'the tests pass' });
}
