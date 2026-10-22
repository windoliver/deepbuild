// The environment kit's fixture server (#314): a small HTTP service the reference environment@1 fill brings
// up. It takes a moment to come up (the warm-up), then listens on the leased port, answers its health route
// with its token and writes its ready marker; so an environment that reports ready before the health check
// answers is caught, and one that binds another port is seen at the lease.
//   node server.mjs <port> <healthPath> <token> <warmupMs> <readyFile> <runToken> [helper|quiet]
// It carries the lease's run token on its command line, as every process of an environment does. With `helper`,
// it also starts helper.mjs carrying that token, a grandchild that outlives the server: the planted environment
// that leaves a process after down. With `quiet`, the grandchild carries no token: an environment with a process
// the lease's contract doesn't cover, which the kit refuses before down (the kit's own tests use it).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [port, health, token, warmup, ready, run, helper] = process.argv.slice(2);
const HELPER = fileURLToPath(new URL('./helper.mjs', import.meta.url));
// The grandchild starts only once the server listens, right before the marker that names it: a server that never
// binds (its port taken in the lease's open moment) starts nothing the kit would not learn of.
const startHelper = () => {
  const grandchild = helper === 'helper' ? spawn(process.execPath, [HELPER, run], { detached: true, stdio: 'ignore' })
    : helper === 'quiet' ? spawn(process.execPath, [HELPER], { detached: true, stdio: 'ignore' })
    : null;
  grandchild?.unref();
  return grandchild?.pid ?? null;
};
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === health) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, token }));
    return;
  }
  response.writeHead(404);
  response.end();
});
// A port it can't bind ends the server at once, so the kit sees it gone rather than waiting on a marker that never comes.
server.on('error', () => process.exit(1));
setTimeout(() => {
  server.listen(Number(port), '127.0.0.1', () => {
    const grandchild = startHelper();
    // The ready marker names the processes this environment is made of, so the kit knows what it started; written
    // whole, then moved into place, so a reader never sees half of it. A fill that never waits for the marker has
    // removed its folder already; the server serves on regardless, so that fill is judged on its health answer.
    try {
      writeFileSync(`${ready}.tmp`, JSON.stringify({ port: Number(port), pid: process.pid, helper: grandchild }));
      renameSync(`${ready}.tmp`, ready);
    } catch { /* nobody is waiting for the marker */ }
  });
}, Number(warmup));
// A fixture server never outlives its run by much.
setTimeout(() => process.exit(0), 60_000).unref();
process.on('SIGTERM', () => process.exit(0));
