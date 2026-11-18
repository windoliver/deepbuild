// Seeds one of #2646's fixture records through a checkout's own `@deepbuild/record`, as a hub's record is written:
//   node seed.mjs '{"checkout": "<checkout>", "shape": "ask-check" | "history" | "asks", "path": "<ledger.db>", "at": <ms>}'
// The packages are resolved by name from the checkout it seeds for, so the merge base's record is made by the merge
// base. Its last stdout line is JSON: what the record holds, for the test that reads it. README: Fixtures.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { checkout, shape, path, at } = JSON.parse(process.argv[2]);
const from = createRequire(join(checkout, 'package.json'));
const entry = (name) => import(pathToFileURL(from.resolve(name)).href);
const { openRecord } = await entry('@deepbuild/record');
const { askSources } = await entry('@deepbuild/asks');

const DAY = 86_400_000, MINUTE = 60_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique, ordered, and the same on every run. */
function ulidAt(ms) {
  let text = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i += 1) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const letters = (id) => id.replace(/[^0-9A-Za-z]/g, '');
const sessionId = (group, n) => `2646${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;

let now = at;
const record = await openRecord({ path, now: () => now });
const kinds = {};
let pending = [];
let stamps = 0;
/** Appends one event as `writer` for `session`; flushed in batches, in order. */
function put(writer, session, kind, ts, data, more = {}) {
  now = ts;
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  const id = more.id ?? ulidAt(ts);
  const seq = writer === 'hook' && kind !== 'session.start' ? { seq: (BigInt(ts) * 1_000_000n + BigInt(++stamps % 1_000_000)).toString() } : {};
  pending.push(record.append({ writer, actor: 'you', scope: 'you', session, agent: 'claude-code' }, { v: more.v ?? 1, id, kind, ts, ...seq, ...(more.subject ? { subject: `session:${letters(session)}` } : {}), data }));
  return id;
}
const flush = async () => { await Promise.all(pending); pending = []; };
const start = (session, ts) => put('hook', session, 'session.start', ts, { agent: 'claude-code', worktree: '/nowhere/shop', branch: 'main', thread: session });
const prompt = (session, ts, msg = 0) => put('hook', session, 'user.ask', ts, { msg, text: 'run the tests and fix what fails', tasks: [], from: 'person' });
const call = (session, ts, kind, k = 0) => put('hook', session, kind, ts, { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` });
const stop = (session, ts, turn = 1) => put('hook', session, 'agent.stop', ts, { turn, did_work: true }, { subject: true });
/** A stop as agent.stop@4 records one that ended on an error: its cause, and who can clear it. */
const failedStop = (session, ts, cause, owner) => put('hook', session, 'agent.stop', ts, { turn: 1, did_work: true, claim: false, cause, usage: null, outcome: 'failed', ...(owner ? { signature: `sig:${sha256(`${cause}:${session}`).slice(0, 16)}`, owner } : {}) }, { v: 4, subject: true });
const taste = askSources().find((row) => row.kind === 'taste').fixture.ask;
/**
 * An open taste ask of `session`, raised by the core, made distinct by `n`: its deadline 30 days on unless given. The
 * fixture's subject is left out: ask.created@1 holds none.
 */
function ask(session, ts, n, deadline = at + 30 * DAY) {
  const { deadline: _deadline, default: _default, subject: _subject, ...data } = structuredClone(taste);
  return put('core', session, 'ask.created', ts, { ...data, question: `Which header for screen ${n}?`, key: sha256(`taste:2646:${n}`), pinned_to: { kind: 'evidence', ref: sha256(`screen 2646 ${n}`) }, deadline, default: taste.recommended });
}
/**
 * #16's 30 days (tests/acceptance/16/budgets.test.ts, seedHistory): 20 sessions a day of ten turns, about 3,000 events
 * a day, each session a start, then ten turns of a prompt, 13 tool events and a stop. The newest day starts at `end - DAY`.
 */
async function month(end) {
  const sessions = [];
  for (let d = 0; d < 30; d += 1) {
    for (let s = 0; s < 20; s += 1) {
      const session = sessionId('0000', d * 20 + s);
      sessions.push(session);
      let ts = end - (30 - d) * DAY + s * 600_000;
      start(session, ts);
      for (let t = 0; t < 10; t += 1) {
        prompt(session, ts += 1000, t);
        for (let k = 0; k < 13; k += 1) call(session, ts += 1000, k % 2 === 0 ? 'tool.before' : 'tool.after', k);
        stop(session, ts += 1000, t + 1);
      }
      await flush();
    }
  }
  return sessions;
}

const shapes = {
  // Criterion 1: 200,000 events; one live session of 20,000 events holding three undelivered asks; every other session ended.
  async 'ask-check'() {
    const ended = async (from, to, since) => {
      for (let n = from; n < to; n += 1) {
        const session = sessionId('e000', n);
        let ts = since + (n - from) * 3_600_000;
        start(session, ts);
        for (let k = 0; k < 598; k += 1) call(session, ts += 1000, k % 2 === 0 ? 'tool.before' : 'tool.after', k);
        put('hook', session, 'session.end', ts += 1000, { reason: 'other' });
        await flush();
      }
    };
    // 150 ended sessions, the live one, 150 more: 300 x 600 events and 20,000, in the log's order and in time's.
    await ended(0, 150, at - 20 * DAY);
    const live = sessionId('11fe', 1);
    const asks = [];
    let ts = at - 13 * DAY;
    start(live, ts);
    for (let k = 0; k < 19_996; k += 1) {
      call(live, ts += 1000, k % 2 === 0 ? 'tool.before' : 'tool.after', k % 50);
      if (k === 4_999 || k === 9_999 || k === 14_999) asks.push(ask(live, ts += 1, asks.length));
      if (k % 500 === 499) await flush();
    }
    await flush();
    await ended(150, 300, at - 12 * DAY);
    return { live, asks };
  },
  // Criterion 3: 30 days of history, every session of it quiet at `at`, and no live session; three sessions the clock
  // alone moves in the first ten minutes after `at`, and one whose promise fell due an hour before it. The test's
  // hub starts its clock half an hour before `at` and is stepped to each minute after it.
  async history() {
    const sessions = await month(at - DAY);
    const [finished, working, waiting, promised] = ['f000', 'a000', 'b000', 'c000'].map((group) => sessionId(group, 1));
    // Its turn stopped 24 h less 4.5 minutes before `at`: finished until minute 4, quiet from minute 5.
    let ts = at - DAY + 4.5 * MINUTE - 4000;
    start(finished, ts); prompt(finished, ts += 1000); call(finished, ts += 1000, 'tool.before'); call(finished, ts += 1000, 'tool.after'); stop(finished, ts += 1000);
    // Last seen at work 24 h less 9.5 minutes before `at`: working until minute 9, quiet from minute 10.
    ts = at - DAY + 9.5 * MINUTE - 2000;
    start(working, ts); prompt(working, ts += 1000); call(working, ts += 1000, 'tool.before');
    // A permission prompt showing since 3.5 minutes before `at`: needs you at minute 1, quiet from minute 2.
    ts = at - 3.5 * MINUTE - 3000;
    start(waiting, ts); prompt(waiting, ts += 1000); call(waiting, ts += 1000, 'tool.before');
    put('hook', waiting, 'permission.request', ts += 1000, { kind: 'tool', tool: 'Bash', command: 'npm test', paths: [] }, { subject: true });
    // A check promised three days back for an hour before `at`: it falls due as the hub starts.
    ts = at - 3 * DAY;
    start(promised, ts); prompt(promised, ts += 1000); call(promised, ts += 1000, 'tool.before'); call(promised, ts += 1000, 'tool.after'); stop(promised, ts += 1000);
    const promise = ulidAt(ts += 1000);
    put('core', promised, 'promise.set', ts, { promise, quote: "I'll look again in the morning.", due: at - 60 * MINUTE, times_set: 1, end: at - 60 * MINUTE + DAY }, { id: promise, subject: true });
    await flush();
    return { sessions: sessions.length + 4, finished, working, waiting, promised };
  },
  // Criterion 4: #16's 30-day record, four sessions more that give the asks core an ask, a task and a stop to read,
  // and then, as the hub that ran on it last left it, the state it read for each session of the month: 600
  // session.state events, a kind the asks core applies none of, and the newest the core wrote.
  async asks() {
    const sessions = await month(at);
    const [held, open, blocked, cut] = ['a5c0', 'a5c1', 'a5c2', 'a5c3'].map((group) => sessionId(group, 1));
    let ts;
    // Raised by a turn that hadn't read a message you typed, read by its next tool call, and not raised again by the
    // turn's stop: it no longer stands (#84). A core that never reads the tool.before keeps it held.
    ts = at - 9 * MINUTE;
    start(held, ts); prompt(held, ts += 1000);
    const missed = ask(held, ts += 1000, 'held', at + DAY);
    call(held, ts += 1000, 'tool.before'); stop(held, ts += 1000);
    // An ask nothing closes. Its deadline is a day on, inside its kind's wait, so the time the hub was down moves it.
    ts = at - 8 * MINUTE;
    start(open, ts);
    const standing = ask(open, ts += 1000, 'open', at + DAY);
    // A stop only you can clear: the core raises its task.
    ts = at - 7 * MINUTE;
    start(blocked, ts); prompt(blocked, ts += 1000); failedStop(blocked, ts += 1000, 'rate_limited', 'you');
    // A stop that passes by itself, inside the window a continue may start in: the core continues the session.
    ts = at - 2 * MINUTE;
    start(cut, ts); prompt(cut, ts += 1000); failedStop(cut, ts += 1000, 'timed_out');
    await flush();
    ts = at - MINUTE;
    for (const session of sessions) put('core', session, 'session.state', ts += 1, { state: 'quiet', cause: 'quiet' }, { v: 2, subject: true });
    await flush();
    return { held, open, blocked, cut, missed: `ask:${missed}`, standing: `ask:${standing}` };
  },
};

if (!shapes[shape]) throw Error(`no shape ${shape}`);
const made = await shapes[shape]();
await flush();
await record.close();
console.log(JSON.stringify({ path, shape, at, events: Object.values(kinds).reduce((sum, n) => sum + n, 0), kinds, ...made }));
