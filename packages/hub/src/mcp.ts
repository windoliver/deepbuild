// `deep mcp`: the MCP server agents call, one stdio process per agent session (newline-delimited JSON-RPC).
// It reaches the hub at the address setting, presents the agent that started it as its parent and the folder it runs
// in, and forwards each deep_* call there; the hub checks the call's arguments, binds it to a session and answers.
// With the hub down or restarting it keeps its tool list and answers each call within a second that the hub is
// unreachable, never with a success, and reconnects at the next call. Every error is a tool result holding error@2.
// The pages of the codes those errors carry read at deep://codes/<code>, with no tool call and no hub.
// `deep mcp actions` serves the second server entry, deep-actions (#363): the plug-in actions' two tools in place of
// the deep_* tools. `deep setup` writes deep-hook's `mcp actions` for it, which answers the same (#824).
import { read, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { CODES, codePage } from './codes.js';
import { hubAddress } from './paths.js';
import { shedStartup } from './settle.js';
import { actionToolList, instructionsFor, nearest, toolList } from './tools.js';
import { activePlant, line, refusal, startOf, type Refusal } from './wire.js';

type Obj = Record<string, unknown>;
const UNREACHABLE_MS = 1000;
/** Longer than any call the hub holds open: deep_ask and deep_wait answer "still waiting" after 40 s. */
// A held deep_ask answers just before the tool timeout Codex gives this server (#39), which this outlasts.
const ANSWER_MS = 55_000;
const isCodex = (client: unknown): boolean => typeof client === 'string' && /codex/i.test(client);
/** How long a call waits for the hub: Codex gives its MCP server's tool calls `tool_timeout_sec`, which is Codex's setting alone; any other client keeps ANSWER_MS. */
export const answerWaitMs = (client: unknown, toolS: () => number): number => (isCodex(client) ? Math.max(ANSWER_MS, toolS() * 1000) : ANSWER_MS);
/**
 * The handshake revisions this server holds, oldest first (#2854): mcp.handshake@1's list, read from the contract file
 * itself so deep mcp loads no contract code. The client's revision is answered when held, the newest otherwise.
 */
const revisions = (entry: string): string[] => (JSON.parse(readFileSync(new URL(`../schemas/${entry}`, import.meta.resolve('@deepbuild/contracts/json')), 'utf8')) as { properties: { protocolVersion: { enum: string[] } } }).properties.protocolVersion.enum;
let held: string[] | undefined;
const handshake = (asked: unknown): string => {
  held ??= revisions('mcp.handshake@1.json');
  return typeof asked === 'string' && held.includes(asked) ? asked : held[held.length - 1]!;
};
let stateless: string[] | undefined;
const META = 'io.modelcontextprotocol/';
const supported = (): string[] => {
  stateless ??= revisions('mcp.meta@1.json');
  held ??= revisions('mcp.handshake@1.json');
  return [...stateless].reverse().concat([...held].reverse());
};
const CACHED = new Set(['server/discover', 'tools/list', 'resources/list', 'resources/read']);
const unreachable = (why: string): Refusal => refusal('unavailable', '', `The DeepBuild hub is unreachable (${why}); nothing was recorded. Call again once it is back.`, '', true);

/**
 * The longest line deep mcp reads, from its client or from the hub, its newline not counted (#2654): 16 times what a
 * model's arguments come to at most, and a quarter of the hub's own line cap, so no request read here is one the hub
 * refuses for its size.
 */
const LINE_CAP = 16 * 1024 * 1024;
const CAP_TEXT = '16 MiB (16,777,216 bytes)';

/**
 * Cuts bytes into lines of at most LINE_CAP bytes, each decoded once it is whole, so a line or a character cut across
 * two reads is read as one. A longer line comes out once as null where it passes the cap, and its bytes are dropped as
 * they come, never kept, up to the newline that ends it.
 */
class Lines {
  private parts: Buffer[] = [];
  private size = 0;
  private dropping = false;

  push(chunk: Buffer): (string | null)[] {
    const out: (string | null)[] = [];
    for (let start = 0; start <= chunk.length;) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline < 0 ? chunk.length : newline;
      if (!this.dropping && end > start) {
        if (this.size + end - start > LINE_CAP) {
          this.dropping = true;
          this.parts = [];
          this.size = 0;
          out.push(null);
        } else {
          // A copy, so a held part keeps no more of its read than its own bytes.
          this.parts.push(Buffer.from(chunk.subarray(start, end)));
          this.size += end - start;
        }
      }
      if (newline < 0) break;
      if (!this.dropping) out.push(this.take());
      this.dropping = false;
      this.parts = [];
      this.size = 0;
      start = newline + 1;
    }
    return out;
  }

  /** What is left once the stream ends: its last line when it had no newline, as readline gave it. */
  end(): string[] {
    return this.size && !this.dropping ? [this.take()] : [];
  }

  private take(): string {
    return Buffer.concat(this.parts, this.size).toString('utf8');
  }
}

/** One connection to the hub as this process's deep mcp; undefined when the hub can't be reached in time. */
class Hub {
  private sock: net.Socket | undefined;
  private connecting: Promise<boolean> | undefined;
  private readonly waiting = new Map<string, (line: Obj) => void>();
  private ids = 0;

  private connect(): Promise<boolean> {
    if (this.sock) return Promise.resolve(true);
    this.connecting ??= new Promise<boolean>((resolve) => {
      let address: string;
      try {
        address = hubAddress().path;
      } catch {
        return resolve(false);
      }
      const sock = net.connect(address);
      const reader = new Lines();
      let greeted = false;
      const fail = () => {
        clearTimeout(timer);
        sock.destroy();
        if (this.sock === sock) this.sock = undefined;
        for (const wake of this.waiting.values()) wake({ error: unreachable('it closed the connection') });
        this.waiting.clear();
        resolve(false);
      };
      const timer = setTimeout(fail, UNREACHABLE_MS);
      sock.on('error', fail);
      sock.on('close', fail);
      // Each read's lines wait for the last read's, so the greeting's await cannot let a later line overtake it.
      let handled = Promise.resolve();
      sock.on('data', (chunk: Buffer) => {
        const lines = reader.push(chunk);
        handled = handled.then(() => handle(lines));
      });
      const handle = async (lines: (string | null)[]) => {
        for (const text of lines) {
          if (sock.destroyed) return;
          // A reply that runs past the cap is a fault, not an answer: every call waiting on this connection fails.
          if (text === null) {
            for (const wake of this.waiting.values()) wake({ error: refusal('too_large', '', `The DeepBuild hub's reply ran past ${CAP_TEXT} with no end of line, so deep mcp gave up on it and read none of it. The hub may already have acted on the call, so check its effect before making it again.`, '', false) });
            this.waiting.clear();
            sock.destroy();
            return;
          }
          const message = JSON.parse(text) as Obj;
          if (!greeted) {
            greeted = true;
            sock.write(line({ hello: 'mcp', parent: { pid: process.ppid, start: (await startOf(process.ppid)) ?? '' }, cwd: process.cwd(), ...(process.env.DEEP_PASEO_BIND ? { paseo: process.env.DEEP_PASEO_BIND } : {}) }));
            continue;
          }
          if ('role' in message) {
            clearTimeout(timer);
            this.sock = sock;
            resolve(true);
            continue;
          }
          const wake = this.waiting.get(String(message.id));
          this.waiting.delete(String(message.id));
          wake?.(message);
        }
      };
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  /** The client's own name, from its initialize. */
  private client: unknown;
  /** The client's name and version, from its initialize: the hub holds each reply under what that client keeps (#2896). */
  private info: { name: unknown; version: unknown } | undefined;
  /** Codex's `tool_timeout_sec`, read at each call; 0, so ANSWER_MS, until a Codex client names itself. */
  private toolS: () => number = () => 0;
  /**
   * Takes the client's name. Codex's settings load for Codex alone, since no other client's session reads them, and
   * what loading them leaves is given back as the start's garbage was.
   */
  async named(info: { name?: unknown; version?: unknown } | undefined): Promise<void> {
    const client = info?.name;
    if (this.info && this.info.name === (client ?? null) && this.info.version === (info?.version ?? null)) return;
    this.client = client;
    this.info = { name: client ?? null, version: info?.version ?? null };
    if (!isCodex(client)) return;
    this.toolS = (await import('./codex-settings.js')).toolTimeoutS;
    shedStartup();
  }
  /** The hub's ID of each call in flight, by the client's request ID (#1923). */
  private readonly inFlight = new Map<string, string>();
  /** One deep_* call through the hub: its result, or the refusal or unreachability as error@2. */
  async call(tool: string, args: unknown, request?: unknown): Promise<{ ok: boolean; value: unknown }> {
    if (!(await this.connect()) || !this.sock) return { ok: false, value: unreachable('no answer on its socket') };
    const id = `mcp#${++this.ids}`;
    const mine = JSON.stringify(request ?? null);
    this.inFlight.set(mine, id);
    const reply = await new Promise<Obj>((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ error: unreachable('it did not answer in time') }); }, answerWaitMs(this.client, this.toolS));
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.sock!.write(line({ id, method: 'mcp.call', params: { tool, arguments: args ?? {}, ...(this.info ? { client: this.info } : {}) } }));
    }).finally(() => { if (this.inFlight.get(mine) === id) this.inFlight.delete(mine); });
    return 'error' in reply ? { ok: false, value: reply.error } : { ok: true, value: reply.result };
  }
  /**
   * The tools as the hub publishes them and holds calls to (#1415), over this connection, which then closes: the calls'
   * own connection still says hello at the first call, once the agent's session has started. Undefined when the hub
   * can't be reached in time.
   */
  async tools(): Promise<unknown[] | undefined> {
    if (!(await this.connect()) || !this.sock) return undefined;
    const id = `mcp#${++this.ids}`;
    const reply = await new Promise<Obj>((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({}); }, UNREACHABLE_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.sock!.write(line({ id, method: 'mcp.tools', params: {} }));
    }).finally(() => this.sock?.destroy());
    const tools = (reply.result as Obj | undefined)?.tools;
    return Array.isArray(tools) ? tools : undefined;
  }
  /** The client cancelled a request (#1923): the hub is told that call's caller is gone, and its reply is never sent. */
  cancel(request: unknown): boolean {
    const id = this.inFlight.get(JSON.stringify(request ?? null));
    if (id === undefined || !this.sock) return false;
    this.inFlight.delete(JSON.stringify(request ?? null));
    this.sock.write(line({ id: `${id}:cancel`, method: 'mcp.cancel', params: { call: id } }));
    return true;
  }
}

/**
 * The client's request lines on stdin, read as they are served; null for one past the cap. Each read lands in the same
 * buffer, so the bytes of a line past the cap are dropped without one allocation.
 */
async function* requests(): AsyncGenerator<string | null> {
  const reader = new Lines();
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const n = await new Promise<number>((resolve, reject) => read(0, buffer, 0, buffer.length, null, (error, bytes) => (error ? reject(error) : resolve(bytes))))
      // A client may hand over a non-blocking stdin, which has nothing to read yet rather than blocking.
      .catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'EAGAIN') throw error; await new Promise((wait) => setTimeout(wait, 10)); return -1; });
    if (n < 0) continue;
    if (n === 0) break;
    yield* reader.push(buffer.subarray(0, n));
  }
  yield* reader.end();
}

/** `deep mcp`, or `deep mcp actions` for deep-actions: serves the agent on stdin and stdout until stdin closes. */
export async function runMcp(server: 'deep' | 'deep-actions' = 'deep'): Promise<number> {
  shedStartup();
  // #824's planted wrong program: deep mcp loads the hub's whole package and holds it while it serves. A worker's
  // entry throws outside its worker, and is passed over.
  if (server === 'deep' && activePlant() === 'mcp-loads-hub') {
    const dir = new URL('.', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) await import(new URL(file, dir).href).catch(() => undefined);
  }
  const hub = new Hub();
  const tools = server === 'deep' ? toolList() : actionToolList();
  const write = (message: Obj) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const calls: Promise<void>[] = [];
  const cancelled = new Set<string>();
  let opened = false;
  for await (const raw of requests()) {
    if (raw === null) {
      write({ id: null, error: { code: -32600, message: `A request line ran past ${CAP_TEXT}; it was dropped unread. Send each JSON-RPC message as one line of at most 16 MiB.` } });
      continue;
    }
    let request: Obj;
    try {
      request = JSON.parse(raw) as Obj;
    } catch {
      write({ id: null, error: { code: -32700, message: 'Parse error: send one JSON-RPC message per line.' } });
      continue;
    }
    const { id, method } = request;
    const params = (request.params ?? {}) as Obj;
    // A cancelled request gets no reply, and the hub drops it as one of its job's callers (#1923).
    if (id === undefined && method === 'notifications/cancelled') {
      if (hub.cancel(params.requestId)) cancelled.add(JSON.stringify(params.requestId ?? null));
      continue;
    }
    if (id === undefined) continue; // a notification
    const meta = (!opened && method !== 'initialize' && params._meta && typeof params._meta === 'object' ? params._meta : {}) as Obj;
    const asked = meta[`${META}protocolVersion`];
    const alone = asked !== undefined && supported().slice(0, stateless!.length).includes(asked as string);
    if (asked !== undefined && !supported().includes(asked as string)) {
      write({ id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: supported(), requested: asked } } });
      continue;
    }
    const send = (message: Obj) => write(alone && 'result' in message ? { ...message, result: { resultType: 'complete', ...(message.result as Obj), ...(CACHED.has(String(method)) ? { ttlMs: 0, cacheScope: 'private' } : {}) } } : message);
    if (alone && meta[`${META}clientInfo`] !== undefined) await hub.named(meta[`${META}clientInfo`] as Obj | undefined);
    switch (method) {
      case 'initialize':
        opened = true;
        await hub.named(params.clientInfo as Obj | undefined);
        send({ id, result: { protocolVersion: handshake(params.protocolVersion), capabilities: { tools: {}, resources: {} }, serverInfo: { name: server, version: '0.0.0' }, instructions: instructionsFor(server) } });
        break;
      case 'server/discover':
        write({ id, result: { resultType: 'complete', supportedVersions: supported(), capabilities: { tools: {}, resources: {} }, _meta: { [`${META}serverInfo`]: { name: server, version: '0.0.0' } }, instructions: instructionsFor(server), ttlMs: 0, cacheScope: 'private' } });
        break;
      case 'ping':
        if (alone) send({ id, error: { code: -32601, message: 'Method ping not found.' } });
        else send({ id, result: {} });
        break;
      case 'tools/list':
        // The hub's list while it can be reached, so what is listed is what its check holds a call to; else this build's.
        send({ id, result: { tools: (server === 'deep' ? await new Hub().tools() : undefined) ?? tools } });
        break;
      case 'resources/list':
        send({ id, result: { resources: CODES.map((page) => ({ uri: `deep://codes/${page.code}`, name: page.code, description: page.meaning, mimeType: 'application/json' })) } });
        break;
      case 'resources/read': {
        const uri = String(params.uri);
        const page = /^deep:\/\/codes\/([a-z_]+)$/.exec(uri) ? codePage(uri.slice('deep://codes/'.length)) : undefined;
        if (!page) send({ id, error: { code: alone ? -32602 : -32002, message: `No resource ${uri}; the codes' pages are ${CODES.map((p) => `deep://codes/${p.code}`).join(', ')}.` } });
        else send({ id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(page) }] } });
        break;
      }
      case 'tools/call': {
        const name = String(params.name);
        // deep_start isn't listed, and the hub refuses it: no MCP call starts a session (#1330).
        if (!tools.some((t) => t.name === name) && name !== 'deep_start') {
          const near = nearest(name, tools.map((t) => t.name));
          send({ id, error: { code: -32602, message: near ? `No tool ${name}; call ${near} in place of it.` : `No tool ${name}; the tools are ${tools.map((t) => t.name).join(', ')}.` } });
          break;
        }
        // A call that waits, such as deep_wait, holds up no other call.
        calls.push(hub.call(name, params.arguments, id).then(({ ok, value }) => {
          if (cancelled.delete(JSON.stringify(id))) return;
          // A plug-in action that started and failed is an error the agent sees, with its report (#363).
          const failed = ok && server === 'deep-actions' && (value as { status?: unknown } | null)?.status === 'failed';
          send({ id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: !ok || failed, ...(ok ? { structuredContent: value } : {}) } });
        }));
        break;
      }
      default:
        send({ id, error: { code: -32601, message: `Method ${String(method)} not found.` } });
    }
  }
  await Promise.all(calls);
  return 0;
}
