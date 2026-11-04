// A stand-in for one agent process (one Claude Code or Codex session), adapted from tests/acceptance/18/binding/fixtures/agent.mjs
// (same repo, same license). It decides nothing; it carries lines. Its hooks are the real deep-hook binary, run as its
// direct children (`deep-hook <agent> <event>`, the hook JSON on stdin), and its shell tool's commands are its children
// too, each `/bin/sh -c <command>` in a process group of its own, as an agent's Bash tool runs one and its timeout kills
// it. So every process a command starts, `deep lease` included, has this session's agent among its ancestors, as under a
// real agent.
//   node agent.mjs   one JSON command per stdin line; one JSON answer per stdout line, matched by `n`. A `bash`
//                    command also sends {n, started: <pid>} as its shell starts and {n, output: <text>} as it prints.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const c = JSON.parse(line);
  if (c.op === 'exit') { setTimeout(() => process.exit(0), 20); return; }
  const work = c.op === 'hook' ? hook(c) : c.op === 'bash' ? bash(c) : Promise.reject(Error(`unknown op ${c.op}`));
  work.then((a) => out({ n: c.n, done: true, ...a }), (e) => out({ n: c.n, done: true, failed: String(e?.stack ?? e) }));
});

/** deep-hook as the agent runs a hook entry: a direct child of this process, the payload on stdin, waited for. */
function hook({ binary, agent, event, payload, cwd, env }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(binary, [agent, event], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${String(error)}`, ms: performance.now() - t0 }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

/** The shell tool: `/bin/sh -c <command>` in a process group of its own; its output, stdout and stderr in order, is the tool result. */
function bash({ n, command, cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    out({ n, started: child.pid });
    let output = '';
    const take = (d) => { output += d; out({ n, output: d }); };
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.on('error', (error) => resolve({ code: null, signal: null, output: `${output}${String(error)}`, pid: child.pid }));
    child.on('close', (code, signal) => resolve({ code, signal, output, pid: child.pid }));
  });
}
