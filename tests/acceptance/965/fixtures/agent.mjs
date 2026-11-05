#!/usr/bin/env node
// One session's Claude Code, as far as DeepBuild sees it (README, Playing Claude Code): a long-lived process per
// session whose children are that session's deep-hook runs, its `deep mcp` and the shell commands it runs in the
// background, as a real session's hook commands, MCP servers and background Bash calls are Claude Code's children.
// So the hub binds the session to this process, reads its background commands under it (#907), and `deep inbox`
// run by the test stays outside every session's process tree. It decides nothing about DeepBuild. Adapted from
// tests/acceptance/29/fixtures/agent.mjs and tests/acceptance/18/binding/fixtures/agent.mjs (same repo, same license).
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {n, op: 'hook', args, cwd, input, timeoutMs}   runs `<deep-hook> <args…>`; answers {n, pid} as it starts, then
//                                                  {n, code, signal, stdout, stderr, ms, timedOut, ended}
//   {n, op: 'mcp', line, timeoutMs}                one JSON-RPC line to this agent's `deep mcp` (started on first
//                                                  use); answers {n, reply, pid}
//   {n, op: 'background', command, cwd}            `/bin/sh -c <command>` in a process group of its own, as Claude
//                                                  Code runs a Bash call with run_in_background; answers {n, pid}
// On SIGTERM, or when stdin closes, it stops every hook run still going and its deep mcp, then exits; background
// commands are left to the test, which stops them by their group.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK, CLI] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
let mcp;

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'mcp') {
    mcpCall(c.line, c.timeoutMs ?? 120_000).then((a) => out({ n: c.n, ...a }), (error) => out({ n: c.n, failed: String(error?.stack ?? error) }));
    return;
  }
  if (c.op === 'background') {
    const child = spawn('/bin/sh', ['-c', c.command], { cwd: c.cwd, env: process.env, stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    out({ n: c.n, pid: child.pid });
    return;
  }
  const t0 = performance.now();
  const child = spawn(DEEP_HOOK, c.args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
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

/** This agent's own `deep mcp`, started once; one JSON-RPC line, one reply by id. */
function mcpCall(line, timeoutMs) {
  if (!mcp) {
    const child = spawn(process.execPath, [CLI, 'mcp'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
    child.stdin.on('error', () => undefined);
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

const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  try { mcp?.child.kill('SIGTERM'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
