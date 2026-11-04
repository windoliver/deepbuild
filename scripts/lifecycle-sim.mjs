// The hub's simulation harness for the lifecycle tables (#570): seeded runs that drive the real record, with its
// gate and projections, through random interleavings of the events that move asks, ask-tasks, leases, claims,
// open items and session bindings. Writers are mixed (the core, the app, the CLI, a hook, an agent's MCP
// connection), the clock steps back once and the hub restarts once. scripts/lifecycle.mjs replays each run's log
// against the tables, and `check` holds the record's own tables to the states the lifecycle tables reach.
//
// It runs the record from its TypeScript source, through a loader that strips types with the repo's own
// TypeScript, so it never runs a stale build.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
export const SEEDS = [1, 2, 3, 4, 5];
const STEPS = 400;

registerHooks({
  resolve(specifier, context, next) {
    // A source file imports its siblings as .js; the source beside it is .ts.
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      try { return next(`${specifier.slice(0, -3)}.ts`, context); } catch { /* a real .js */ }
    }
    return next(specifier, { ...context, conditions: [...(context.conditions ?? []), 'development'] });
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts') || url.endsWith('.d.ts')) return next(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});

/** A seeded generator: mulberry32. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fixture = (name) => JSON.parse(readFileSync(join(root, 'packages/contracts/fixtures', name, '01.json'), 'utf8'));
const HOUR = 3_600_000;

/** One seeded run: its log, as the record holds it, and the check of the record's tables against the tables' states. */
export async function simulate(seed) {
  const { openRecord, testStorage, ulid } = await import(pathToFileURL(join(root, 'packages/record/src/index.ts')).href);
  // The record's in-memory storage: a reopen without a power cut is a restart, holding what was committed.
  const storage = testStorage();
  const path = 'lifecycle-sim.db';
  const rand = random(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let t = 1_760_013_451_123;
  let record = await openRecord({ path, storage, now: () => t });
  const who = { actor: 'you', scope: 'you' };
  const as = (writer, session) => ({ writer, ...who, ...(session ? { session, agent: 'claude-code' } : {}) });
  const WRITERS = [as('core'), as('app'), as('cli'), as('hook', 'S1'), as('mcp:S1', 'S1')];
  const asks = [];
  const claims = [];
  const ends = [];
  const bound = { S1: 'unbound', S2: 'unbound' };
  const task = `task:${ulid(t)}`;
  const item = { task_ref: task, text: 'Still open: the e2e run' };
  const resource = { host: 'local', kind: 'port', key: '4317' };
  let backed = false;
  let restarted = false;
  // Each step appends one event as some writer; a writer its schema refuses is refused there, before any move.
  const append = async (connection, kind, v, fields) => {
    try {
      await record.append(connection, { v, id: ulid(t), kind, ts: t, ...fields });
    } catch (error) {
      if (!['writer', 'schema'].includes(error.code)) throw error;
    }
  };
  const lease = (holder, extra = {}) => ({ resource, holder, mode: 'exclusive', expires: t + HOUR, ...extra });
  await append(as('app'), 'task.created', 1, { data: { ...fixture('task.created@1').data, task_ref: task } });
  const steps = [
    async () => { if (asks.length < 4) { const id = ulid(t); asks.push(id); await record.append(as('core'), { v: 4, id, kind: 'ask.created', ts: t, data: { ...fixture('ask.created@4').data, deadline: t + HOUR } }); } },
    async () => asks.length && append(as('core'), 'ask.answered', 4, { subject: `ask:${pick(asks)}`, data: fixture('ask.answered@4').data }),
    async () => asks.length && append(as('core'), 'ask.defaulted', 1, { subject: `ask:${pick(asks)}`, data: { answer: 'hold', plan_hash: null, decision: 'deny' } }),
    async () => asks.length && append(pick(WRITERS), 'ask.later', 1, { subject: `ask:${pick(asks)}`, data: { until: t + HOUR / 4 } }),
    async () => asks.length && append(pick([as('core'), as('app')]), 'ask.batched', 1, { data: { batch: ulid(t), asks: asks.filter(() => rand() < 0.5).map((a) => ({ ask: `ask:${a}`, plan_hash: null })) } }),
    async () => asks.length && append(pick(WRITERS), 'ask.cancelled', 1, { subject: `ask:${pick(asks)}`, data: fixture('ask.cancelled@1').data }),
    async () => asks.length && append(as('core'), 'ask.moot', 2, { subject: `ask:${pick(asks)}`, data: fixture('ask.moot@2').data }),
    async () => asks.length && append(as('core'), 'decision.applied', 1, { data: { decision: `decision:${ulid(t)}`, ask: `ask:${pick(asks)}` } }),
    async () => asks.length && append(as('core'), 'default.undone', 1, { subject: `ask:${pick(asks)}`, data: { deadline: t + HOUR } }),
    async () => asks.length && append(as('core'), 'deadline.moved', 1, { subject: `ask:${pick(asks)}`, data: { span: HOUR / 2, deadline: t + HOUR, because: 'away' } }),
    async () => append(as('core'), 'task.closed', 1, { subject: task, data: { by_verdict: `verdict:${ulid(t)}` } }),
    async () => append(pick(WRITERS), 'task.withdrawn', 1, { subject: task, data: {} }),
    async () => append(as('core'), 'lease.acquired', 2, { subject: `lease:${ulid(t)}`, data: lease('session:S1') }),
    async () => append(as('core'), 'lease.stale', 1, { data: lease('session:S1') }),
    async () => append(as('core'), 'lease.released', 2, { subject: `lease:${ulid(t)}`, data: lease('session:S1', { proof: rand() < 0.7 ? ends.slice(-1) : [] }) }),
    async () => append(as('core'), 'lease.denied', 1, { data: lease('session:S2') }),
    async () => { const id = ulid(t); claims.push(id); await append(as('core', 'S1'), 'claim.made', 3, { id, data: { ...fixture('claim.made@3').data, task_ref: task, attempt: claims.length } }); },
    async () => claims.length && append(as('core'), 'run.started', 3, { subject: `run:${ulid(t)}`, data: { ...fixture('run.started@3').data, run: `run:${ulid(t)}`, claim: `claim:${pick(claims)}` } }),
    async () => claims.length && append(as('core'), 'verdict.made', 1, { data: { ...fixture('verdict.made@1').data, verdict: `verdict:${ulid(t)}`, claim: `claim:${pick(claims)}` } }),
    async () => claims.length && append(pick([as('core'), as('app')]), 'claim.sent_back', 1, { data: { claim: `claim:${pick(claims)}`, verdict: `verdict:${ulid(t)}`, round: 1, to: 'session:S1' } }),
    async () => claims.length && append(as('core'), 'claim.stalled', 1, { data: { claim: `claim:${pick(claims)}`, rule: 'no-progress-3-rounds' } }),
    async () => append(as('core'), 'open_item.opened', 2, { data: { ...fixture('open_item.opened@2').data, ...item } }),
    async () => append(as('core'), 'open_item.closed', 2, { data: { ...fixture('open_item.closed@2').data, ...item } }),
    async () => { const s = pick(['S1', 'S2']); if (bound[s] !== 'gone') bound[s] = 'bound'; await append(as('hook', s), 'session.start', 4, { data: fixture('session.start@4').data }); },
    async () => { const s = pick(['S1', 'S2']); const id = ulid(t); if (s === 'S1') ends.push(id); await append(as('hook', s), 'session.end', 1, { id, data: { reason: 'other' } }); },
    // The core marks a session gone once, when its process is gone with no SessionEnd.
    async () => { if (bound.S2 === 'bound') { bound.S2 = 'gone'; await append(as('core'), 'session.gone', 1, { subject: 'session:S2', data: fixture('session.gone@1').data }); } },
  ];
  for (let i = 0; i < STEPS; i++) {
    t += 1 + Math.floor(rand() * HOUR / 8);
    // The clock steps back once, past a deadline; the hub restarts once, from its log.
    if (!backed && i > STEPS / 3 && rand() < 0.05) { t -= HOUR; backed = true; }
    if (!restarted && i > STEPS / 2 && rand() < 0.05) { await record.close(); record = await openRecord({ path, storage, now: () => t }); restarted = true; }
    await pick(steps)();
  }
  const events = (await record.read({ after: 0, limit: 1_000_000 })).map((e) => ({ ...e, log_pos: Number(e.log_pos) }));
  const rows = {};
  for (const name of ['asks', 'tasks', 'leases', 'claims', 'open_items']) rows[name] = (await record.table(name)).rows;
  await record.close();
  const check = (objects) => {
    const problems = [];
    const same = (object, held) => {
      const o = objects.get(object);
      if (o && o.state !== held) problems.push(`the record holds ${object} ${held}, and its table moved it to ${o.state}`);
    };
    for (const r of rows.asks) same(`ask:${r.id}`, r.status);
    for (const r of rows.tasks) same(r.task_ref, r.state);
    for (const r of rows.leases) same(`lease:${r.kind}/${r.key}`, r.state);
    for (const r of rows.claims) if (r.state !== null) same(`claim:${r.id}`, r.state);
    for (const r of rows.open_items) same(`open_item:${r.task_ref}/${r.text}`, r.closed === null ? 'open' : 'closed');
    if (!backed || !restarted) problems.push(`the run ${!backed ? 'never stepped its clock back' : 'never restarted the hub'}`);
    return problems;
  };
  return { events, check };
}
