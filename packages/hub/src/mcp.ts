// `deep mcp`: the MCP server agents call, one stdio process per agent session (newline-delimited JSON-RPC).
// It reaches the hub at the address setting, presents the agent that started it as its parent, and forwards
// each deep_* call there; the hub binds the call to a session. With the hub down or restarting it keeps its
// tool list and answers each call within a second that the hub is unreachable, never with a success.
import net from 'node:net';
import { createInterface } from 'node:readline';
import { hubAddress } from './paths.js';
import { line, startOf } from './wire.js';

type Obj = Record<string, unknown>;
const UNREACHABLE_MS = 1000;
const ANSWER_MS = 30_000;

const TOOLS = [
  { name: 'deep_status', description: "The hub's state as this session sees it: the session it binds to and whether its gates are watch-only.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'deep_claim', description: "Declares that this session's task is done, at a commit; checks then decide whether it is.",
    inputSchema: { type: 'object', properties: { task_ref: { type: 'string' }, attempt: { type: 'integer' }, commit: { type: 'string' }, scope: { type: 'string', enum: ['session', 'child', 'task'] } }, required: ['task_ref', 'attempt', 'commit', 'scope'], additionalProperties: false },
  },
  {
    name: 'deep_evidence', description: "Attaches a file from this session's working folder as evidence.",
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, kind: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
];

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
        for (const wake of this.waiting.values()) wake({ error: { code: 'unavailable', remediation: 'The hub closed the connection.' } });
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
            sock.write(line({ hello: 'mcp', parent: { pid: process.ppid, start: (await startOf(process.ppid)) ?? '' } }));
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

  /** One deep_* call through the hub: its result, or the refusal or unreachability as an error. */
  async call(tool: string, args: unknown): Promise<{ ok: boolean; value: unknown }> {
    if (!(await this.connect()) || !this.sock) return { ok: false, value: 'The DeepBuild hub is unreachable; nothing was recorded. Try again once it is back.' };
    const id = `mcp#${++this.ids}`;
    const reply = await new Promise<Obj>((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(id); resolve({ error: { code: 'unavailable', remediation: 'The hub did not answer in time.' } }); }, ANSWER_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.sock!.write(line({ id, method: 'mcp.call', params: { tool, arguments: args ?? {} } }));
    });
    return 'error' in reply ? { ok: false, value: reply.error } : { ok: true, value: reply.result };
  }
}

/** `deep mcp`: serves the agent on stdin and stdout until stdin closes. */
export async function runMcp(): Promise<number> {
  const hub = new Hub();
  const send = (message: Obj) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const lines = createInterface({ input: process.stdin });
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
        send({ id, result: { protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'deep', version: '0.0.0' } } });
        break;
      case 'ping':
        send({ id, result: {} });
        break;
      case 'tools/list':
        send({ id, result: { tools: TOOLS } });
        break;
      case 'tools/call': {
        const name = String(params.name);
        if (!TOOLS.some((t) => t.name === name)) {
          send({ id, error: { code: -32602, message: `No tool ${name}; the tools are ${TOOLS.map((t) => t.name).join(', ')}.` } });
          break;
        }
        const { ok, value } = await hub.call(name, params.arguments);
        send({ id, result: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: !ok, ...(ok ? { structuredContent: value } : {}) } });
        break;
      }
      default:
        send({ id, error: { code: -32601, message: `Method ${String(method)} not found.` } });
    }
  }
  return 0;
}
