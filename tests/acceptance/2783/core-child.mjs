// #2783's fixture: one hub core in a process of its own, so a core that spins takes this process and not the test's.
// The parent (replay-late.test.ts) starts it with `node core-child.mjs`, its plan in DH2783_PLAN (JSON), and kills it
// by PID at its limit. Every step is appended to the plan's log file synchronously: a starved event loop never
// flushes a pipe.
//
// The surfaces are the issue's: `createCore` from packages/hub/dist/hub-runtime.js, `started()`, `hook()`, `stop()`,
// and `call('events.read')` to read what the core recorded.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

/** @type {{ mode: 'failed-start' | 'start' | 'late-spool', root: string, log: string, hook: { session: string, cwd: string, transcript: string }, late?: string }} */
const plan = JSON.parse(process.env.DH2783_PLAN ?? 'null');
const log = (step, more = {}) => appendFileSync(plan.log, `${JSON.stringify({ step, at: Date.now(), ...more })}\n`);
const why = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 400);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const BUILT = new URL('../../../packages/hub/dist/hub-runtime.js', import.meta.url);
if (!existsSync(BUILT)) {
  log('blocked', { why: 'packages/hub/dist/hub-runtime.js is missing; build the hub first' });
  process.exit(3);
}
const { createCore } = await import(BUILT.href);
let version;
try {
  version = (await import('@deepbuild/adapters')).readFacts('claude-code.facts.json').versions.at(-1);
} catch { /* a hook without its agent's version is still a hook */ }

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A hook request's ID, a ULID as deep-hook makes one. */
function ulid() {
  let s = '';
  for (let t = BigInt(Date.now()), i = 0; i < 10; i++, t >>= 5n) s = CROCKFORD[Number(t & 31n)] + s;
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}
/** One hook as the hub's event loop hands it to the core: the SessionStart of the plan's hook session. */
function sendHook(core) {
  const { session, cwd, transcript } = plan.hook;
  const ts = Date.now();
  const id = ulid();
  const meta = { id, seq: String(BigInt(ts) * 1_000_000n), agent: 'claude-code', event: 'SessionStart', session, cwd, transcript, pid: process.pid, ppid: process.pid, matched: [], ...(version ? { version } : {}), fields: { source: 'startup' } };
  const draft = { kind: 'session.start', v: 3, id, ts, seq: meta.seq, data: { agent: 'claude-code', worktree: cwd, branch: null, thread: session, loads: [] }, fill: 'loads' };
  return core.hook([draft], meta, 'hook');
}
/** Every session.start the core's record holds, by session. */
async function starts(core) {
  const out = [];
  for (let after = 0; ;) {
    const page = await core.call('events.read', { after, limit: 1000 }, { role: 'cli' });
    const events = JSON.parse(page.events);
    for (const e of events) if (e.kind === 'session.start') out.push({ session: e.session ?? e.session_id ?? null, log_pos: e.log_pos });
    if (events.length < 1000) return out;
    after = page.log_pos;
  }
}

log('begin', { mode: plan.mode, pid: process.pid });
const core = createCore({ root: plan.root, clock: { start: Date.now(), real: Date.now() }, held: [] }, () => undefined);
let failed;
await core.started().then(() => log('started'), (error) => { failed = why(error); log('start-rejected', { why: failed }); });

if (plan.mode === 'failed-start') {
  // The 50 ms timer beside the core. It is seen firing before the hook, so a timer that never fires after it is the hook's doing.
  let hookAt;
  let firstTick;
  const first = new Promise((done) => { firstTick = done; });
  setInterval(() => {
    if (hookAt === undefined) return firstTick();
    log('tick', { ms: Math.round(performance.now() - hookAt) });
  }, 50);
  await first;
  log('timer-fires-before-the-hook');
  const sent = sendHook(core);
  hookAt = performance.now();
  log('hook-sent');
  sent.then(() => log('hook-settled', { how: 'resolved' }), (error) => log('hook-settled', { how: 'rejected', why: why(error) }));
  await sleep(2000);
  log('window-over', { ms: Math.round(performance.now() - hookAt) });
  const stopAt = performance.now();
  await core.stop('test').then(() => log('stop-settled', { how: 'resolved', ms: Math.round(performance.now() - stopAt) }), (error) => log('stop-settled', { how: 'rejected', ms: Math.round(performance.now() - stopAt), why: why(error) }));
  log('end');
  process.exit(0);
}

if (failed !== undefined) {
  log('end');
  process.exit(4);
}

if (plan.mode === 'start') {
  log('starts', { starts: await starts(core) });
} else {
  // A spool written after the start, as deep-hook appends one: one line, one append.
  mkdirSync(join(plan.root, 'spool'), { recursive: true });
  writeFileSync(join(plan.root, 'spool', 'spool.jsonl'), plan.late, { flag: 'a' });
  log('spool-written');
  // The next hook. Its own event is recorded after what the spool held, so the spool is read once this one shows.
  await sendHook(core).then(() => log('hook-settled', { how: 'resolved' }), (error) => log('hook-settled', { how: 'rejected', why: why(error) }));
  let seen = await starts(core);
  for (const end = Date.now() + 120_000; Date.now() < end && !seen.some((s) => s.session === plan.hook.session); await sleep(50)) seen = await starts(core);
  log('starts-after-the-hook', { starts: seen });
  // Longer than the core's own 2 s look at the spool: a second replay of the same line would show by then.
  await sleep(5000);
  log('starts-later', { starts: await starts(core), spool: existsSync(join(plan.root, 'spool', 'spool.jsonl')) });
}
// events.read builds its next page on a setImmediate: let it run before the record closes.
await sleep(100);
const stopAt = performance.now();
await core.stop('test').then(() => log('stop-settled', { how: 'resolved', ms: Math.round(performance.now() - stopAt) }), (error) => log('stop-settled', { how: 'rejected', why: why(error) }));
log('end');
process.exit(0);
