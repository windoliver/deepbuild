// The sample app, started from each run's checkout. It keeps orders in the database $DATABASE_URL names and a visit
// counter in the stack's Redis, on the ports the stack leased ($web, $redis). It writes one line to <obs>/app.jsonl as it
// starts, with what it found in its folder before writing anything, and passes a journey's reports on to
// <obs>/journey.jsonl. Everything else is the plainest shop that shows the criterion's numbers.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pg, redis, retry, VERSION } from 'dh-wire';

const { dir: obs, name } = JSON.parse(readFileSync('obs.json', 'utf8'));
const files = (at) => (existsSync(at) ? readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(at, e.name)) : [join(at, e.name)])) : []);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const before = Object.fromEntries(files('.next').map((f) => [f, sha(readFileSync(f))]));

// What a build leaves: output that no later run may start with, and a cache that may carry.
mkdirSync('.next/cache', { recursive: true });
mkdirSync('.next/static', { recursive: true });
writeFileSync('.next/BUILD_ID', `${randomBytes(4).toString('hex')}\n`);
writeFileSync('.next/static/chunk.js', 'export {};\n');
const compiled = existsSync('.next/cache/compiled') ? Number(readFileSync('.next/cache/compiled', 'utf8')) : 0;
writeFileSync('.next/cache/compiled', String(compiled + 1));

const db = await retry(() => pg(process.env.DATABASE_URL));
const kv = await retry(() => redis(process.env.redis));
const modules = lstatSync('node_modules');
appendFileSync(join(obs, 'app.jsonl'), `${JSON.stringify({ name, pid: process.pid, cwd: process.cwd(), database: process.env.DATABASE_URL, web: process.env.web, version: VERSION, linked: modules.isSymbolicLink(), next_before: before, cart: sha(readFileSync('src/cart.ts')), at: Date.now() })}\n`);

const count = async () => Number((await db.query('SELECT count(*) FROM orders'))[0][0]);
const send = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
createServer((req, res) => {
  let text = '';
  req.setEncoding('utf8').on('data', (d) => (text += d)).on('end', async () => {
    try {
      if (req.url === '/health') return send(res, { ok: true });
      if (req.url === '/state') return send(res, { orders: await count(), visits: Number((await kv.command('GET', 'visits')) ?? 0), seeded: await kv.command('GET', 'seeded'), version: VERSION });
      if (req.url === '/go') return send(res, { go: !existsSync(join(obs, `hold-${name}`)) });
      if (req.url === '/target') return send(res, existsSync(join(obs, `target-${name}.json`)) ? JSON.parse(readFileSync(join(obs, `target-${name}.json`), 'utf8')) : {});
      if (req.url === '/orders' && req.method === 'POST') { await db.query("INSERT INTO orders (item) VALUES ('tea')"); return send(res, { placed: true }); }
      if (req.url === '/orders') { await kv.command('INCR', 'visits'); return send(res, { count: await count() }); }
      if (req.url === '/report') { appendFileSync(join(obs, 'journey.jsonl'), `${JSON.stringify({ name, pid: process.pid, cwd: process.cwd(), ...JSON.parse(text) })}\n`); return send(res, { ok: true }); }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
}).listen(Number(process.env.web), '127.0.0.1');
