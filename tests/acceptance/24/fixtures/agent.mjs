// A stand-in for an agent session's process (Claude Code): its children carry its hooks, run `deep`
// commands as its Bash tool would (through a shell), start its `deep mcp`, and type into your shell with
// `tmux send-keys`. So the hub sees what it would see from a real agent: hooks whose parent is this
// process, and `deep` commands with this process above them. It decides nothing; it carries lines.
//   node agent.mjs                                  the agent: one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node agent.mjs hook <socket> <request JSON>     a hook client: sends the request with its own pid and this agent's, prints the hub's lines
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
  const done = (end) => { out({ lines, end }); sock.destroy(); process.exit(0); };
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
  let mcp;
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
        const r = await collect(spawn(NODE, [SELF, 'hook', command.socket, JSON.stringify(command.request)], { stdio: ['ignore', 'pipe', 'pipe'] }));
        return JSON.parse(r.stdout);
      }
      case 'run':
        // As an agent's Bash tool runs a command: a shell of this process runs it. `exit $?` keeps the shell from
        // exec'ing it, so the shell stays between this agent and the command, as it does for a real agent.
        return collect(spawn('/bin/sh', ['-c', '"$0" "$@"; exit $?', ...command.argv], { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
      case 'mcp':
        return mcpCall(command.argv, command.line);
      case 'exit':
        mcp?.child.kill();
        setTimeout(() => process.exit(0), 20);
        return {};
      default:
        throw Error(`unknown op ${command.op}`);
    }
  }

  // This agent's own `deep mcp`, started once, as the agent starts its MCP server; one JSON-RPC line, one reply by id.
  function mcpCall(argv, line) {
    if (!mcp) {
      const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
      mcp = { child, lines: [], wakers: new Set() };
      createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
      child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
    }
    return new Promise((resolve, reject) => {
      const from = mcp.lines.length;
      const timer = setTimeout(() => { mcp.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${line.id} in 30 s`)); }, 30_000);
      const check = () => {
        for (const raw of mcp.lines.slice(from)) {
          let json;
          try { json = JSON.parse(raw); } catch { continue; }
          if (json.id === line.id) { clearTimeout(timer); mcp.wakers.delete(check); resolve({ reply: json }); return; }
        }
        if (mcp.child.exitCode !== null) { clearTimeout(timer); mcp.wakers.delete(check); reject(Error('deep mcp exited')); }
      };
      mcp.wakers.add(check);
      mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
      check();
    });
  }
}
