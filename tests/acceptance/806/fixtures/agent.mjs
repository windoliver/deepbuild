// A stand-in for an agent's process (a Claude Code session or a Codex session), as #26's fixtures/agent.mjs is, with one
// more op, `exec`: a command run the way an agent runs a tool, as a child of a shell that is itself the agent's child, so
// a `deep show` it runs sits inside the agent's process tree. It decides nothing; it carries lines.
//   node agent.mjs                               the agent: one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node agent.mjs hook <socket> <request JSON>  a hook client (deep-hook's wire): sends the request with its own pid and this agent's, prints the hub's lines
//   ops: hook {socket, request, cwd} | mcp {argv, line, timeoutMs} | mcp-pid | exec {argv, cwd, env?, timeoutMs?} | exit
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
    child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid }));
  });

  async function handle(command) {
    switch (command.op) {
      case 'hook': {
        const r = await collect(spawn(NODE, [SELF, 'hook', command.socket, JSON.stringify(command.request)], { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
        try { return JSON.parse(r.stdout); } catch { return { lines: [], end: `client exited ${r.code}: ${r.stderr}` }; }
      }
      case 'exec': {
        // agent -> shell -> command: the shell stays between, because it runs one more thing after the command.
        const child = spawn('/bin/sh', ['-c', '"$@"; exit $?', 'sh', ...command.argv], { cwd: command.cwd, env: command.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const timer = setTimeout(() => child.kill('SIGKILL'), command.timeoutMs ?? 120_000);
        const r = await collect(child);
        clearTimeout(timer);
        return { code: r.code, stdout: r.stdout, stderr: r.stderr, shell: r.pid };
      }
      case 'mcp':
        return mcpCall(command.argv, command.line, command.timeoutMs ?? 120_000);
      case 'mcp-pid':
        return { pid: mcp?.child.pid ?? null, alive: mcp ? mcp.child.exitCode === null : false };
      case 'exit':
        mcp?.child.kill();
        setTimeout(() => process.exit(0), 20);
        return {};
      default:
        throw Error(`unknown op ${command.op}`);
    }
  }

  // This agent's own `deep mcp`, started once, as an agent starts its MCP server; one JSON-RPC line, one reply by id.
  function mcpCall(argv, line, timeoutMs) {
    if (!mcp) {
      const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
      mcp = { child, lines: [], wakers: new Set(), stderr: '' };
      child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
      createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push({ raw: l, at: performance.now() }); for (const w of [...mcp.wakers]) w(); });
      child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
    }
    if (line.id === undefined) {
      mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
      return Promise.resolve({ reply: null, ms: 0, pid: mcp.child.pid });
    }
    return new Promise((resolve, reject) => {
      const from = mcp.lines.length;
      let t0 = performance.now();
      const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < mcp.lines.length; i++) {
          let json;
          try { json = JSON.parse(mcp.lines[i].raw); } catch { continue; }
          if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: mcp.lines[i].at - t0, pid: mcp.child.pid }); return; }
        }
        if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
      };
      mcp.wakers.add(check);
      t0 = performance.now();
      mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
      check();
    });
  }
}
