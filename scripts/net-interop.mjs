// The network seam's interop part (issue #553; canvas primitives: Seam and backend, Net: relay protocol `relay@1`),
// run in the local preflight's `seams` lane: the app's network backend and the web player's play one match of a
// two-player piece through the relay DeepBuild ships, behind a test relay that delays, drops, duplicates and reorders
// relay@1 frames between each copy and the relay, and must pass net.rollback together. The app's copy is `deep-show
// run` (a person's click on its Join prompt, then `play_match`) as player 1 on the macOS backend; the web player's is
// the exported bundle in headless Chrome, joined through the first player's link by a person's click, as player 2,
// whose person presses the keys the piece's controls name. The test relay reads every frame a copy sends in relay@1's
// documented little-endian layout and fails a frame whose fields can't be right, naming the field and the sending
// copy's backend. net.rollback on the two copies: each reaches the on-time run's full-state hash at every confirmed
// step (the on-time run is `match` in one process with no faults, on player 1's script and player 2's entries as the
// records hold them), holds the on-time run's occurrences and records its merged track.
//
//   node scripts/net-interop.mjs --doc <file> --evidence <dir> --plays <file> --steps <n> --seed <n>
//                                [--planted web_writes_step_big_endian]
//
// `--planted web_writes_step_big_endian` is the wrong web backend: the page's WebSocket writes each frame's `first`
// big-endian (planted by this part through the browser's DevTools; the shipped player is unchanged). Findings go to
// stdout, then a last line `{"interop": Report}`; it exits 0 on PASS, 1 on FAIL, 2 on INCONCLUSIVE and 3 on BLOCKED. It
// stops everything it started by PID, also when it is sent SIGTERM. Never on push or pull request.
import { X509Certificate, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { connect as tlsConnect, createServer as createTlsServer } from 'node:tls';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const FLICKS = 705_600_000;
const HEADER = 27;
/** How long a live phase may take on the wall clock before the part gives up on it. */
const LIVE_MS = 30 * 60_000;
/** A frame's `first` is the lowest step its copy's peers confirmed: never this many steps past its own `confirmed`. */
const FIRST_MARGIN = 600;
/** The backends this part plays: the app's network seam backend on macOS (crates/deep-relay/src/macos.rs) and the web
 * player's, the page's own WebSocket (crates/deep-player/web/element.js). */
const BACKENDS = { app: { name: 'network.macos', version: '1.0.0' }, web: { name: 'network.web', version: '1.0.0' } };
const PLANTS = ['web_writes_step_big_endian'];

// ---------------------------------------------------------------------------------------------------
// Arguments, the report, and the processes this part starts.

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const opts = { doc: arg('doc'), evidence: arg('evidence'), plays: arg('plays'), steps: Number(arg('steps')), seed: Number(arg('seed') ?? 0), planted: arg('planted') ?? null };
const report = {
  status: 'FAIL', steps: opts.steps, seed: opts.seed, backends: BACKENDS,
  relay: { frames: 0, delayed: 0, dropped: 0, duplicated: 0, reordered: 0 },
  check: { kind: 'net.rollback', verdict: 'FAIL', failures: [] }, failures: [], copies: { app: null, web: null },
};
const lines = [];
const children = new Set();
const closers = [];
const scratch = mkdtempSync(join(tmpdir(), 'deep-net-interop-'));
const temp = (name) => { const d = join(scratch, name); mkdirSync(d, { recursive: true }); return d; };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
class Stop extends Error { constructor(status, reason) { super(reason); this.status = status; } }
const blocked = (reason) => { throw new Stop('BLOCKED', reason); };
/** A live phase that didn't finish: INCONCLUSIVE when the machine's 1-minute load is above its cores, else a failure. */
function gaveUp(what) {
  const load = loadavg()[0] ?? 0;
  if (load > cpus().length) throw new Stop('INCONCLUSIVE', `${what}, with a 1-minute load of ${load.toFixed(1)} on ${cpus().length} cores; run it again on a quieter machine`);
  throw new Stop('FAIL', `${what} (1-minute load ${load.toFixed(1)} on ${cpus().length} cores)`);
}

let finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  for (const close of closers.splice(0).reverse()) { try { await close(); } catch { /* already closed */ } }
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(scratch, { recursive: true, force: true });
  // Exit only once the report has reached a pipe whole: an exit right after a large write cuts it short.
  const out = `${lines.map((l) => `${l}\n`).join('')}${JSON.stringify({ interop: report })}\n`;
  process.stdout.write(out, () => process.exit(code));
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { report.status = 'FAIL'; report.reason = `stopped by ${signal}`; void finish(1); });

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the shipped set and the shipped relay, copied out of the target so a neighbour's build
// can't swap them under the run.

const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const PATH = existsSync(TOOLCHAIN) ? `${TOOLCHAIN}:${process.env.PATH ?? ''}` : (process.env.PATH ?? '');
const TARGET = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
function build() {
  const env = { ...process.env, PATH, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
  const bins = temp('bin');
  for (const [args, name] of [[['--bin', 'deep-show', '--no-default-features', '--features', 'full'], 'deep-show'], [['--bin', 'deep-relay'], 'deep-relay']]) {
    const r = spawnSync('cargo', ['build', '--locked', ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
    if (r.error) blocked(`cargo could not run (${r.error.message}); this machine lacks the Rust toolchain`);
    if (r.status !== 0) throw new Stop('FAIL', `cargo build ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => /^(error|warning: unused)|-->/.test(l)).slice(0, 30).join('\n')}`);
    copyFileSync(join(TARGET, 'debug', name), join(bins, name));
  }
  return { show: join(bins, 'deep-show'), relay: join(bins, 'deep-relay') };
}

// ---------------------------------------------------------------------------------------------------
// A throwaway certificate authority and a relay certificate for 127.0.0.1 it signed (#309's, by the openssl CLI).

function certificates() {
  const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) blocked(`the openssl CLI can't run (${probe.error?.message ?? probe.stderr}); the throwaway certificate for 127.0.0.1 is made with it. Unblock: install openssl`);
  const dir = temp('certs');
  const at = (f) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = deep net interop throwaway authority\n[ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('relay.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = 127.0.0.1\n');
  writeFileSync(at('relay.ext'), 'subjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\nauthorityKeyIdentifier = keyid\n');
  for (const step of [
    ['ecparam', '-name', 'prime256v1', '-param_enc', 'named_curve', '-out', at('p256.pem')],
    ['req', '-x509', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('ca.key'), '-out', at('ca.pem'), '-days', '1', '-config', at('ca.cnf'), '-extensions', 'ca'],
    ['req', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('relay.key'), '-out', at('relay.csr'), '-config', at('relay.cnf')],
    ['x509', '-req', '-in', at('relay.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-set_serial', '1', '-out', at('relay.pem'), '-days', '1', '-sha256', '-extfile', at('relay.ext')],
  ]) {
    const r = spawnSync('openssl', step, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) blocked(`openssl ${step[0]} failed: ${r.error?.message ?? r.stderr}`);
  }
  return { ca: at('ca.pem'), cert: at('relay.pem'), key: at('relay.key') };
}

/** The shipped relay on a port it picks. */
function startRelay(bin, certs) {
  const child = spawn(bin, ['--listen', '127.0.0.1:0', '--cert', certs.cert, '--key', certs.key], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.add(child);
  closers.push(() => { child.kill('SIGTERM'); children.delete(child); });
  return new Promise((done, fail) => {
    child.once('exit', (code) => fail(new Stop('FAIL', `deep-relay exited ${code} before listening`)));
    child.stdout.setEncoding('utf8').once('data', (line) => done(JSON.parse(line.split('\n')[0]).listening));
  });
}

// ---------------------------------------------------------------------------------------------------
// relay@1 on the wire (packages/contracts/slots/relay@1.json): a WebSocket over https; each control message one JSON
// text message; each frame one binary message. The test relay reads WebSocket framing (RFC 6455) only to find each
// message, and writes each message's bytes as they came.

class Messages {
  buf = Buffer.alloc(0);
  parts = [];
  /** Each whole message: its opcode, unmasked payload and the raw frames it came in. */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    for (;;) {
      if (this.buf.length < 2) return out;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) { if (this.buf.length < 4) return out; len = this.buf.readUInt16BE(2); at = 4; } else if (len === 127) { if (this.buf.length < 10) return out; len = Number(this.buf.readBigUInt64BE(2)); at = 10; }
      const masked = (b1 & 0x80) !== 0;
      const total = at + (masked ? 4 : 0) + len;
      if (this.buf.length < total) return out;
      const raw = Buffer.from(this.buf.subarray(0, total));
      let payload = Buffer.from(raw.subarray(at + (masked ? 4 : 0)));
      if (masked) { const key = raw.subarray(at, at + 4); payload = Buffer.from(payload.map((x, i) => x ^ key[i % 4])); }
      this.buf = this.buf.subarray(total);
      const opcode = b0 & 0x0f;
      if (opcode >= 8) { out.push({ opcode, payload, raw }); continue; }
      this.parts.push({ opcode, payload, raw });
      if ((b0 & 0x80) === 0) continue;
      const parts = this.parts;
      this.parts = [];
      out.push({ opcode: parts[0].opcode, payload: Buffer.concat(parts.map((p) => p.payload)), raw: Buffer.concat(parts.map((p) => p.raw)) });
    }
  }
}
/** A stream's HTTP header block, then the rest. */
class Head {
  buf = Buffer.alloc(0);
  done = false;
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const end = this.buf.indexOf('\r\n\r\n');
    if (end < 0) return null;
    this.done = true;
    return { head: this.buf.subarray(0, end + 4).toString('latin1'), rest: Buffer.from(this.buf.subarray(end + 4)) };
  }
}
/** mulberry32: a seeded generator of numbers in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a frame a copy sent can't be, read in relay@1's documented little-endian layout: {match 16 B, player u8,
 * confirmed u32, first u32, count u16, then each step as a u16 length and its bytes}. Null when it reads whole. */
function misread(frame, players) {
  if (frame.length < HEADER) return { field: 'header', what: `a frame of ${frame.length} bytes, shorter than relay@1's ${HEADER}-byte header` };
  const player = frame.readUInt8(16);
  const confirmed = frame.readUInt32LE(17);
  const first = frame.readUInt32LE(21);
  const count = frame.readUInt16LE(25);
  if (player >= players) return { field: 'player', what: `the frame names player ${player + 1} of a ${players}-player match` };
  if (first > confirmed + FIRST_MARGIN) return { field: 'first', step: first, what: `the frame's first step reads ${first} in relay@1's little-endian layout, ${first - confirmed} steps past the ${confirmed} its copy confirmed (its bytes ${frame.subarray(21, 25).toString('hex')})` };
  let at = HEADER;
  for (let k = 0; k < count; k++) {
    if (at + 2 > frame.length) return { field: 'count', what: `the frame says ${count} steps but holds ${k}` };
    at += 2 + frame.readUInt16LE(at);
  }
  if (at !== frame.length) return { field: 'count', what: `the frame's ${count} steps fill ${at} of its ${frame.length} bytes` };
  return null;
}

/** The test relay: a listener on 127.0.0.1 that ends TLS with the relay's own throwaway certificate and opens its own
 * TLS connection to the relay for each connection it takes. It hands control messages on at once, in order, and
 * applies its seeded faults to every frame either way: each frame waits a seeded delay (so frames reorder), some are
 * dropped and some sent twice. Every frame a copy sends is read in relay@1's layout; a frame that doesn't read is
 * named, with the backend of the copy that sent it (a browser's WebSocket sends an Origin; the app's backend none). */
async function startTestRelay(target, certs, seed, players, onBad) {
  const [, port] = target.split(':');
  const random = rng(seed ^ 0x553);
  const sockets = new Set();
  const counts = report.relay;
  const server = createTlsServer({ cert: readFileSync(certs.cert), key: readFileSync(certs.key), ALPNProtocols: ['http/1.1'] }, (down) => {
    const up = tlsConnect({ host: '127.0.0.1', port: Number(port), ca: readFileSync(certs.ca), ALPNProtocols: ['http/1.1'] });
    for (const s of [down, up]) { sockets.add(s); s.once('close', () => sockets.delete(s)); }
    let backend = 'app';
    /** One direction's faults: each frame at its own seeded time; control messages after everything already queued. */
    const direction = (out, check) => {
      const messages = new Messages();
      let last = 0;
      let seq = 0;
      let written = -1;
      let pending = 0;
      let ended = false;
      const write = (raw, n) => {
        if (n !== null) { if (n < written) counts.reordered += 1; written = Math.max(written, n); }
        if (!out.destroyed) out.write(raw);
      };
      const later = (at, f) => { pending += 1; setTimeout(() => { pending -= 1; f(); if (ended && pending === 0) out.end(); }, Math.max(0, at - Date.now())); };
      return {
        push: (chunk) => {
          for (const m of messages.push(chunk)) {
            if (m.opcode !== 2) {
              const at = Math.max(Date.now(), last);
              if (at <= Date.now() && pending === 0) write(m.raw, null); else later(at, () => write(m.raw, null));
              continue;
            }
            counts.frames += 1;
            if (check) { const bad = misread(m.payload, players); if (bad) onBad({ backend: BACKENDS[backend].name, ...bad }); }
            const n = seq++;
            if (random() < 0.04) { counts.dropped += 1; continue; }
            const twice = random() < 0.04;
            const wait = Math.floor(random() * 120);
            if (wait > 0) counts.delayed += 1;
            const at = Date.now() + wait;
            last = Math.max(last, at);
            later(at, () => { write(m.raw, n); if (twice) { counts.duplicated += 1; write(m.raw, null); } });
          }
        },
        end: () => { ended = true; if (pending === 0) out.end(); },
      };
    };
    const fromCopy = direction(up, true);
    const fromRelay = direction(down, false);
    const heads = { down: new Head(), up: new Head() };
    down.on('data', (d) => {
      if (heads.down.done) { fromCopy.push(d); return; }
      const h = heads.down.push(d);
      if (!h) return;
      const headLines = h.head.split('\r\n').filter((l) => l !== '');
      if (headLines.some((l) => /^origin:/i.test(l))) backend = 'web';
      // No extension is negotiated through the test relay, so every frame stays readable as it is.
      up.write(Buffer.from(`${headLines.filter((l) => !/^sec-websocket-extensions:/i.test(l)).join('\r\n')}\r\n\r\n`, 'latin1'));
      if (h.rest.length) fromCopy.push(h.rest);
    });
    up.on('data', (d) => {
      if (heads.up.done) { fromRelay.push(d); return; }
      const h = heads.up.push(d);
      if (!h) return;
      down.write(Buffer.from(h.head, 'latin1'));
      if (h.rest.length) fromRelay.push(h.rest);
    });
    up.on('end', () => fromRelay.end());
    up.on('close', () => fromRelay.end());
    down.on('end', () => fromCopy.end());
    down.on('close', () => up.destroy());
    down.on('error', () => up.destroy());
    up.on('error', () => down.destroy());
  });
  server.on('tlsClientError', () => { /* a copy that refuses the certificate shows as no connection */ });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done()));
  const address = server.address();
  closers.push(() => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }));
  return `https://127.0.0.1:${address.port}`;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}` (#393), on #383's virtual clock.

const AGENT = { id: 'sess-interop', thread: 'thread-interop', name: 'Network seam interop part', process: { pid: 4100, start: 1_000 } };
const PROCESSES = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
const YOU = { pid: 3002, start: 3_000 };
const PANEL = 'main';
function scenario(w) {
  return {
    evidence: w.evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels: { [PANEL]: { rect: [0, 0, 640, 360] } }, docs: { [w.doc]: { panel: PANEL, ...(w.link ? { link: w.link } : {}) } },
    clock: { refresh_hz: 60, lead: 0, check: 0 }, ...(w.relayCa ? { relay_ca: w.relayCa } : {}), calls: w.calls,
  };
}
class Script {
  calls = [];
  t = 0;
  add(c, gap = 0.05) { this.t += Math.round(gap * FLICKS); this.calls.push({ ...c, at: this.t }); return this.calls.length - 1; }
  present(doc, document) { return this.add({ call: 'deep show', peer: YOU, doc, document, include: ['issues'] }, 0.001); }
  scope() { return this.add({ call: 'scope', panel: PANEL }, 0.2); }
  click(pos) { this.add({ call: 'input', panel: PANEL, event: { type: 'down', pos } }, 0.2); this.add({ call: 'input', panel: PANEL, event: { type: 'up', pos } }, 0.06); }
}
function runShow(bin, sc, what, timeoutMs = LIVE_MS) {
  return new Promise((done, fail) => {
    const child = spawn(bin, ['run'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    const out = [];
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Stop('TIMEOUT', `${what}: deep-show run did not finish within ${Math.round(timeoutMs / 60_000)} minutes`)); }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    child.once('error', (e) => { clearTimeout(timer); children.delete(child); fail(new Stop('FAIL', `${what}: deep-show could not run: ${e.message}`)); });
    child.once('close', (status) => {
      clearTimeout(timer);
      children.delete(child);
      const text = Buffer.concat(out).toString('utf8').trim();
      let answer = null;
      try { answer = JSON.parse(text.split('\n').at(-1) ?? ''); } catch { /* named below */ }
      if (status !== 0 || !answer?.ok || !Array.isArray(answer.replies)) { fail(new Stop('FAIL', `${what}: deep-show run answered ${text.slice(0, 600)} (exit ${status}); ${stderr.slice(-800)}`)); return; }
      done(answer.replies);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(sc)}\n`);
  });
}
function presented(reply, what) {
  const errors = (reply?.issues ?? []).filter((i) => i?.severity === 'error');
  if (reply?.outcome !== 'presented' || errors.length) throw new Stop('FAIL', `${what} isn't presented: ${JSON.stringify(reply?.issues ?? reply).slice(0, 1500)}`);
}

// ---------------------------------------------------------------------------------------------------
// The web bundle, served over HTTP on 127.0.0.1, and headless Chrome with WebGPU over its DevTools protocol.

async function exportBundle(bin, evidence, document, out) {
  const doc = String(document.id);
  const s = new Script();
  s.present(doc, document);
  const exported = s.add({ call: 'export', doc, out, video: { codec: 'web' } });
  const r = await runShow(bin, scenario({ evidence, doc, calls: s.calls }), 'the web export');
  presented(r[0], 'the piece');
  if (r[exported]?.outcome !== 'exported' || !existsSync(join(out, 'index.html'))) throw new Stop('FAIL', `the web export didn't deliver the bundle: ${JSON.stringify(r[exported]).slice(0, 1500)}`);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
async function serve(dir) {
  const base = resolve(dir);
  const server = createHttpServer((q, r) => {
    const url = decodeURIComponent((q.url ?? '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = resolve(base, rel);
    let body = null;
    if (file.startsWith(base + sep)) { try { body = readFileSync(file); } catch { body = null; } }
    if (!body) { r.statusCode = 404; r.end(); return; }
    const wasm = body.length >= 4 && body.readUInt32BE(0) === 0x0061736d;
    r.setHeader('content-type', wasm ? 'application/wasm' : (TYPES[extname(file)] ?? 'application/octet-stream'));
    r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
    r.end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done()));
  closers.push(() => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }));
  return `http://127.0.0.1:${server.address().port}`;
}

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];
/** The wrong web backend: the page's WebSocket writes each binary frame's `first` (bytes 21 to 25) big-endian. */
const BIG_ENDIAN_FIRST = `(() => {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (typeof data !== 'string' && data && data.byteLength >= ${HEADER}) {
      const bytes = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data.slice(0));
      const view = new DataView(bytes.buffer);
      view.setUint32(21, view.getUint32(21, true), false);
      return send.call(this, bytes);
    }
    return send.call(this, data);
  };
})();`;
class Protocol {
  n = 0;
  pending = new Map();
  constructor(ws) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id === undefined) return;
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); });
    return new Protocol(ws);
  }
  send(method, params = {}, session = '', timeoutMs = 60_000) {
    const id = ++this.n;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(Error(`${method}: no answer within ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { done: (r) => { clearTimeout(timer); done(r); }, fail: (e) => { clearTimeout(timer); fail(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
  }
}
class Tab {
  constructor(cdp, session) { this.cdp = cdp; this.session = session; }
  send(method, params = {}, timeoutMs = 60_000) { return this.cdp.send(method, params, this.session, timeoutMs); }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw Error(`a script in the page threw: ${r.exceptionDetails.text ?? ''} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result?.value;
  }
  async mustBeReady(ms = 180_000) {
    const until = Date.now() + ms;
    let s = { ready: false, notices: [] };
    while (Date.now() < until && !s.ready) {
      s = await this.evaluate(`(() => { const p = document.querySelector('deep-player'); return { ready: !!(p && p.ready === true),
        notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`).catch(() => s);
      if (!s.ready) await sleep(200);
    }
    if (s.ready) return;
    const gpu = await this.evaluate(`(async () => !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter')()`).catch((e) => e.message);
    if (gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${gpu}); the web player needs WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    gaveUp(`the web player wasn't ready within ${ms / 1000} s; its notices ${JSON.stringify(s.notices)}`);
  }
  prompt() {
    return this.evaluate(`(() => { const p = document.querySelector('[data-deep-join]'); if (!p) return null; const b = p.querySelector('button'); const r = b ? b.getBoundingClientRect() : null;
      return { state: p.getAttribute('data-deep-join') || '', text: (p.textContent || '').trim(), button: r && !b.hidden ? { x: r.x, y: r.y, w: r.width, h: r.height } : null }; })()`);
  }
  async match() {
    const v = await this.evaluate(`(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v && v.match !== undefined ? v.match : null)); })()`);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }
  /** A person's click: the browser's own input, a trusted event with a user activation. */
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** A person's key press: the browser's own input. */
  async key(key) {
    const code = /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: vk });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  }
}
async function openChrome(pin, url, planted) {
  if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the web player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
  const profile = temp('chrome');
  const chrome = spawn(CHROME, [...CHROME_ARGS, `--ignore-certificate-errors-spki-list=${pin}`, `--user-data-dir=${profile}`, 'about:blank'], { detached: true, stdio: 'ignore' });
  children.add(chrome);
  closers.push(() => { if (chrome.pid && chrome.exitCode === null) { try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ } } children.delete(chrome); });
  const portFile = join(profile, 'DevToolsActivePort');
  const until = Date.now() + 120_000;
  while (!existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2) {
    if (Date.now() > until || chrome.exitCode !== null) blocked(`${CHROME} opened no DevTools port within 120 s (exit ${String(chrome.exitCode)}). Unblock: run where headless Chrome starts`);
    await sleep(100);
  }
  const [port, path] = readFileSync(portFile, 'utf8').split('\n');
  const cdp = await Protocol.connect(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
  closers.push(() => cdp.ws.close());
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const tab = new Tab(cdp, sessionId);
  await tab.send('Page.enable');
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  if (planted === 'web_writes_step_big_endian') await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: BIG_ENDIAN_FIRST });
  await tab.send('Page.navigate', { url }).catch(() => undefined);
  return tab;
}
/** The pin Chrome trusts the throwaway certificate by: the base64 SHA-256 of its public key, for this browser alone. */
const pinOf = (certPem) => createHash('sha256').update(new X509Certificate(readFileSync(certPem)).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');

// ---------------------------------------------------------------------------------------------------
// net.rollback on the two copies.

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const trackLines = (track, before, step) => (track ?? []).filter((e) => e.t < before * step).slice().sort((x, y) => x.t - y.t || x.player - y.player || (x.seq ?? 0) - (y.seq ?? 0))
  .map((e) => `${e.t / step} p${e.player} ${e.control}=${JSON.stringify(e.value)}`);
const occurrenceLines = (c, before) => (c.occurrences ?? []).filter((r) => r.step < before).map((r) => JSON.stringify(canon(r))).sort();
/** Each failure names the backend whose copy it found and the first step that differs. */
function rollbackFailures(copy, onTime, before, step, backend) {
  const f = [];
  const want = new Map((onTime.hashes ?? []).map((h) => [h.step, h.hash]));
  const parted = (copy.hashes ?? []).find((h) => h.step < before && want.has(h.step) && want.get(h.step) !== h.hash);
  if (parted) f.push({ backend, step: parted.step, what: `the ${backend} copy's full-state hash at match step ${parted.step} isn't the on-time run's` });
  const shared = (copy.hashes ?? []).filter((h) => h.step < before && want.has(h.step)).length;
  if (shared < before - 3 * 8) f.push({ backend, what: `the ${backend} copy shares only ${shared} full-state hashes with the on-time run before step ${before}` });
  const [got, base] = [occurrenceLines(copy, before), occurrenceLines(onTime, before)];
  const extra = got.find((l) => !base.includes(l));
  const lacks = base.find((l) => !got.includes(l));
  if (extra || lacks || got.length !== base.length) {
    const row = JSON.parse(extra ?? lacks ?? 'null');
    f.push({ backend, ...(row ? { step: row.step } : {}), what: `the ${backend} copy ${extra ? 'holds an occurrence the on-time run doesn\'t' : 'lacks an occurrence the on-time run holds'}: ${extra ?? lacks ?? `${got.length} rows and ${base.length}`}` });
  }
  const [a, b] = [trackLines(copy.record?.track, before, step), trackLines(onTime.record?.track, before, step)];
  const i = a.findIndex((l, k) => l !== b[k]);
  if (i >= 0 || a.length !== b.length) {
    const at = i >= 0 ? i : Math.min(a.length, b.length);
    f.push({ backend, step: Number((a[at] ?? b[at] ?? 'NaN').split(' ')[0]), what: `the ${backend} copy records another merged track than the on-time run: ${a[at] ?? '(nothing)'} where it holds ${b[at] ?? '(nothing)'}` });
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The part.

async function main() {
  if (!opts.doc || !opts.evidence || !opts.plays || !(opts.steps > 0) || !Number.isInteger(opts.seed)) {
    throw new Stop('FAIL', 'usage: node scripts/net-interop.mjs --doc <file> --evidence <dir> --plays <file> --steps <n> --seed <n> [--planted web_writes_step_big_endian]');
  }
  if (opts.planted !== null && !PLANTS.includes(opts.planted)) throw new Stop('FAIL', `no planted run ${opts.planted}`);
  const document = JSON.parse(readFileSync(opts.doc, 'utf8'));
  const plays = JSON.parse(readFileSync(opts.plays, 'utf8'));
  const [netId, net] = Object.entries(document.items ?? {}).find(([, i]) => i?.kind === 'net@1') ?? [];
  if (!net) throw new Stop('FAIL', 'the piece has no net item');
  const players = net.params?.players ?? 2;
  const delay = net.params?.delay ?? 2;
  const step = FLICKS / (net.params?.step_rate ?? 60);
  const keys = Object.values(document.controls ?? {}).flatMap((c) => Object.keys(c?.keys ?? {}));
  if (!keys.length) throw new Stop('FAIL', 'no control of the piece names a key, so the web player\'s person has nothing to press');
  if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the web player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);

  const certs = certificates();
  const bins = build();
  const relayHost = await startRelay(bins.relay, certs);
  let stopEarly = null;
  const badFrames = new Promise((done) => { stopEarly = done; });
  const frameFailures = [];
  const door = await startTestRelay(relayHost, certs, opts.seed, players, (bad) => {
    if (frameFailures.length < 5) frameFailures.push(bad);
    if (frameFailures.length === 1) { lines.push(`FAIL ${bad.backend}'s frame: ${bad.what}`); stopEarly(); }
  });
  lines.push(`the shipped relay at ${relayHost}, behind the test relay at ${door} (seed ${opts.seed})`);

  // The piece declares the test relay; each copy keeps an evidence store of its own.
  const live = JSON.parse(JSON.stringify(document));
  live.items[netId].params = { ...live.items[netId].params, relay: door };
  const [appStore, webStore] = [temp('app-evidence'), temp('web-evidence')];
  cpSync(opts.evidence, appStore, { recursive: true });
  cpSync(opts.evidence, webStore, { recursive: true });
  const bundle = join(temp('bundle'), 'out');
  await exportBundle(bins.show, webStore, live, bundle);
  const origin = await serve(bundle);

  // The app's copy: the prompt read, a person's click on Join, then the match for `steps` steps, writing its link.
  const doc = String(live.id);
  const first = new Script();
  first.present(doc, live);
  const seen = first.scope();
  const r0 = await runShow(bins.show, scenario({ evidence: appStore, doc, relayCa: certs.ca, calls: first.calls }), 'the app\'s prompt');
  presented(r0[0], 'the piece');
  const button = r0[seen]?.state?.join?.button;
  if (!Array.isArray(button)) throw new Stop('FAIL', `the app shows no Join prompt for the piece: ${JSON.stringify(r0[seen]?.state ?? null).slice(0, 600)}`);
  const linkFile = join(temp('link'), 'link');
  const s = new Script();
  s.present(doc, live);
  s.scope();
  s.click([button[0] + button[2] / 2, button[1] + button[3] / 2]);
  const playedAt = s.add({ call: 'play_match', panel: PANEL, steps: opts.steps, plays: plays['1'] ?? [], link_to: linkFile });
  let appDone = false;
  const app = runShow(bins.show, scenario({ evidence: appStore, doc, relayCa: certs.ca, calls: s.calls }), 'the app\'s copy');
  app.then(() => { appDone = true; }, () => { appDone = true; });

  const live$ = (async () => {
    const until = Date.now() + LIVE_MS;
    let link = '';
    while (!link) {
      if (existsSync(linkFile) && statSync(linkFile).size > 0) { const text = readFileSync(linkFile, 'utf8').trim(); if (text.includes('#')) link = text; }
      if (!link && appDone) { await app; throw new Stop('FAIL', 'the app\'s copy finished without writing the first player\'s link'); }
      if (!link && Date.now() > until) gaveUp('the app\'s copy wrote no link');
      if (!link) await sleep(100);
    }
    const tab = await openChrome(pinOf(certs.cert), `${origin}/index.html${link.slice(link.indexOf('#'))}`, opts.planted);
    await tab.mustBeReady();
    const prompt = await tab.prompt();
    if (!prompt?.button) throw new Stop('FAIL', `the web player draws no Join prompt with a button: ${JSON.stringify(prompt)}`);
    await tab.click(prompt.button.x + prompt.button.w / 2, prompt.button.y + prompt.button.h / 2);
    // The person's keys, one every 0.3 s from the web player's first match step while the app's copy plays.
    while (!appDone && Number((await tab.match())?.ran ?? 0) < 1) {
      // A Join the relay or the copies refuse says why on the web player's prompt.
      const said = await tab.prompt();
      if (said?.state === 'refused') {
        report.failures = [{ backend: BACKENDS.web.name, what: `the web player's Join was refused: ${said.text}` }];
        throw new Stop('FAIL', `the web player's Join was refused: ${said.text}`);
      }
      if (Date.now() > until) gaveUp('the web player\'s copy ran no match step after its Join');
      await sleep(100);
    }
    const press = rng(opts.seed ^ 0x7e9);
    while (!appDone) { await tab.key(keys[Math.floor(press() * keys.length)]); await sleep(300); }
    await app;
    let seenMatch = await tab.match();
    const ended = Date.now() + 120_000;
    while ((seenMatch?.end === null || seenMatch?.end === undefined) && Date.now() < ended) { await sleep(250); seenMatch = await tab.match(); }
    return seenMatch;
  })();
  const outcome = await Promise.race([live$.then((web) => ({ web })), badFrames.then(() => ({ bad: true }))]);
  if (outcome.bad) {
    // A frame that doesn't read in relay@1's layout fails the part: only the frames are named, never what they caused.
    await sleep(1000);
    report.failures = frameFailures;
    report.check = { kind: 'net.rollback', verdict: 'FAIL', failures: [] };
    throw new Stop('FAIL', 'a copy sent a frame that doesn\'t read in relay@1\'s layout');
  }
  const appReply = (await app)[playedAt];
  if (appReply?.code) throw new Stop('FAIL', `the app's play_match didn't play: ${JSON.stringify(appReply).slice(0, 1200)}`);
  const web = outcome.web;
  report.copies = { app: appReply, web };
  if (!web) throw new Stop('FAIL', 'the web player\'s probe() holds no match');
  if (frameFailures.length) { report.failures = frameFailures; throw new Stop('FAIL', 'a copy sent a frame that doesn\'t read in relay@1\'s layout'); }
  lines.push(`the app's copy ran ${appReply.ran} steps with ${appReply.rollbacks} rollbacks; the web player's ${web.ran} with ${web.rollbacks}`);

  // The on-time run: `match` in one process with no faults, on the entries the records hold.
  const before = Math.min(appReply.record?.confirmed ?? -1, web.record?.confirmed ?? -1) + 1;
  const p2 = (appReply.record?.track ?? []).filter((e) => e.player === 2 && e.t < before * step).sort((x, y) => x.t - y.t || x.seq - y.seq)
    .map((e) => ({ step: e.t / step - delay, control: e.control, value: e.value }));
  const o = new Script();
  o.present(doc, document);
  const m = o.add({ call: 'match', doc, steps: opts.steps, plays: { 1: plays['1'] ?? [], 2: p2 } });
  const r = await runShow(bins.show, scenario({ evidence: appStore, doc, calls: o.calls }), 'the on-time run');
  presented(r[0], 'the piece in the on-time run');
  if (r[m]?.code) throw new Stop('FAIL', `the on-time run's match didn't play: ${JSON.stringify(r[m]).slice(0, 1200)}`);
  const onTime = Object.fromEntries((r[m].copies ?? []).map((c) => [c.player, c]));
  const failures = [];
  if (!(before > 0)) failures.push({ backend: BACKENDS.app.name, what: 'the copies confirmed no step' });
  for (const [c, side] of [[appReply, 'app'], [web, 'web']]) {
    failures.push(...rollbackFailures(c, onTime[c.player] ?? {}, before, step, BACKENDS[side].name));
    if (c.fault || c.desync) failures.push({ backend: BACKENDS[side].name, what: `the ${side} copy's match ended ${c.end}: ${JSON.stringify(c.fault ?? c.desync).slice(0, 400)}` });
  }
  report.check = { kind: 'net.rollback', verdict: failures.length ? 'FAIL' : 'PASS', failures };
  report.failures = failures;
  for (const f of failures) lines.push(`FAIL ${f.backend}: ${f.what}`);
  lines.push(`net.rollback on the two copies: ${report.check.verdict} over ${before} confirmed steps`);
  report.status = failures.length ? 'FAIL' : 'PASS';
}

try {
  await main();
} catch (error) {
  const status = error instanceof Stop ? (error.status === 'TIMEOUT' ? 'FAIL' : error.status) : 'FAIL';
  report.status = status;
  report.reason = error.message;
  if (error instanceof Stop && error.status === 'TIMEOUT') {
    const load = loadavg()[0] ?? 0;
    if (load > cpus().length) report.status = 'INCONCLUSIVE';
  }
  lines.push(`${report.status} the interop part: ${error.message}`);
}
lines.push(`the test relay carried ${report.relay.frames} frames: ${report.relay.delayed} delayed, ${report.relay.dropped} dropped, ${report.relay.duplicated} duplicated, ${report.relay.reordered} reordered`);
await finish({ PASS: 0, FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3 }[report.status] ?? 1);
