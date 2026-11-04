// Claude Code's side of the hook contract for #992's replays: one process stands in for one Claude Code process. It
// decides nothing and carries lines: each hook is the real deep-hook binary run as this process's direct child
// (`deep-hook claude-code <event>`, the recorded payload on stdin), as Claude Code runs a hook command, so the hub sees
// the agent's process as the hook's parent. A test ends it by its PID, which is the terminal closing under the agent.
// Shaped after tests/acceptance/18/binding/fixtures/agent.mjs (same repo, same license); this suite keeps its own copy.
//   node agent.mjs   one JSON command per stdin line, one JSON answer per stdout line, matched by `n`
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  if (command.op === 'hook') return hook(command.binary, command.event, command.payload, command.cwd, command.timeoutMs ?? 60_000);
  throw Error(`unknown op ${command.op}`);
}

/** deep-hook as Claude Code runs a hook entry: a direct child of this process, the payload on stdin, waited for. */
function hook(binary, event, payload, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(binary, ['claude-code', event], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${String(error)}`, ms: Date.now() - started, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: Date.now() - started, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}
