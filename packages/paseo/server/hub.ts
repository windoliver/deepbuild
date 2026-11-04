// The hub's socket as the plugin reaches it: where it is, one hook request per connection, and one long-lived
// connection per session for its answers. Only `node:` built-ins: paseo installs the plugin alone.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Obj = Record<string, unknown>;
const line = (value: Obj): string => `${JSON.stringify({ v: 1, ...value })}\n`;
/** A line of the hub's protocol, or nothing for one that isn't: a throw inside a socket's handler would end the plugin. */
function parse(text: string): Obj | undefined {
  try { const value = JSON.parse(text) as unknown; return typeof value === 'object' && value !== null ? value as Obj : undefined; } catch { return undefined; }
}

const deepRoot = (): string => join(process.env.HOME ?? homedir(), '.deepbuild');
function config(): Obj {
  const file = join(deepRoot(), 'config.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { return {}; }
}
/** The hub's socket: `hub.address` in ~/.deepbuild/config.json, or the installed hub's, as the pi package finds it. */
export function hubSocket(cwd: string): string {
  const hub = config().hub as { address?: unknown; use?: unknown } | undefined;
  const uses = typeof hub?.use === 'object' && hub.use !== null ? Object.entries(hub.use as Obj).filter(([dir]) => cwd === dir || cwd.startsWith(`${dir}/`)).sort((a, b) => b[0].length - a[0].length) : [];
  const address = uses[0]?.[1] ?? hub?.address;
  return typeof address === 'string' && address.startsWith('unix:') ? address.slice(5) : join(deepRoot(), 'hub.sock');
}
/** The command that runs `deep mcp`: the one setup recorded, else `deep` on the agent's PATH. */
export function deepCommand(): { command: string; args: string[] } {
  const recorded = (config().paseo as { deep?: unknown } | undefined)?.deep;
  const parts = Array.isArray(recorded) && recorded.length && recorded.every((p) => typeof p === 'string') ? recorded as string[] : ['deep'];
  return { command: parts[0]!, args: [...parts.slice(1), 'mcp'] };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(): string {
  let time = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) { head = CROCKFORD[time % 32]! + head; time = Math.floor(time / 32); }
  return head + [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join('');
}
export const token = (): string => randomBytes(18).toString('base64url');

export interface Reply { exit: number; stdout: string; stderr: string }
/** Longer than the hub holds any hook it answers: a permission request waits for your answer. */
const HELD_MS = 24 * 3600_000;
/**
 * One hook request on its own connection: the hub's hello, the request, its acknowledgement, its reply. `acked` fires
 * once the hub has posted it, so the next one sent lands after it. `undefined` when the hub can't be reached.
 */
export function sendHook(socket: string, event: string, payload: Obj, acked: () => void): Promise<Reply | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    let buffer = '';
    let greeted = false;
    let ack = false;
    const end = (value?: Reply) => { clearTimeout(timer); if (!ack) acked(); sock.destroy(); resolve(value); };
    let timer = setTimeout(() => end(), 15_000);
    sock.on('error', () => end());
    sock.on('close', () => end());
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const message = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!message) continue;
        if (!greeted) {
          greeted = true;
          const seq = (BigInt(Date.now()) * 1_000_000n).toString();
          sock.write(line({ agent: 'paseo', event, seq, id: ulid(), pid: process.pid, ppid: process.pid, matched: [], payload }));
        } else if ('ack' in message) {
          ack = true;
          acked();
          clearTimeout(timer);
          timer = setTimeout(() => end(), HELD_MS);
        } else if ('exit' in message) end(message as unknown as Reply);
      }
    });
  });
}

/** One connection to the hub for one session's answers, bound at hello by the session's token. */
export class Answers {
  private sock: net.Socket | undefined;
  private connecting: Promise<boolean> | undefined;
  private readonly waiting = new Map<string, (message: Obj) => void>();
  private ids = 0;
  closed = false;
  private readonly socket: string;
  private readonly bind: string;
  private readonly cwd: string;
  constructor(socket: string, bind: string, cwd: string) {
    this.socket = socket;
    this.bind = bind;
    this.cwd = cwd;
  }
  private connect(): Promise<boolean> {
    if (this.sock) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    return this.connecting ??= new Promise<boolean>((resolve) => {
      const sock = net.connect(this.socket);
      let buffer = '';
      let greeted = false;
      const fail = () => {
        clearTimeout(timer);
        sock.destroy();
        if (this.sock === sock) this.sock = undefined;
        for (const wake of this.waiting.values()) wake({ error: { code: 'unavailable' } });
        this.waiting.clear();
        resolve(false);
      };
      const timer = setTimeout(fail, 1000);
      sock.on('error', fail);
      sock.on('close', fail);
      sock.setEncoding('utf8').on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const message = parse(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
          if (!message) continue;
          if (!greeted) {
            greeted = true;
            sock.write(line({ hello: 'mcp', paseo: this.bind, cwd: this.cwd }));
          } else if ('role' in message) {
            clearTimeout(timer);
            this.sock = sock;
            resolve(true);
          } else {
            const wake = this.waiting.get(String(message.id));
            this.waiting.delete(String(message.id));
            wake?.(message);
          }
        }
      });
    }).finally(() => { this.connecting = undefined; });
  }
  /** A method on this connection: its reply, or the refusal as `error`. */
  async call(method: string, params: Obj): Promise<Obj> {
    if (!(await this.connect()) || !this.sock) return { error: { code: 'unavailable' } };
    const id = `paseo#${++this.ids}`;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.sock!.write(line({ id, method, params }));
    });
  }
  /** Says hello again on the next call: the hub binds a connection to its session once, at hello. */
  rebind(): void {
    this.sock?.destroy();
    this.sock = undefined;
  }
  close(): void {
    this.closed = true;
    this.sock?.destroy();
  }
}
