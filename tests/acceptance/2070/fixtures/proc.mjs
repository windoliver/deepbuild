// A process the #2070 tests drive (README, The processes): paseo's daemon with DeepBuild's plugin in it, sending the
// plugin's lines and starting its agents' MCP servers, or a process outside every agent's process tree, sending lines
// and saying hello on connections of its own. It decides nothing; it carries lines. What it says of itself is true of
// the OS's process tree, unless the test hands its hello another parent (AC2).
//
//   node proc.mjs                                     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node proc.mjs provider <token> <command> <args…>  an agent's CLI between paseo and the MCP server paseo's plugin added:
//                                                     runs the command with DEEP_PASEO_BIND=<token> in its environment
//                                                     and its own stdio, as the plugin's server entry asks
//
// Commands:
//   {op:'line', socket, request}         one hook request line from this process, as paseo's plugin sends its lines
//                                        (packages/paseo/server/hub.ts): its pid and ppid both this process's PID;
//                                        answers {lines, end, pid}
//   {op:'hello', socket, fields}         a connection of its own: reads the hub's hello, says hello as `deep mcp` does
//                                        (its parent by PID and start time, its folder), with `fields` over that;
//                                        answers {sent, answer}, `answer` the hub's line after the hello
//   {op:'call', method, params}          one method on that connection; answers {reply}
//   {op:'mcp', argv, cwd, line, timeoutMs}  its agent's MCP server, started once from argv as its child; one
//                                        JSON-RPC line to it, answers {reply, ms, pid} (no reply for a notification)
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const parse = (raw) => { try { return JSON.parse(raw); } catch { return undefined; } };
/** `ps -o lstart=`, as the hub and `deep mcp` read a process's start time. */
const lstart = (pid) => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();

if (process.argv[2] === 'provider') {
  const [, , , token, command, ...args] = process.argv;
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, DEEP_PASEO_BIND: token } });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  let conn;
  let server;
  let ids = 0;
  createInterface({ input: process.stdin }).on('line', (raw) => {
    const command = JSON.parse(raw);
    handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
  });

  async function handle(command) {
    switch (command.op) {
      case 'line': return line(command);
      case 'hello': return hello(command);
      case 'call': return call(command);
      case 'mcp': return mcp(command);
      default: throw Error(`unknown op ${command.op}`);
    }
  }

  /** A socket's lines, each parsed (or kept raw), with a way to wait for the first one that matches. */
  function lines(sock) {
    const seen = [];
    const wakers = new Set();
    let buffer = '';
    let closed = false;
    sock.setEncoding('utf8').on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        seen.push(parse(raw) ?? { unparsed: raw });
      }
      for (const wake of [...wakers]) wake();
    });
    const end = () => { closed = true; for (const wake of [...wakers]) wake(); };
    sock.on('error', end);
    sock.on('close', end);
    /** Resolves true once `ready()` holds, false when the socket closed first or the time ran out. */
    const until = (ready, timeoutMs = 15_000) => new Promise((resolve) => {
      const check = () => {
        if (ready() || closed) { clearTimeout(timer); wakers.delete(check); resolve(ready()); }
      };
      const timer = setTimeout(() => { wakers.delete(check); resolve(ready()); }, timeoutMs);
      wakers.add(check);
      check();
    });
    return { seen, until, closed: () => closed };
  }

  function line({ socket, request }) {
    return new Promise((resolve) => {
      const sent = { ...request, pid: process.pid, ppid: process.pid };
      const sock = net.connect(socket);
      const got = [];
      let buffer = '';
      let finished = false;
      const done = (end) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        sock.destroy();
        resolve({ lines: got, end, pid: process.pid });
      };
      const timer = setTimeout(() => done('timeout'), 15_000);
      sock.on('error', (error) => done(`error:${error.code}`));
      sock.on('close', () => done('close'));
      sock.setEncoding('utf8').on('data', (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const raw = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          got.push(raw);
          if (got.length === 1) sock.write(`${JSON.stringify(sent)}\n`);
          else if (/"(exit|error)"/.test(raw)) done('reply');
        }
      });
    });
  }

  async function hello({ socket, fields }) {
    conn?.sock.destroy();
    const sock = net.connect(socket);
    conn = { sock, ...lines(sock) };
    if (!(await conn.until(() => conn.seen.length >= 1))) throw Error(`no hello from the hub at ${socket}`);
    const sent = { v: 1, hello: 'mcp', parent: { pid: process.ppid, start: lstart(process.ppid) }, cwd: process.cwd(), ...fields };
    sock.write(`${JSON.stringify(sent)}\n`);
    await conn.until(() => conn.seen.length >= 2);
    return { sent, answer: conn.seen[1] ?? null };
  }

  async function call({ method, params, timeoutMs = 30_000 }) {
    if (!conn || conn.closed()) throw Error('no connection open: say hello first');
    const id = `t2070#${++ids}`;
    conn.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    await conn.until(() => conn.seen.some((l) => l.id === id), timeoutMs);
    const reply = conn.seen.find((l) => l.id === id);
    if (!reply) throw Error(`no reply to ${method} in ${timeoutMs} ms${conn.closed() ? ' (the hub closed the connection)' : ''}`);
    return { reply };
  }

  // Its agent's one MCP server, started once, as an agent starts its MCP server; one JSON-RPC line, its reply by id.
  function mcp({ argv, cwd, line: message, timeoutMs = 120_000 }) {
    if (!server) {
      const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      server = { child, lines: [], wakers: new Set(), stderr: '' };
      child.stderr.setEncoding('utf8').on('data', (d) => { server.stderr = (server.stderr + d).slice(-4000); });
      createInterface({ input: child.stdout }).on('line', (l) => { server.lines.push({ raw: l, at: performance.now() }); for (const w of [...server.wakers]) w(); });
      child.on('close', () => { for (const w of [...server.wakers]) w(); });
    }
    if (message.id === undefined) {
      server.child.stdin.write(`${JSON.stringify(message)}\n`);
      return Promise.resolve({ reply: null, ms: 0, pid: server.child.pid });
    }
    return new Promise((resolve, reject) => {
      const from = server.lines.length;
      const t0 = performance.now();
      const finish = () => { clearTimeout(timer); server.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`its MCP server gave no reply to ${message.id} in ${timeoutMs} ms: ${server.stderr}`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < server.lines.length; i++) {
          const json = parse(server.lines[i].raw);
          if (json && json.id === message.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: server.lines[i].at - t0, pid: server.child.pid }); return; }
        }
        if (server.child.exitCode !== null) { finish(); reject(Error(`its MCP server exited ${server.child.exitCode}: ${server.stderr}`)); }
      };
      server.wakers.add(check);
      server.child.stdin.write(`${JSON.stringify(message)}\n`);
      check();
    });
  }
}
