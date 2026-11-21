// #2484 e2e: through the built conformance package, under the warning lsof on PATH, the environment kit still
// passes the reference environment and still sees a port that really is in use beside the lease.
import { spawn } from 'node:child_process';
const repo = process.argv[2];
const { runKit, slotKits, cleanFills } = await import(`${repo}/packages/conformance/dist/index.js`);
const kit = slotKits().find((k) => k.slot === 'environment@1');
const show = (label, report) => { for (const c of report.cases) console.log(`${label}: ${c.outcome} ${c.codes.join(',')} ${c.message ?? ''}`.trim()); };

show('clean fill', await runKit(kit, cleanFills(kit)[0], { parts: ['fixed'] }));

const children = [];
const script = `
  const [port, token] = process.argv.slice(1);
  const http = require('node:http');
  const handler = (q, s) => { if (q.url === '/ping') { s.writeHead(204); s.end(); return; } s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); };
  http.createServer(handler).listen(Number(port), '127.0.0.1');
  const extra = http.createServer(handler).listen(0, '127.0.0.1', () => console.log('second port in use: 127.0.0.1:' + extra.address().port));
  process.on('SIGTERM', () => process.exit(0));`;
const secondPort = {
  slot: 'environment@1', revision: 1,
  up: (spec, lease, checkout) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, String(lease.port), spec.token, `--run-token=${lease.token}`], { stdio: ['ignore', 'inherit', 'inherit'], cwd: checkout });
    children.push(child);
    const until = Date.now() + 5000;
    const poll = () => fetch(`http://127.0.0.1:${lease.port}/ping`).then(() => resolve({ id: `e2e-${child.pid}`, port: lease.port, pid: child.pid }), () => (Date.now() < until ? setTimeout(poll, 20) : reject(Error('the server did not come up'))));
    poll();
  }),
  down: (handle) => { for (const c of children) if (c.pid === handle.pid) c.kill('SIGTERM'); },
};
try {
  show('second-port fill', await runKit(kit, secondPort, { parts: ['fixed'] }));
} finally {
  for (const c of children) c.kill('SIGKILL');
}
