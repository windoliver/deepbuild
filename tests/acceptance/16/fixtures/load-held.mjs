// The scripted sessions of the AC19 redraft, in a process of their own so the timings don't share an event
// loop with the test; the 16 MB call goes from a child process of its own, so building and writing it never
// holds this process's loop either.
//   node load-held.mjs <socket> <spec file>
//   spec: { sessions: [{id, cwd, transcript}], hooks: 1000, intervalMs: 50,
//           big: { session: 0, at: 8, bytes: 16777216, forms: ["<each printed form of the value>"], command: "<the call's command>" } }
//
// Why it is shaped this way. The hub writes its hello on accept, and a hook client sends its request only
// after reading it; a hub whose event loop is held can't accept, so a client that connects during the hold
// only sends once the hold is over, and its request is read at once: timed from the write, it is never late.
// The requests a held loop delays are the ones already sent on a connection the hub greeted, waiting unread.
// So each session keeps its next connection open and greeted ahead of time (it connects and reads the hello
// as soon as its previous hook is answered), then writes its request at its scheduled time. Sessions are
// staggered evenly, so some session writes a request every intervalMs / sessions ms; whenever a hold starts,
// every session whose time falls inside it has already been greeted and writes into it, and the request sits
// unread until the hold ends. writeAt is the moment the request could first be read.
//
// Each session first sends its SessionStart (untimed), then its share of the PreToolUse hooks. Session
// `big.session`, when it reaches its hook number `big.at`, sends one PostToolUse through the child and waits
// for its reply before going on, as an agent waits on its PostToolUse hook; every other session keeps sending
// across it. All times are ms since the epoch, from performance.timeOrigin + performance.now() in each
// process. Prints one JSON line: { hooks: [...], big: {...}, starts: [ids] }.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const base32 = (v, n) => { let s = ''; for (let i = 0; i < n; i++) { s = CROCKFORD[Number(v & 31n)] + s; v >>= 5n; } return s; };
const ulid = () => base32(BigInt(Date.now()), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
let counter = 0n;
const seq = () => { counter = (counter + 1n) % 1_000_000n; return (BigInt(Date.now()) * 1_000_000n + counter).toString(); };
function request(s, event, extra = {}) {
  const payload = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
  return { v: 1, agent: 'claude-code', event, seq: seq(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload };
}

/** A connection that reads lines; `hello` resolves with the hub's first line, `answer` with the ack and the reply. */
function connect(socket, timeoutMs) {
  const c = { openAt: now(), helloAt: null, ackAt: null, replyAt: null, end: null, error: undefined };
  const sock = net.connect(socket);
  let buffer = '';
  let onHello, onEnd;
  c.hello = new Promise((r) => (onHello = r));
  c.answer = new Promise((r) => (onEnd = r));
  const finish = (end) => { if (c.end) return; c.end = end; clearTimeout(timer); sock.destroy(); onHello(false); onEnd(c); };
  let timer = setTimeout(() => finish('timeout'), timeoutMs);
  c.restart = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish('timeout'), ms); };
  c.sock = sock;
  c.finish = finish;
  sock.setEncoding('utf8');
  sock.on('error', (e) => finish(`error:${e.code}`));
  sock.on('close', () => finish('close'));
  sock.on('data', (chunk) => {
    const at = now();
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (c.helloAt === null) { c.helloAt = at; onHello(true); continue; }
      let json;
      try { json = JSON.parse(raw); } catch { json = {}; }
      if (json && typeof json === 'object' && 'ack' in json && c.ackAt === null) c.ackAt = at;
      if (json && typeof json === 'object' && ('exit' in json || 'error' in json)) {
        c.replyAt = at;
        if ('error' in json) c.error = json.error;
        finish('reply');
        return;
      }
    }
  });
  return c;
}
const timings = (c) => ({ openAt: c.openAt, helloAt: c.helloAt, ackAt: c.ackAt, replyAt: c.replyAt, end: c.end, ...(c.error !== undefined && { error: c.error }) });

const [first, ...rest] = process.argv.slice(2);

if (first === '--big') {
  // The child: builds the 16 MB call before it says ready, sends it on "go", reports when it is answered.
  const [socket, specFile] = rest;
  const spec = JSON.parse(readFileSync(specFile, 'utf8'));
  const s = spec.sessions[spec.big.session];
  const filler = 'build output line that says nothing in particular, again and again\n';
  const forms = spec.big.forms;
  const room = spec.big.bytes - forms.reduce((n, f) => n + f.length, 0);
  const piece = Math.floor(room / (forms.length + 1));
  const pad = (n) => filler.repeat(Math.ceil(n / filler.length) + 1).slice(0, n);
  let stdout = pad(piece);
  for (const f of forms) stdout += f + pad(piece);
  stdout += pad(spec.big.bytes - stdout.length);
  const r = request(s, 'PostToolUse', {
    tool_name: 'Bash', tool_use_id: `call_${randomUUID()}`,
    tool_input: { command: spec.big.command },
    tool_response: { stdout, stderr: '', interrupted: false },
  });
  r.pid = process.pid;
  r.ppid = process.ppid;
  const line = Buffer.from(`${JSON.stringify(r)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ready: true, id: r.id, outputBytes: Buffer.byteLength(stdout), lineBytes: line.length })}\n`);
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', async () => {
    const c = connect(socket, 120_000);
    const greeted = await c.hello;
    let writeStart = null;
    let writeEnd = null;
    if (greeted) {
      writeStart = now();
      c.sock.write(line, () => { writeEnd = now(); });
    }
    await c.answer;
    process.stdout.write(`${JSON.stringify({ id: r.id, session: s.id, bytes: Buffer.byteLength(stdout), writeStart, writeEnd, ...timings(c) })}\n`, () => process.exit(0));
  });
} else {
  const socket = first;
  const spec = JSON.parse(readFileSync(rest[0], 'utf8'));
  const sessions = spec.sessions;

  // The child that sends the large call; this process waits for it to be built.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--big', socket, rest[0]], { stdio: ['pipe', 'pipe', 'inherit'] });
  const childLines = [];
  const childWaiters = [];
  let childBuffer = '';
  child.stdout.setEncoding('utf8').on('data', (d) => {
    childBuffer += d;
    let i;
    while ((i = childBuffer.indexOf('\n')) >= 0) {
      const json = JSON.parse(childBuffer.slice(0, i));
      childBuffer = childBuffer.slice(i + 1);
      const waiter = childWaiters.shift();
      if (waiter) waiter(json); else childLines.push(json);
    }
  });
  const childLine = () => (childLines.length ? Promise.resolve(childLines.shift()) : new Promise((r) => childWaiters.push(r)));
  const built = await childLine();

  const starts = [];
  for (const s of sessions) {
    const r = request(s, 'SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    const c = connect(socket, 20_000);
    if (await c.hello) c.sock.write(`${JSON.stringify(r)}\n`);
    await c.answer;
    starts.push({ id: r.id, end: c.end });
  }

  const hooks = [];
  let big = null;
  const perSession = sessions.map((_, k) => Array.from({ length: spec.hooks }, (_, i) => i).filter((i) => i % sessions.length === k).length);
  await Promise.all(sessions.map(async (s, k) => {
    await sleep((k * spec.intervalMs) / sessions.length);
    let due = now();
    for (let n = 0; n < perSession[k]; n++) {
      if (k === spec.big.session && n === spec.big.at) {
        child.stdin.write('go\n');
        big = { ...(await childLine()), built };
        due = now();
      }
      // Greeted ahead of time: connect and read the hello now, write the request when it is due.
      const c = connect(socket, 20_000);
      const r = request(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: `ls src/${n}` }, tool_use_id: `call_${randomUUID()}` });
      const greeted = await c.hello;
      let writeAt = null;
      if (greeted) {
        await sleep(due - now());
        c.restart(20_000);
        writeAt = now();
        c.sock.write(`${JSON.stringify(r)}\n`);
      }
      await c.answer;
      hooks.push({ id: r.id, session: s.id, n, writeAt, ...timings(c) });
      due = Math.max(now(), (writeAt ?? now()) + spec.intervalMs);
    }
  }));
  child.stdin.end();
  process.stdout.write(`${JSON.stringify({ hooks, big, starts })}\n`);
}
