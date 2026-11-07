#!/usr/bin/env node
// One session's agent process, as far as DeepBuild sees it: a long-lived process whose children are that session's
// deep-hook runs and the shell commands of its Bash tool, as a desktop app's Claude Code or Codex process is their
// parent. The hub binds the session to this process, and `deep env up` run under it is that session's. A test kills it
// with SIGKILL to interrupt the session. It decides nothing about DeepBuild. Adapted from
// tests/acceptance/965/fixtures/agent.mjs (same repo, same license).
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {n, op: 'hook', args, cwd, input}   runs `<deep-hook> <args…>` with `input` on its stdin
//   {n, op: 'bash', command, cwd}       runs `/bin/sh -c <command>`
// Each answers {n, code, stdout, stderr}.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (raw) => {
  const c = JSON.parse(raw);
  const child = c.op === 'hook'
    ? spawn(DEEP_HOOK, c.args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('/bin/sh', ['-c', c.command], { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  child.on('error', (error) => out({ n: c.n, code: null, stdout, stderr: `${stderr}${error.message}` }));
  child.on('close', (code) => out({ n: c.n, code, stdout, stderr }));
  child.stdin.on('error', () => undefined);
  child.stdin.end(c.input ?? '');
});
