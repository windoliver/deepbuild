// A `deep` command's call to the hub, as every deep command makes it (packages/hub/src/client.ts, `call` with the
// peer): the cli role, the control token from $HOME/.deepbuild, and this process named as the peer, by its PID and its
// start time as `ps -o lstart=` gives it, so the hub's peer check can tell whose process tree runs it. It sends
// `ask.answer` with the params in the file it is given, signature included, and prints the hub's reply line.
//   node deep-answer.mjs <params.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

const root = join(process.env.HOME ?? '', '.deepbuild');
const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
const params = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();

const sock = net.connect(join(root, 'hub.sock'));
let buffer = '';
let step = 0;
let said = false;
const done = (line) => {
  if (said) return;
  said = true;
  process.stdout.write(`${line}\n`, () => process.exit(0));
  sock.destroy();
};
setTimeout(() => done(JSON.stringify({ failed: 'no reply from the hub within 60 s' })), 60_000).unref();
sock.on('error', (error) => done(JSON.stringify({ failed: `can't reach the hub: ${error.message}` })));
sock.on('close', () => done(JSON.stringify({ failed: 'the hub closed the connection before it answered' })));
sock.setEncoding('utf8').on('data', (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    let json;
    try { json = JSON.parse(line); } catch { continue; }
    if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
    else if (step === 1 && json.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method: 'ask.answer', params })}\n`); }
    else if (step === 1 && json.error !== undefined) done(line);
    else if (step === 2 && json.id === 1) done(line);
  }
});
