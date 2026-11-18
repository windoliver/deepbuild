// #2646 acceptance: one side's own code, in a process of its own. node probe.mjs <action> <checkout> <json>
// loads <checkout>'s record and asks core through their package entries (@deepbuild/record, @deepbuild/asks, as that
// checkout's node_modules resolve them), does one thing and prints one JSON line. The tests run it once per side, so
// the merge base's record is seeded and read by the merge base's code and the change's by the change's.
//   seed-asking   { dir }                   criterion 1's record: 200,000 events, one live session of 20,000 with three undelivered asks
//   ask-check     { dir, sql, params, rusage, runs }   the ask check's read on that record: its rows, and the instructions `runs` more of it retire
//   seed-month    { ledger, clock }         criterion 3's record: 30 days of history, no live session, one promise that falls due
//   seed-sixteen  { ledger, clock }         criterion 4's record: #16's 30-day history, and one ask
//   asks-open     { ledger, now }           the asks core opened on a record as a hub's start opens it: the events it decoded, by kind
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [action, checkout, json] = process.argv.slice(2);
const input = JSON.parse(json ?? '{}');
const from = createRequire(join(checkout, 'package.json'));
const entry = (name) => import(pathToFileURL(from.resolve(name)).href);
const { openRecord } = await entry('@deepbuild/record');
const { askSources, openAsks } = await entry('@deepbuild/asks');

const DAY = 86_400_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let made = 0;
/** A ULID at `ms`, counted, so every run makes the same IDs. */
function ulid(ms) {
  let text = '', value = (BigInt(ms) << 80n) | BigInt(++made);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
let sequenced = 0;
const seq = (ms) => (BigInt(ms) * 1_000_000n + BigInt(++sequenced % 1_000_000)).toString();
const hooked = (session) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
const core = (session) => ({ writer: 'core', actor: 'you', scope: 'you', session, agent: 'claude-code' });
const taste = askSources().find((row) => row.kind === 'taste');
/** The taste row's fixture ask, made distinct by `n`, open until `deadline`. */
function ask(n, deadline) {
  const { deadline: _deadline, default: _default, ...data } = structuredClone(taste.fixture.ask);
  return { ...data, question: `Which header for screen ${n}?`, key: createHash('sha256').update(`taste:${n}`).digest('hex'), deadline, default: taste.fixture.ask.recommended };
}
const start = (record, session, at) => record.append(hooked(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } });
const tool = (record, session, at, k) => record.append(hooked(session), { v: 1, id: ulid(at), kind: k % 2 === 0 ? 'tool.before' : 'tool.after', ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } });
const count = async (record, sql, params = []) => Number((await record.raw(sql, params))[0].n);

/** One session as #16's seedHistory makes it: a start, then ten turns of a prompt, 13 tool events and a stop, a second apart. Returns its last event's time. */
async function sixteenSession(record, session, at) {
  const pending = [start(record, session, at)];
  for (let t = 0; t < 10; t++) {
    at += 1000;
    pending.push(record.append(hooked(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
    for (let k = 0; k < 13; k++) {
      at += 1000;
      pending.push(tool(record, session, at, k));
    }
    at += 1000;
    pending.push(record.append(hooked(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } }));
  }
  await Promise.all(pending);
  return at;
}
/** #16's 30 days of heavy use ending at `end`: 20 sessions a day, about 3,000 events a day. Returns the newest session and its last event's time. */
async function sixteenHistory(record, clock, end) {
  let last;
  for (let d = 0; d < 30; d++) {
    const dayStart = end - (30 - d) * DAY;
    for (let s = 0; s < 20; s++) {
      const session = ulid(dayStart), at = dayStart + s * 600_000;
      clock.now = at;
      last = { session, at: await sixteenSession(record, session, at) };
    }
  }
  return last;
}

const actions = {
  async 'seed-asking'({ dir }) {
    const T0 = 1_760_013_451_000, clock = { now: T0 };
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => clock.now });
    const deadline = T0 + 400 * DAY;
    let at = T0, asked = 0;
    // 299 ended sessions hold 180,000 events between them, 1,000 undelivered asks among the first 250.
    const tools = 180_000 - 299 * 2 - 1000;
    for (let s = 0; s < 299; s++) {
      const session = ulid(at), pending = [start(record, session, at)];
      clock.now = at;
      for (let k = 0; k < Math.floor(tools / 299) + (s < tools % 299 ? 1 : 0); k++) pending.push(tool(record, session, ++at, k));
      for (let a = 0; a < (s < 250 ? 4 : 0); a++) pending.push(record.append(core(session), { v: 5, id: ulid(++at), kind: 'ask.created', ts: at, data: ask(++asked, deadline) }));
      pending.push(record.append(hooked(session), { v: 1, id: ulid(++at), kind: 'session.end', ts: at, data: { reason: 'exit' } }));
      await Promise.all(pending);
      at += 1000;
    }
    // The live session: 20,000 events, three of them its undelivered asks, and no end.
    const live = ulid(at), asks = [];
    clock.now = at;
    let pending = [start(record, live, at)];
    for (let a = 0; a < 3; a++) {
      asks.push(ulid(++at));
      pending.push(record.append(core(live), { v: 5, id: asks[a], kind: 'ask.created', ts: at, data: ask(++asked, deadline) }));
    }
    for (let k = 0; k < 20_000 - 4; k++) {
      pending.push(tool(record, live, ++at, k));
      if (pending.length >= 1000) { await Promise.all(pending); pending = []; }
    }
    await Promise.all(pending);
    const out = {
      events: await count(record, 'SELECT count(*) AS n FROM events'), live, asks,
      liveEvents: await count(record, 'SELECT count(*) AS n FROM events WHERE session_id = ?', [live]),
      sessions: await count(record, "SELECT count(*) AS n FROM events WHERE kind = 'session.start'"),
      ended: await count(record, "SELECT count(*) AS n FROM events WHERE kind = 'session.end' AND unverified = 0"),
      open: await count(record, "SELECT count(*) AS n FROM asks WHERE status = 'open' AND session_id IS NOT NULL"),
    };
    await record.close();
    return out;
  },

  async 'ask-check'({ dir, sql, params, rusage, runs }) {
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => Date.now() });
    const rows = await record.raw(sql, params);
    const read = () => {
      const result = spawnSync(rusage, [String(process.pid)], { encoding: 'utf8' });
      const value = Number(String(result.stdout).trim());
      return result.status === 0 && Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    let instructions = null;
    if (rusage) {
      const before = read();
      for (let i = 0; i < runs; i++) await record.raw(sql, params);
      const after = read();
      instructions = before === null || after === null ? null : after - before;
    }
    await record.close();
    return { rows, instructions };
  },

  async 'seed-month'({ ledger, clock: T }) {
    const clock = { now: T - 32 * DAY };
    const record = await openRecord({ path: ledger, now: () => clock.now });
    // #16's history, a day further back, so that each of its sessions was last seen more than a day before T.
    await sixteenHistory(record, clock, T - 60_000 - DAY);
    // One session whose last stop is a day old 30.5 minutes after T: its state changes with time alone, between
    // minutes 30 and 31.
    clock.now = T - DAY + 30.5 * 60_000 - 150_000;
    const crossing = ulid(clock.now);
    await sixteenSession(record, crossing, clock.now);
    // One session, two hours old, that promised a check due a minute before T, which no hub has yet found due.
    clock.now = T - 2 * 3_600_000 - 150_000;
    const promised = ulid(clock.now);
    const at = await sixteenSession(record, promised, clock.now) + 1000;
    clock.now = at;
    await record.append(core(promised), { v: 1, id: ulid(at), kind: 'promise.set', ts: at, data: { promise: ulid(at), quote: 'I will check the deploy again in a while.', due: T - 60_000, times_set: 1, end: T + DAY } });
    const out = { crossing, promised, sessions: await count(record, 'SELECT count(*) AS n FROM sessions'), events: await count(record, 'SELECT count(*) AS n FROM events') };
    await record.close();
    return out;
  },

  async 'seed-sixteen'({ ledger, clock: T }) {
    const clock = { now: T - 31 * DAY };
    const record = await openRecord({ path: ledger, now: () => clock.now });
    const last = await sixteenHistory(record, clock, T - 60_000);
    // One ask the newest session raised after its last tool call: #16's history holds none.
    const at = last.at + 1000, id = ulid(at);
    clock.now = at;
    await record.append(core(last.session), { v: 5, id, kind: 'ask.created', ts: at, data: ask(1, T + 30 * DAY) });
    const kinds = Object.fromEntries((await record.raw('SELECT kind, count(*) AS n FROM events GROUP BY kind')).map((row) => [row.kind, Number(row.n)]));
    const out = { ask: id, session: last.session, kinds, head: await count(record, 'SELECT max(log_pos) AS n FROM events') };
    await record.close();
    return out;
  },

  async 'asks-open'({ ledger, now }) {
    const record = await openRecord({ path: ledger, now: () => now });
    // The record the core is given counts every event a read hands it: each is a row decoded into an event.
    const decoded = {};
    const counting = new Proxy(record, {
      get(target, name) {
        const value = Reflect.get(target, name, target);
        if (typeof value !== 'function') return value;
        if (name !== 'read') return value.bind(target);
        return async (query) => {
          const page = await target.read(query);
          for (const event of page) decoded[event.kind] = (decoded[event.kind] ?? 0) + 1;
          return page;
        };
      },
    });
    const asks = await openAsks({ record: counting, now: () => now, deliver: () => undefined });
    const inbox = (await asks.inbox()).length;
    await record.close();
    return { decoded, inbox };
  },
};

if (!actions[action]) throw Error(`no action ${action}`);
console.log(JSON.stringify(await actions[action](input), (_key, value) => (typeof value === 'bigint' ? Number(value) : value)));
