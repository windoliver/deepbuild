// The stand-in server only. NODE_OPTIONS preloads it so the hub-run child can answer
// at process age 30 ms, not 30 ms PLUS the production hub's module-loading time.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
export const now = () => Number(process.hrtime.bigint()) / 1e6;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(deadline) { while (now() < deadline) await wait(Math.max(1, deadline - now())); }

export async function runHub({ root }) {
  const mode = readFileSync(join(root, 'mode'), 'utf8');
  const note = (event, data = {}) => appendFileSync(join(root, 'trace.jsonl'), `${JSON.stringify({ event, t: now(), ...data })}\n`);
  const started = now() - performance.now(); // Node's monotonic process-start origin, not module entry.
  note('start', { pid: process.pid, started });
  process.on('exit', () => note('exit'));
  process.on('SIGTERM', () => process.exit(0));
  // A peer lives until its test stops it, not until another command's deadline.
  setInterval(() => {
    try { process.kill(Number(process.env.ACC2330_OWNER), 0); } catch { process.exit(91); }
  }, 1000).unref();
  if (mode === 'never') { await new Promise(() => { setInterval(() => {}, 1000); }); }
  writeFileSync(join(root, 'control.token'), 'acceptance-2330-only\n', { mode: 0o600 });
  let first = true, stopping = false;
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    const send = (o) => socket.write(`${JSON.stringify({ v: 1, ...o })}\n`);
    send({ hello: 'deep-hub', start: 'acceptance-2330', contract: '1.0', features: [], generation: 1 });
    if (first) { first = false; note('first-answer'); }
    let buffer = '', authorized = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (message.hello === 'cli') {
          authorized = message.token === 'acceptance-2330-only';
          send(authorized ? { hello: 'cli' } : { error: { code: 'denied' } });
        } else if (authorized && message.method === 'hub.stop' && !stopping) {
          stopping = true;
          note('stop-request');
          send({ id: message.id, result: { stopping: true } });
          if (mode === 'early-close' || mode === 'stays-up') { socket.end(); note('control-close'); }
          if (mode !== 'stays-up') {
            void until(now() + (mode === 'early-close' ? 230 : 30)).then(() => process.exit(0));
          }
        } else { send({ id: message.id, error: { code: 'unexpected-request' } }); }
      }
    });
  });
  await until(started + 30);
  server.listen(join(root, 'hub.sock'), () => {
    note('ready'); // listening, before ANY polling client has to notice
    // An immediate independent witness makes the first answer independent of the CLI's polling cadence.
    const witness = net.connect(join(root, 'hub.sock'));
    witness.on('data', () => witness.destroy());
    witness.on('error', () => {});
  });
  await new Promise(() => {});
}

if (process.argv[2] === 'hub' && process.argv[3] === 'run') {
  await runHub({ root: process.argv[process.argv.indexOf('--root') + 1] });
}
