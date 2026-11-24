// Test-side tools for the #2654 acceptance tests: `deep mcp` (this checkout's packages/cli/dist/main.js) started as a
// child with its stdin and stdout piped, the JSON-RPC lines it writes collected, its resident memory sampled by its PID
// with `ps`, and a stand-in hub socket at the home's default address (<home>/.deepbuild/hub.sock, paths.ts hubAddress)
// that greets deep mcp as the hub does and then answers its call with a reply held open with no newline.
//
// Safety: every folder is under /tmp/dh2654-*, removed after the file; deep mcp runs with HOME and TMPDIR there and
// without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; nothing leaves the machine; every process is one this
// file started, stopped by its PID.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;

/** Each criterion's tag, in the issue's order; it starts its tests' names. */
export const AC = {
  gigabyte: '#2654.4f03ec28',
  exact: '#2654.2d94a9c4',
  split: '#2654.ac2ce418',
  reply: '#2654.7c3a0ee7',
  budgets: '#2654.1891d3ad',
} as const;

/** The cap, as the issue drafts it: 16 MiB. */
export const CAP = 16 * 1024 * 1024;
/** The memory bound the issue states since its Nov 22 amendment: 96 MB (resident), read as 96,000,000 bytes. */
export const RSS_LIMIT = 96_000_000;
/** How an error names the cap: its size in MiB or in bytes (the issue doesn't fix the wording). */
export const NAMES_CAP = /\b16\s?MiB\b|\b16,?777,?216\b/i;
/** A long feed on a loaded machine. */
export const LONG = 1_800_000;
export const SHORT = 300_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

const made: string[] = [];
const owned = new Set<number>();
const servers: net.Server[] = [];
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
afterAll(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const path of made.splice(0).reverse()) rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 60_000);

/** A fresh folder with a home in it; no hub runs there unless a test stands one in. */
export function tempHome(): { dir: string; home: string } {
  const dir = realpathSync(mkdtempSync('/tmp/dh2654-'));
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
  return { ...env, HOME: home, TMPDIR: tmp, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' };
}

export type Line = { [key: string]: any };

/** A running `deep mcp`: the lines it wrote, its peak resident memory as `ps` saw it, and its stdin. */
export class Mcp {
  readonly lines: Line[] = [];
  readonly raw: string[] = [];
  stderr = '';
  exited: number | null | undefined = undefined;
  peak = 0;
  samples = 0;
  private sampler: NodeJS.Timeout | undefined;
  private readonly child: ChildProcessWithoutNullStreams;
  private stdinError: Error | undefined;

  constructor(home: string, tmp: string) {
    this.child = spawn(NODE, [CLI, 'mcp'], { cwd: tmp, env: childEnv(home, tmp), stdio: ['pipe', 'pipe', 'pipe'] });
    if (this.child.pid) owned.add(this.child.pid);
    let out = '';
    this.child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
        const text = out.slice(0, i);
        out = out.slice(i + 1);
        this.raw.push(text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
        try { this.lines.push(JSON.parse(text) as Line); } catch { this.lines.push({ unparsed: text.slice(0, 2000) }); }
      }
    });
    this.child.stderr.setEncoding('utf8').on('data', (d: string) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.child.stdin.on('error', (error) => (this.stdinError = error));
    this.child.on('exit', (code) => { this.exited = code; if (this.child.pid) owned.delete(this.child.pid); this.stopSampling(); });
  }

  get pid(): number { return this.child.pid!; }

  /** Samples the process's resident memory (`ps -o rss=`, KiB) by its PID every 100 ms, keeping the peak. */
  startSampling(): void {
    let busy = false;
    this.sampler = setInterval(() => {
      if (busy || this.exited !== undefined) return;
      busy = true;
      execFile('ps', ['-o', 'rss=', '-p', String(this.pid)], (error, stdout) => {
        busy = false;
        const kib = Number(String(stdout).trim());
        if (!error && Number.isFinite(kib) && kib > 0) { this.samples++; this.peak = Math.max(this.peak, kib * 1024); }
      });
    }, 100);
  }
  stopSampling(): void { if (this.sampler) clearInterval(this.sampler); this.sampler = undefined; }

  /** Writes bytes to deep mcp's stdin, waiting for the pipe to drain; false once it can't be written. */
  async write(bytes: string | Buffer): Promise<boolean> {
    if (this.exited !== undefined || this.stdinError || this.child.stdin.destroyed) return false;
    if (!this.child.stdin.write(bytes)) {
      await new Promise<void>((resolve) => {
        const done = () => { this.child.stdin.off('drain', done); this.child.off('exit', done); this.child.stdin.off('error', done); resolve(); };
        this.child.stdin.on('drain', done);
        this.child.stdin.on('error', done);
        this.child.on('exit', done);
      });
    }
    return this.exited === undefined && !this.stdinError;
  }

  /**
   * Streams `total` bytes of 'a' with no newline, a MiB at a time, never holding more than one chunk in this process.
   * Stops early once `stop()` says so or the process is gone; returns the bytes written.
   */
  async stream(total: number, stop: () => boolean = () => false): Promise<number> {
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    let sent = 0;
    while (sent < total && !stop()) {
      const n = Math.min(chunk.length, total - sent);
      if (!(await this.write(n === chunk.length ? chunk : chunk.subarray(0, n)))) break;
      sent += n;
    }
    return sent;
  }

  /** The first line written matching `match`, waiting up to `ms`; undefined when none came or the process ended. */
  async waitFor(match: (line: Line) => boolean, ms: number): Promise<Line | undefined> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.lines.find(match);
      if (found || this.exited !== undefined || Date.now() > deadline) return found;
      await sleep(25);
    }
  }

  /** Closes stdin and waits for the process to end, stopping it by its PID if it doesn't. */
  async end(ms = 30_000): Promise<void> {
    this.stopSampling();
    try { this.child.stdin.end(); } catch { /* gone */ }
    const deadline = Date.now() + ms;
    while (this.exited === undefined && Date.now() < deadline) await sleep(50);
    if (this.exited === undefined) try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ }
  }

  /** What it wrote and its state, for a failure message. */
  shown(): string {
    return `deep mcp (pid ${this.pid}) wrote ${JSON.stringify(this.raw.slice(-8))}, exit ${String(this.exited)}, stderr ${JSON.stringify(this.stderr.slice(-1200))}`;
  }
}

/** A JSON-RPC ping request of exactly `bytes` bytes, the newline not counted; ping takes no params, so the pad is ignored. */
export function pingOf(id: number, bytes: number): string {
  const head = `{"jsonrpc":"2.0","id":${id},"method":"ping","params":{"pad":"`;
  const tail = '"}}';
  const pad = bytes - Buffer.byteLength(head) - Buffer.byteLength(tail);
  if (pad < 0) throw Error(`setup: a ping can't be ${bytes} bytes`);
  const text = `${head}${'a'.repeat(pad)}${tail}`;
  if (Buffer.byteLength(text) !== bytes) throw Error('setup: ping length');
  return text;
}

export const request = (id: number, method: string, params?: unknown): string => `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`;

/** A JSON-RPC error line (the one deep mcp writes for a line it refuses). */
export const isError = (line: Line): boolean => line.error !== undefined && line.result === undefined;

/**
 * A stand-in hub on `<home>/.deepbuild/hub.sock`, the address deep mcp reads when no config names one. It greets each
 * connection, answers deep mcp's hello with a role, as the hub does (server.ts), and answers the first mcp.call with the
 * start of a reply, `{"id":…,"result":{"pad":"`, followed by `replyBytes` bytes of 'a' and no newline, then holds the
 * connection open. `written` counts the reply's bytes the socket took so far.
 */
export class StandInHub {
  written = 0;
  called = false;
  finishedAt = 0;
  readonly server: net.Server;
  constructor(home: string, replyBytes: number) {
    const dir = join(home, '.deepbuild');
    mkdirSync(dir, { recursive: true });
    this.server = net.createServer((sock) => {
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
    this.server.listen(join(dir, 'hub.sock'));
  }
  async listening(): Promise<void> {
    if (this.server.listening) return;
    await new Promise<void>((resolve, reject) => { this.server.once('listening', resolve); this.server.once('error', reject); });
  }
  private async hold(sock: net.Socket, id: string, total: number): Promise<void> {
    const write = (bytes: string | Buffer) => new Promise<boolean>((resolve) => {
      if (sock.destroyed) return resolve(false);
      const ok = sock.write(bytes, (error) => { if (!error) this.written += Buffer.byteLength(bytes); });
      if (ok) return resolve(true);
      const done = () => { sock.off('drain', done); sock.off('close', done); resolve(!sock.destroyed); };
      sock.on('drain', done);
      sock.on('close', done);
    });
    await write(`{"v":1,"id":${JSON.stringify(id)},"result":{"pad":"`);
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    let sent = 0;
    while (sent < total) {
      const n = Math.min(chunk.length, total - sent);
      if (!(await write(n === chunk.length ? chunk : chunk.subarray(0, n)))) break;
      sent += n;
    }
    this.finishedAt = Date.now();
    // Held open with no newline: nothing more is written and the socket isn't closed.
  }
}
