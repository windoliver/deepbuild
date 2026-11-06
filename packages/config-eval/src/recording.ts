// A replayed task's outside calls, answered from its recording (#1108): an MCP tool call, or a shell command that
// reaches the network, gets the result the original session got for the same call, by tool and normalized input,
// and any other gets an error saying it isn't in the recording. Nothing is sent: the replay's answering server, on a
// port of this machine, serves the recorded MCP servers and the replay's shell hook, keeps every call, and tunnels
// only to the agent's model endpoint.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { errorShape } from '@deepbuild/gate';
import type { Made, RecordedCall } from './index.js';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Programs whose run reaches another host, and git's subcommands that do. Any other command stays in the sandbox,
 * which refuses every host but the model endpoint and loopback.
 */
const NETWORK = /^(?:gh|curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|http|https|xh)$/;
const GIT_NETWORK = /^(?:push|pull|fetch|clone|ls-remote|send-email)$/;
const PUBLISH = /^(?:npm|pnpm|yarn|bun|cargo|twine|gem)$/;
/**
 * Programs that run the program after them, with their options that take a value; `timeout` takes its duration too,
 * and `command -v` only looks the program up.
 */
const WRAPPERS = new Map<string, { values: string[]; then?: number; runsNone?: string[] }>([
  ['sudo', { values: ['-u', '-g', '-h', '-p', '-U'] }], ['env', { values: ['-u', '-C', '-S'] }], ['exec', { values: ['-a'] }], ['command', { values: [], runsNone: ['-v', '-V'] }],
  ['nohup', { values: [] }], ['time', { values: ['-f', '-o'] }], ['nice', { values: ['-n'] }], ['stdbuf', { values: ['-i', '-o', '-e'] }],
  ['timeout', { values: ['-s', '-k', '--signal', '--kill-after'], then: 1 }], ['xargs', { values: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a'] }],
]);

/** A piece's words from the program it runs on, past its variable assignments and the wrappers that run it. */
function fromProgram(piece: string): string[] {
  let words = piece.trim().split(/\s+/).filter(Boolean);
  for (;;) {
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words = words.slice(1);
    const wrapper = WRAPPERS.get((words[0] ?? '').replace(/^.*\//, ''));
    if (!wrapper) return words;
    let i = 1;
    while (i < words.length && words[i]!.startsWith('-')) {
      if (wrapper.runsNone?.includes(words[i]!)) return [];
      i += wrapper.values.includes(words[i]!) ? 2 : 1;
    }
    words = words.slice(i + (wrapper.then ?? 0));
  }
}

/**
 * Whether a shell command runs a program that reaches the network, in any of its pieces (`a && b | c`, `$(d)`). Quoted
 * text is an argument, never a program: a commit message that names ssh runs none. A program run from inside quotes
 * (`bash -c "curl …"`) isn't counted, and the sandbox refuses its host.
 */
export function reachesNetwork(command: string): boolean {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''").split(/&&|\|\||[;|&\n()`]|\$\(/).some((piece) => {
    const words = fromProgram(piece);
    const program = (words[0] ?? '').replace(/^.*\//, '');
    // A program asked for its help or version prints it and reaches no host: the flag comes right after the program, or
    // after git's, gh's or a publisher's subcommands, never after an argument (`ssh host node --version` runs remotely).
    const asked = words.findIndex((w) => w === '--help' || w === '--version');
    const subcommands = program === 'git' || program === 'gh' || PUBLISH.test(program);
    if (asked === 1 || (asked > 1 && subcommands && words.slice(1, asked).every((w) => /^[a-z][a-z-]*$/.test(w)))) return false;
    if (NETWORK.test(program)) return true;
    if (program === 'git') return GIT_NETWORK.test(words.find((w, i) => i > 0 && !w.startsWith('-') && words[i - 1] !== '-C' && words[i - 1] !== '-c') ?? '');
    return PUBLISH.test(program) && words.includes('publish');
  });
}

/**
 * Whether a tool call is an outside call: any MCP tool, a web fetch or search (a search runs at the model's own
 * service, where the sandbox can't refuse it), or a shell command that reaches the network.
 */
export function isOutside(tool: string, input: unknown): boolean {
  if (tool.startsWith('mcp__') || tool === 'WebFetch' || tool === 'WebSearch') return true;
  return tool === 'Bash' && isObj(input) && typeof input.command === 'string' && reachesNetwork(input.command);
}

/**
 * The part of a call's input that names the call, each string normalized as open items normalize error text
 * (temporary paths, process IDs and timestamps as placeholders), keys in order. A shell call is named by its command
 * alone, and a web fetch by its URL: a shell call's description and timeout, and what a fetch asks of its page, are the
 * agent's wording, not the call.
 */
function callKey(tool: string, input: unknown): string {
  const norm = (v: unknown): unknown => typeof v === 'string' ? errorShape(v)
    : Array.isArray(v) ? v.map(norm)
    : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v;
  const named = !isObj(input) ? input : tool === 'Bash' ? { command: input.command } : tool === 'WebFetch' ? { url: input.url } : input;
  return JSON.stringify([tool, norm(named)]);
}


const notRecorded = (tool: string): string => `${tool}: this call is not in the recording of the task being replayed, so it was not made. A replay answers outside calls only from what the original session did.`;
/** `text`, single-quoted for sh. */
const shQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** The replay's answering server for one run. */
export interface Answering {
  port: number;
  /** The MCP config that serves each server the recording names, over streamable HTTP on this server. */
  mcpConfig: { mcpServers: Record<string, { type: 'http'; url: string }> };
  /** The servers the recording names. */
  servers: string[];
  /** The hook command's script: it hands a PreToolUse call to this server and prints the answer. */
  hookScript: string;
  /** Every outside call so far, in order. */
  calls: Made[];
  close(): Promise<void>;
}

/**
 * Opens the answering server for one run on a port of this machine. `model` is the agent's model endpoint as
 * `host:port`; a CONNECT tunnel goes there and nowhere else.
 */
export async function openAnswering(recording: readonly RecordedCall[], model: string): Promise<Answering> {
  const calls: Made[] = [];
  const secret = randomBytes(16).toString('hex');
  const servers = [...new Set(recording.flatMap((r) => { const m = /^mcp__(.+?)__(.+)$/.exec(r.tool); return m ? [m[1]!] : []; }))];
  const keys = recording.map((r) => callKey(r.tool, r.input));
  // Each recorded call answers once, in the order the original session made them: a second look at a PR after its
  // merge gets the second result.
  const used = new Set<number>();
  const answer = (tool: string, input: unknown): RecordedCall | undefined => {
    const key = callKey(tool, input);
    const at = keys.findIndex((k, i) => k === key && !used.has(i));
    if (at >= 0) used.add(at);
    const found = at >= 0 ? recording[at] : undefined;
    calls.push({ tool, input, answered: !!found });
    return found;
  };

  /** One JSON-RPC message to a recorded server, answered. */
  const mcp = (server: string, m: Record<string, unknown>): unknown => {
    const params = isObj(m.params) ? m.params : {};
    if (m.method === 'initialize') return { protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: server, version: 'recording' } };
    if (m.method === 'tools/list') {
      const names = [...new Set(recording.flatMap((r) => r.tool.startsWith(`mcp__${server}__`) ? [r.tool.slice(`mcp__${server}__`.length)] : []))];
      return { tools: names.map((name) => ({ name, description: `${name}, answered from the recording of the task being replayed`, inputSchema: { type: 'object', additionalProperties: true } })) };
    }
    if (m.method === 'tools/call') {
      const tool = `mcp__${server}__${String(params.name)}`;
      const found = answer(tool, params.arguments ?? {});
      return found ? { content: [{ type: 'text', text: found.result }], isError: found.error === true } : { content: [{ type: 'text', text: notRecorded(tool) }], isError: true };
    }
    if (m.method === 'ping') return {};
    return undefined;
  };
  /**
   * A PreToolUse call from the replay's hook: an outside shell command answered or refused, any other let through to
   * the sandbox. A web fetch or search is never made: the hook can't hand back a result for it, so it is refused, with
   * the recorded result as the reason when there is one.
   */
  const hook = (payload: Record<string, unknown>): unknown => {
    const tool = String(payload.tool_name ?? '');
    const input = payload.tool_input;
    if (!isOutside(tool, input)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'runs in the replay\'s sandbox' } };
    const found = answer(tool, input);
    if (!found) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: notRecorded(tool) } };
    if (tool !== 'Bash') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${tool}: answered from the recording of the task being replayed, so it was not made. The original session's ${found.error ? 'call failed with' : 'result'}:\n${found.result}` } };
    const command = `printf '%s\\n' ${shQuote(found.result)}${found.error ? ' && exit 1' : ''}`;
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'answered from the recording', updatedInput: { ...(isObj(input) ? input : {}), command } } };
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => { body += d.toString('utf8'); });
    req.on('end', () => {
      const send = (status: number, value?: unknown) => { res.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json' }); res.end(value === undefined ? '' : JSON.stringify(value)); };
      let m: unknown;
      try { m = JSON.parse(body); } catch { return send(400); }
      const url = req.url ?? '';
      if (req.method !== 'POST' || !isObj(m)) return send(400);
      if (url === `/${secret}/hook`) return send(200, hook(m));
      const server = url.startsWith(`/${secret}/mcp/`) ? url.slice(`/${secret}/mcp/`.length) : undefined;
      if (server === undefined || !servers.includes(decodeURIComponent(server))) return send(404);
      if (m.id === undefined) return send(202);
      const result = mcp(decodeURIComponent(server), m);
      return send(200, result === undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no method ${String(m.method)}` } } : { jsonrpc: '2.0', id: m.id, result });
    });
  });
  // The one way out: a tunnel to the model endpoint.
  server.on('connect', (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
    if ((req.url ?? '').toLowerCase() !== model.toLowerCase()) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const colon = model.lastIndexOf(':');
    const up = connect({ host: model.slice(0, colon).replace(/^\[|\]$/g, ''), port: Number(model.slice(colon + 1)) }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return {
    port, servers, calls,
    mcpConfig: { mcpServers: Object.fromEntries(servers.map((s) => [s, { type: 'http' as const, url: `http://127.0.0.1:${port}/${secret}/mcp/${encodeURIComponent(s)}` }])) },
    hookScript: `// The replay's PreToolUse hook (#1108): the call goes to the answering server, and its answer is the hook's.
let body = '';
process.stdin.on('data', (d) => { body += d; });
process.stdin.on('end', async () => {
  try {
    const r = await fetch('http://127.0.0.1:${port}/${secret}/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    process.stdout.write(await r.text());
  } catch (e) {
    process.stderr.write('the replay could not answer this call from its recording: ' + (e?.cause?.code ?? e?.message));
    process.exit(2);
  }
});
`,
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}
