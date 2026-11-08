#!/usr/bin/env node
// One session's agent (Claude Code or Codex), as far as its hooks and its MCP server go (README, Playing the agents):
// a long-lived process per session whose children are that session's deep-hook runs (its waiter among them) and its
// one `deep mcp`, as a real session's hook commands and MCP server are the agent's children. So the hub binds the
// session to this process, never to the test runner, and `deep inbox answer` / `deep race` run by the test (a sibling
// of this process, not its descendant) are your terminal, outside every session's process tree. It decides nothing
// about DeepBuild. Copied from tests/acceptance/323/fixtures/agent.mjs (same repo, same license), with one addition:
// a `child` command starts another copy of this program as this process's own child, the agent process of a child
// session a lead starts (README, A lead's own child sessions), and `via` routes later commands to it.
//
//   node agent.mjs <deep-hook> <node> <deep cli>   one JSON command per stdin line, JSON answers per stdout line, by `n`
//
// A hook command: {n, args, cwd, input, timeoutMs}: runs `<deep-hook> <args…>` in `cwd`, `input` on its stdin, this
// process's environment (with `env` laid over it), and stops it (SIGKILL) at `timeoutMs`. Answers {n, pid} once it
// starts, then {n, code, signal, stdout, stderr, ms, timedOut, ended} once it ends. Several may run at once (a waiter).
// An MCP line: {n, mcp, cwd, timeoutMs}: writes the JSON-RPC line `mcp` to this session's `deep mcp` (started once, in
// `cwd`, as `<node> <deep cli> mcp`), and answers {n, reply} with the line whose id is the request's, or {n, reply:
// null} for a notification, or {n, failed} at `timeoutMs`.
// A child: {n, child: <name>, env}: starts `node agent.mjs …` as this process's child under `name`, with `env` laid
// over this environment; answers {n, pid}. {n, via: <name>, …command} sends the command to that child and relays its
// answers.
// On SIGTERM, or when stdin closes, it stops every child still going, then exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const [, , DEEP_HOOK, NODE, CLI] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
const children = new Map();
let mcp;

function startMcp(cwd, n) {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  mcp = { child, lines: [], wakers: new Set(), stderr: '' };
  child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
  createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
  child.on('close', () => { running.delete(child); for (const w of [...mcp.wakers]) w(); });
  child.stdin.on('error', () => undefined);
  if (child.pid) out({ n, pid: child.pid });
}

function mcpLine(c) {
  if (!mcp) startMcp(c.cwd, c.n);
  const line = c.mcp;
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    out({ n: c.n, reply: null });
    return;
  }
  const from = mcp.lines.length;
  const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
  const timer = setTimeout(() => { finish(); out({ n: c.n, failed: `deep mcp gave no reply to ${line.id} in ${c.timeoutMs} ms: ${mcp.stderr}` }); }, c.timeoutMs ?? 120_000);
  const check = () => {
    for (let i = from; i < mcp.lines.length; i++) {
      let json;
      try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
      if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); out({ n: c.n, reply: json }); return; }
    }
    if (mcp.child.exitCode !== null) { finish(); out({ n: c.n, failed: `deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}` }); }
  };
  mcp.wakers.add(check);
  mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
  check();
}

function startChild(c) {
  const child = spawn(NODE, [fileURLToPath(import.meta.url), DEEP_HOOK, NODE, CLI], { cwd: process.cwd(), env: { ...process.env, ...(c.env ?? {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
  running.add(child);
  children.set(c.child, child);
  child.stdin.on('error', () => undefined);
  // The child's answers carry the numbers this process gave it, which are the test's own: relayed as they are.
  createInterface({ input: child.stdout }).on('line', (l) => process.stdout.write(`${l}\n`));
  child.on('close', () => running.delete(child));
  out({ n: c.n, pid: child.pid });
  out({ n: c.n, code: 0, signal: null, stdout: '', stderr: '', ms: 0, timedOut: false, ended: Date.now(), pid: child.pid });
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.via !== undefined) {
    const child = children.get(c.via);
    const { via: _via, ...rest } = c;
    if (child) child.stdin.write(`${JSON.stringify(rest)}\n`);
    else out({ n: c.n, failed: `no child ${c.via}`, code: null, signal: null, stdout: '', stderr: `no child ${c.via}`, ms: 0, timedOut: false, ended: Date.now() });
    return;
  }
  if (c.child !== undefined) return startChild(c);
  if (c.mcp) return mcpLine(c);
  const t0 = performance.now();
  const child = spawn(DEEP_HOOK, c.args, { cwd: c.cwd, env: { ...process.env, ...(c.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, c.timeoutMs ?? 60_000);
  const done = (code, signal, extra = '') => {
    clearTimeout(timer);
    running.delete(child);
    out({ n: c.n, code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut, ended: Date.now() });
  };
  child.on('error', (error) => done(null, null, error.message));
  child.on('close', (code, signal) => done(code, signal));
  if (child.pid) out({ n: c.n, pid: child.pid });
  child.stdin.on('error', () => undefined);
  child.stdin.end(c.input ?? '');
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
