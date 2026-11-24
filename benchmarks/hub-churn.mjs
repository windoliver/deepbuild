// The hub across churn (issue #824): node benchmarks/hub-churn.mjs [--cycles n] [--killed] [--home dir] [--merge-base].
// A hub on a temp home runs fixed cycles: a session starts, ten tool calls with their hooks (an edit, a call whose
// permission prompt is asked and answered and a commit among them, #1866), an ask created and answered, an action called
// with a request ID that reads a 64 KB source and a series source's new set of 100 names now (#2650), a plug-in's send
// held for your answer, one revision shown through deep_show, the change claimed at a stop that carries usage and judged
// to PASS (#1866), a check run, a job whose agent prints 256 KB and ends (#2650), a promise armed and woken, an extension
// reloaded (installed again, so its running copy stops and the new one loads) and the session ending: with --killed
// (#1866), by its agent's process killed and no SessionEnd. After a warm-up of 100
// cycles, its retained heap after a full collection, all its threads together, and its resident memory are read every
// 100 cycles, and the heap each of the four stores #2650 bounds retains is read from a heap snapshot after warm-up and
// after the last cycle. The readings come through the hub's inspector, so the hub needs no method of its own and the
// merge base's hub is measured just as this one is. It prints the readings as one JSON line, then PASS, FAIL or
// BLOCKED, and stops the hub it started by PID.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WARMUP = 100;
const EVERY = 100;
/** The issue's limits over 5,000 cycles, per 1,000 cycles, so a shorter run scales. 1 MB is 10^6 bytes. */
const HEAP_PER_1000 = 200_000;
const RSS_PER_1000 = 2_000_000;
const STEP_MS = 60_000;
/** Read now keeps a source's answer from the last 2 s, so a view is read again no sooner than this. */
const KEPT_MS = 2_100;
/** Each cycle's set of 100 names is new, drawn from these 113: so an hour's rollup holds at most 113 series. */
const POOL = Array.from({ length: 113 }, (_, i) => `n${String(i).padStart(3, '0')}`);
/** The account the stand-in agent is signed in to, and the four stores (#2650), by key: their owner and its fields. */
const ACCOUNT = '0a0a0a0a-2650-4000-8000-000000000001';
/** The prompt each cycle's change answers (#1866), with a definition handed for it, and the file its edit changes. */
const CHANGE = 'make the value module give the cycle its number';
const CHANGED = 'src/value.mjs';
const CHECK = '.deepbuild/checks/value.sh';
/** The one document each cycle shows a revision of, through deep_show (#1866). */
const DOC = '0CHVRN1866000000000000000A';
const STORES = {
  answers: { owner: 'Sources', fields: ['recorded', 'binary'], what: "the host's recorded source answers" },
  results: { owner: 'Host', fields: ['requests'], what: "the host's action results by request ID" },
  jobs: { owner: 'LocalRunner', fields: ['jobs', 'endedIds'], what: "the runner's jobs and their output" },
  names: { owner: 'SeriesStore', fields: ['names', 'namesPut'], what: "the series store's sets of names" },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => `${(bytes / 1e6).toFixed(3)} MB`;
/** A reading that can't be had, or a cycle that can't finish: BLOCKED, never PASS. */
class Blocked extends Error {}
/** What a signal must stop or remove on the way out, as a lane killed partway does. */
const leaving = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const leave of leaving) leave(); process.exit(1); });

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The hub's inspector over its WebSocket: its main thread, and each worker thread through NodeWorker. */
async function inspect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Blocked(`the inspector at ${url} refused the connection, so a full collection can't be forced`));
  });
  let n = 0;
  const waiting = new Map();
  const workers = new Map();
  const send = (method, params, session) => new Promise((resolve, reject) => {
    const id = ++n;
    // A worker gone between the call and its answer never answers.
    const timer = setTimeout(() => { waiting.delete(id); reject(new Blocked(`${method}: the inspector gave no answer`)); }, 5 * STEP_MS);
    waiting.set(id, { resolve, reject, method, timer });
    const text = JSON.stringify({ id, method, params });
    socket.send(session ? JSON.stringify({ id: ++n, method: 'NodeWorker.sendMessageToWorker', params: { sessionId: session, message: text } }) : text);
  });
  const settle = (message) => {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Blocked(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result);
  };
  /** A thread's heap snapshot as it arrives (#2650), one thread at a time. */
  let chunks = [];
  const inbound = (message) => {
    if (message.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(message.params.chunk);
    else settle(message);
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'NodeWorker.attachedToWorker') workers.set(message.params.sessionId, message.params.workerInfo.title);
    else if (message.method === 'NodeWorker.detachedFromWorker') workers.delete(message.params.sessionId);
    else if (message.method === 'NodeWorker.receivedMessageFromWorker') inbound(JSON.parse(message.params.message));
    else inbound(message);
  };
  socket.onclose = () => { for (const { reject, method, timer } of waiting.values()) { clearTimeout(timer); reject(new Blocked(`${method}: the inspector closed`)); } waiting.clear(); };
  await send('NodeWorker.enable', { waitForDebuggerOnStart: false });
  await sleep(50);
  const threads = () => [undefined, ...workers.keys()];
  const value = async (expression, session) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, includeCommandLineAPI: true }, session);
    if (exceptionDetails) throw new Blocked(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  /** A thread's timers not yet finished, found by V8's walk of its heap, which clears every inline cache in it. */
  const timersOf = async (session) => {
    const { result: proto } = await send('Runtime.evaluate', { expression: '(() => { const t = setTimeout(() => {}, 0); clearTimeout(t); return Object.getPrototypeOf(t); })()' }, session);
    const { objects } = await send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: 'churn' }, session);
    const { result } = await send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.filter((t) => !t._destroyed && t._idleTimeout >= 0).length; }', returnByValue: true }, session);
    await send('Runtime.releaseObjectGroup', { objectGroup: 'churn' }, session);
    return result.value;
  };
  return {
    close: () => socket.close(),
    /**
     * The retained heap of every thread after a full collection, and the process's resident memory. Each reading walks
     * the heap first: the inline caches a walk clears are over 1 MB of the hub's, so a reading that found them warm
     * would read them as growth over one taken after a walk (#1866).
     */
    async memory() {
      let heapBytes = 0;
      for (const session of threads()) {
        await timersOf(session);
        await send('HeapProfiler.collectGarbage', {}, session);
        await send('HeapProfiler.collectGarbage', {}, session);
        heapBytes += await value('process.memoryUsage().heapUsed', session);
      }
      const rssBytes = await value('process.memoryUsage().rss', undefined);
      if (!Number.isSafeInteger(heapBytes) || heapBytes <= 0) throw new Blocked(`the retained heap read ${heapBytes}`);
      if (!Number.isSafeInteger(rssBytes) || rssBytes <= 0) throw new Blocked(`resident memory read ${rssBytes}`);
      return { heapBytes, rssBytes };
    },
    /** Timers not yet finished, across its threads. The hub's are unref'd, so only the heap can count them. */
    async timers() {
      let count = 0;
      for (const session of threads()) count += await timersOf(session);
      return count;
    },
    /**
     * The heap each store retains (#2650), from a snapshot of each thread, the hub's core running in a worker of its
     * own: by key, summed over threads, null where no thread holds one.
     */
    async stores() {
      const sizes = Object.fromEntries(Object.keys(STORES).map((key) => [key, null]));
      for (const session of threads()) {
        chunks = [];
        await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }, session);
        const found = storeSizes(JSON.parse(chunks.join('')));
        chunks = [];
        for (const [key, bytes] of Object.entries(found)) if (bytes !== null) sizes[key] = (sizes[key] ?? 0) + bytes;
      }
      return sizes;
    },
  };
}

/**
 * Each store's retained heap in a V8 heap snapshot (#2650): what only its owner's fields reach, by the dominator tree
 * of the snapshot's strong edges (Cooper, Harvey and Kennedy's iteration over a post-order from the root). A store's
 * owner is found by its class's name and each field by its property's, so the merge base's hub is read the same way.
 */
function storeSizes(snapshot) {
  const { meta } = snapshot.snapshot;
  const { nodes, edges, strings } = snapshot;
  const NF = meta.node_fields.length;
  const EF = meta.edge_fields.length;
  const [TYPE, NAME, SELF, COUNT] = ['type', 'name', 'self_size', 'edge_count'].map((f) => meta.node_fields.indexOf(f));
  const [ETYPE, ENAME, ETO] = ['type', 'name_or_index', 'to_node'].map((f) => meta.edge_fields.indexOf(f));
  const edgeTypes = meta.edge_types[ETYPE];
  const weak = new Set([edgeTypes.indexOf('weak'), edgeTypes.indexOf('shortcut')]);
  const PROPERTY = edgeTypes.indexOf('property');
  const OBJECT = meta.node_types[TYPE].indexOf('object');
  const n = nodes.length / NF;
  const first = new Float64Array(n + 1);
  for (let i = 0, e = 0; i < n; i++) { first[i] = e; e += nodes[i * NF + COUNT] * EF; }
  first[n] = edges.length;
  // Post-order of what the root reaches by strong edges: a dominator's number is always higher than what it dominates.
  const po = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const stackNode = new Int32Array(n);
  const stackEdge = new Float64Array(n);
  const seen = new Uint8Array(n);
  let top = 0;
  let count = 0;
  stackNode[0] = 0;
  stackEdge[0] = first[0];
  seen[0] = 1;
  while (top >= 0) {
    const node = stackNode[top];
    let e = stackEdge[top];
    let deeper = false;
    for (; e < first[node + 1]; e += EF) {
      const to = edges[e + ETO] / NF;
      if (weak.has(edges[e + ETYPE]) || seen[to]) continue;
      stackEdge[top] = e + EF;
      seen[to] = 1;
      stackNode[++top] = to;
      stackEdge[top] = first[to];
      deeper = true;
      break;
    }
    if (!deeper) { po[node] = count; order[count++] = node; top--; }
  }
  // Each reached node's predecessors by strong edges, as post-order numbers.
  const predStart = new Int32Array(count + 1);
  for (let i = 0; i < n; i++) {
    if (po[i] < 0) continue;
    for (let e = first[i]; e < first[i + 1]; e += EF) { const to = edges[e + ETO] / NF; if (!weak.has(edges[e + ETYPE]) && po[to] >= 0) predStart[po[to] + 1]++; }
  }
  for (let i = 0; i < count; i++) predStart[i + 1] += predStart[i];
  const preds = new Int32Array(predStart[count]);
  const fill = predStart.slice(0, count);
  for (let i = 0; i < n; i++) {
    if (po[i] < 0) continue;
    for (let e = first[i]; e < first[i + 1]; e += EF) { const to = edges[e + ETO] / NF; if (!weak.has(edges[e + ETYPE]) && po[to] >= 0) preds[fill[po[to]]++] = po[i]; }
  }
  const root = count - 1;
  const idom = new Int32Array(count).fill(-1);
  idom[root] = root;
  const meet = (a, b) => { while (a !== b) { while (a < b) a = idom[a]; while (b < a) b = idom[b]; } return a; };
  for (let changed = true; changed;) {
    changed = false;
    for (let v = root - 1; v >= 0; v--) {
      let d = -1;
      for (let p = predStart[v]; p < predStart[v + 1]; p++) { const u = preds[p]; if (idom[u] >= 0) d = d < 0 ? u : meet(u, d); }
      if (d >= 0 && idom[v] !== d) { idom[v] = d; changed = true; }
    }
  }
  const retained = new Float64Array(count);
  for (let v = 0; v < count; v++) retained[v] = nodes[order[v] * NF + SELF];
  for (let v = 0; v < root; v++) if (idom[v] >= 0) retained[idom[v]] += retained[v];
  const sizes = Object.fromEntries(Object.keys(STORES).map((key) => [key, null]));
  for (let i = 0; i < n; i++) {
    if (nodes[i * NF + TYPE] !== OBJECT || po[i] < 0) continue;
    const owner = strings[nodes[i * NF + NAME]];
    for (const [key, store] of Object.entries(STORES)) {
      if (store.owner !== owner) continue;
      for (let e = first[i]; e < first[i + 1]; e += EF) {
        const to = edges[e + ETO] / NF;
        if (edges[e + ETYPE] !== PROPERTY || !store.fields.includes(strings[edges[e + ENAME]]) || po[to] < 0) continue;
        sizes[key] = (sizes[key] ?? 0) + retained[po[to]];
      }
    }
  }
  return sizes;
}

/** The sockets the process holds and the processes under it, from the OS. */
function fromOs(pid) {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';
  const inet = spawnSync(lsof, ['-n', '-P', '-a', '-p', String(pid), '-i', '-F', 'f'], { encoding: 'utf8' });
  const unix = spawnSync(lsof, ['-n', '-P', '-a', '-p', String(pid), '-U', '-F', 'f'], { encoding: 'utf8' });
  if (inet.error || unix.error) throw new Blocked(`lsof can't count the hub's sockets: ${(inet.error ?? unix.error).message}`);
  const count = (out) => out.split('\n').filter((line) => line.startsWith('f')).length;
  const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (table.error || table.status) throw new Blocked(`ps can't count the hub's children: ${table.error?.message ?? table.stderr}`);
  const kids = new Map();
  for (const row of table.stdout.split('\n')) {
    const [child, parent] = row.trim().split(/\s+/);
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  let children = 0;
  const under = (parent) => { for (const child of kids.get(parent) ?? []) { children++; under(child); } };
  under(String(pid));
  const sockets = count(inet.stdout) + count(unix.stdout);
  // The hub holds its own listening socket, so none read means no reading.
  if (sockets < 1) throw new Blocked('lsof counted no sockets on the hub, which listens on one');
  return { sockets, children };
}
/**
 * The least of each count over ten seconds. A reload's old process or a tick's helper comes and goes, so one reading can
 * hold one more than the hub keeps; what it left behind stays in every reading.
 */
async function openCounts(pid, inspector) {
  let least = fromOs(pid);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const next = fromOs(pid);
    least = { sockets: Math.min(least.sockets, next.sockets), children: Math.min(least.children, next.children) };
  }
  // An answer handed to a turn waits ten seconds to be shown (#906), so its timer may end a moment after them.
  let timers = await inspector.timers();
  for (let i = 0; i < 4; i++) {
    await sleep(1000);
    timers = Math.min(timers, await inspector.timers());
  }
  return { ...least, timers };
}

/** One request and its reply on a connection of its own, as deep-hook makes them. */
function hook(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('error', reject);
    // Closed before it named a role, or refused: the caller tries again until the hub's own time is up.
    sock.on('close', () => reject(Error('the hub closed the connection')));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { sock.destroy(); resolve(line); }
      }
    });
  });
}
/**
 * A connection under one role: `call` resolves with a reply, `onFrame` gets each stream frame. `to` is the hub's socket,
 * or a process that holds a connection of its own to it (#1866), its stdin and stdout the two ways.
 */
function connect(to, hello) {
  return new Promise((resolve, reject) => {
    const sock = typeof to === 'string' ? net.connect(to) : to.stdin;
    const heard = typeof to === 'string' ? sock : to.stdout;
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    const conn = {
      onFrame: () => undefined,
      call: (method, params) => within(new Promise((done) => {
        const id = `c${++n}`;
        waiting.set(id, done);
        sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      }), method),
      close: () => sock.destroy(),
    };
    heard.setEncoding('utf8');
    sock.on('error', reject);
    heard.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
        else if (line.role) { conn.role = line.role; resolve(conn); }
        else if (line.error && !line.id) reject(Error(JSON.stringify(line.error)));
        else if (line.event) conn.onFrame(line.event);
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}
const within = (promise, what) => {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Blocked(`${what}: nothing within ${STEP_MS / 1000} s`)), STEP_MS).unref(); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID now, with a counter for its random part: unique and ordered. */
function ulid() {
  let s = '';
  let value = (BigInt(Date.now()) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}

/** The package each cycle installs again: it does nothing but load, in a process of its own. */
async function churnPackage(cli, home) {
  const { packageDigest } = await import(new URL('../../extension-host/dist/index.js', `file://${cli}`).href);
  const dir = join(home, 'churn-package');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export default function (): void {}\n');
  const manifest = { id: 'bench/churn', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, checks: [] };
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  return dir;
}

/**
 * The host the stores package's sources call (#2650): HTTPS on 127.0.0.1 under a test CA the hub trusts, answering
 * /answer with 64 KB and /names with a new set of 100 of the 113 names, as JSON values by name.
 */
async function answering(home) {
  const dir = join(home, 'tls');
  mkdirSync(dir, { recursive: true });
  const cnf = join(dir, 'openssl.cnf');
  writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', '[dn]',
    '[v3_ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign', 'subjectKeyIdentifier = hash',
    '[v3_leaf]', 'basicConstraints = CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth', 'subjectAltName = IP:127.0.0.1', '',
  ].join('\n'));
  const ssl = (...args) => {
    const r = spawnSync('/usr/bin/openssl', args, { cwd: dir, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
    if (r.error || r.status) throw new Blocked(`openssl can't make the source host's test certificate: ${r.error?.message ?? r.stderr}`);
  };
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=hub-churn test CA', '-config', cnf, '-extensions', 'v3_ca');
  ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'host.key', '-out', 'host.csr', '-subj', '/CN=127.0.0.1', '-config', cnf);
  ssl('x509', '-req', '-in', 'host.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'host.pem', '-days', '2', '-extfile', cnf, '-extensions', 'v3_leaf');
  const pad = 'x'.repeat(65_536 - '{"value":0,"pad":""}'.length);
  let sets = 0;
  const server = https.createServer({ key: readFileSync(join(dir, 'host.key')), cert: readFileSync(join(dir, 'host.pem')) }, (req, res) => {
    req.resume();
    if (req.url === '/answer') return res.writeHead(200, { 'content-type': 'application/json' }).end(`{"value":${sets % 10},"pad":"${pad}"}`);
    if (req.url !== '/names') return res.writeHead(404).end();
    // Set k leaves out 13 of the 113 names, one of each pair (b, 13 + b) by k's bit b: every k under 8,192 a new set.
    const k = sets++;
    const out = new Set(Array.from({ length: 13 }, (_, b) => ((k >> b) & 1 ? b : 13 + b)));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Object.fromEntries(POOL.filter((_, i) => !out.has(i)).map((name, i) => [name, k + i]))));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { ca: join(dir, 'ca.pem'), host: `127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } };
}

/**
 * The stores package (#2650): two views, each binding a polled source on the host answering 64 KB and a series source
 * answering 100 names, and ext.stores.read_now, a read action that reads a view now. The cycles take the views in turn,
 * so each source is read every other cycle, past Read now's 2 s. Its manifest's library source names the host, which
 * is what an install grants (#1731), so the merge base's hub installs it just as this one does.
 */
async function storesPackage(cli, home, host) {
  const { packageDigest } = await import(new URL('../../extension-host/dist/index.js', `file://${cli}`).href);
  const dir = join(home, 'stores-package');
  mkdirSync(join(dir, 'panel'), { recursive: true });
  writeFileSync(join(dir, 'index.ts'), `// The churn benchmark's stores package (#2650).
const HOST = ${JSON.stringify(host)};
const QUOTA = { per_minute: 600, per_day: 100_000 };
export default async function (deep: any): Promise<void> {
  for (const i of [0, 1]) {
    await deep.registerSource('ext.stores.answer' + i, { variant: 'polled', host: HOST, path: '/answer', quota: QUOTA, timeout: 30_000, freshFor: 1_000,
      parse: (a: { status: number; body: string }) => { if (a.status !== 200) throw Error('no answer: ' + a.status); return { value: Number(JSON.parse(a.body).value), unit: 'n' }; } });
    await deep.registerSource('ext.stores.names' + i, { variant: 'polled', host: HOST, path: '/names', quota: QUOTA, timeout: 30_000, freshFor: 1_000, shape: 'series',
      parse: (a: { status: number; body: string }) => { if (a.status !== 200) throw Error('no names: ' + a.status); return { values: JSON.parse(a.body), unit: 'n' }; } });
    await deep.registerView('ext.stores.board' + i, 'panel', 'home', { binds: ['reading:ext.stores.answer' + i, 'reading:ext.stores.names' + i] });
  }
  deep.registerAction('ext.stores.read_now', {
    declares: 'read', reads: [],
    input: { type: 'object', properties: { view: { type: 'string', enum: ['ext.stores.board0', 'ext.stores.board1'] } }, required: ['view'], additionalProperties: false },
    output: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
  }, async (input: { view: string }) => ({ result: JSON.stringify(await deep.readNow(input.view)) }));
}
`);
  writeFileSync(join(dir, 'panel', 'main.js'), `// The stores view's panel: the values its view binds.
import { View, div } from "gpui-kit";
export default class Board extends View {
  render() { return div().id("board").child("stores"); }
}
`);
  const manifest = {
    id: 'bench/stores', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, access: { words: ['hosts'] }, checks: [], actions: ['ext.stores.read_now'],
    sources: [
      ...[0, 1].flatMap((i) => [{ name: `ext.stores.answer${i}`, variant: 'polled' }, { name: `ext.stores.names${i}`, variant: 'polled' }]),
      { name: 'ext.stores.files', variant: 'library', host },
    ],
    requires: { preview: ['deep.registerSource', 'deep.registerView', 'deep.readNow', 'deep.registerAction'] },
  };
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  return dir;
}

/**
 * The repo each cycle's session works in (#1866): a value module on a branch of its own, and the drafted check its
 * change is judged by. Every cycle's edit gives the module a new value, so its check runs on it and carries nothing.
 */
function repository(work) {
  const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: work, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: work, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' },
  });
  const files = {
    [CHANGED]: valueModule('none'),
    'test/value.test.mjs': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { value } from '../src/value.mjs';\n\ntest('the value module gives a value', () => assert.equal(typeof value, 'string'));\n",
    [CHECK]: 'node --test test/value.test.mjs\n',
    'package.json': `${JSON.stringify({ name: 'value', version: '1.0.0', type: 'module' })}\n`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), text);
  }
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the value module and its drafted check');
  git('checkout', '-q', '-b', 'churn');
  return git;
}
const valueModule = (value) => `export const value = '${value}';\n`;
/** The definition handed for each cycle's change (#1866): one requirement, judged by the drafted check. */
const DRAFTS = { drafts: [{ ask: CHANGE, requirements: [{ id: 'R1', text: 'The value module gives a value', source_line: 'ask#L1', refuted_by: 'a run where it gives none', check: CHECK, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] }], deliverables: [CHANGED], budget: null }] };

/** The document each cycle shows a revision of (#1866): two items, the bar a size of its own at each cycle. */
const shown = (n) => JSON.stringify({
  format: 1, profile: 'board', title: 'Churn', description: 'What the churn benchmark shows.', size: [320, 200],
  items: {
    back: { id: 'back', kind: 'rect@1', name: 'Backdrop', order: 'a0', params: { box: [0, 0, 320, 200], paint: { fill: { role: 'ground' } } } },
    bar: { id: 'bar', kind: 'rect@1', name: 'Bar', order: 'a1', params: { box: [0, 0, 1 + (n % 300), 1 + (Math.floor(n / 300) % 180)], paint: { fill: { role: 'muted' } } } },
  },
});

/** The package whose action sends (#1866): held for your answer at every call, and nothing leaves when it runs. */
async function sendsPackage(cli, home) {
  const { packageDigest } = await import(new URL('../../extension-host/dist/index.js', `file://${cli}`).href);
  const dir = join(home, 'sends-package');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), `export default function (deep: any): void {
  deep.registerAction('ext.sends.note', {
    declares: 'send',
    input: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'], additionalProperties: false },
    output: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'], additionalProperties: false },
  }, async (input: { to: string }) => ({ output: { to: input.to }, report: { verified: true, checked: 'sent nothing' } }));
}
`);
  const manifest = { id: 'bench/sends', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, access: { words: [] }, checks: [], actions: ['ext.sends.note'], requires: { preview: ['deep.registerAction'] } };
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  return dir;
}

/**
 * A killed session's agent (#1866): a process of its own the session's hooks name as their parent, which connects to the
 * hub when told to and passes lines both ways, so its MCP connection binds to its session as an agent's does.
 */
function standInSession(home, socket) {
  const file = join(home, 'agent.pl');
  if (!existsSync(file)) {
    writeFileSync(file, `use strict; use IO::Socket::UNIX; use IO::Select;
$| = 1;
my $go = <STDIN>;
exit 0 unless defined $go;
my $hub = IO::Socket::UNIX->new(Type => SOCK_STREAM, Peer => $ARGV[0]) or exit 1;
my $ready = IO::Select->new(\\*STDIN, $hub);
while (my @from = $ready->can_read) {
  for my $from (@from) {
    my $n = sysread($from, my $bytes, 65536);
    exit 0 unless $n;
    my $to = $from == $hub ? \\*STDOUT : $hub;
    while (length $bytes) { my $w = syswrite($to, $bytes); exit 0 unless $w; substr($bytes, 0, $w) = ''; }
  }
}
`);
  }
  const child = spawn('/usr/bin/perl', [file, socket], { stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdin.on('error', () => undefined);
  const gone = new Promise((resolve) => child.on('exit', resolve));
  const stop = () => child.kill('SIGKILL');
  leaving.add(stop);
  return { pid: child.pid, stdin: child.stdin, stdout: child.stdout, kill: async () => { stop(); await gone; leaving.delete(stop); } };
}

/**
 * The agent each cycle's job runs (#2650): a stand-in `claude` that gives a version its facts cover and, run headless,
 * prints 256 KB of stream-json assistant lines, then a result, and ends. Signed in to ACCOUNT under the test HOME.
 */
function standInAgent(home) {
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/perl
if (grep { $_ eq '--version' || $_ eq '-v' } @ARGV) { print "2.1.308 (Claude Code)\\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'status') { print qq({"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}\\n); exit 0; }
# What the hub asks of an agent beside a job, such as its plugin list, reads nothing from it here.
exit 0 unless grep { $_ eq '-p' } @ARGV;
{ local $/; my $prompt = <STDIN>; }
$| = 1;
my $session = sprintf('%08x-0000-4000-8000-%012x', $$, time);
print qq({"type":"system","subtype":"init","session_id":"$session","model":"claude-haiku-4-5","tools":[],"mcp_servers":[]}\\n);
for my $i (1 .. 256) {
  my $head = qq({"type":"assistant","message":{"id":"msg_$i","model":"claude-haiku-4-5","role":"assistant","content":[{"type":"text","text":");
  my $tail = qq("}],"usage":{"input_tokens":1,"output_tokens":1}},"session_id":"$session"});
  print $head, 'x' x (1023 - length($head) - length($tail)), $tail, "\\n";
}
print qq({"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"$session","total_cost_usd":0,"usage":{"input_tokens":1,"cache_read_input_tokens":0,"output_tokens":1}}\\n);
exit 0;
`);
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'hub-churn@example.invalid' }, mcpServers: {}, projects: {} })}\n`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: 'made-up', refreshToken: 'made-up', expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`);
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  return bin;
}
/** A window reading with room for ACCOUNT, so its jobs never wait for one (the runner's plan window). */
const roomy = () => {
  const now = Math.floor(Date.now() / 1000);
  return { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: now + 4 * 3600 }, seven_day: { used_percentage: 20, resets_at: now + 6 * 86_400 } } };
};

/** The fixed cycles against a hub, read through its inspector, and the hub stopped by PID. */
async function run({ cli, home, cycles, killed }) {
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const work = join(home, 'work');
  const transcripts = join(home, '.claude', 'projects', 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(transcripts, { recursive: true });
  const git = repository(work);
  const drafts = join(home, 'drafts.json');
  writeFileSync(drafts, JSON.stringify(DRAFTS));
  // The newest Claude Code version this hub's facts cover: each transcript entry carries it.
  const covered = JSON.parse(readFileSync(new URL('../../../adapters/claude-code.facts.json', `file://${cli}`), 'utf8')).versions.at(-1);
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed');
  // The source host the stores package calls, and the agent each cycle's job runs on its login PATH (#2650).
  const source = await answering(home);
  leaving.add(source.close);
  writeFileSync(join(root, 'config.json'), JSON.stringify({ runner: { login_path: `${standInAgent(home)}:/usr/bin:/bin` } }));
  // As `deep setup` does: an ask's deadline comes from these settings.
  const { draftAskSettings } = await import(new URL('../../asks/dist/index.js', `file://${cli}`).href);
  await draftAskSettings(root);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key === 'DEEP_HUB_PLANT' || !/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(key)));
  // V8's optimizing tiers keep compiling long after warm-up: about 0.7 MB over 500 cycles, as much as the leaks this looks for.
  const hub = spawn(process.execPath, ['--inspect=127.0.0.1:0', '--no-opt', '--no-maglev', '--no-sparkplug', cli, 'hub', 'run'], { cwd: work, env: { ...env, HOME: home, DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_DRAFTS: drafts, NODE_EXTRA_CA_CERTS: source.ca }, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  leaving.add(() => hub.kill('SIGTERM'));
  let stderr = '';
  hub.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  let inspector;
  const conns = [];
  try {
    const socket = join(root, 'hub.sock');
    const t0 = performance.now();
    let cliConn, app;
    for (;;) {
      try {
        const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
        app = await connect(socket, { hello: 'app', token });
        cliConn = await connect(socket, { hello: 'cli', token });
        break;
      } catch {
        if (hub.exitCode !== null) throw new Blocked(`the hub exited ${hub.exitCode}: ${stderr}`);
        if (performance.now() - t0 > STEP_MS) throw new Blocked(`the hub did not answer: ${stderr}`);
        await sleep(20);
      }
    }
    conns.push(app, cliConn);
    const url = /ws:\/\/\S+/.exec(stderr)?.[0];
    if (!url) throw new Blocked(`the hub offers no inspector, so a full collection can't be forced: ${stderr}`);
    inspector = await inspect(url);
    // A platform that can't take the reading is BLOCKED before any cycle is spent on it.
    await inspector.memory();

    let end = 0;
    for (;;) {
      const { result } = await app.call('events.read', { after: end, limit: 10_000 });
      if (!result.events.length) break;
      end = result.log_pos;
    }
    await app.call('stream.subscribe', { after: end });
    const seen = [];
    const wanted = [];
    app.onFrame = (event) => {
      const at = wanted.findIndex(({ test }) => test(event));
      if (at >= 0) wanted.splice(at, 1)[0].done(event);
      else seen.push(event);
    };
    const frame = (what, test) => {
      const at = seen.findIndex(test);
      if (at >= 0) return Promise.resolve(seen.splice(at, 1)[0]);
      return within(new Promise((done) => wanted.push({ test, done })), what);
    };
    const startOf = (pid) => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
    const parent = { pid: process.pid, start: startOf(process.pid) };
    const pkg = await churnPackage(cli, home);
    const sends = await within(cliConn.call('extension.install', { from: await sendsPackage(cli, home) }), 'the sends package\'s install');
    if (sends.error || sends.result?.status !== 'installed' || sends.result.not_loaded) throw new Blocked(`the sends package didn't load: ${JSON.stringify(sends.error ?? sends.result)}`);
    // The stores package (#2650), installed once. Its view's panel has no kit to pass where no replica is built; the
    // package still loads, and its action reads the view's sources now.
    const installed = await within(cliConn.call('extension.install', { from: await storesPackage(cli, home, source.host) }), 'the stores package\'s install');
    if (installed.error || installed.result?.status !== 'installed' || (installed.result.not_loaded && !/^ext\.stores\.board0 reads \w+ on panel@1: .*; ext\.stores\.board1 reads \w+ on panel@1: /.test(installed.result.not_loaded))) {
      throw new Blocked(`the stores package didn't load: ${JSON.stringify(installed.error ?? installed.result)}`);
    }
    const reported = await within(cliConn.call('windows.report', roomy()), 'windows.report');
    if (reported.error) throw new Blocked(`the stand-in agent's window reading was refused: ${JSON.stringify(reported.error)}`);
    /** When each view was last read now, by its number. */
    const lastRead = [-Infinity, -Infinity];
    let seq = BigInt(Date.now()) * 1_000_000n;

    const cycle = async (n) => {
      const session = randomUUID();
      const transcript = join(transcripts, `${session}.jsonl`);
      writeFileSync(transcript, '');
      // A killed session's agent is a process of its own (#1866); any other session's is this one.
      const agent = killed ? standInSession(home, socket) : { pid: process.pid };
      let prompt;
      const fire = async (event, extra = {}) => {
        const reply = await within(hook(socket, {
          v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(), pid: process.pid, ppid: agent.pid, matched: [],
          payload: { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...(prompt ? { prompt_id: prompt } : {}), ...extra },
        }), `cycle ${n}: ${event}`);
        if (reply.error) throw new Blocked(`cycle ${n}: ${event}: ${JSON.stringify(reply.error)}`);
        return reply;
      };
      /** One transcript entry, as Claude Code writes it. */
      let entryBefore = null;
      const entry = (value) => {
        const uuid = randomUUID();
        appendFileSync(transcript, `${JSON.stringify({ parentUuid: entryBefore, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: work, sessionId: session, version: covered, gitBranch: 'churn' })}\n`);
        entryBefore = uuid;
      };
      const assistant = (content, stop) => entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
      /** A prompt typed in the session, in its transcript first as Claude Code writes it. */
      const typed = async (text) => {
        prompt = randomUUID();
        entry({ promptId: prompt, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
        await fire('UserPromptSubmit', { prompt: text });
      };
      let calls = 0;
      /** One tool call with its two hooks; `asks` shows its permission prompt, and `effect` is what it does. */
      const tool = async (tool_name, tool_input, { effect, asks = false, response = { stdout: '', stderr: '', interrupted: false, isImage: false } } = {}) => {
        const call = { tool_name, tool_input, tool_use_id: `toolu_${n}_${calls++}` };
        assistant([{ type: 'tool_use', id: call.tool_use_id, name: tool_name, input: tool_input }], 'tool_use');
        await fire('PreToolUse', call);
        if (asks) await fire('PermissionRequest', { tool_name, tool_input });
        await effect?.(call.tool_use_id);
        entry({ promptId: prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: call.tool_use_id, type: 'tool_result', content: 'done' }] }, toolUseResult: response });
        await fire('PostToolUse', { ...call, tool_response: response, duration_ms: 40 });
      };
      const of = (kind) => (event) => event.kind === kind && (event.session_id ?? event.session) === session;
      seen.length = 0;
      await fire('SessionStart', { source: 'startup' });
      // One job whose agent prints 256 KB and ends (#2650). It runs beside the session's hooks, and its end is awaited
      // before the session's, so the cycle takes about as long as it did without it.
      const jobDone = (async () => {
        const job = await within(cliConn.call('job.submit', { spec: { kind: 'read', agent: 'claude-code', prompt: `Cycle ${n}: answer done.` } }), `cycle ${n}: job.submit`);
        if (job.error) throw new Blocked(`cycle ${n}: job.submit: ${JSON.stringify(job.error)}`);
        const ended = await frame(`cycle ${n}: job.ended`, (event) => event.kind === 'job.ended' && event.subject === job.result.job).catch(async (error) => {
          // What it waits on, as the runner reads it.
          const status = await within(cliConn.call('job.status', { job: job.result.job }), `cycle ${n}: job.status`).catch(() => undefined);
          throw new Blocked(`${error.message}; the job reads ${JSON.stringify(status?.result ?? status?.error)}`);
        });
        if (ended.data?.state !== 'finished') throw new Blocked(`cycle ${n}: the job didn't finish: ${JSON.stringify(ended.data)}`);
      })();
      jobDone.catch(() => undefined);
      // A change asked for, its definition handed at once (#1866): what the edit below is judged by.
      await typed(CHANGE);
      await frame(`cycle ${n}: definition.locked`, (event) => event.kind === 'definition.locked' && String(event.data?.task_ref).startsWith(`session:${session.replace(/[^0-9A-Za-z]/g, '')}#`));
      for (let i = 0; i < 7; i++) await tool('Bash', { command: `ls src/${i}` });
      // A permission prompt your saved decision covers, raised as an ask and answered by it. The first is answered in its
      // agent's terminal, offered back and saved.
      await tool('Bash', { command: 'make value' }, { asks: true });
      if (!n) {
        const { result: inbox } = await within(app.call('inbox.read', {}), 'inbox.read');
        const offer = inbox?.offers?.find((o) => o.command === 'make value');
        const saved = await within(cliConn.call('offer.save', { offer: offer?.offer }), 'offer.save');
        if (saved.error) throw new Blocked(`the prompt's yes wasn't saved as a decision: ${JSON.stringify({ inbox, error: saved.error })}`);
      }
      const path = join(work, CHANGED);
      const [from, to] = [readFileSync(path, 'utf8'), valueModule(`cycle-${n}-${session}`)];
      await tool('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, { effect: () => writeFileSync(path, to), response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false } });
      // Committed once the hub has read the head the edit left: a hook's reply comes before its reading, where an agent's
      // own call takes longer than that.
      await tool('Bash', { command: 'git commit -am value' }, { effect: async (id) => {
        await frame(`cycle ${n}: tool.before`, (event) => event.kind === 'tool.before' && event.data?.call === id);
        await sleep(50);
        git('commit', '-q', '-am', 'value');
      } });
      await frame(`cycle ${n}: commit.made`, of('commit.made'));

      if (killed) agent.stdin.write('go\n');
      const mcp = await within(connect(killed ? agent : socket, { hello: 'mcp', parent: killed ? { pid: agent.pid, start: startOf(agent.pid) } : parent, cwd: work }), `cycle ${n}: the MCP hello`);
      if (mcp.role !== `mcp:${session}`) throw new Blocked(`cycle ${n}: the MCP connection didn't bind to its session: it is ${mcp.role}`);
      // What the session and the hub do at once here overlaps, so a cycle takes the longest part and not their sum.
      const asking = async () => {
        const asked = mcp.call('mcp.call', { tool: 'deep_ask', arguments: { kind: 'choice', question: `Which header for screen ${n}?`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'a', steps: null, where: null, why: null, check: null, subject: null } });
        const refused = asked.then((reply) => { if (reply.error) throw new Blocked(`cycle ${n}: deep_ask: ${JSON.stringify(reply.error)}`); return new Promise(() => undefined); });
        const created = await Promise.race([frame(`cycle ${n}: ask.created`, (event) => of('ask.created')(event) && event.data?.kind === 'choice'), refused]);
        // In words, so it saves no decision: one you save stands until you revoke it, and a hub keeps each.
        const answer = await within(cliConn.call('ask.answer', { ask: `ask:${created.id}`, words: 'The plain one' }), `cycle ${n}: ask.answer`);
        if (answer.error) throw new Blocked(`cycle ${n}: ask.answer: ${JSON.stringify(answer.error)}`);
        await within(asked, `cycle ${n}: deep_ask`);
      };
      const reading = async () => {
        // One action call with a request ID (#2650): a read that reads one view's two sources now, the 64 KB answer and a
        // new set of 100 names. Read now keeps an answer from the last 2 s, so a view read sooner waits out the rest.
        const view = n % 2;
        await sleep(Math.max(0, KEPT_MS - (performance.now() - lastRead[view])));
        const acted = await within(mcp.call('mcp.call', { tool: 'call_action', arguments: { action: 'ext.stores.read_now', request: `churn-${n}-${randomUUID()}`, input: JSON.stringify({ view: `ext.stores.board${view}` }) } }), `cycle ${n}: call_action`);
        lastRead[view] = performance.now();
        const read = acted.result?.status === 'done' ? JSON.parse(acted.result.output?.result ?? 'null') : null;
        if (!read?.sources?.length || read.sources.some((s) => s.status !== 'read')) throw new Blocked(`cycle ${n}: the stores' sources weren't read now: ${JSON.stringify(acted.error ?? acted.result)}`);
      };
      const sending = async () => {
        // A send held for your answer (#1866), answered in words as the ask above is: your yes would be saved for the repo
        // and answer every later cycle's send.
        const held = await within(mcp.call('mcp.call', { tool: 'call_action', arguments: { action: 'ext.sends.note', request: `send-${n}-${session}`, input: JSON.stringify({ to: `cycle-${n}` }) } }), `cycle ${n}: the send`);
        if (held.result?.status !== 'held') throw new Blocked(`cycle ${n}: the send wasn't held: ${JSON.stringify(held.error ?? held.result)}`);
        const told = await within(cliConn.call('ask.answer', { ask: held.result.ask, words: 'Not yet' }), `cycle ${n}: the send's answer`);
        if (told.error) throw new Blocked(`cycle ${n}: the send's answer: ${JSON.stringify(told.error)}`);
      };
      const showing = async () => {
        // One revision of the one document (#1866).
        const drawn = await within(mcp.call('mcp.call', { tool: 'deep_show', arguments: { doc: DOC, document: shown(n), patch: null, removes: null, t: '0s', size: null, include: ['issues'], rev: null, camera: null, probes: null, sheet: null, mode: null, cursor: null, item: null, reference: null, select: null, span: null, depth: null } }), `cycle ${n}: deep_show`);
        if (drawn.result?.outcome !== 'presented') throw new Blocked(`cycle ${n}: deep_show: ${JSON.stringify(drawn.error ?? drawn.result)}`);
      };
      const checked = (async () => {
        const started = await within(app.call('run.start', { check: 'churn', claim: `claim:${ulid()}`, commit: '0'.repeat(40), argv: ['/usr/bin/true'], cwd: work }), `cycle ${n}: run.start`);
        if (started.error) throw new Blocked(`cycle ${n}: run.start: ${JSON.stringify(started.error)}`);
        await frame(`cycle ${n}: run.finished`, (event) => event.kind === 'run.finished' && event.subject === started.result.run);
      })();
      checked.catch(() => undefined);
      await Promise.all([asking(), reading(), sending(), showing()]);
      // A killed session's agent holds its connection to its end.
      if (!killed) mcp.close();

      const reloaded = (async () => {
        const installed = await within(cliConn.call('extension.install', { from: pkg }), `cycle ${n}: extension.install`);
        if (installed.error || installed.result?.status !== 'installed' || installed.result.not_loaded) throw new Blocked(`cycle ${n}: the extension didn't reload: ${JSON.stringify(installed.error ?? installed.result)}`);
      })();
      reloaded.catch(() => undefined);
      // The change is claimed at the stop, whose turn's usage its transcript holds, and judged to PASS (#1866).
      assistant([{ type: 'text', text: 'Done.' }], 'end_turn');
      await fire('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
      const claimed = await frame(`cycle ${n}: claim.made`, of('claim.made'));
      const verdict = await frame(`cycle ${n}: verdict.made`, (event) => event.kind === 'verdict.made' && event.subject === `claim:${claimed.id}` && event.data?.outcome !== 'PENDING');
      if (verdict.data?.outcome !== 'PASS') throw new Blocked(`cycle ${n}: the claim's verdict isn't PASS: ${JSON.stringify(verdict.data)}`);
      await fire('UserPromptSubmit', { prompt: 'what does the deploy say?' });
      await fire('Stop', { last_assistant_message: "I'll check the deploy again in half a second." });
      await frame(`cycle ${n}: promise.set`, of('promise.set'));
      await frame(`cycle ${n}: promise.due`, of('promise.due'));
      await fire('UserPromptSubmit', { prompt: 'and now?' });
      await frame(`cycle ${n}: promise.woken`, of('promise.woken'));

      await Promise.all([jobDone, checked, reloaded]);
      if (killed) {
        await agent.kill();
        await frame(`cycle ${n}: session.gone`, of('session.gone'));
      } else {
        await fire('SessionEnd', { reason: 'other' });
        await frame(`cycle ${n}: session.end`, of('session.end'));
      }
      rmSync(transcript, { force: true });
    };

    for (let n = 0; n < WARMUP; n++) await cycle(n);
    // Counted first: its walk of every thread's heap leaves about 20 MB resident, which a reading taken before it would
    // count as growth. The stores' snapshot walks it too.
    const afterWarmup = await openCounts(hub.pid, inspector);
    const storesFirst = await inspector.stores();
    const readings = [{ cycle: 0, ...(await inspector.memory()) }];
    for (let n = 1; n <= cycles; n++) {
      await cycle(WARMUP + n);
      if (n % EVERY !== 0) continue;
      readings.push({ cycle: n, ...(await inspector.memory()) });
      // The window reading again, so the jobs never wait on one older than its window.
      await within(cliConn.call('windows.report', roomy()), 'windows.report');
    }
    if (cycles % EVERY !== 0) readings.push({ cycle: cycles, ...(await inspector.memory()) });
    const afterLast = await openCounts(hub.pid, inspector);
    const storesLast = await inspector.stores();
    const [first, last] = [readings[0], readings.at(-1)];
    const heapGrowthBytes = last.heapBytes - first.heapBytes;
    const rssGrowthBytes = last.rssBytes - first.rssBytes;
    // Each store's growth per 1,000 cycles (#2650): null where the hub holds no such store, never 0.
    const stores = Object.fromEntries(Object.keys(STORES).map((key) => {
      const [first, last] = [storesFirst[key], storesLast[key]];
      return [key, first === null || last === null ? null : Math.round(((last - first) * 1000) / cycles)];
    }));
    return {
      bench: 'hub-churn', cycles, warmup: WARMUP, every: EVERY, readings, heapGrowthBytes, rssGrowthBytes,
      heapGrowthPer1000Bytes: Math.round((heapGrowthBytes * 1000) / cycles), rssGrowthPer1000Bytes: Math.round((rssGrowthBytes * 1000) / cycles),
      stores, open: { afterWarmup, afterLast }, killed,
    };
  } finally {
    inspector?.close();
    for (const conn of conns) conn.close();
    hub.kill('SIGTERM');
    const killing = setTimeout(() => hub.kill('SIGKILL'), 30_000);
    await exited;
    clearTimeout(killing);
    source.close();
  }
}
/** The merge base's hub through these same cycles, side by side with this one; without it there is no comparison, so BLOCKED. */
async function mergeBaseSide() {
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = git('merge-base', 'HEAD', 'origin/main');
  const copy = realpathSync(mkdtempSync('/tmp/deep-churn-base-'));
  const done = (fields) => { rmSync(copy, { recursive: true, force: true }); return { commit, ...fields }; };
  try {
    const archive = spawnSync('/usr/bin/git', ['archive', commit], { cwd: ROOT, maxBuffer: 2 ** 31 });
    execFileSync('tar', ['-xf', '-', '-C', copy], { input: archive.stdout, maxBuffer: 2 ** 31 });
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: copy, stdio: 'ignore' });
    // A first build can fail on declaration order; the second passes.
    if (spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' }).status) execFileSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' });
    // A hub starts only with a deep-hook built under its checkout, and draws only with a deep-show (#1866). Both run outside
    // the heap measured here, so the copy borrows this checkout's newest builds rather than compiling Rust.
    mkdirSync(join(copy, 'target', 'debug'), { recursive: true });
    for (const name of ['deep-hook', 'deep-show']) {
      const built = ['release', 'debug'].map((p) => join(ROOT, 'target', p, name)).filter((p) => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      if (!built) throw Error(`no ${name} is built under ${join(ROOT, 'target')} for its hub; run cargo build --bin ${name} first`);
      copyFileSync(built, join(copy, 'target', 'debug', name), constants.COPYFILE_FICLONE);
      chmodSync(join(copy, 'target', 'debug', name), 0o755);
    }
    return { copy, commit, done };
  } catch (error) {
    done({});
    throw new Blocked(`the merge base ${commit} can't be built here: ${error.message}`);
  }
}
function runBase(side, cycles) {
  // Beside the copy, never in it: a package's sandbox can't read the copy's package.json, which node looks for above it.
  const scratch = realpathSync(mkdtempSync('/tmp/deep-churn-base-home-'));
  const home = join(scratch, 'h');
  mkdirSync(home);
  const { DEEP_HUB_PLANT: _plant, ...env } = process.env;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--cli', join(side.copy, 'packages/cli/dist/main.js'), '--cycles', String(cycles), '--home', home, ...(killed ? ['--killed'] : [])], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    side.stop = () => child.kill('SIGTERM');
    leaving.add(() => { child.kill('SIGTERM'); rmSync(side.copy, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk; });
    child.on('close', () => {
      rmSync(scratch, { recursive: true, force: true });
      const line = out.split('\n').find((text) => text.startsWith('{"bench"'));
      if (!line) return resolve(side.done({ blocked: `the merge base ${side.commit} can't run the cycles: ${out.split('\n').find((text) => text.startsWith('BLOCKED')) ?? 'it printed no readings'}` }));
      const { readings, heapGrowthBytes, rssGrowthBytes, heapGrowthPer1000Bytes, rssGrowthPer1000Bytes, stores, open } = JSON.parse(line);
      resolve(side.done({ readings, heapGrowthBytes, rssGrowthBytes, heapGrowthPer1000Bytes, rssGrowthPer1000Bytes, stores, open }));
    });
  });
}

const cycles = Number(flag('cycles') ?? 5000);
const killed = process.argv.includes('--killed');
if (!Number.isSafeInteger(cycles) || cycles < 1) throw Error(`--cycles takes a whole number of cycles, not ${flag('cycles')}`);
const given = flag('home');
const home = given ?? join(realpathSync(mkdtempSync('/tmp/deep-churn-')), 'h');
mkdirSync(home, { recursive: true });
if (!given) leaving.add(() => rmSync(join(home, '..'), { recursive: true, force: true }));
let base, beside;
try {
  base = process.argv.includes('--merge-base') ? await mergeBaseSide() : undefined;
  beside = base && runBase(base, cycles);
  const line = await run({ cli: flag('cli') ?? join(ROOT, 'packages/cli/dist/main.js'), home: realpathSync(home), cycles, killed });
  if (beside) line.mergeBase = await beside;
  if (line.mergeBase?.blocked) throw new Blocked(line.mergeBase.blocked);
  console.log(JSON.stringify(line));
  const failures = [];
  const heapLimit = (HEAP_PER_1000 * cycles) / 1000;
  const rssLimit = (RSS_PER_1000 * cycles) / 1000;
  // What it left first: a leftover is the likelier cause of the growth below it.
  const { afterWarmup, afterLast } = line.open;
  for (const [key, word] of [['sockets', 'socket'], ['timers', 'timer'], ['children', 'child process']]) {
    if (afterLast[key] !== afterWarmup[key]) failures.push(`the hub holds ${afterLast[key]} of ${word} after ${cycles} cycles, against ${afterWarmup[key]} after warm-up: ${word} left behind`);
  }
  if (line.heapGrowthBytes >= heapLimit) {
    // The store that grew most (#2650), by its key, so the growth names where it went.
    const [key, most] = Object.entries(line.stores).filter(([, growth]) => growth !== null).sort(([, a], [, b]) => b - a)[0] ?? [];
    const where = !key ? '' : most > 0 ? `; the store that grew most is ${key} (${STORES[key].what}), ${mb(most)} per 1,000` : '; none of the four stores #2650 bounds grew';
    failures.push(`the hub's retained heap grew ${mb(line.heapGrowthBytes)} over ${cycles} cycles, ${mb(line.heapGrowthPer1000Bytes)} per 1,000; the limit is under ${mb(heapLimit)}${where}`);
  }
  if (line.rssGrowthBytes >= rssLimit) failures.push(`the hub's resident memory grew ${mb(line.rssGrowthBytes)} over ${cycles} cycles, ${mb(line.rssGrowthPer1000Bytes)} per 1,000; the limit is under ${mb(rssLimit)}`);
  for (const failure of failures) console.log(`FAIL hub churn: ${failure}\n  Fix: Find what keeps growing per cycle and release it when its session, ask or extension ends.`);
  if (failures.length) process.exitCode = 1;
  else console.log(`PASS hub churn: over ${cycles} cycles the retained heap grew ${mb(line.heapGrowthBytes)} and resident memory ${mb(line.rssGrowthBytes)}`);
} catch (error) {
  if (!(error instanceof Blocked)) throw error;
  console.log(`BLOCKED hub churn: ${error.message}\n  Fix: Run it where Node's inspector can force a full collection and read resident memory, and the hub answers.`);
  process.exitCode = 1;
} finally {
  // A run that stopped early stops the merge base's beside it, and waits while that removes its copy.
  base?.stop?.();
  await beside;
  if (!given) rmSync(join(home, '..'), { recursive: true, force: true });
}
