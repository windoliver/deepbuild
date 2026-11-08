// A stand-in for one agent session's process: its children carry its hooks (fixtures/hook.mjs), so the hub sees hooks
// whose parent is this process, as it would from Claude Code. Driven over stdin, one JSON command per line
// ({n, op: 'hook', address, request, token?, cwd} or {n, op: 'exit'}); one JSON answer per line, by `n`.
// Trimmed from tests/acceptance/16/fixtures/agent.mjs (no deep mcp), with the person's credential passed through.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./hook.mjs', import.meta.url));
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  if (command.op === 'exit') {
    setTimeout(() => process.exit(0), 20);
    return {};
  }
  if (command.op !== 'hook') throw Error(`unknown op ${command.op}`);
  const args = [HOOK, command.address, JSON.stringify(command.request), ...(command.token ? [command.token] : [])];
  const child = spawn(process.execPath, args, { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(Error(`hook.mjs exited ${code}: ${stderr}`))));
  });
}
