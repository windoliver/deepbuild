// The agent stand-in (fixtures/agent.mjs) as the hub sees it: a Claude Code session established by hooks whose
// parent is the agent's process (hook.request lines over the hub's socket, deep-hook's wire), and `deep env up` /
// `deep env down` run through its Bash tool: the PreToolUse Claude Code fires for that Bash call, stamped from the
// agent's process, then the command itself as the agent's child, in the session's worktree. Adapted from
// tests/acceptance/331/agents.ts (same repo, same license). Nothing here stands in for the hub: every observation
// is a hook reply, the command's own output, or the record read through the socket.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { childEnv, CLI, type Hub, type Line, NODE, own, type Ran, replyOf, ulid } from './helpers.ts';

const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const parse = (raw: string): Line | undefined => { try { return JSON.parse(raw) as Line; } catch { return undefined; } };

export interface Session { id: string; cwd: string; transcript: string }

/** An agent started in the worktree, with a Claude Code session there that the hub knows by its hooks. */
export async function sessionIn(hub: Hub, worktree: string): Promise<{ agent: Agent; s: Session }> {
  const agent = Agent.start(worktree);
  const s = agent.session(worktree);
  await agent.establish(hub, s);
  return { agent, s };
}

/**
 * Whether a BLOCKED cause names the lease another session holds: the lease's ID (its lease.acquired event's subject
 * or data.id), its holder as the record shows it, or the holding session's ID (with or without its dashes).
 */
export function namesLease(cause: unknown, lease: Line | undefined, holder: Session): boolean {
  const text = String(cause ?? '');
  const flat = text.replace(/-/g, '').toLowerCase();
  const names = [lease?.subject, lease?.data?.id, lease?.data?.holder].filter((n): n is string => typeof n === 'string' && n.length > 0);
  return names.some((n) => text.includes(n)) || flat.includes(holder.id.replace(/-/g, '').toLowerCase());
}

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
  /** An agent process started by this test process, in `cwd`, with HOME the suite's temp home. */
  static start(cwd: string): Agent {
    const child: ChildProcess = spawn(NODE, [AGENT], { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Agent(child.stdout!, child.stdin!, child.pid!, cwd);
  }
  /** A new Claude Code session in `cwd`, its transcript where Claude Code keeps it under the agent's home. */
  session(cwd = this.cwd): Session {
    const id = randomUUID();
    const transcript = join(process.env.HOME!, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: id, cwd, message: { role: 'user', content: 'bring the app up' } })}\n`);
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
  async hook(hub: Hub, s: Session, event: string, extra: Line = {}): Promise<{ lines: string[]; reply: Line | undefined }> {
    const payload: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
    if (event === 'SessionStart') Object.assign(payload, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(payload, { prompt: 'bring the app up', prompt_id: randomUUID() });
    if (event === 'PreToolUse') Object.assign(payload, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomUUID()}` });
    Object.assign(payload, extra);
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: s.cwd });
    const lines = (r.lines as string[] | undefined) ?? [];
    if (!lines.some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${s.id}: ${JSON.stringify(r)}`);
    return { lines, reply: replyOf(lines.slice(1)) };
  }
  /** Its SessionStart, prompt and first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: Hub, s: Session): Promise<void> {
    await this.hook(hub, s, 'SessionStart');
    await this.hook(hub, s, 'UserPromptSubmit');
    await this.hook(hub, s, 'PreToolUse');
  }
  /** A tool call as Claude Code asks the hook about it before it runs: PreToolUse with its name and input. */
  preToolUse(hub: Hub, s: Session, tool: string, input: Line): Promise<{ lines: string[]; reply: Line | undefined }> {
    return this.hook(hub, s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: `toolu_${randomUUID()}` });
  }
  /**
   * `deep env <action> --root <hub> --json` through the agent's Bash tool: stamped first (PreToolUse, Bash, the
   * command line), then run as this agent's child in the session's worktree.
   */
  async env(hub: Hub, s: Session, action: 'up' | 'down', timeoutMs = 150_000): Promise<Ran> {
    const argv = [NODE, CLI, 'env', action, '--root', hub.root, '--json'];
    await this.preToolUse(hub, s, 'Bash', { command: `deep env ${action} --root ${hub.root} --json`, description: `Take the stack ${action}` });
    const r = await this.send({ op: 'exec', argv, cwd: s.cwd }, timeoutMs);
    own(r.pid as number);
    return { code: r.code as number | null, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
  }
}
