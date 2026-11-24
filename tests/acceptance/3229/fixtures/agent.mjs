// One session's Claude Code, as far as its processes go (README, The surface under test): a long-lived process whose
// children are that session's deep-hook runs, the shells its Bash tool starts, and its one `deep mcp`, so the hub binds
// the session to this process and finds it above everything the session runs. It decides nothing about DeepBuild.
// Adapted from tests/acceptance/29/fixtures/agent.mjs and tests/acceptance/667/fixtures/agent.mjs (same repo, same
// license); this suite keeps its own copy so a redraft of theirs never moves it.
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
//   {n, op: 'hook', args, cwd, input}   runs `<deep-hook> <args…>`, `input` on its stdin: {n, code, stdout, stderr}
//   {n, op: 'bash', command, cwd}       runs `/bin/sh -c <command>`, as the Bash tool does: {n, code, stdout, stderr}
//   {n, op: 'mcp', argv, line}          one JSON-RPC line to this agent's own `deep mcp`, started once: {n, reply}
//
// Each answer comes once the child ends (or its reply line arrives); a child still going at LIMIT is stopped with
// SIGKILL, by its PID, and the answer says so. On SIGTERM, or when stdin closes, it stops its children and exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const LIMIT = 600_000;
const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
let mcp;

function end(n, file, args, cwd, input) {
  const child = spawn(file, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const timer = setTimeout(() => { stderr += `\nstopped at ${LIMIT} ms`; child.kill('SIGKILL'); }, LIMIT); // deadline: a child that never ends is stopped, so the answer comes
  const done = (code, extra = '') => {
    clearTimeout(timer);
    running.delete(child);
    out({ n, code, stdout, stderr: stderr + extra });
  };
  child.on('error', (error) => done(null, error.message));
  child.on('close', (code) => done(code));
  child.stdin.on('error', () => undefined);
  child.stdin.end(input ?? '');
}

function mcpCall(n, argv, line) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(child);
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
  if (line.id === undefined) { out({ n, reply: null }); return; }
  const from = mcp.lines.length;
  const finish = (answer) => { clearTimeout(timer); mcp.wakers.delete(check); out({ n, ...answer }); };
  const timer = setTimeout(() => finish({ failed: `deep mcp gave no reply to ${line.id} in ${LIMIT} ms: ${mcp.stderr}` }), LIMIT); // deadline: a reply that never comes is answered as failed
  const check = () => {
    for (let i = from; i < mcp.lines.length; i++) {
      let json;
      try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
      if (json.id === line.id && ('result' in json || 'error' in json)) { finish({ reply: json }); return; }
    }
    if (mcp.child.exitCode !== null) finish({ failed: `deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}` });
  };
  mcp.wakers.add(check);
  check();
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'hook') end(c.n, DEEP_HOOK, c.args, c.cwd, c.input);
  else if (c.op === 'bash') end(c.n, '/bin/sh', ['-c', c.command], c.cwd, '');
  else if (c.op === 'mcp') mcpCall(c.n, c.argv, c.line);
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
