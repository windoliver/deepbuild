// `deep mcp`: the MCP server agents call, one stdio process per agent session (newline-delimited JSON-RPC).
// It reaches the hub at the address setting, presents the agent that started it as its parent and the folder it runs
// in, and forwards each deep_* call there; the hub checks the call's arguments, binds it to a session and answers.
// With the hub down or restarting it keeps its tool list and answers each call within a second that the hub is
// unreachable, never with a success, and reconnects at the next call. Every error is a tool result holding error@2.
// The pages of the codes those errors carry read at deep://codes/<code>, with no tool call and no hub.
// `deep mcp actions` is the second server entry, deep-actions (#363): the same process and hub connection, serving
// the plug-in actions' two tools in place of the deep_* tools.
import net from 'node:net';
import { createInterface } from 'node:readline';
import { CODES, codePage } from './codes.js';
import { toolTimeoutS } from './codex-settings.js';
import { hubAddress } from './paths.js';
import { actionToolList, toolList } from './tools.js';
import { line, refusal, startOf, type Refusal } from './wire.js';

type Obj = Record<string, unknown>;
const UNREACHABLE_MS = 1000;
/** Longer than any call the hub holds open: deep_ask and deep_wait answer "still waiting" after 40 s. */
// A held deep_ask answers just before the tool timeout Codex gives this server (#39), which this outlasts.
const ANSWER_MS = 55_000;
/** How long a call waits for the hub: Codex gives its MCP server's tool calls `tool_timeout_sec`, which is Codex's setting alone; any other client keeps ANSWER_MS. */
export const answerWaitMs = (client: unknown, toolS: () => number = toolTimeoutS): number => (typeof client === 'string' && /codex/i.test(client) ? Math.max(ANSWER_MS, toolS() * 1000) : ANSWER_MS);
const unreachable = (why: string): Refusal => refusal('unavailable', '', `The DeepBuild hub is unreachable (${why}); nothing was recorded. Call again once it is back.`, '', true);

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
      let buffer = '';
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
      sock.setEncoding('utf8');
      sock.on('error', fail);
      sock.on('close', fail);
      sock.on('data', async (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const message = JSON.parse(buffer.slice(0, i)) as Obj;
          buffer = buffer.slice(i + 1);
          if (!greeted) {
            greeted = true;
            sock.write(line({ hello: 'mcp', parent: { pid: process.ppid, start: (await startOf(process.ppid)) ?? '' }, cwd: process.cwd() }));
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
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  /** The client's own name, from its initialize. */
  client: unknown;
  /** One deep_* call through the hub: its result, or the refusal or unreachability as error@2. */
  async call(tool: string, args: unknown): Promise<{ ok: boolean; value: unknown }> {
    if (!(await this.connect()) || !this.sock) return { ok: false, value: unreachable('no answer on its socket') };
    const id = `mcp#${++this.ids}`;
    const reply = await new Promise<Obj>((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ error: unreachable('it did not answer in time') }); }, answerWaitMs(this.client));
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.sock!.write(line({ id, method: 'mcp.call', params: { tool, arguments: args ?? {} } }));
    });
    return 'error' in reply ? { ok: false, value: reply.error } : { ok: true, value: reply.result };
  }
}

/** `deep mcp`, or `deep mcp actions` for deep-actions: serves the agent on stdin and stdout until stdin closes. */
export async function runMcp(server: 'deep' | 'deep-actions' = 'deep'): Promise<number> {
  const hub = new Hub();
  const tools = server === 'deep' ? toolList() : actionToolList();
  const send = (message: Obj) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const lines = createInterface({ input: process.stdin });
  const calls: Promise<void>[] = [];
  for await (const raw of lines) {
    let request: Obj;
    try {
      request = JSON.parse(raw) as Obj;
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error: send one JSON-RPC message per line.' } });
      continue;
    }
    const { id, method } = request;
    const params = (request.params ?? {}) as Obj;
    if (id === undefined) continue; // a notification
    switch (method) {
      case 'initialize':
        hub.client = (params.clientInfo as Obj | undefined)?.name;
        send({ id, result: { protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: server, version: '0.0.0' } } });
        break;
      case 'ping':
        send({ id, result: {} });
        break;
      case 'tools/list':
        send({ id, result: { tools } });
        break;
      case 'resources/list':
        send({ id, result: { resources: CODES.map((page) => ({ uri: `deep://codes/${page.code}`, name: page.code, description: page.meaning, mimeType: 'application/json' })) } });
        break;
      case 'resources/read': {
        const uri = String(params.uri);
        const page = /^deep:\/\/codes\/([a-z_]+)$/.exec(uri) ? codePage(uri.slice('deep://codes/'.length)) : undefined;
        if (!page) send({ id, error: { code: -32002, message: `No resource ${uri}; the codes' pages are ${CODES.map((p) => `deep://codes/${p.code}`).join(', ')}.` } });
        else send({ id, result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(page) }] } });
        break;
      }
      case 'tools/call': {
        const name = String(params.name);
        if (!tools.some((t) => t.name === name)) {
          send({ id, error: { code: -32602, message: `No tool ${name}; the tools are ${tools.map((t) => t.name).join(', ')}.` } });
          break;
        }
        // A call that waits, such as deep_wait, holds up no other call.
        calls.push(hub.call(name, params.arguments).then(({ ok, value }) => {
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
