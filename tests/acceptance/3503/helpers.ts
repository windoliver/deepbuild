// Test-side tools for the #3503 acceptance tests. A server, `deep-hook mcp actions` (or, for criterion 5, `deep mcp`),
// runs as a child under `/usr/bin/time -l`, in a process group of its own, with its stdin and stdout piped. The tools
// collect the JSON-RPC lines it writes and read its resident memory: `ps -o rss=` by its PID while it is fed, and
// time's "maximum resident set size" (the kernel's peak, in bytes on macOS) once it exits. A stand-in hub socket sits at
// the home's default address (<home>/.deepbuild/hub.sock) for criterion 4.
//
// Safety: every folder is under /tmp/dh3503-*, removed after the file. A server runs with HOME and TMPDIR there and
// without the caller's DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS. Nothing leaves the machine, and nothing is written in
// this checkout. Every process stopped is one this file started, stopped by its PID or its own process group.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
const CLI = join(REPO, 'packages/cli/dist/main.js');

/** Each criterion's ID, in the issue's order (`criterionId` in scripts/proof-change.mjs); it starts its tests' names. */
export const AC = {
  gigabyte: '#3503.1357b746',
  exact: '#3503.2d94a9c4',
  split: '#3503.ac2ce418',
  reply: '#3503.54cedc2a',
  same: '#3503.3e8aff35',
  budgets: '#3503.5f4bd902',
} as const;

/** #2654's cap, as the issue's Scope states it: 16 MiB, one line's bytes without its newline. */
export const CAP = 16 * 1024 * 1024;
/** Criterion 1's bound, "under 32 MB resident (drafted)", read as 32,000,000 bytes. */
export const RSS_LIMIT = 32_000_000;
/** How an error names the cap: its size in MiB or in bytes (the issue fixes no wording). */
export const NAMES_CAP = /\b16\s?MiB\b|\b16,?777,?216\b/i;
export const MIB = 1024 * 1024;
export const LONG = 1_800_000;
export const SHORT = 300_000;
export const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

/** The deep-hook under test: the run's own build in DEEP_BIN_DIR, else this checkout's debug build. */
export function hookBinary(): string {
  const bin = process.env.DEEP_BIN_DIR ? join(process.env.DEEP_BIN_DIR, 'deep-hook') : join(REPO, 'target/debug/deep-hook');
  if (!existsSync(bin)) throw Error(`BLOCKED: ${bin} is not built; run cargo build --locked -p deep-hook first`);
  return bin;
}
export const actions = (bin = hookBinary()): string[] => [bin, 'mcp', 'actions'];
export function deepMcp(): string[] {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is not built; run npm ci and npm run build --workspaces first`);
  return [NODE, CLI, 'mcp'];
}

const made: string[] = [];
const groups = new Set<number>();
const sockets = new Set<net.Socket>();
const servers: net.Server[] = [];
afterAll(() => {
  for (const sock of sockets) sock.destroy();
  for (const server of servers.splice(0)) server.close();
  for (const pid of groups) try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
  groups.clear();
  for (const path of made.splice(0).reverse()) rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 60_000);

/** A fresh folder with a home in it; no hub runs there unless a test stands one in. */
export function tempHome(): { dir: string; home: string } {
  const dir = realpathSync(mkdtempSync('/tmp/dh3503-'));
  made.push(dir);
  const home = join(dir, 'h');
  mkdirSync(home);
  return { dir, home };
}

function childEnv(home: string, tmp: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, TMPDIR: tmp, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C' };
}

const ps = (args: string[]): Promise<string> => new Promise((resolve) => execFile('ps', args, (error, stdout) => resolve(error ? '' : String(stdout))));
const pgrepChild = (pid: number): Promise<number> => new Promise((resolve) => execFile('pgrep', ['-P', String(pid)], (_e, out) => resolve(Number(String(out).trim().split('\n')[0]) || 0)));

export type Line = { [key: string]: any };

/** A running server: the lines it wrote, its resident memory, its stdin. */
export class Server {
  readonly lines: Line[] = [];
  readonly raw: string[] = [];
  stderr = '';
  exited: number | null | undefined = undefined;
  /** The highest resident memory seen, in bytes: `ps` while it ran, and time's maximum once it exited. */
  peak = 0;
  maxrss = 0;
  private serverPid = 0;
  private readonly events = new EventEmitter();
  private readonly child: ChildProcessWithoutNullStreams;
  private stdinError: Error | undefined;

  constructor(readonly argv: string[], home: string, tmp: string, readonly name = 'deep-hook mcp actions') {
    this.child = spawn('/usr/bin/time', ['-l', ...argv], { cwd: tmp, env: childEnv(home, tmp), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const pid = this.child.pid!;
    groups.add(pid);
    let out = '';
    this.child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
        const text = out.slice(0, i);
        out = out.slice(i + 1);
        this.raw.push(text.length > 1500 ? `${text.slice(0, 1500)}…` : text);
        try { this.lines.push(JSON.parse(text) as Line); } catch { this.lines.push({ unparsed: text.slice(0, 1500) }); }
      }
      this.events.emit('change');
    });
    this.child.stderr.setEncoding('utf8').on('data', (d: string) => (this.stderr = (this.stderr + d).slice(-6000)));
    this.child.stdin.on('error', (error) => (this.stdinError = error));
    this.child.on('close', (code) => {
      this.exited = code;
      groups.delete(pid);
      const max = /(\d+)\s+maximum resident set size/.exec(this.stderr);
      if (max) { this.maxrss = Number(max[1]); this.peak = Math.max(this.peak, this.maxrss); }
      this.events.emit('change');
    });
  }

  /** The server's resident memory now, in bytes, by its PID (time's child); 0 when it can't be read. */
  async rss(): Promise<number> {
    if (!this.serverPid) this.serverPid = await pgrepChild(this.child.pid!);
    const kib = Number((await ps(['-o', 'rss=', '-p', String(this.serverPid)])).trim());
    const bytes = this.serverPid && Number.isFinite(kib) ? kib * 1024 : 0;
    this.peak = Math.max(this.peak, bytes);
    return bytes;
  }

  /** Writes bytes to the server's stdin, waiting for the pipe to drain; false once it can't be written. */
  async write(bytes: string | Buffer): Promise<boolean> {
    if (this.exited !== undefined || this.stdinError || this.child.stdin.destroyed) return false;
    if (!this.child.stdin.write(bytes)) {
      await new Promise<void>((resolve) => {
        const done = () => { this.child.stdin.off('drain', done); this.child.off('close', done); this.child.stdin.off('error', done); resolve(); };
        this.child.stdin.on('drain', done);
        this.child.stdin.on('error', done);
        this.child.on('close', done);
      });
    }
    return this.exited === undefined && !this.stdinError;
  }

  /**
   * Streams `total` bytes of 'a' with no newline, a MiB at a time (this process never holds more), reading the server's
   * resident memory every 16 MiB. Once a reading reaches `stopAt`, it feeds 64 MiB more and stops, so a server that
   * holds what it is fed shows it without taking the whole feed. Returns the bytes written.
   */
  async stream(total: number, stopAt = Infinity): Promise<number> {
    const chunk = Buffer.alloc(MIB, 0x61);
    let sent = 0;
    let past = -1;
    while (sent < total && (past < 0 || sent - past < 64 * MIB)) {
      const n = Math.min(MIB, total - sent);
      if (!(await this.write(n === MIB ? chunk : chunk.subarray(0, n)))) break;
      sent += n;
      if (sent % (16 * MIB) === 0 && past < 0 && (await this.rss()) >= stopAt) past = sent;
    }
    return sent;
  }

  /** The first line written matching `match`, waiting up to `ms`; undefined when none came or the server ended. */
  waitFor(match: (line: Line) => boolean, ms: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const found = () => this.lines.find(match);
      if (found() || this.exited !== undefined) return resolve(found());
      const check = () => { if (found() || this.exited !== undefined) finish(); };
      const finish = () => { clearTimeout(timer); this.events.off('change', check); resolve(found()); };
      // deadline: bounds the wait for an answer, so a server that never answers fails instead of hanging.
      const timer = setTimeout(finish, ms);
      this.events.on('change', check);
    });
  }

  /** Closes stdin and waits for the server to exit (so time reports its peak), stopping its group if it doesn't. */
  async end(ms = 60_000): Promise<void> {
    try { this.child.stdin.end(); } catch { /* gone */ }
    if (this.exited !== undefined) return;
    await new Promise<void>((resolve) => {
      // deadline: bounds the wait for the exit; a server that outlives it is stopped by its process group.
      const timer = setTimeout(() => { try { process.kill(-this.child.pid!, 'SIGKILL'); } catch { /* gone */ } }, ms);
      this.child.on('close', () => { clearTimeout(timer); resolve(); });
    });
  }

  shown(): string {
    return `${this.name} wrote ${JSON.stringify(this.raw.slice(-6))}, exit ${String(this.exited)}, peak ${mb(this.peak)}, stderr ${JSON.stringify(this.stderr.replace(/^\s+\d+\s+[a-z].*$/gm, '').trim().slice(-800))}`;
  }
}

export const startActions = (home: string, dir: string): Server => new Server(actions(), home, dir);

/** A JSON-RPC ping request of exactly `bytes` bytes, the newline not counted; ping takes no params, so the pad is ignored. */
export function pingOf(id: number, bytes: number): string {
  const head = `{"jsonrpc":"2.0","id":${id},"method":"ping","params":{"pad":"`;
  const tail = '"}}';
  const text = `${head}${'a'.repeat(bytes - head.length - tail.length)}${tail}`;
  if (Buffer.byteLength(text) !== bytes) throw Error('setup: ping length');
  return text;
}

export const request = (id: number, method: string, params?: unknown): string => `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`;
export const isError = (line: Line): boolean => line.error !== undefined && line.result === undefined;

/**
 * A stand-in hub on `<home>/.deepbuild/hub.sock`, the address deep-hook reads with no config. It greets each connection,
 * answers the server's hello with a role, as the hub does, then answers the first mcp.call with the start of a reply,
 * `{"v":1,"id":…,"result":{"pad":"`, followed by `replyBytes` bytes of 'a' and no newline, and holds the connection
 * open. `written` counts the reply's bytes the socket took.
 */
export class StandInHub {
  written = 0;
  called = false;
  readonly server: net.Server;
  constructor(home: string, replyBytes: number) {
    mkdirSync(join(home, '.deepbuild'), { recursive: true });
    this.server = net.createServer((sock) => {
      sockets.add(sock);
      let buffer = '';
      let greeted = false;
      sock.on('error', () => undefined);
      sock.write('{"v":1,"hello":"hub"}\n');
      sock.setEncoding('utf8').on('data', (d: string) => {
        buffer += d;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const message = JSON.parse(buffer.slice(0, i)) as Line;
          buffer = buffer.slice(i + 1);
          if (!greeted) { greeted = true; sock.write('{"v":1,"role":"mcp"}\n'); continue; }
          if (message.method === 'mcp.call' && !this.called) { this.called = true; void this.hold(sock, String(message.id), replyBytes); }
        }
      });
    });
    servers.push(this.server);
    this.server.listen(join(home, '.deepbuild', 'hub.sock'));
  }
  async listening(): Promise<void> {
    if (this.server.listening) return;
    await new Promise<void>((resolve, reject) => { this.server.once('listening', resolve); this.server.once('error', reject); });
  }
  /** Drops every connection, so a server still waiting on one is told it closed. */
  close(): void { for (const sock of sockets) sock.destroy(); }
  private async hold(sock: net.Socket, id: string, total: number): Promise<void> {
    const write = (bytes: string | Buffer) => new Promise<boolean>((resolve) => {
      if (sock.destroyed) return resolve(false);
      if (sock.write(bytes, (error) => { if (!error) this.written += Buffer.byteLength(bytes); })) return resolve(true);
      const done = () => { sock.off('drain', done); sock.off('close', done); resolve(!sock.destroyed); };
      sock.on('drain', done);
      sock.on('close', done);
    });
    await write(`{"v":1,"id":${JSON.stringify(id)},"result":{"pad":"`);
    const chunk = Buffer.alloc(MIB, 0x61);
    for (let sent = 0; sent < total; sent += MIB) if (!(await write(chunk))) break;
    // Held open with no newline: nothing more is written and the socket isn't closed.
  }
}
