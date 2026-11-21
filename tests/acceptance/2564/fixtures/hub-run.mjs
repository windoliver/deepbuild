// One run of the hub's core in a Node process of its own, with nothing listening for unhandled rejections, so Node's
// default holds: one ends the process with status 1, its stack on stderr. Each step is one JSON line on stdout.
//
//   HOME=<temp home> node hub-run.mjs <temp folder>
//
// The core is the one the hub runs: `createCore` from the hub's build (packages/hub/dist/hub-runtime.js), on a fresh
// root with its real record, its frames taken by the `emit` the hub's worker hands it. It meets one session the way
// the hub meets one whose hook it missed: a SessionStart line, as deep-hook writes it, in the root's spool, so the log
// holds events to stream. One subscriber subscribes as the server's `stream.subscribe` asks the core to: unscoped, as
// the app subscribes, after log_pos 0.
//
// The one thing stood in is SQLite's binding (better-sqlite3), a boundary the hub doesn't own: the subscriber's page
// read in a flush (a read of `events` bound to the subscriber's last log_pos, 0, and the flush's turn of 128 events)
// fails once, as a disk's read does. Every other read, before and after, is the real one.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
/** The events a flush reads for one subscriber in its turn (log-reads.ts's TURN). */
const TURN = 128;
const SUB = 'c1:1';
const say = (step, more = {}) => process.stdout.write(`${JSON.stringify({ step, ...more })}\n`);
/** One turn of the event loop: every immediate set before it has run, and a rejection nothing handled has been reported. */
const turn = () => new Promise((done) => setImmediate(done));
/** Resolves with `p`'s value, or null when `ms` pass first. */
const within = (p, ms) => {
  let timer;
  // deadline: only bounds a wait for an event, turning a hang into a BLOCKED step
  return Promise.race([p, new Promise((done) => { timer = setTimeout(done, ms, null); })]).finally(() => clearTimeout(timer));
};

// ---- SQLite's binding: the subscriber's page read fails once, when armed.
const Database = createRequire(import.meta.url)('better-sqlite3');
const probe = new Database(':memory:');
const Statement = Object.getPrototypeOf(probe.prepare('SELECT 1'));
probe.close();
const all = Statement.all;
/** Set just before the subscribe: the subscriber's last log_pos whose page read to fail, and whom to tell. */
let armed;
Statement.all = function (...params) {
  if (armed && /\bFROM events\b/.test(this.source) && params.length === 2 && Number(params[0]) === armed.after && Number(params[1]) === TURN) {
    const { failed } = armed;
    armed = undefined;
    failed();
    throw Object.assign(new Error('disk I/O error (planted by tests/acceptance/2564: the subscriber\'s page read in a flush)'), { code: 'SQLITE_IOERR' });
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
const projects = join(process.env.HOME, '.claude', 'projects', 'dh2564');
for (const d of [join(root, 'spool'), repo, projects]) mkdirSync(d, { recursive: true });
const transcript = join(projects, `${session}.jsonl`);
writeFileSync(transcript, '');
writeFileSync(join(root, 'spool', 'spool.jsonl'), `${JSON.stringify({
  v: 1, agent: 'claude-code', event: 'SessionStart', seq: String(BigInt(Date.now()) * 1_000_000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
  payload: { session_id: session, transcript_path: transcript, cwd: repo, hook_event_name: 'SessionStart', source: 'startup' },
})}\n`);

/** The frames the core emitted, in order: what the server would write to the subscriber. */
const frames = [];
let framed = () => undefined;
const { createCore } = await import(new URL('../../../../packages/hub/dist/hub-runtime.js', import.meta.url).href);
const core = createCore({ root, clock: { start: Date.now(), real: Date.now() }, held: [] }, (sub, event, caught) => {
  frames.push({ sub, event, caught: caught === true });
  framed();
});
// Resolves at started: the record is open and the spool replayed.
await core.started();
say('started');

const read = async (params) => {
  const page = await core.call('events.read', params, { role: 'cli' });
  return { log_pos: page.log_pos, events: JSON.parse(page.events) };
};
const held = (await read({ after: 0, limit: 1000 })).events.length;
if (held === 0) {
  say('blocked', { why: 'the log held no events after the core started with a session in its spool' });
  process.exit(3);
}
await turn();

// ---- A subscriber subscribes; its first flush's page read fails.
const failed = new Promise((done) => { armed = { after: 0, failed: () => done(true) }; });
const reply = await core.subscribe(SUB, 0);
say('subscribed', { after: 0, reply, held });
if ((await within(failed, 30_000)) === null) {
  say('blocked', { why: 'no page read of the subscriber after log_pos 0 within 30 s of its subscribe' });
  process.exit(3);
}
say('stream-read-failed', { after: 0, frames: frames.length });
await turn();
await turn();
say('alive');

// ---- The hub keeps answering.
const again = await read({ after: 0, limit: 2 });
say('answered', { method: 'events.read', after: 0, log_pos: again.log_pos, events: again.events.length });
const health = await core.call('health', {}, { role: 'cli' });
say('answered', { method: 'health', keys: Object.keys(health ?? {}).length });

// ---- Seen, not judged: whether a later append's frame still reaches the subscriber (README: not a criterion).
const name = `renamed ${randomUUID()}`;
const reached = new Promise((done) => { framed = () => { if (frames.some((f) => f.sub === SUB && f.event.includes(name))) done(true); }; });
try {
  await core.call('session.rename', { session, name }, { role: 'app' });
  say('appended', { streamed: (await within(reached, 10_000)) === true, frames: frames.length });
} catch (error) {
  say('appended', { refused: error instanceof Error ? error.message : String(error) });
}

core.unsubscribe(SUB);
await turn();
await turn();
await core.stop('test');
say('stopped');
process.exit(0);
