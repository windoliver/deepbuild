// One run of the hub's core in a Node process of its own, with nothing listening for unhandled rejections, so Node's
// default holds: one ends the process with status 1, its stack on stderr. Each step is one JSON line on stdout.
//
//   HOME=<temp home> node hub-run.mjs <temp folder>
//
// The core is the one the hub runs: `createCore` from the hub's build (packages/hub/dist/hub-runtime.js), on a fresh
// root with its real record. It meets one session the way the hub meets one whose hook it missed: a SessionStart line,
// as deep-hook writes it, in the root's spool, so the log holds events to page through.
//
// The one thing stood in is SQLite's binding (better-sqlite3), a boundary the hub doesn't own: once `events.read` has
// replied with a page, the read of the page after it (a read of `events` bound to that page's log_pos and its limit)
// fails once, as a disk's read does. Every other read, before and after, is the real one.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
const LIMIT = 2;
const say = (step, more = {}) => process.stdout.write(`${JSON.stringify({ step, ...more })}\n`);
/** One turn of the event loop: every immediate set before it has run, and a rejection nothing handled has been reported. */
const turn = () => new Promise((done) => setImmediate(done));
/** Resolves with `p`'s value, or null when `ms` pass first. */
const within = (p, ms) => {
  let timer;
  return Promise.race([p, new Promise((done) => { timer = setTimeout(done, ms, null); })]).finally(() => clearTimeout(timer));
};

// ---- SQLite's binding: the next page's read fails once, when armed.
const Database = createRequire(import.meta.url)('better-sqlite3');
const probe = new Database(':memory:');
const Statement = Object.getPrototypeOf(probe.prepare('SELECT 1'));
probe.close();
const all = Statement.all;
/** Set once `events.read` has replied: the page to fail the read of, and whom to tell. */
let armed;
Statement.all = function (...params) {
  if (armed && /\bFROM events\b/.test(this.source) && params.length === 2 && Number(params[0]) === armed.after && Number(params[1]) === LIMIT) {
    const { failed } = armed;
    armed = undefined;
    failed();
    throw Object.assign(new Error('disk I/O error (planted by tests/acceptance/1841: the read of the next page)'), { code: 'SQLITE_IOERR' });
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
const projects = join(process.env.HOME, '.claude', 'projects', 'dh1841');
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
// The spooled session is replayed as the core starts: wait until the log holds more than one page of it.
let held = 0;
for (const end = Date.now() + 30_000; held <= LIMIT && Date.now() < end;) {
  held = (await read({ after: 0, limit: 1000 })).events.length;
  if (held <= LIMIT) await new Promise((done) => setTimeout(done, 50));
}
if (held <= LIMIT) {
  say('blocked', { why: `the log held ${held} events 30 s after the core started, not the ${LIMIT + 1} two pages need` });
  process.exit(3);
}
await turn();

// ---- events.read replies with the first page; then the read of the page after it fails.
const first = await read({ after: 0, limit: LIMIT });
// Still in the turn of the reply: nothing has run since it.
const failed = new Promise((done) => { armed = { after: first.log_pos, failed: () => done(true) }; });
say('replied', { log_pos: first.log_pos, events: first.events.length });
if ((await within(failed, 30_000)) === null) {
  say('blocked', { why: `no read of the page after log_pos ${first.log_pos} within 30 s of the reply` });
  process.exit(3);
}
say('next-page-read-failed', { after: first.log_pos });
await turn();
await turn();
say('alive');

// ---- The hub keeps answering.
const again = await read({ after: first.log_pos, limit: LIMIT });
say('answered', { method: 'events.read', after: first.log_pos, log_pos: again.log_pos, events: again.events.length, kinds: again.events.map((e) => e.kind) });
const health = await core.call('health', {}, { role: 'cli' });
say('answered', { method: 'health', keys: Object.keys(health ?? {}).length });
// The last read's own next page is read before the record closes.
await turn();
await turn();
await core.stop('test');
say('stopped');
process.exit(0);
