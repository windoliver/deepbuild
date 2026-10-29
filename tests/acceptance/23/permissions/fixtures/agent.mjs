#!/usr/bin/env node
// One session's Claude Code, as far as its hooks go (README, Redraft): a long-lived process per session whose
// children are that session's deep-hook runs, as a real session's hook commands are Claude Code's children. So the
// hub binds the session to this process, never to the test runner, and `deep inbox answer` run by the test (a
// sibling of this process, not its descendant) is your terminal, outside every session's process tree. It decides
// nothing about DeepBuild. After tests/acceptance/25/routes/fixtures/claude.mjs (same repo, same license), cut down
// to running one hook command.
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, JSON answers per stdout line, by `n`
//
// Command: {n, args, cwd, input, timeoutMs}: runs `<deep-hook> <args…>` in `cwd`, `input` on its stdin, this
// process's environment, and stops it (SIGKILL) at `timeoutMs`. Answers {n, pid} once it starts, then
// {n, code, signal, stdout, stderr, ms, timedOut, ended} once it ends. On SIGTERM, or when stdin closes, it stops
// every run still going, then exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
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
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
