// #1868 acceptance: a stand-in for an agent's process, as #26's suite has one. Its children carry its hooks and run
// its one `deep mcp`, so the hub sees what it sees from Claude Code: hooks whose parent is this process, and an MCP
// server whose parent is this process, which is how the hub binds a deep_* call to a session. It decides nothing.
//   node agent.mjs                               one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node agent.mjs hook <socket> <request JSON>  a hook client (deep-hook's wire): the request with its own pid and this agent's
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (process.argv[2] === 'hook') {
  const [, , , socket, json] = process.argv;
  const request = { ...JSON.parse(json), pid: process.pid, ppid: process.ppid };
  const lines = [];
  const sock = net.connect(socket);
  let buffer = '', finished = false;
  const done = (end) => {
    if (finished) return;
    finished = true;
    process.stdout.write(`${JSON.stringify({ lines, end })}\n`, () => process.exit(0));
    sock.destroy();
  };
  setTimeout(() => done('timeout'), 120_000);
  sock.on('error', (error) => done(`error:${error.code}`));
  sock.on('close', () => done('close'));
  sock.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      lines.push(line);
      if (lines.length === 1) sock.write(`${JSON.stringify(request)}\n`);
      else if (/"(exit|error)"/.test(line)) done('reply');
    }
  });
} else {
  let mcp;
  const collect = (child) => new Promise((resolve) => {
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  // This agent's own `deep mcp`, started once, as an agent starts its MCP server: one JSON-RPC line, one reply by id.
  // `ms` runs from the line written to the reply read, both in this process.
  function mcpCall(argv, env, line, timeoutMs) {
    if (!mcp) {
      const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      mcp = { child, lines: [], wakers: new Set(), stderr: '' };
      child.stderr.setEncoding('utf8').on('data', (text) => { mcp.stderr = (mcp.stderr + text).slice(-4000); });
      createInterface({ input: child.stdout }).on('line', (raw) => { mcp.lines.push({ raw, at: performance.now() }); for (const wake of [...mcp.wakers]) wake(); });
      child.on('close', () => { for (const wake of [...mcp.wakers]) wake(); });
    }
    if (line.id === undefined) {
      mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
      return Promise.resolve({ reply: null, ms: 0 });
    }
    return new Promise((resolve, reject) => {
      const from = mcp.lines.length;
      let t0 = performance.now();
      const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms: ${mcp.stderr}`)); }, timeoutMs);
      const check = () => {
        for (let i = from; i < mcp.lines.length; i++) {
          let json;
          try { json = JSON.parse(mcp.lines[i].raw); } catch { continue; }
          if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: mcp.lines[i].at - t0 }); return; }
        }
        if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
      };
      mcp.wakers.add(check);
      t0 = performance.now();
      mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
      check();
    });
  }
  async function handle(command) {
    switch (command.op) {
      case 'hook': {
        const ran = await collect(spawn(process.execPath, [SELF, 'hook', command.socket, JSON.stringify(command.request)], { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
        try { return JSON.parse(ran.stdout); } catch { return { lines: [], end: `the hook client exited ${ran.code}: ${ran.stderr}` }; }
      }
      case 'mcp': return mcpCall(command.argv, command.env ?? {}, command.line, command.timeoutMs ?? 120_000);
      case 'exit':
        mcp?.child.kill();
        setTimeout(() => process.exit(0), 20);
        return {};
      default: throw Error(`unknown op ${command.op}`);
    }
  }
  createInterface({ input: process.stdin }).on('line', (line) => {
    const command = JSON.parse(line);
    handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.message ?? error) }));
  });
  process.stdin.on('end', () => { mcp?.child.kill(); process.exit(0); });
}
