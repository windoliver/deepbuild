// #1868 acceptance: this checkout's own record, in a process of its own. node probe.mjs <action> <checkout> <json>
// loads <checkout>'s record and asks core through their package entries (@deepbuild/record, @deepbuild/asks, as that
// checkout's node_modules resolve them), seeds a record no hub has opened yet, and prints one JSON line. Every event is
// appended through the record's own `append`, as the hub's core appends it, in batches. IDs are counted, so every run
// makes the same record but for its times, which end a minute before `now`.
//   seed-canvas  { ledger, now, readings, asks }       criterion 1's record: `readings` reading.recorded events and `asks` asks
//   seed-world   { ledger, now, session, worktree }    criterion 2's record: one session with an open ask, and one reading
//   seed-runs    { ledger, now, session, worktree, runEvents }   criterion 3's record: `runEvents` run events, 200 of them the runs of the session's 10 claims
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [action, checkout, json] = process.argv.slice(2);
const input = JSON.parse(json ?? '{}');
const from = createRequire(join(checkout, 'package.json'));
const entry = (name) => import(pathToFileURL(from.resolve(name)).href);
const { openRecord } = await entry('@deepbuild/record');
const { askSources } = await entry('@deepbuild/asks');

const DAY = 86_400_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let made = 0;
/** A ULID at `at`, counted, so every run makes the same IDs for the same times. */
function ulid(at) {
  let text = '', value = (BigInt(at) << 80n) | BigInt(++made);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
const you = { actor: 'you', scope: 'you' };
const hooked = (session) => ({ writer: 'hook', ...you, session, agent: 'claude-code' });
const core = (session) => ({ writer: 'core', ...you, ...(session ? { session, agent: 'claude-code' } : {}) });
const agent = (session) => ({ writer: `mcp:${session}`, ...you, session, agent: 'claude-code' });
const taste = askSources().find((row) => row.kind === 'taste');
/** The version this checkout's record takes its taste row's fixture ask at: @6 once the fixture declares what may answer it (#1581), @5 before. */
const ASK_V = 'may_answer' in taste.fixture.ask ? 6 : 5;
/** The taste row's fixture ask, made distinct by `n`, open until `deadline`. */
function ask(n, deadline) {
  const { deadline: _deadline, default: _default, ...data } = structuredClone(taste.fixture.ask);
  return { ...data, question: `Which header for screen ${n}?`, key: createHash('sha256').update(`taste:${n}`).digest('hex'), deadline, default: taste.fixture.ask.recommended };
}
const count = async (record, sql, params = []) => Number((await record.raw(sql, params))[0].n);
async function open(ledger, clock) {
  mkdirSync(dirname(ledger), { recursive: true, mode: 0o700 });
  return openRecord({ path: ledger, now: () => clock.now });
}
/** Appends in batches of 1,000, as the hub's writer batches. */
function batcher() {
  let pending = [];
  return {
    async add(promise) { pending.push(promise); if (pending.length >= 1000) { await Promise.all(pending); pending = []; } },
    async flush() { await Promise.all(pending); pending = []; },
  };
}
const start = (record, session, at, worktree) => record.append(hooked(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } });
const end = (record, session, at) => record.append(hooked(session), { v: 1, id: ulid(at), kind: 'session.end', ts: at, data: { reason: 'exit' } });
/** One reading as the hub's sources and its gate record one: a name of its own, written by the core for no session. */
function reading(record, at, value, source) {
  const id = ulid(at);
  return { handle: `reading:${id}`, done: record.append(core(), { v: 1, id, kind: 'reading.recorded', ts: at, data: { reading: `reading:${id}`, value, unit: 'count', as_of: at, source, n: 1, outside: false } }) };
}
const SOURCES = Array.from({ length: 20 }, (_, i) => `fixture source ${i + 1}`);

const actions = {
  // 30 days ending a minute before `now`: 250 ended sessions, 20 asks each, and the readings spread evenly over the
  // days. Each ask but its session's last is answered, as most of a month's asks are; the last stays open.
  async 'seed-canvas'({ ledger, now, readings, asks }) {
    const from = now - 30 * DAY - 60_000, clock = { now: from };
    const record = await open(ledger, clock);
    const batch = batcher();
    const sessions = asks / 20, step = Math.floor((30 * DAY) / readings), perSession = Math.floor(readings / sessions);
    const every = Math.max(1, Math.floor(perSession / 20));
    let at = from, written = 0;
    for (let s = 0; s < sessions; s++) {
      const session = ulid(at);
      clock.now = at;
      await start(record, session, at, '/work/shop');
      for (let k = 0; k < perSession + (s === sessions - 1 ? readings - perSession * sessions : 0); k++) {
        at += step;
        await batch.add(reading(record, at, ++written, SOURCES[written % SOURCES.length]).done);
        if (k % every === 0 && k / every < 20) {
          const n = s * 20 + k / every, id = ulid(at);
          await batch.add(record.append(core(session), { v: ASK_V, id, kind: 'ask.created', ts: at, data: ask(n, now + 30 * DAY) }));
          if (n % 20 !== 19) await batch.add(record.append(core(session), { v: 1, id: ulid(at + 1), kind: 'ask.answered', ts: at + 1, subject: `ask:${id}`, data: { answer: taste.fixture.ask.recommended, plan_hash: null, decision: 'none' } }));
        }
      }
      await batch.flush();
      await end(record, session, ++at);
    }
    const out = {
      readings: await count(record, "SELECT count(*) AS n FROM events WHERE kind = 'reading.recorded'"),
      asks: await count(record, 'SELECT count(*) AS n FROM asks'),
      open: await count(record, "SELECT count(*) AS n FROM asks WHERE status IN ('open', 'later')"),
      events: await count(record, 'SELECT count(*) AS n FROM events'),
    };
    await record.close();
    return out;
  },

  // One session, an hour old, with an ask of its own still open, and one reading no session owns.
  async 'seed-world'({ ledger, now, session, worktree }) {
    const clock = { now: now - 3_600_000 };
    const record = await open(ledger, clock);
    let at = clock.now;
    await start(record, session, at, worktree);
    const id = ulid(++at);
    await record.append(core(session), { v: ASK_V, id, kind: 'ask.created', ts: at, data: ask(1, now + 3 * DAY) });
    const old = reading(record, ++at, 3, SOURCES[0]);
    await old.done;
    const out = { ask: `ask:${id}`, reading: old.handle, option: taste.fixture.ask.recommended, state: (await record.raw('SELECT status FROM asks WHERE id = ?', [id]))[0]?.status ?? null };
    await record.close();
    return out;
  },

  // `runEvents` run events (a run.started and a run.finished a run). The session made 10 claims, each with 10 finished
  // runs, five of each of two checks: 200 run events, the same in every record this seeds. The rest are the runs of
  // other, ended sessions' claims, 10 claims a session and 10 runs a claim, all older than the session's.
  async 'seed-runs'({ ledger, now, session, worktree, runEvents }) {
    const others = (runEvents - 200) / 20;
    if (!Number.isInteger(others) || others < 0) throw Error(`runEvents must be 200 plus a multiple of 20, got ${runEvents}`);
    const from = now - 30 * DAY - 60_000, spread = Math.max(1, Math.floor((29 * DAY) / Math.max(1, runEvents))), clock = { now: from };
    const record = await open(ledger, clock);
    const batch = batcher();
    let at = from;
    const commit = (n) => createHash('sha1').update(`commit ${n}`).digest('hex');
    const claim = async (owner, n, step) => {
      const id = ulid(++at);
      await batch.add(record.append(agent(owner), { v: 1, id, kind: 'claim.made', ts: at, data: { task_ref: `task:${ulid(at)}`, attempt: 1, commit: commit(n), scope: 'session' } }));
      for (let r = 0; r < 10; r++) {
        const run = `run:${ulid(at += step)}`, check = r % 2 ? 'lint' : 'unit';
        await batch.add(record.append(core(owner), { v: 1, id: ulid(at), kind: 'run.started', ts: at, subject: run, data: { run, check, claim: `claim:${id}`, commit: commit(n) } }));
        await batch.add(record.append(core(owner), {
          v: 1, id: ulid(at += step), kind: 'run.finished', ts: at, subject: run,
          data: { run, outcome: r % 5 === 4 ? 'failed' : 'passed', tests_run: 12, passed: r % 5 === 4 ? 11 : 12, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'darwin-arm64' },
        }));
      }
      return `claim:${id}`;
    };
    for (let c = 0; c < others; c++) {
      if (c % 10 === 0) {
        if (c) { await batch.flush(); await end(record, clock.session, ++at); }
        clock.session = ulid(++at);
        clock.now = at;
        await start(record, clock.session, at, '/work/shop');
      }
      await claim(clock.session, c, spread);
    }
    await batch.flush();
    if (others) await end(record, clock.session, ++at);
    // The session under test: started an hour before `now`, its 10 claims the newest in the record.
    at = Math.max(at + 1, now - 3_600_000);
    clock.now = at;
    await start(record, session, at, worktree);
    const claims = [];
    for (let c = 0; c < 10; c++) claims.push(await claim(session, others + c, 1000));
    await batch.flush();
    const out = {
      claims,
      runEvents: await count(record, "SELECT count(*) AS n FROM events WHERE kind IN ('run.started', 'run.finished')"),
      own: await count(record, "SELECT count(*) AS n FROM events WHERE kind IN ('run.started', 'run.finished') AND session_id = ?", [session]),
      events: await count(record, 'SELECT count(*) AS n FROM events'),
    };
    await record.close();
    return out;
  },
};

if (!actions[action]) throw Error(`no action ${action}`);
console.log(JSON.stringify(await actions[action](input), (_key, value) => (typeof value === 'bigint' ? Number(value) : value)));
