// A repo's own dev server, as the environment block of a test repo's .deepbuild/done.yaml starts it (`up`). It
// reads its leased port from `web` and listens on 127.0.0.1 there, writing <pid-dir>/server.<pid> first so the test
// knows its PID without trusting the hub. It reports what it was given, never a credential's value:
//   GET /health  200 {ok, cwd, port, pid}
//   GET /env     200 {cwd, SHOP_ACCOUNT, GPU, SCREEN, DEPLOY, APP_HOST, DATABASE, credential}: the leased keys and host
//                name as given, and for SHOP_API_KEY only {set, sha256} (the digest of the value it got)
//   GET /db      200 {database, exists, content}: the database file named by $DATABASE, as the app reads it
// At start it prints its credential's value once on stdout and stderr, as a careless app logs its config, so a
// test can see whether the value reached the record, evidence or the checkout through its output.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const dir = resolve(value('--pid-dir', '.pids'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `server.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));

const key = process.env.SHOP_API_KEY;
if (key !== undefined) {
  console.log(`shop api: using key ${key}`);
  console.error(`shop api: using key ${key}`);
}
const port = Number(process.env.web);
if (!Number.isInteger(port) || port <= 0) { console.error(`server: no port in $web (${process.env.web})`); process.exit(64); }
const pick = (name) => process.env[name] ?? null;
const server = http.createServer((req, res) => {
  const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return send({ ok: true, cwd: process.cwd(), port, pid: process.pid });
  if (req.url === '/env') {
    return send({
      cwd: process.cwd(),
      SHOP_ACCOUNT: pick('SHOP_ACCOUNT'), GPU: pick('GPU'), SCREEN: pick('SCREEN'), DEPLOY: pick('DEPLOY'), APP_HOST: pick('APP_HOST'), DATABASE: pick('DATABASE'),
      credential: { set: key !== undefined, sha256: key === undefined ? null : createHash('sha256').update(key).digest('hex') },
    });
  }
  if (req.url === '/db') {
    const database = pick('DATABASE');
    let content = null;
    let error = null;
    try { if (database && existsSync(database)) content = readFileSync(database, 'utf8'); } catch (e) { error = String(e?.code ?? e); }
    return send({ database, exists: Boolean(database && existsSync(database)), content, error });
  }
  res.writeHead(404).end();
});
server.on('error', (error) => { console.error(`server: ${error.message}`); process.exit(65); });
server.listen(port, '127.0.0.1');
