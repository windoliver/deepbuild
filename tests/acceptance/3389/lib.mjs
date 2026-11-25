// #3389 acceptance: what the test files share. The hub, its socket, its hooks and its read log are #2646's
// (../2646/lib.mjs), imported, not copied; here are the seeded record, a connection under another role, the list a record
// holds, and what a read of the read log gives of which sessions.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { openRecord } from '@deepbuild/record';
import { rawOf, settled, ulid, until } from '../2646/lib.mjs';

export * from '../2646/lib.mjs';

export const HOUR = 3_600_000;
/** A session's handle holds its ID's letters and digits. */
export const letters = (session) => session.replace(/[^0-9A-Za-z]/g, '');
/** The n-th session's ID: a UUID, as Claude Code's are, its first eight digits its own. */
export const sessionId = (n) => `3389${String(n).padStart(4, '0')}-0000-4000-8000-000000003389`;
export const ledgerOf = (home) => join(home, '.deepbuild', 'ledger.db');

/**
 * A record made before any hub opens it, through @deepbuild/record: `make(add)` appends to it with
 * `add(kind, v, ts, data, { writer, session, subject, id })`, which gives the event's ID.
 */
export async function seed(home, make) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  let now = 0, n = 0;
  const record = await openRecord({ path: ledgerOf(home), now: () => now });
  try {
    await make(async (kind, v, ts, data, { writer = 'core', session, subject, id = ulid(ts, ++n) } = {}) => {
      now = Math.max(now, ts);
      const stamped = /^(user\.ask|agent\.stop|tool\.)/.test(kind) ? { seq: `${BigInt(ts) * 1_000_000n + BigInt(n)}` } : {};
      await record.append({ writer, actor: 'you', scope: 'you', ...(session ? { session, agent: 'claude-code' } : {}) }, { v, id, kind, ts, data, ...stamped, ...(subject ? { subject } : {}) });
      return id;
    });
  } finally {
    await record.close();
  }
}
/**
 * One session that started, took a prompt, made a call, stopped and ended: its status, its state and its row's word read
 * `finished`. `during` adds what its turn made, before its stop.
 */
export async function endedSession(add, session, at, during = async () => undefined) {
  const own = { writer: 'hook', session };
  await add('session.start', 1, at, { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session }, own);
  // Its prompt names its row, and no two are alike.
  await add('user.ask', 1, at + 1000, { msg: 0, text: `say what value ${session.slice(0, 8)} is`, tasks: [], from: 'person' }, own);
  for (const kind of ['tool.before', 'tool.after']) await add(kind, 1, at + 2000, { kind: 'shell', paths: [], command: 'ls src' }, own);
  await during(at + 3000);
  await add('agent.stop', 1, at + 4000, { turn: 1, did_work: true }, { ...own, subject: `session:${letters(session)}` });
  await add('session.end', 1, at + 5000, { reason: 'exit' }, own);
}

/** One call on a connection of its own, under the role `hello` takes, which must answer to the name `bound`: its result. */
const called = (hub, hello, method, params, bound = hello.hello) => new Promise((done, fail) => {
  const sock = net.connect(hub.socket);
  const refused = (why) => { sock.destroy(); fail(Error(`BLOCKED: ${method} as ${bound}: ${why}`)); };
  let buffer = '';
  sock.setEncoding('utf8').on('error', (error) => refused(error.message)).on('close', () => refused('the hub closed the connection')).on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (line.hello) sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
      else if (line.role === bound) sock.write(`${JSON.stringify({ v: 1, id: 'call', method, params })}\n`);
      else if (line.id !== 'call' || line.error) refused(JSON.stringify(line));
      else {
        done(line.result);
        sock.destroy();
      }
    }
  });
});
/** A process and when it started, as the hub's peer check names one. */
export const peerOf = (pid) => ({ pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim() });
/** A method called with the control token, as the app or the CLI; `peer` names the calling process where the hub wants one. */
export const own = (hub, role, method, params = {}, peer = undefined) => called(hub, { hello: role, token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim(), ...(peer ? { peer } : {}) }, method, params);
/** One deep_* call of the one live session whose agent is this process's parent, as ../2646/lib.mjs's hooks say it is. */
export const tool = (hub, session, name, args) => called(hub, { hello: 'mcp', parent: peerOf(process.ppid), cwd: join(hub.home, 'work') }, 'mcp.call', { tool: name, arguments: args }, `mcp:${session}`);

/** The newest session.state of each session, and the `rows` table, as the record's file holds them. */
export function listed(db) {
  const states = Object.fromEntries(db.prepare("SELECT session_id AS id, json_extract(data, '$.state') || '/' || json_extract(data, '$.cause') AS state FROM events WHERE kind = 'session.state' AND log_pos IN (SELECT max(log_pos) FROM events WHERE kind = 'session.state' GROUP BY session_id)").all().map((r) => [r.id, r.state]));
  const rows = Object.fromEntries(db.prepare('SELECT id, ord, row FROM rows').all().map((r) => [r.id, { order: r.ord, ...JSON.parse(r.row) }]));
  return { states, rows };
}

/**
 * The sessions of `ids` whose state a logged read gives. A pass that reads a session's state has to read what the state
 * is decided from or compared with: its status, its recorded state, its row. Every session of `ids` reads `finished` in
 * all three and never changes, so a read gives one's state when it holds a row that says `finished`, and that row, the
 * read's SQL or a value bound to it names the session. However the hub words its reads, each is run again on the file.
 */
export function given(db, entry, ids) {
  let rows = [];
  try {
    if (entry.via === 'raw') {
      const { sql, params } = rawOf(entry);
      rows = db.prepare(sql).all(...params);
    } else if (entry.via === 'table') rows = db.prepare(`SELECT * FROM "${String(JSON.parse(entry.query)[0]).replace(/"/g, '')}"`).all();
  } catch { /* no read of the record's tables */ }
  const said = rows.map((row) => JSON.stringify(row)).filter((row) => /(?<![\w.])finished(?![\w.])/.test(row));
  return said.length ? ids.filter((id) => String(entry.query).includes(id) || said.some((row) => row.includes(id))) : [];
}

/**
 * Waits until two seconds pass with no new event and, given the hub, no state pass due: asked by inbox.read, which waits
 * for one and then reads the list, so never where the read log is judged.
 */
export async function quiet(db, hub) {
  const head = db.prepare('SELECT max(log_pos) AS pos FROM events');
  let pos = -1, since = Date.now();
  await until(async () => {
    if (hub) await settled(hub);
    const now = head.get().pos;
    if (now !== pos) [pos, since] = [now, Date.now()];
    return Date.now() - since > 2000;
  }, 180_000, 'BLOCKED: the hub never went two seconds without an append');
}
