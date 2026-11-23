// One run of the hub's core in a Node process of its own. Each step is one JSON line on stdout.
//
//   HOME=<temp home> node page-read-fails.mjs <temp folder>
//
// The core is the one the hub runs: `createCore` from the hub's build (packages/hub/dist/hub-runtime.js), on a fresh
// root with its real record. It meets one session through a SessionStart line in the root's spool, as deep-hook writes
// it, so the log holds events to page through.
//
// The one thing stood in is SQLite's binding (better-sqlite3), a boundary the hub doesn't own. Once `events.read` has
// replied with a page, the next read of `events` whose first bound value is that page's `log_pos` and which binds the
// page's limit (however many other values the statement binds) throws once, as a disk's read does: that is the read
// of the page after the one replied. Every other read, before and after, is the real one.
//
// The process records each unhandled rejection it sees (step `unhandled`, with its message and stack) instead of
// dying of it, so the test reads what was recorded and whether the hub went on answering.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
const LIMIT = 2;
const WAIT_MS = 120_000;
const say = (step, more = {}) => process.stdout.write(`${JSON.stringify({ step, ...more })}\n`);
/** One turn of the event loop: every immediate set before it has run, and a rejection nothing handled has been reported. */
const turn = () => new Promise((done) => setImmediate(done));
const within = (p, ms) => {
  let timer;
  return Promise.race([p, new Promise((done) => { timer = setTimeout(done, ms, null); })]).finally(() => clearTimeout(timer));
};

process.on('unhandledRejection', (reason) => {
  say('unhandled', { message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? String(reason.stack) : '' });
});

// ---- SQLite's binding: the read of the page after the replied one fails once, when armed.
const Database = createRequire(new URL('../../../../packages/record/package.json', import.meta.url))('better-sqlite3');
const probe = new Database(':memory:');
const Statement = Object.getPrototypeOf(probe.prepare('SELECT 1'));
probe.close();
const all = Statement.all;
let armed;
Statement.all = function (...params) {
  if (armed && /\bFROM\s+events\b/i.test(this.source) && params.length >= 2 && Number(params[0]) === armed.after && params.slice(1).some((p) => Number(p) === LIMIT)) {
    const { failed } = armed;
    armed = undefined;
    failed(params.length);
    throw Object.assign(new Error('disk I/O error (planted by tests/acceptance/1841-redraft-ac1: the read of the next page)'), { code: 'SQLITE_IOERR' });
  }
  return all.apply(this, params);
};

// ---- A session in the spool, and the core started on a fresh root.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let s = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) s = CROCKFORD[Number(t & 31n)] + s;
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}
const session = randomUUID();
const root = join(dir, 'deepbuild');
const repo = join(dir, 'repo');
const projects = join(process.env.HOME, '.claude', 'projects', 'dh1841r');
for (const d of [join(root, 'spool'), repo, projects]) mkdirSync(d, { recursive: true });
const transcript = join(projects, `${session}.jsonl`);
writeFileSync(transcript, '');
writeFileSync(join(root, 'spool', 'spool.jsonl'), `${JSON.stringify({
  v: 1, agent: 'claude-code', event: 'SessionStart', seq: String(BigInt(Date.now()) * 1_000_000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
  payload: { session_id: session, transcript_path: transcript, cwd: repo, hook_event_name: 'SessionStart', source: 'startup' },
})}\n`);

const { createCore } = await import(new URL('../../../../packages/hub/dist/hub-runtime.js', import.meta.url).href);
const core = createCore({ root, clock: { start: Date.now(), real: Date.now() }, held: [] }, () => undefined);
await core.started();
say('started');

const read = async (params) => {
  const page = await core.call('events.read', params, { role: 'cli' });
  return { log_pos: page.log_pos, events: JSON.parse(page.events) };
};
// The spooled session is replayed as the core starts: wait until the log holds more than one page.
let log = [];
for (const end = Date.now() + WAIT_MS; log.length <= LIMIT && Date.now() < end;) {
  log = (await read({ after: 0, limit: 1000 })).events;
  if (log.length <= LIMIT) await new Promise((done) => setTimeout(done, 100));
}
if (log.length <= LIMIT) {
  say('blocked', { why: `the log held ${log.length} events ${WAIT_MS / 1000} s after the core started, not the ${LIMIT + 1} two pages need` });
  process.exit(3);
}
await turn();
await turn();

// ---- events.read replies with the first page; then the read of the page after it fails.
const first = await read({ after: 0, limit: LIMIT });
// Still in the turn of the reply: no immediate set by it has run yet.
const failed = new Promise((done) => { armed = { after: first.log_pos, failed: (bound) => done(bound) }; });
say('replied', { log_pos: first.log_pos, events: first.events.map((e) => e.log_pos) });
const bound = await within(failed, WAIT_MS);
if (bound === null) {
  say('blocked', { why: `no read of the page after log_pos ${first.log_pos} was made within ${WAIT_MS / 1000} s of the reply, so no failure was injected` });
  process.exit(3);
}
say('next-page-read-failed', { after: first.log_pos, bound });
// Node reports a rejection nothing handled once the turn that made it ends.
await turn();
await turn();
await new Promise((done) => setTimeout(done, 50));
say('settled');

// ---- The hub keeps answering: the page whose read failed, and the next.
const again = await read({ after: first.log_pos, limit: LIMIT });
say('answered', { after: first.log_pos, log_pos: again.log_pos, events: again.events.map((e) => e.log_pos) });
// What the log holds now, to judge the page against.
log = (await read({ after: 0, limit: 1000 })).events;
say('log', { log_pos: log.map((e) => e.log_pos) });
const health = await core.call('health', {}, { role: 'cli' });
say('health', { answered: health !== undefined && health !== null });
await turn();
await turn();
await core.stop('test');
say('stopped');
process.exit(0);
