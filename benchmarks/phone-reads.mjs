// A phone's reads, for the perf lane's count budgets (issue #1576): node benchmarks/phone-reads.mjs.
// It seeds records of 200 and of 1,000 sessions (5 at work, each with an open ask; the rest stopped, 50 of them with an
// ask you answered), starts the hub on each and counts the bytes of a cold open (the app's hello, inbox.read and
// sessions.read on a new connection), how much they grow from the smaller record to the larger, and the queries of a
// reconnect on the larger (the same reads again, by their `queries`). Then it plays the first
// turn of the recorded session adapters/corpus/claude-code/2.1.308/tools on a hub with an empty record and counts the
// frames and bytes that session's page gets after it is caught up. It prints them as one JSON line; every number is a
// count, never a time, so load can't void it. DEEP_HUB_PLANT, if set, reaches both hubs. It stops only the hubs it
// started, by PID, and removes only its own temp folder.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSources, openAsks } from '../packages/asks/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const CORPUS = fileURLToPath(new URL('../adapters/corpus/claude-code/2.1.308/tools/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique and ordered. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const seqAt = (ms) => `${BigInt(ms) * 1_000_000n + counter++}`;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-phone-bench-')));
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => (!k.startsWith('DEEP_') || k === 'DEEP_HUB_PLANT') && !k.startsWith('CLAUDE')));

/** `sessions` sessions in `home`'s ledger, seeded with no hub running. */
async function seed(home, sessions) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  let now = Date.now() - 6 * 3_600_000;
  const record = await openRecord({ path: join(home, '.deepbuild', 'ledger.db'), now: () => now });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  const source = askSources().find((row) => row.source === 'deep_ask.choice');
  const ask = (n, deadline) => ({ ...structuredClone(source.fixture.ask), question: `Keep the store of item ${String(n).padStart(6, '0')} on SQLite or plain files?`, key: sha256(`phone ${n}`), deadline });
  const who = (writer, session) => ({ writer, actor: 'you', scope: 'you', session, project: 'shop', ...(writer === 'hook' ? { agent: 'claude-code' } : {}) });
  const start = (session) => record.append(who('hook', session), { v: 1, id: ulidAt(now), kind: 'session.start', ts: now, seq: seqAt(now), data: { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: session } });
  try {
    const settled = Array.from({ length: sessions - 5 }, () => randomUUID());
    await Promise.all(settled.map(start));
    // An ask answered in 50 of the stopped sessions, spread evenly.
    const every = Math.floor(settled.length / 50);
    for (const [i, session] of settled.entries()) {
      if ((i + 1) % every || i >= every * 50) continue;
      now += 1;
      await asks.answer({ writer: 'app', actor: 'you', scope: 'you' }, await asks.raise(who('core', session), source.source, ask(i, now + 86_400_000)), { option: 'files' });
    }
    now += 1;
    await Promise.all(settled.map((session) => record.append(who('hook', session), { v: 1, id: ulidAt(now), kind: 'agent.stop', subject: `session:${session.replace(/-/g, '')}`, ts: now, seq: seqAt(now), data: { turn: 1, did_work: false } })));
    for (let i = 0; i < 5; i++) {
      now += 1;
      const session = randomUUID();
      await start(session);
      await asks.raise(who('core', session), source.source, ask(900_000 + i, now + 7 * 86_400_000));
    }
  } finally {
    await record.close();
  }
}

/** A connection to the hub: every line it sends, with its bytes, and a call that resolves with its reply. */
function connect(home) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(home, '.deepbuild', 'hub.sock'));
    const lines = [];
    const waiting = new Map();
    let pending = [];
    let n = 0;
    const conn = {
      lines,
      call: (method, params = {}) => new Promise((done, fail) => {
        const id = `p${++n}`;
        waiting.set(id, { done, fail });
        sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      }),
      close: () => sock.destroy(),
    };
    // A hub that stops answering ends the connection, and every call on it fails, so nothing waits forever.
    sock.setTimeout(120_000, () => sock.destroy(Error('the hub stopped answering')));
    const ended = (error) => {
      reject(error);
      for (const { fail } of waiting.values()) fail(error);
      waiting.clear();
    };
    sock.on('error', ended);
    sock.on('close', () => ended(Error('the hub closed the connection')));
    sock.on('data', (chunk) => {
      for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10)) {
        const raw = Buffer.concat([...pending, chunk.subarray(0, at)]);
        pending = [];
        chunk = chunk.subarray(at + 1);
        const line = JSON.parse(raw.toString('utf8'));
        lines.push({ bytes: raw.length + 1, line });
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) resolve(conn);
        else if (waiting.has(line.id) && ('result' in line || 'error' in line)) { waiting.get(line.id).done(line); waiting.delete(line.id); }
      }
      if (chunk.length) pending.push(chunk);
    });
  });
}

/** The hub on `home`, once it answers and `method` reflects the same log_pos twice a second apart: nothing it appends by itself is still to come. */
async function start(home) {
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...base, HOME: home, LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const t0 = Date.now();
  for (;;) {
    try {
      await settled(home, 'inbox.read');
      return hub;
    } catch (error) {
      if (hub.exitCode !== null || Date.now() - t0 > 600_000) throw Error(`the hub did not start: ${error}`);
      await sleep(200);
    }
  }
}
async function settled(home, method) {
  const conn = await connect(home);
  try {
    for (let end = -1; ;) {
      const reply = await conn.call(method);
      if (!reply.result) throw Error(`${method} was refused: ${JSON.stringify(reply.error)}`);
      if (reply.result.log_pos === end) return;
      end = reply.result.log_pos;
      await sleep(1000);
    }
  } finally {
    conn.close();
  }
}
async function stop(hub) {
  const exited = new Promise((resolve) => hub.once('exit', resolve));
  hub.kill('SIGTERM');
  await exited;
}

/** A cold open's bytes, every line the hub sent on a new connection; and each read's reply. */
async function coldOpen(home) {
  const conn = await connect(home);
  try {
    const replies = [await conn.call('inbox.read'), await conn.call('sessions.read')];
    return { bytes: conn.lines.reduce((sum, l) => sum + l.bytes, 0), replies };
  } finally {
    conn.close();
  }
}

/** The recorded first turn, its SessionStart first, sent as deep-hook sends it; the frames and bytes its session's page got. */
async function turn(home) {
  const events = readFileSync(join(CORPUS, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).payload);
  const payloads = events.slice(0, events.findIndex((e) => e.hook_event_name === 'Stop') + 1);
  const session = payloads[0].session_id;
  const cwd = join(home, 'work');
  mkdirSync(cwd, { recursive: true });
  const transcript = join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  // That turn's transcript: its first six lines, through the turn's last reply.
  writeFileSync(transcript, `${readFileSync(join(CORPUS, 'transcript.jsonl'), 'utf8').split('\n').slice(0, 6).join('\n')}\n`);
  const send = async (payload) => {
    const at = Date.now();
    const sock = net.connect(join(home, '.deepbuild', 'hub.sock'));
    // The hub's hello, then the request; its reply ends on a line with `exit`, or a refusal.
    const replied = await new Promise((resolve, reject) => {
      let buffer = '';
      sock.setEncoding('utf8');
      sock.on('error', reject);
      sock.on('data', (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const line = JSON.parse(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
          if (line.hello) sock.write(`${JSON.stringify({ v: 1, agent: 'claude-code', event: payload.hook_event_name, seq: seqAt(at), id: ulidAt(at), matched: [], payload: { ...payload, cwd, transcript_path: transcript }, pid: process.pid, ppid: process.ppid })}\n`);
          else if ('exit' in line || 'error' in line) resolve(line);
        }
      });
    });
    sock.destroy();
    if (!('exit' in replied)) throw Error(`the hub refused the turn's ${payload.hook_event_name}: ${JSON.stringify(replied)}`);
    await settled(home, 'status.read');
  };
  await send(payloads[0]);
  const page = await connect(home);
  try {
    const end = (await page.call('status.read')).result.log_pos;
    const reply = await page.call('stream.subscribe', { after: end, scope: { kind: 'session', session } });
    if (!reply.result) throw Error(`the page's subscribe was refused: ${JSON.stringify(reply.error)}`);
    for (const t0 = Date.now(); !page.lines.some(({ line }) => line.id === reply.id && 'caught_up' in line);) {
      if (Date.now() - t0 > 60_000) throw Error("the page's subscribe was never caught up");
      await sleep(50);
    }
    const mark = page.lines.findIndex(({ line }) => line.id === reply.id && 'caught_up' in line) + 1;
    for (const payload of payloads.slice(1)) await send(payload);
    await sleep(1000);
    const frames = page.lines.slice(mark).filter(({ line }) => line.id === reply.id && !('result' in line));
    return { frames: frames.length, bytes: frames.reduce((sum, f) => sum + f.bytes, 0) };
  } finally {
    page.close();
  }
}

try {
  const fewer = join(dir, 'fewer');
  await seed(fewer, 200);
  let hub = await start(fewer);
  const small = await coldOpen(fewer);
  await stop(hub);
  const listed = join(dir, 'listed');
  await seed(listed, 1000);
  hub = await start(listed);
  const open = await coldOpen(listed);
  const again = await coldOpen(listed);
  await stop(hub);
  const queries = again.replies.map((r) => r.result?.queries);
  const empty = join(dir, 'empty');
  mkdirSync(empty);
  hub = await start(empty);
  const t = await turn(empty);
  await stop(hub);
  console.log(JSON.stringify({
    coldOpenBytes: open.bytes,
    coldOpenGrowthPercent: Math.round((open.bytes / small.bytes - 1) * 10_000) / 100,
    reconnectQueries: queries.every(Number.isSafeInteger) ? queries.reduce((a, b) => a + b, 0) : null,
    turnFrames: t.frames,
    turnBytes: t.bytes,
  }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
