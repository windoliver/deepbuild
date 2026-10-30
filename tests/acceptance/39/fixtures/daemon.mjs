// A stand-in for Codex's shared app-server daemon, adapted from tests/acceptance/18/binding/fixtures/agent.mjs (same repo,
// same license). It decides nothing: one process is the parent of every thread's hooks (`deep-hook codex <event>`) and of
// one `deep mcp`, so the process tree can't tell the threads apart; only each payload can.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let mcp;
createInterface({ input: process.stdin }).on('line', (line) => {
  const c = JSON.parse(line);
  if (c.op === 'exit') { mcp?.child.kill(); setTimeout(() => process.exit(0), 20); return; }
  const work = c.op === 'hook' ? hook(c) : mcpCall(c);
  work.then((a) => out({ n: c.n, ...a }), (e) => out({ n: c.n, failed: String(e?.stack ?? e) }));
});
function hook({ binary, event, payload, cwd }) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['codex', event], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}
function mcpCall({ argv, line, timeoutMs }) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'ignore'] });
    mcp = { child, wait: new Map() };
    createInterface({ input: child.stdout }).on('line', (l) => { const v = JSON.parse(l); mcp.wait.get(v.id)?.(v); });
  }
  if (line.id === undefined) { mcp.child.stdin.write(`${JSON.stringify(line)}\n`); return Promise.resolve({ reply: null, pid: mcp.child.pid }); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`deep mcp gave no reply to ${line.method} in ${timeoutMs} ms`)), timeoutMs);
    mcp.wait.set(line.id, (reply) => { clearTimeout(timer); resolve({ reply, pid: mcp.child.pid }); });
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
  });
}
