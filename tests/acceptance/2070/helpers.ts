// Test-side tools for the #2070 acceptance tests. The hub in a temporary home, the record read through `events.read`,
// the Claude Code agent stand-in and its own `deep mcp`, and the MCP client calls come from #26's suite
// (../26/helpers.ts); this file adds fixtures/proc.mjs, a real process standing in for paseo's daemon with its plugin
// or for a process outside every agent's process tree, and the plugin's hook line. No hub, CLI or plugin module is
// imported; processes are stopped by PID only (../26/helpers.ts, cleanup).

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  CLI, NODE, childEnv, eventMatching, events, nextId, own, rootOf, ulid, type Ev, type Exchange, type Hub, type Line, type Mcp,
} from '../26/helpers.ts';

const PROC = fileURLToPath(new URL('./fixtures/proc.mjs', import.meta.url));

/** An event as `events.read` gives it, with the record's unverified mark (`verified: false`). */
export type Recorded = Ev & { verified?: boolean };
export const brief = (e: Recorded): string => `${e.kind} ${e.id} session ${e.session ?? 'none'} verified ${String(e.verified)}`;

/** A bind token as paseo's plugin makes one for each agent (packages/paseo/server/hub.ts). */
export const token = (): string => randomBytes(18).toString('base64url');

let seq = BigInt(Date.now()) * 1_000_000n;
/** A paseo session as the plugin knows it: the agent's own session ID, its folder, paseo's agent ID and its token. */
export interface PaseoSession { id: string; cwd: string; agent: string; bind: string }
/**
 * The line paseo's plugin sends for the session's `agent.turn.before`, carrying `bind` (packages/paseo/server/plugin.ts
 * and hub.ts; mapped to session.activity by adapters/paseo.facts.json). The provider is Copilot, an ACP agent the paseo
 * facts cover, so the session is the plugin's own and never watch-only. pid and ppid are filled by the process sending
 * it (fixtures/proc.mjs).
 */
export function paseoLine(s: PaseoSession, bind = s.bind): Line {
  const id = ulid();
  return {
    v: 1, agent: 'paseo', event: 'agent.turn.before', seq: String(seq += 1000n), id, matched: [],
    payload: { hook_event_name: 'agent.turn.before', session_id: s.id, cwd: s.cwd, provider: 'copilot', paseo_agent: s.agent, bind, turn_id: `turn-${id}` },
  };
}

/** The record's events for one hook line, by its ID (the event's identity from then on); [] if none came in 10 s. */
export async function recorded(hub: Hub, id: string): Promise<Recorded[]> {
  await eventMatching(hub, (e) => e.id === id, 10_000);
  return (await events(hub)).filter((e) => e.id === id) as Recorded[];
}
/**
 * Your ask settings, in <home>/.deepbuild/config.json before the hub starts: the asks block of #26's done.yaml. paseo's
 * plugin sends no session start, so the hub knows no worktree for a paseo session, and its asks take their deadlines
 * and defaults from your settings alone.
 */
export function yourAskSettings(home: string): void {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'config.json'), `${JSON.stringify({
    asks: {
      deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
      default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
      fallback: ['change-owner'],
    },
  }, null, 2)}\n`);
}

/** The newest log position now. */
export const head = async (hub: Hub): Promise<number> => Math.max(0, ...(await events(hub)).map((e) => e.log_pos));

/**
 * A real process this test starts (fixtures/proc.mjs): paseo's daemon with DeepBuild's plugin in it, or a process
 * outside every agent's process tree. Its parent is this test process, never an agent.
 */
export class Proc {
  private n = 0;
  private readonly waiting = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.on('exit', () => { for (const [n, done] of [...this.waiting]) done({ n, failed: 'the process exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.waiting.get(line.n)?.(line);
      }
    });
  }
  static start(home: string, cwd: string): Proc {
    const child = spawn(NODE, [PROC], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Proc(child);
  }
  get pid(): number { return this.child.pid!; }
  private send(command: Line, timeoutMs = 60_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(n); reject(Error(`process ${this.pid} gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.waiting.set(n, (line) => {
        clearTimeout(timer);
        this.waiting.delete(n);
        if (line.failed) reject(Error(`process ${this.pid} failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** One hook line from this process, as paseo's plugin sends one; throws BLOCKED unless the hub acknowledged it. */
  async line(hub: Hub, request: Line): Promise<Line> {
    const r = await this.send({ op: 'line', socket: hub.socket, request });
    if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge line ${request.id} from process ${this.pid}: ${JSON.stringify(r)}`);
    return request;
  }
  /** Says hello as `mcp` on a connection of this process's own, as `deep mcp` does, with `fields` over that; the hub's answer. */
  async hello(hub: Hub, fields: Line = {}): Promise<{ sent: Line; answer: Line | null }> {
    const r = await this.send({ op: 'hello', socket: hub.socket, fields });
    return { sent: r.sent as Line, answer: (r.answer as Line | null) ?? null };
  }
  /** One method on that connection: its reply line, `result` or `error`. */
  async call(method: string, params: Line): Promise<Line> {
    return (await this.send({ op: 'call', method, params })).reply as Line;
  }
  /**
   * The MCP server paseo's plugin adds to this daemon's agent: `deep mcp` with DEEP_PASEO_BIND=`bind`, started in `cwd`
   * by the agent's CLI (fixtures/proc.mjs provider), a child of this process, so its parent is never this process.
   */
  server(bind: string, cwd: string): Mcp {
    const argv = [NODE, PROC, 'provider', bind, NODE, CLI, 'mcp'];
    return {
      request: async (method: string, params: Line = {}, timeoutMs = 120_000): Promise<Exchange> => {
        const r = await this.send({ op: 'mcp', argv, cwd, line: { jsonrpc: '2.0', id: nextId(method), method, params }, timeoutMs }, timeoutMs + 5000);
        own(r.pid as number);
        return { reply: r.reply as Line, ms: r.ms as number, pid: r.pid as number };
      },
      notify: async (method: string, params: Line = {}): Promise<void> => {
        own((await this.send({ op: 'mcp', argv, cwd, line: { jsonrpc: '2.0', method, params } })).pid as number);
      },
    };
  }
}

/**
 * A session of paseo's daemon `daemon`, in `cwd`, established by its own line carrying its token: the line comes from
 * the daemon's process, so the hub can check it against the session. Holds that the hub recorded it verified.
 */
export async function paseoSession(daemon: Proc, hub: Hub, cwd: string): Promise<PaseoSession> {
  const s = { id: randomUUID(), cwd, agent: randomUUID(), bind: token() };
  const sent = await daemon.line(hub, paseoLine(s));
  const mine = await recorded(hub, sent.id);
  const what = `paseo session ${s.id}'s own line ${sent.id}, from its daemon (pid ${daemon.pid}), is recorded and verified`;
  expect(mine.length, what).toBeGreaterThan(0);
  expect(mine.map(brief), what).toEqual(mine.map((e) => brief({ ...e, verified: true })));
  return s;
}
