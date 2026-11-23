// Test-side tools for issue #3309 (README). The rest comes from earlier suites, imported by path, never copied:
// ../83/helpers.ts (the real hub's process shape, `deep setup`, the Claude Code stand-in and its hook log),
// ../3305/helpers.ts (#906's planted late reply, the lost prompt and the count of replies that reached the agent) and
// ../352/helpers.ts (two worktrees of one repo and their sessions, the hub as #352 runs it). What is added here: your
// note sent from the app (`session.note` on an app connection, #340), a fixture forge on 127.0.0.1 that holds one
// issue read until the test lets it go, and deep-hook stopped by its PID. Nothing here stands in for DeepBuild.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parseObject, type Hub, type Line } from '../83/helpers.ts';

/** The criteria, by their IDs (#3309. + the first 8 hex of the SHA-256 of each criterion's text, whitespace collapsed). */
export const SIBLING = '#3309.5263c09a';
export const NOTE = '#3309.c730ec7c';
export const PROMISE = '#3309.c1997961';

export const tag = (n = 4) => randomBytes(n).toString('hex');

/**
 * Your words into a session from the app (#340): `session.note {session, text, request}` on an `app` connection with
 * the control token, as the app sends it. BLOCKED unless the hub takes it, naming the request.
 */
export function noteFromApp(hub: Hub, session: string, text: string, request: string, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: no reply to session.note within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(Error(`BLOCKED: session.note couldn't reach the hub: ${String(error)}`)); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'app', token })}\n`);
        } else if (step === 1 && (line?.role !== undefined || line?.error !== undefined)) {
          if (line.role !== 'app') { clearTimeout(timer); sock.destroy(); reject(Error(`BLOCKED: the hub refused the app hello: ${JSON.stringify(line)}`)); return; }
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 'note#1', method: 'session.note', params: { session, text, request } })}\n`);
        } else if (step === 2 && line?.id === 'note#1') {
          clearTimeout(timer);
          sock.destroy();
          if (line.error || line.result?.request !== request) reject(Error(`BLOCKED: the hub didn't take the note (request ${request}): ${JSON.stringify(line)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}

/**
 * GitHub's REST API as far as an issue link's read reaches it, on 127.0.0.1 (DEEP_HUB_TEST_FORGE). Every path answers
 * 404 at once, except the held issue: its GET is kept open until `release()`, then answered 404 (no such issue), so the
 * hub's read of the link ends with nothing read. When the read arrived and when it was let go are kept.
 */
export class HeldForge {
  seenAt: number | undefined;
  releasedAt: number | undefined;
  readonly paths: string[] = [];
  private seenWaiters: (() => void)[] = [];
  private releaseNow: (() => void) | undefined;
  private readonly released: Promise<void>;
  private constructor(private readonly server: http.Server, readonly url: string, readonly held: string) {
    this.released = new Promise<void>((resolve) => { this.releaseNow = resolve; });
  }
  static async start(held: string): Promise<HeldForge> {
    let forge: HeldForge | undefined;
    const server = http.createServer((req, res) => void forge!.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new HeldForge(server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, held);
    return forge;
  }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', this.url).pathname;
    this.paths.push(`${req.method ?? 'GET'} ${path}`);
    for await (const _ of req) { /* drain */ }
    if (path === this.held && this.releasedAt === undefined) {
      this.seenAt ??= Date.now();
      for (const w of this.seenWaiters.splice(0)) w();
      await this.released;
    }
    if (!res.destroyed) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: 'Not Found' }));
    }
  }
  /** Resolves once the held issue's read has reached the forge, or with false after `timeoutMs`. */
  seen(timeoutMs: number): Promise<boolean> {
    if (this.seenAt !== undefined) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.seenWaiters.push(() => { clearTimeout(timer); resolve(true); });
    });
  }
  release(): void {
    if (this.releasedAt !== undefined) return;
    this.releasedAt = Date.now();
    this.releaseNow!();
  }
  async close(): Promise<void> {
    this.release();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/**
 * The deep-hook processes running as children of `parent` (a session's agent process, which starts each hook command
 * as Claude Code does) whose arguments end with `args`, by PID, from `ps`.
 */
export function hookChildren(parent: number, args: string): number[] {
  const out = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return out.split('\n').flatMap((row) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
    return m && Number(m[2]) === parent && /deep-hook/.test(m[3]!) && m[3]!.trimEnd().endsWith(args) ? [Number(m[1])] : [];
  });
}
