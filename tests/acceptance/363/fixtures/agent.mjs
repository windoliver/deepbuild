// A stand-in for an agent's process (#363 AC1, AC5, AC6), after #26's: a Claude Code session whose hooks are its
// child processes, and whose MCP servers are its children too, one per server entry, each started once on first use:
// `deep` (`deep mcp`) and `deep-actions` (`deep mcp actions`). The hub sees what it would see from a real agent. It
// decides nothing; it carries lines.
//   node agent.mjs                               the agent: one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node agent.mjs hook <socket> <request JSON>  a hook client (deep-hook's wire): sends the request with its own pid and this agent's, prints the hub's lines
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const NODE = process.execPath;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (process.argv[2] === 'hook') {
  const [, , , socket, json] = process.argv;
  const request = { ...JSON.parse(json), pid: process.pid, ppid: process.ppid };
  const lines = [];
  const sock = net.connect(socket);
  let buffer = '';
  let finished = false;
  const done = (end) => {
    if (finished) return;
    finished = true;
    process.stdout.write(`${JSON.stringify({ lines, end, pid: process.pid, ppid: process.ppid })}\n`, () => process.exit(0));
    sock.destroy();
  };
  setTimeout(() => done('timeout'), 10_000);
  sock.on('error', (error) => done(`error:${error.code}`));
  sock.on('close', () => done('close'));
  sock.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      lines.push(line);
      if (lines.length === 1) sock.write(`${JSON.stringify(request)}\n`);
      else if (/"(exit|error)"/.test(line)) done('reply');
    }
  });
} else {
  /** Its MCP servers by entry name, each its own child process. */
  const servers = new Map();
  createInterface({ input: process.stdin }).on('line', (line) => {
    const command = JSON.parse(line);
    handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
  });

  const collect = (child) => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  async function handle(command) {
    switch (command.op) {
      case 'hook': {
        const r = await collect(spawn(NODE, [SELF, 'hook', command.socket, JSON.stringify(command.request)], { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
        try { return JSON.parse(r.stdout); } catch { return { lines: [], end: `client exited ${r.code}: ${r.stderr}` }; }
      }
      case 'mcp':
        return mcpCall(command.server, command.argv, command.line, command.timeoutMs ?? 120_000);
      case 'exit':
        for (const s of servers.values()) s.child.kill();
        setTimeout(() => process.exit(0), 20);
        return {};
      default:
        throw Error(`unknown op ${command.op}`);
    }
  }

  // One JSON-RPC line to the named server, started once as an agent starts its MCP servers; its reply by id.
  function mcpCall(name, argv, line, timeoutMs) {
    let s = servers.get(name);
    if (!s) {
      const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
      s = { child, lines: [], wakers: new Set(), stderr: '' };
      servers.set(name, s);
      const server = s;
      // A server that exits at once (one this build doesn't have) must not take the agent down with a broken pipe.
      child.stdin.on('error', () => undefined);
      child.stderr.setEncoding('utf8').on('data', (d) => { server.stderr = (server.stderr + d).slice(-4000); });
      createInterface({ input: child.stdout }).on('line', (l) => { server.lines.push({ raw: l, at: performance.now() }); for (const w of [...server.wakers]) w(); });
      child.on('close', () => { for (const w of [...server.wakers]) w(); });
    }
    const server = s;
    if (line.id === undefined) {
      server.child.stdin.write(`${JSON.stringify(line)}\n`);
      return Promise.resolve({ reply: null, ms: 0, pid: server.child.pid });
    }
    return new Promise((resolve, reject) => {
      const from = server.lines.length;
      const t0 = performance.now();
      const finish = () => { clearTimeout(timer); server.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`${name} gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < server.lines.length; i++) {
          let json;
          try { json = JSON.parse(server.lines[i].raw); } catch { continue; }
          if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: server.lines[i].at - t0, pid: server.child.pid }); return; }
        }
        if (server.child.exitCode !== null) { finish(); reject(Error(`the ${name} server (${argv.slice(1).join(' ')}) exited ${server.child.exitCode}: ${server.stderr}`)); }
      };
      server.wakers.add(check);
      server.child.stdin.write(`${JSON.stringify(line)}\n`);
      check();
    });
  }
}
