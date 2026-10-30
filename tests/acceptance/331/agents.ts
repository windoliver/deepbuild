// The agent stand-in (fixtures/agent.mjs) for #331's AC9, as the hub sees it: a Claude Code session established by
// hooks whose parent is the agent's process (hook.request lines over the hub's socket, deep-hook's wire), a
// `deep mcp` that is the agent's child, spoken to as an MCP client speaks it (newline-delimited JSON-RPC 2.0 on its
// stdio), and an agent the agent itself starts, in a worktree of its own: a child process of the first, so the
// session it establishes is a child session by the process tree. Adapted from tests/acceptance/26/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of that suite never moves it. Nothing here
// stands in for the hub: every observation is a tool result, a hub reply or the record read through the socket.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { childEnv, CLI, type Hub, type Line, NODE, own, sleep, tempDir, ulid, waitFor } from './helpers.ts';

const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };
let rpc = 0;
const nextId = (what: string): string => `${what}#${++rpc}`;

export interface Session { id: string; cwd: string; transcript: string }
/** A tool call's outcome: `isError`, and its value (structuredContent, else the JSON in its first text block). */
export interface Outcome { isError: boolean; value: Line | string | undefined; reply: Line; protocolError: boolean }

export class Agent {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private constructor(input: Readable, private readonly output: Writable, readonly pid: number, readonly cwd: string) {
    let buffer = '';
    input.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
    input.on('close', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the agent stand-in went away' }); });
  }
  /** An agent process started by this test process, in `cwd`, with HOME the suite's temp home (helpers.ts, childEnv). */
  static start(cwd: string): Agent {
    const child: ChildProcess = spawn(NODE, [AGENT], { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child.stdout!, child.stdin!, child.pid!, cwd);
  }
  /**
   * An agent this agent starts, in `cwd`: a child process of this agent's process (the stand-in spawns it), driven
   * over a Unix socket of its own so the test can speak to it without standing between the two processes.
   */
  async spawnChild(cwd: string): Promise<Agent> {
    const socket = join(tempDir(), 'agent.sock');
    const r = await this.send({ op: 'spawn', argv: [NODE, AGENT, '--listen', socket], cwd });
    own(r.pid as number);
    const sock = await waitFor(() => new Promise<net.Socket | undefined>((resolve) => {
      const s = net.connect(socket);
      s.once('connect', () => resolve(s));
      s.once('error', () => resolve(undefined));
    }), 10_000, `the child agent's socket ${socket}`);
    sock.on('error', () => undefined);
    return new Agent(sock, sock, r.pid as number, cwd);
  }
  /** A new Claude Code session in `cwd`, its transcript where Claude Code keeps it under the agent's home. */
  session(cwd = this.cwd, firstMessage = 'start'): Session {
    const id = randomUUID();
    const transcript = join(process.env.HOME!, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: id, cwd, message: { role: 'user', content: firstMessage } })}\n`);
    return { id, cwd, transcript };
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.output.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook, from a child of this agent (deep-hook's wire); throws BLOCKED unless the hub acknowledged it. */
  async hook(hub: Hub, s: Session, event: string, extra: Line = {}): Promise<Line> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'bring the app up', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    if (event === 'SessionEnd') Object.assign(payload, { reason: 'other' });
    Object.assign(payload, extra);
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
    return r;
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit');
    await this.hook(hub, s, 'PreToolUse');
  }
  /** The PreToolUse Claude Code fires before its next call of the deep tool `tool` with `args`: `mcp__deep__<tool>`. */
  stamp(hub: Hub, s: Session, tool: string, args: Line): Promise<Line> {
    return this.hook(hub, s, 'PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args });
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<Line> {
    const line = { jsonrpc: '2.0', id: nextId(method), method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
    own(r.pid as number);
  }
  /** `initialize` and `notifications/initialized`, as an MCP client starts; BLOCKED if deep mcp refuses. */
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-331', version: '0' } });
    if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
    await this.notify('notifications/initialized');
    await sleep(50);
  }
  /** The names in `tools/list`. */
  async tools(): Promise<string[]> {
    const reply = await this.request('tools/list', {});
    if (!Array.isArray(reply.result?.tools)) throw Error(`BLOCKED: tools/list gave no tools: ${JSON.stringify(reply)}`);
    return (reply.result.tools as Line[]).map((t) => String(t.name));
  }
  async call(name: string, args: Line, timeoutMs = 120_000): Promise<Outcome> {
    const reply = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (reply.error) return { isError: true, value: reply.error as Line, reply, protocolError: true };
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? (result.content as Line[]).find((c) => c?.type === 'text')?.text : undefined;
    const value = (result.structuredContent as Line | undefined) ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: result.isError === true, value, reply, protocolError: false };
  }
  /**
   * `deep_env` for the session, stamped first as Claude Code stamps every MCP call (PreToolUse `mcp__deep__deep_env`
   * with the call's arguments), then called on this agent's deep mcp. README, The surface under test: deep_env.
   */
  async deepEnv(hub: Hub, s: Session, args: Line, timeoutMs = 120_000): Promise<Outcome> {
    await this.stamp(hub, s, 'deep_env', args);
    return this.call('deep_env', args, timeoutMs);
  }
}
