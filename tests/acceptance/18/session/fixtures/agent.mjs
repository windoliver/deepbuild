// A stand-in for a Claude Code process, for the #18 binding test (AC9). It decides nothing; it carries lines. Its
// children are what a real Claude Code's are: each hook is the real deep-hook binary, started as its direct child
// (`deep-hook claude-code <event>`, the hook JSON on stdin), and its one MCP server is `deep mcp`, its child too. So
// the hub sees a true process tree: hooks and an MCP server whose parent is this process.
//   node agent.mjs    one JSON command per stdin line, one JSON answer per stdout line, matched by `n`
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let mcp;

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  switch (command.op) {
    case 'hook': {
      // deep-hook as Claude Code starts a hook entry's command: a child of this process, in the session's folder.
      const child = spawn(command.binary, ['claude-code', command.event], { cwd: command.cwd, env: command.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify(command.payload));
      const code = await new Promise((resolve) => child.on('close', (c) => resolve(c)));
      return { code, stdout, stderr, pid: child.pid };
    }
    case 'mcp':
      return mcpCall(command);
    case 'exit':
      mcp?.child.kill();
      setTimeout(() => process.exit(0), 20);
      return {};
    default:
      throw Error(`unknown op ${command.op}`);
  }
}

// This agent's own `deep mcp`, started at its first use, as Claude Code starts a stdio MCP server; one JSON-RPC line
// in, the reply with the same id out. A notification (no id) gets no reply.
function mcpCall({ argv, cwd, env, line, timeoutMs = 120_000 }) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    return Promise.resolve({ reply: null, pid: mcp.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, pid: mcp.child.pid }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
    };
    mcp.wakers.add(check);
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}
