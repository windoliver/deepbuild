import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);
const open = new Map();
let closing = false;

const ended = (n) => {
  open.delete(n);
  if (closing && open.size === 0) process.exit(0);
};

const start = (n, file, args, cwd, input) => {
  let stdout = '';
  let stderr = '';
  let done = false;
  const child = spawn(file, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  open.set(n, child);
  child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
  child.stdin.on('error', () => undefined);
  child.on('error', (error) => {
    if (done) return;
    done = true;
    out({ n, failed: String(error) });
    ended(n);
  });
  child.on('close', (code, signal) => {
    if (done) return;
    done = true;
    out({ n, code, signal, stdout, stderr });
    ended(n);
  });
  if (child.pid) out({ n, pid: child.pid });
  child.stdin.end(input ?? '');
};

const lines = createInterface({ input: process.stdin });
lines.on('line', (raw) => {
  const command = JSON.parse(raw);
  if (command.op === 'hook') start(command.n, command.binary, ['claude-code', command.event], command.cwd, JSON.stringify(command.payload));
  else if (command.op === 'sh') start(command.n, '/bin/sh', ['-c', `${command.line}\nexit $?`], command.cwd);
  else out({ n: command.n, failed: `unknown op ${command.op}` });
});
lines.on('close', () => {
  closing = true;
  for (const child of open.values()) child.kill('SIGTERM');
  if (open.size === 0) process.exit(0);
});
