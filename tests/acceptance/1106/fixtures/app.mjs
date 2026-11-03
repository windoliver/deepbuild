// The repo's own app, as the environment block of a test repo's .deepbuild/done.yaml starts it (`up`). It reads its
// leased port from `web` and listens on 127.0.0.1 there, writing <pid-dir>/app.<pid> first so the test knows its
// PID without trusting the hub. It holds whatever the stack gave it in SHOP_API_KEY and OTHER_API_KEY, and reaches
// outside HTTPS only through the egress filter its environment names, the usual way: an HTTP CONNECT proxy in
// HTTPS_PROXY (or https_proxy), trusting the CA bundle in NODE_EXTRA_CA_CERTS or SSL_CERT_FILE as well as the
// system's roots.
//   GET /health  200 {ok}
//   GET /env     200 {env}: its whole environment, as its process holds it
//   GET /call?var=&to=&put=&method=&attempt=
//                200 {status, upstream, error, chain, trust}: one HTTPS request to `to` (host:port) through the filter,
//                with the variable's value placed as `put` says: header (Authorization: Bearer <it>), query
//                (?api_key=<it>) or body (a form body api_key=<it>), tagged x-dh1106-attempt; `status` the answer's,
//                `upstream` the answering sample API's name (x-dh1106-upstream), `chain` the certificates the TLS
//                peer showed (base64 DER, leaf first), `trust` the CA bundles its trust variables name
//   GET /leak    200 {set, reversed, xor_hex}: SHOP_API_KEY reversed and XOR'd with 0x5a (hex), also written, with the
//                raw XOR'd bytes, to leak.txt in the folder it runs in, as a careless app might log a secret it holds
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import tls from 'node:tls';

const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const dir = resolve(value('--pid-dir', '.pids'));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `app.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));

const port = Number(process.env.web);
if (!Number.isInteger(port) || port <= 0) { console.error(`app: no port in $web (${process.env.web})`); process.exit(64); }
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || '';

/** The CA bundles the usual trust variables name. */
function trusted() {
  const out = [];
  for (const variable of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
    const file = process.env[variable];
    if (!file) continue;
    try { out.push({ variable, pem: readFileSync(file, 'utf8') }); } catch { out.push({ variable, pem: '' }); }
  }
  return out;
}

async function call(q) {
  const variable = q.get('var') ?? '';
  const held = process.env[variable];
  if (held === undefined) return { error: `the app holds no ${variable}` };
  if (!proxyUrl) return { error: 'the app has no HTTPS_PROXY or https_proxy: no egress filter to send through' };
  const to = q.get('to') ?? '';
  const cut = to.lastIndexOf(':');
  const host = to.slice(0, cut).replace(/^\[|\]$/g, '');
  const toPort = Number(to.slice(cut + 1));
  const put = q.get('put') ?? 'header';
  const method = q.get('method') ?? 'GET';
  const attempt = q.get('attempt') ?? '';
  const trust = trusted();
  const proxy = new URL(proxyUrl);
  const auth = proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
  let socket;
  try {
    const { res, sock } = await new Promise((done, fail) => {
      const req = http.request({ host: proxy.hostname.replace(/^\[|\]$/g, ''), port: Number(proxy.port || 80), method: 'CONNECT', path: `${host.includes(':') ? `[${host}]` : host}:${toPort}`, headers: { host: to, ...auth }, timeout: 10_000 });
      req.on('connect', (r, s) => done({ res: r, sock: s }));
      req.on('response', (r) => { r.resume(); done({ res: r, sock: undefined }); });
      req.on('timeout', () => req.destroy(Error('CONNECT timed out')));
      req.on('error', fail);
      req.end();
    });
    if (res.statusCode !== 200 || !sock) { sock?.destroy(); return { status: res.statusCode, upstream: null, error: `the filter answered CONNECT ${res.statusCode}`, trust }; }
    socket = sock;
  } catch (e) {
    return { error: `CONNECT through ${proxy.host}: ${e?.code ?? e?.message ?? e}`, trust };
  }
  const ca = [...tls.rootCertificates, ...trust.map((t) => t.pem).filter(Boolean)];
  let secure;
  try {
    secure = await new Promise((done, fail) => {
      const s = tls.connect({ socket, ca, ...(isIP(host) ? {} : { servername: host }) });
      s.once('secureConnect', () => done(s));
      s.once('error', fail);
    });
  } catch (e) {
    socket.destroy();
    return { error: `TLS to ${to} through the filter: ${e?.code ?? e?.message ?? e}`, trust };
  }
  const chain = [];
  const seen = new Set();
  for (let c = secure.getPeerCertificate(true); c && c.raw && !seen.has(c.fingerprint256); c = c.issuerCertificate) {
    seen.add(c.fingerprint256);
    chain.push(c.raw.toString('base64'));
  }
  const enc = encodeURIComponent(held);
  const path = put === 'query' ? `/v1/items?api_key=${enc}` : '/v1/items';
  const body = put === 'body' ? `api_key=${enc}` : '';
  const headers = { host: to, 'x-dh1106-attempt': attempt, connection: 'close', ...(put === 'header' ? { authorization: `Bearer ${held}` } : {}),
    ...(body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)) } : {}) };
  try {
    const answer = await new Promise((done, fail) => {
      const req = http.request({ createConnection: () => secure, method, path, headers, timeout: 10_000 }, (res) => {
        res.resume();
        res.on('end', () => done({ status: res.statusCode, upstream: res.headers['x-dh1106-upstream'] ?? null }));
      });
      req.on('timeout', () => req.destroy(Error('request timed out')));
      req.on('error', fail);
      req.end(body || undefined);
    });
    return { ...answer, chain, trust };
  } catch (e) {
    return { error: `${method} ${to}: ${e?.code ?? e?.message ?? e}`, chain, trust };
  } finally {
    secure.destroy();
  }
}

function leak() {
  const held = process.env.SHOP_API_KEY;
  if (held === undefined) return { set: false };
  const reversed = [...held].reverse().join('');
  const xor = Buffer.from(Buffer.from(held, 'utf8').map((b) => b ^ 0x5a));
  const xorHex = xor.toString('hex');
  writeFileSync('leak.txt', `reversed=${reversed}\nxor_hex=${xorHex}\nxor_raw=`);
  appendFileSync('leak.txt', Buffer.concat([xor, Buffer.from('\n')]));
  return { set: true, reversed, xor_hex: xorHex };
}

const server = http.createServer(async (req, res) => {
  const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = new URL(req.url ?? '/', 'http://app.invalid');
  try {
    if (url.pathname === '/health') return send({ ok: true });
    if (url.pathname === '/env') return send({ env: { ...process.env } });
    if (url.pathname === '/call') return send(await call(url.searchParams));
    if (url.pathname === '/leak') return send(leak());
  } catch (e) {
    return send({ error: String(e?.message ?? e) });
  }
  res.writeHead(404).end();
});
server.on('error', (error) => { console.error(`app: ${error.message}`); process.exit(65); });
server.listen(port, '127.0.0.1');
