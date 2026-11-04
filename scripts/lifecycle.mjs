// The lifecycle tables checked (#570; design: Lifecycles). Test code over the tables in
// packages/contracts/schemas/<object>.machine@<n>.json; it needs no outside tool.
//
//   node scripts/lifecycle.mjs world [--tables <dir>]
//     Walks every reachable state of a small world: two sessions, two asks, one lease, two devices, one hub
//     restart, one clock step back and one deadline, and one object of every other table. Each object must reach
//     a final state from every state it reaches; two events delivered in either order, or one delivered from both
//     devices, must end in the same state or in a conflict its table names; and a crash at each reachable state,
//     replayed from the log, must recover the state the object was in. A move on a kind no schema in this
//     checkout publishes can't be logged, so it lives only in memory.
//   node scripts/lifecycle.mjs replay [<log.jsonl> ...]
//     Reads recorded logs back against the tables: every recorded move of an ask, an ask-task, a lease, a claim,
//     an open item and a session binding must be one its table allows. With no files, it reads each session of the
//     fixture corpus (adapters/corpus, the adapter's events stored beside each payload) and each seeded run of the
//     hub's simulation harness (scripts/lifecycle-sim.mjs).
//
// One line per finding: PASS, or FAIL/BLOCKED naming the table; it exits 1 when it printed anything but PASS.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = realpathSync(new URL('../', import.meta.url).pathname);
const SCHEMAS = join(root, 'packages/contracts/schemas');
const MACHINE = /^([a-z_]+)\.machine@\d+\.json$/;
const folders = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

/** Every table in `dir`, by its object's name. */
function readTables(dir = SCHEMAS) {
  const tables = new Map();
  for (const file of readdirSync(dir).filter((f) => MACHINE.test(f)).sort()) tables.set(MACHINE.exec(file)[1], JSON.parse(readFileSync(join(dir, file), 'utf8')));
  return tables;
}
/** The kinds this checkout's log can hold: every published event schema. */
const published = new Set(readdirSync(SCHEMAS).filter((f) => f.endsWith('.json') && !MACHINE.test(f)).map((f) => f.replace(/@\d+\.json$/, '')));

let failed = false;
const say = (state, command, text) => {
  if (state !== 'PASS') failed = true;
  console.log(`${state} lifecycle ${command}: ${text}`);
};

// ---- The small world ---------------------------------------------------------------------------------------

/** What each guard reads in the world: the clock, and the state of the session an object belongs to. */
const WORLD_GUARDS = {
  core: () => true,
  not_agent: () => true,
  trusted_path: () => true,
  newer_attempt: () => true,
  past_deadline: (env) => env.clock === 'past',
  holder_ended: (env, tables) => env.session !== null && tables.get('session_binding')?.final.includes(env.session),
  own_session: (env, tables) => env.session !== null && tables.get('session_binding')?.final.includes(env.session),
};
const LINKED = new Set(['holder_ended', 'own_session']);

/** The world's objects: two sessions, two asks, a lease S1 holds, an attempt S2 runs, one of every other table. */
function objectsOf(tables) {
  const names = { session_binding: ['S1', 'S2'], ask: ['A1', 'A2'], lease: ['L1'], attempt: ['At1'] };
  const sessionOf = { L1: 'S1', At1: 'S2' };
  return [...tables.keys()].flatMap((object) => (names[object] ?? [`${object.slice(0, 2).toUpperCase()}1`]).map((name) => {
    const linked = tables.get(object).moves.some((m) => LINKED.has(m.guard));
    return { object, name, session: linked ? sessionOf[name] ?? 'S1' : null };
  }));
}

/** Delivers one event to a state: the first row from it whose guard holds moves it; with none, it stays. */
function deliver(table, state, event, env, tables) {
  const row = table.moves.find((m) => m.from === state && m.event === event && (m.guard === undefined || WORLD_GUARDS[m.guard](env, tables)));
  return row ? row.to : state;
}
const enabled = (table, state, env, tables) => [...new Set(table.moves.filter((m) => m.from === state && (m.guard === undefined || WORLD_GUARDS[m.guard](env, tables))).map((m) => m.event))];

/**
 * One object's world: its state with the clock (before or past its deadline, stepped back at most once), whether
 * the hub restarted, and the state of the session it belongs to. Each node keeps the path that reached it, and
 * that path's log: the moves on published kinds, with what their guards read then.
 */
function walk(table, item, tables) {
  const session = item.session ? tables.get('session_binding') : null;
  const key = (n) => `${n.state}|${n.clock}|${n.back}|${n.restarted}|${n.session}|${n.logged}`;
  const start = { state: table.initial, clock: 'before', back: false, restarted: false, session: session ? session.initial : null, logged: table.initial, path: [], log: [] };
  const nodes = new Map([[key(start), start]]);
  const edges = new Map();
  const queue = [start];
  const replay = (log) => log.reduce((s, { event, env }) => deliver(table, s, event, env, tables), table.initial);
  while (queue.length) {
    const n = queue.shift();
    const env = { clock: n.clock, session: n.session };
    const next = [];
    for (const event of enabled(table, n.state, env, tables)) {
      const to = deliver(table, n.state, event, env, tables);
      const logs = published.has(event);
      next.push({ ...n, state: to, logged: logs ? deliver(table, n.logged, event, env, tables) : n.logged, path: [...n.path, event], log: logs ? [...n.log, { event, env }] : n.log });
    }
    if (n.clock === 'before') next.push({ ...n, clock: 'past', path: [...n.path, 'the deadline passes'] });
    if (n.clock === 'past' && !n.back) next.push({ ...n, clock: 'before', back: true, path: [...n.path, 'the clock steps back'] });
    if (!n.restarted) next.push({ ...n, restarted: true, state: replay(n.log), path: [...n.path, 'the hub restarts'] });
    if (session) for (const event of enabled(session, n.session, {}, tables)) next.push({ ...n, session: deliver(session, n.session, event, {}, tables), path: [...n.path, `${item.session} ${event}`] });
    const out = [];
    for (const m of next) {
      const k = key(m);
      if (!nodes.has(k)) {
        nodes.set(k, m);
        queue.push(m);
      }
      out.push(k);
    }
    edges.set(key(n), out);
  }
  return { nodes, edges, replay };
}

function world(tables) {
  let states = 0;
  let crashes = 0;
  const tableProblems = new Map();
  const problem = (id, text) => (tableProblems.get(id) ?? tableProblems.set(id, []).get(id)).push(text);
  const counts = new Map();
  for (const [object, table] of tables) {
    for (const m of table.moves) if (m.guard !== undefined && !(m.guard in WORLD_GUARDS)) problem(table.id, `BLOCKED|the guard ${m.guard} of ${m.from} --${m.event}--> ${m.to} has no meaning in the world`);
    if (tableProblems.has(table.id)) continue;
    const named = (a, b) => (table.conflicts ?? []).some((c) => c.events.includes(a) && c.events.includes(b) && (a !== b || c.events[0] === c.events[1]));
    for (const item of objectsOf(tables).filter((o) => o.object === object)) {
      const { nodes, edges, replay } = walk(table, item, tables);
      states += nodes.size;
      counts.set(table.id, (counts.get(table.id) ?? 0) + nodes.size);
      // Every state reaches a final one: the nodes that reach one, found backwards from those in a final state.
      const into = new Map();
      for (const [k, outs] of edges) for (const o of outs) (into.get(o) ?? into.set(o, []).get(o)).push(k);
      const ends = [...nodes.keys()].filter((k) => table.final.includes(nodes.get(k).state));
      const reaches = new Set(ends);
      for (const queue = [...ends]; queue.length;) for (const k of into.get(queue.shift()) ?? []) if (!reaches.has(k)) { reaches.add(k); queue.push(k); }
      const stuck = [...nodes.values()].find((n) => !reaches.has(`${n.state}|${n.clock}|${n.back}|${n.restarted}|${n.session}|${n.logged}`));
      if (stuck) problem(table.id, `${item.object} ${item.name} stays ${stuck.state} after ${stuck.path.join(' → ') || 'its start'}; no move reaches a final state`);
      const seen = new Set();
      for (const n of nodes.values()) {
        // A crash here, replayed from the log alone, recovers the state the object is in.
        crashes++;
        const back = replay(n.log);
        if (back !== n.state && !seen.has(`crash ${n.state}`)) {
          seen.add(`crash ${n.state}`);
          problem(table.id, `${item.object} ${item.name} recovers from the log as ${back}, not ${n.state}, after ${n.path.join(' → ')}`);
        }
        // Two events in either order, or one from both devices, end alike or in a conflict the table names.
        const env = { clock: n.clock, session: n.session };
        const here = enabled(table, n.state, env, tables);
        for (const [i, a] of here.entries()) for (const b of here.slice(i)) {
          const ab = deliver(table, deliver(table, n.state, a, env, tables), b, env, tables);
          const ba = deliver(table, deliver(table, n.state, b, env, tables), a, env, tables);
          const once = deliver(table, n.state, a, env, tables);
          const pair = [a, b].sort().join(' ');
          if (a === b ? ab === once || named(a, a) : ab === ba || named(a, b)) continue;
          if (seen.has(pair)) continue;
          seen.add(pair);
          problem(table.id, a === b
            ? `${item.object} ${item.name} in ${n.state}: ${a} from one device ends ${once}, ${a} from both devices ends ${ab}, and no conflict is named`
            : `${item.object} ${item.name} in ${n.state}: ${a} then ${b} ends ${ab}, ${b} then ${a} ends ${ba}, and no conflict is named`);
        }
      }
    }
  }
  console.log(`lifecycle world: ${states} states reached, ${crashes} crashes replayed, over ${tables.size} tables`);
  for (const [, table] of tables) {
    const found = tableProblems.get(table.id) ?? [];
    for (const text of found) {
      const [state, rest] = text.startsWith('BLOCKED|') ? ['BLOCKED', text.slice(8)] : ['FAIL', text];
      say(state, 'world', `${table.id}: ${rest}`);
    }
    if (!found.length) say('PASS', 'world', `${table.id}: ${counts.get(table.id)} states, each reaches a final state; orders agree or are named; every crash recovers`);
  }
}

// ---- Logs read back against the tables ---------------------------------------------------------------------

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const bare = (v) => (typeof v === 'string' ? v.replace(/^[a-z_]+:/, '') : null);
const isAgent = (w) => w === 'hook' || w.startsWith('mcp:');

/** What each guard reads in a log: the event's writer and stamp, the object's deadline, and the events before it. */
const LOG_GUARDS = {
  core: (e) => e.writer === 'core',
  not_agent: (e) => !isAgent(e.writer),
  trusted_path: (e) => e.writer === 'app' || e.writer === 'cli',
  past_deadline: (e, o) => typeof o.deadline !== 'number' || e.ts >= o.deadline,
  holder_ended: (e, o, seen) => {
    const proof = Array.isArray(e.data?.proof) ? e.data.proof : [];
    return !(String(o.holder ?? '').startsWith('session:') && !proof.length) && proof.every((id) => seen.has(id));
  },
};

/**
 * Replays one log: each event finds the objects it would move, as the record does, and moves them by their
 * tables. An event a move.refused cites was refused by the record and moves nothing. Returns the moves made,
 * the problems found and every object's state.
 */
function replayLog(events, tables) {
  const refused = new Set(events.filter((e) => e.kind === 'move.refused').map((e) => e.data?.event_id));
  const objects = new Map();
  const seen = new Set();
  const problems = [];
  let moves = 0;
  const born = (id, table, extra = {}) => (objects.has(id) ? objects.get(id) : objects.set(id, { table, state: tables.get(table).initial, ...extra }).get(id));
  const known = (id) => objects.get(id);
  for (const e of events) {
    seen.add(e.id);
    if (refused.has(e.id)) continue;
    const d = isObj(e.data) ? e.data : {};
    const targets = [];
    switch (e.kind) {
      case 'ask.created': born(`ask:${e.id}`, 'ask', { deadline: d.deadline }); break;
      case 'task.created': born(String(d.task_ref), 'ask_task'); break;
      case 'claim.made': born(`claim:${e.id}`, 'claim'); break;
      case 'ask.batched': for (const a of Array.isArray(d.asks) ? d.asks : []) if (known(`ask:${bare(a?.ask)}`)) targets.push(`ask:${bare(a.ask)}`); break;
      case 'decision.applied': if (known(`ask:${bare(d.ask)}`)) targets.push(`ask:${bare(d.ask)}`); break;
      case 'task.closed': case 'task.withdrawn': if (known(e.subject)) targets.push(e.subject); break;
      case 'lease.acquired': case 'lease.released': case 'lease.stale': case 'lease.denied': {
        // One holder's lease of one resource; a key no one holds, or held by another holder, is a new lease.
        const r = isObj(d.resource) ? d.resource : {};
        const at = `lease:${r.kind}/${r.key}`;
        const now = objects.get(at);
        const own = now && ['held', 'stale'].includes(now.state) && now.holder === d.holder && e.kind !== 'lease.denied';
        if (!own && !(now && ['held', 'stale'].includes(now.state) && e.kind === 'lease.denied')) objects.set(at, { table: 'lease', state: tables.get('lease').initial, holder: d.holder });
        if (!(now && ['held', 'stale'].includes(now.state) && e.kind === 'lease.denied')) targets.push(at);
        break;
      }
      case 'open_item.opened': case 'open_item.closed': {
        const at = `open_item:${d.task_ref}/${d.text}`;
        if (known(at)) targets.push(at);
        else if (e.kind === 'open_item.opened') born(at, 'open_item');
        break;
      }
      case 'run.started': case 'verdict.made': case 'claim.sent_back': case 'claim.stalled':
        if (bare(d.claim)) { born(`claim:${bare(d.claim)}`, 'claim'); targets.push(`claim:${bare(d.claim)}`); }
        break;
      case 'session.start': case 'session.end': case 'session.gone': {
        const id = e.session ?? d.session;
        if (id) { born(`session:${id}`, 'session_binding'); targets.push(`session:${id}`); }
        break;
      }
      default:
        if (e.subject && known(`ask:${bare(e.subject)}`) && tables.get('ask').moves.some((m) => m.event === e.kind)) targets.push(`ask:${bare(e.subject)}`);
    }
    for (const at of targets) {
      const o = objects.get(at);
      const table = tables.get(o.table);
      const row = table.moves.find((m) => m.from === o.state && m.event === e.kind && (m.guard === undefined || LOG_GUARDS[m.guard]?.(e, o, seen)));
      if (row) {
        o.state = row.to;
        moves++;
      } else if (table.moves.some((m) => m.event === e.kind)) problems.push(`event ${e.id} (${e.kind}) moves ${at} from ${o.state}; ${table.id} allows no such move`);
    }
    if (e.kind === 'deadline.moved' || e.kind === 'default.undone') { const o = known(`ask:${bare(e.subject)}`); if (o && typeof d.deadline === 'number') o.deadline = d.deadline; }
  }
  return { moves, problems, objects };
}

const readLog = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).sort((a, b) => (a.log_pos ?? 0) - (b.log_pos ?? 0));

/** Each recorded session of the fixture corpus: the events its adapter mapped, stored beside each payload. */
function corpusLogs() {
  const corpus = join(root, 'adapters/corpus');
  const logs = [];
  for (const agent of folders(corpus)) for (const version of folders(join(corpus, agent))) for (const session of folders(join(corpus, agent, version))) {
    const file = join(corpus, agent, version, session, 'events.jsonl');
    if (!existsSync(file)) continue;
    const events = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l, line) =>
      (JSON.parse(l).expect ?? []).map((x, i) => ({ id: `${line + 1}.${i}`, writer: 'hook', ts: 0, ...x, session: x.data?.session ?? null })));
    logs.push({ label: `corpus ${agent}/${version}/${session}`, events });
  }
  return logs;
}

async function replay(files, tables) {
  const logs = files.length ? files.map((f) => ({ label: f, events: readLog(f) })) : corpusLogs();
  if (!files.length) {
    const { simulate, SEEDS } = await import('./lifecycle-sim.mjs');
    for (const seed of SEEDS) {
      const run = await simulate(seed);
      logs.push({ label: `seed ${seed}`, events: run.events, check: run.check });
    }
  }
  for (const log of logs) {
    const { moves, problems, objects } = replayLog(log.events, tables);
    // A seeded run also holds the record's own projection to the states the tables reach.
    if (log.check) problems.push(...log.check(objects));
    for (const p of problems) say('FAIL', 'replay', `${log.label}: ${p}`);
    if (!problems.length) say('PASS', 'replay', `${log.label}: ${moves} moves`);
  }
}

// ---- Command line ------------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--tables');
  const tables = readTables(at >= 0 ? rest[at + 1] : SCHEMAS);
  if (command === 'world') world(tables);
  else if (command === 'replay') await replay(rest, tables);
  else {
    console.error(`usage: node ${relative(process.cwd(), process.argv[1])} world [--tables <dir>] | replay [<log.jsonl> ...]`);
    process.exit(2);
  }
  process.exit(failed ? 1 : 0);
}
