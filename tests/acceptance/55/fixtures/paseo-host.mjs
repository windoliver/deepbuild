// #55's stand-in for the paseo daemon around a plugin (README, The worlds): it loads the plugin's server entry
// (packages/paseo/index.server.ts, run by Node with its types stripped, as paseo's daemon runs it in a subprocess of its
// own) and hands it a PluginServerContext shaped as @getpaseo/plugin 0.15.0 declares it (server/contracts.d.ts,
// server/lifecycle.d.ts) with the SDK parts the hooks page names (context.paseo.agents.ref(id): refresh, current,
// send, respondToPermission, timeline.refetch, subscribe). The test drives it: it says which agents exist and how they
// read, fires paseo's hooks with their documented payloads, and reads back every SDK call the plugin made. Paseo, the
// agents and paseo's apps are boundaries this repo doesn't own; the plugin, the hub and everything behind them is real.
//
//   node paseo-host.mjs <plugin entry>        one JSON command per stdin line, answers on stdout by `n`
//
// Commands:
//   {op:'load'}                               imports the entry and calls its default export with the context;
//                                             answers {hooks: [names registered], legacy: [...]}.
//   {op:'agent', agent, snapshot, timeline}   an agent as paseo knows it: its PluginHookAgent, its AgentSnapshotPayload
//                                             (what refresh() and current() give), its timeline items; every
//                                             subscriber of the SDK hears {kind:'upsert', agent: snapshot}.
//   {op:'fire', name, payload}                paseo fires a hook. A waiting hook (agent.create.before,
//                                             agent.open.before, …) runs each handler in turn with {request} and
//                                             answers {result, ms, errors}; a notification starts every handler at once
//                                             and answers {started}, then {settled: n, ms, errors} once they end
//                                             (paseo doesn't wait on notifications, and aborts a handler at 30 s).
//   {op:'resolve', agentId, requestId, resolution}  a person answered a pending permission in paseo's own app: paseo
//                                             resolves it and fires agent.permission.after with that resolution.
//   {op:'stop'}                               runs the cleanup the entry returned (paseo's disable), then exits.
//
// Unprompted lines: {call, agentId, args, at, status, into, interrupt} for every SDK call the plugin made, where
// `status` is how the agent read when it was called, `into` the title of the dialog the words went into when send()
// came while a permission, question or picker was pending, and `interrupt` true when send() came while a turn ran
// without activeTurnBehavior 'steer' (the SDK interrupts the turn when it's left out).
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [, , ENTRY] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const WAITS = new Set(['workspace.create.before', 'worktree.create.before', 'worktree.create.after', 'agent.create.before', 'agent.open.before']);
const NAMES = new Set([...WAITS, 'workspace.create.after', 'workspace.archive.after', 'agent.create.after', 'agent.close.after', 'agent.archive.after', 'agent.turn.before', 'agent.turn.after', 'agent.permission.before', 'agent.permission.after']);
const LEGACY = {
  'workspace.created': 'workspace.create.after', 'workspace.archived': 'workspace.archive.after', 'agent.created': 'agent.create.after',
  'agent.closed': 'agent.close.after', 'agent.archived': 'agent.archive.after', 'agent.turn_started': 'agent.turn.before',
  'agent.turn_ended': 'agent.turn.after', 'agent.permission_requested': 'agent.permission.before', 'agent.permission_resolved': 'agent.permission.after',
};
const LEGACY_REQUESTS = { 'workspace.create': 'workspace.create.before', 'agent.create': 'agent.create.before', 'agent.session_open': 'agent.open.before' };

const hooks = new Map();
const legacy = [];
const agents = new Map();
const everyone = new Set();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function register(name, handler) {
  // Paseo: "Unknown hook name: registration fails".
  if (!NAMES.has(name)) throw new Error(`Unknown hook name ${name}`);
  if (!hooks.has(name)) hooks.set(name, []);
  const list = hooks.get(name);
  list.push(handler);
  let removed = false;
  return () => { if (!removed) { removed = true; list.splice(list.indexOf(handler), 1); } };
}
const server = {
  addHook: register,
  on(name, handler) { legacy.push(`on:${name}`); return register(LEGACY[name] ?? name, handler); },
  before(name, handler) { legacy.push(`before:${name}`); return register(LEGACY_REQUESTS[name] ?? name, handler); },
  registerSettings(definition) {
    out({ registered: 'settings' });
    return { async read() { return { status: 'ready', revision: '0', values: clone(definition?.defaults) ?? {} }; }, subscribe() { return () => {}; } };
  },
  handle(contract) { out({ registered: 'rpc', contract: contract?.method ?? contract?.name ?? null }); },
  registerProvider(provider) { out({ registered: 'provider', id: provider?.id ?? null }); },
  registerUsageSource(source) { out({ registered: 'usage', id: source?.id ?? null }); },
};

/** A pending permission's name as a person sees it: its title, else its name. */
const titleOf = (p) => p?.title ?? p?.name ?? p?.id ?? null;
function handle(id) {
  const now = () => agents.get(id);
  const log = (call, args, extra = {}) => out({ call, agentId: id, args: clone(args) ?? null, at: Date.now(), status: now()?.snapshot?.status ?? null, ...extra });
  const field = (k) => () => now()?.snapshot?.[k] ?? null;
  const ref = {
    id,
    address: { agentId: id },
    current: () => clone(now()?.snapshot) ?? null,
    async refresh() { log('refresh'); return now() ? { agent: clone(now().snapshot), project: null } : null; },
    async reload() { log('reload'); return now() ? { agent: clone(now().snapshot), project: null } : null; },
    async send(text, options = {}) {
      const s = now()?.snapshot;
      const dialog = (s?.pendingPermissions ?? [])[0];
      log('send', { text, options }, { into: dialog ? titleOf(dialog) : null, interrupt: s?.status === 'running' && options?.activeTurnBehavior !== 'steer' });
      if (!s) throw new Error(`Agent not found: ${id}`);
    },
    async respondToPermission(options) {
      const s = now()?.snapshot;
      const at = (s?.pendingPermissions ?? []).findIndex((p) => p.id === options?.requestId);
      log('respondToPermission', options, { pending: at >= 0 });
      // The hooks page: an already-resolved request's SDK response fails.
      if (at < 0) throw new Error(`No pending permission ${options?.requestId} for agent ${id}`);
      s.pendingPermissions.splice(at, 1);
      void fire('agent.permission.after', { agent: clone(now().agent), requestId: options.requestId, resolution: clone(options.response) });
    },
    async run(text, options) { log('run', { text, options }); throw new Error('the stand-in starts no turn for a plugin'); },
    async waitForFinish(timeoutMs) { log('waitForFinish', { timeoutMs }); return { status: now()?.snapshot?.status ?? 'closed', final: null }; },
    async commands() { log('commands'); return { commands: [], error: null }; },
    async archive() { log('archive'); return { archivedAt: new Date().toISOString() }; },
    async detach() { log('detach'); },
    subscribe(handler) { log('subscribe'); now()?.subscribers.add(handler); return () => now()?.subscribers.delete(handler); },
    timeline: {
      async refetch(options = {}) {
        log('timeline', options);
        const a = now();
        const items = a?.timeline ?? [];
        const limit = typeof options.limit === 'number' ? options.limit : items.length;
        const tail = items.slice(Math.max(0, items.length - limit));
        const start = items.length - tail.length;
        return {
          requestId: options.requestId ?? 'r', agentId: id, agent: clone(a?.snapshot) ?? null, direction: options.direction ?? 'tail', projection: options.projection ?? 'projected',
          epoch: 'e1', reset: false, staleCursor: false, gap: false, window: { minSeq: 0, maxSeq: Math.max(0, items.length - 1), nextSeq: items.length },
          startCursor: null, endCursor: null, hasOlder: start > 0, hasNewer: false,
          entries: tail.map((item, i) => ({ provider: a?.agent?.provider ?? 'unknown', item: clone(item), turnId: item.turnId, timestamp: new Date().toISOString(), seqStart: start + i, seqEnd: start + i, sourceSeqRanges: [], collapsed: [] })),
          error: null,
        };
      },
      subscribe(handler) { log('timeline.subscribe'); void handler; return Object.assign(() => {}, { ready: Promise.resolve() }); },
      async append(item) { log('timeline.append', item); return { seq: 0, epoch: 'e1' }; },
    },
  };
  for (const k of ['workspaceId', 'cwd', 'status', 'capabilities', 'availableModes', 'pendingPermissions', 'activeTurn', 'lastUsage', 'lastError', 'features', 'runtimeInfo', 'archivedAt']) Object.defineProperty(ref, k, { get: field(k), enumerable: true });
  return ref;
}
/** An SDK member this stand-in doesn't have: said on stdout, so a test failing on it names it. */
const unsupported = (path) => new Proxy({}, { get(_, key) { if (key === 'then') return undefined; out({ call: 'unsupported', path: `${path}.${String(key)}` }); return undefined; } });
const paseo = {
  agents: {
    ref: (agent) => handle(typeof agent === 'string' ? agent : agent?.id),
    async list() { out({ call: 'agents.list' }); return { entries: [...agents.values()].map((a) => ({ agent: clone(a.snapshot) })), agents: [...agents.values()].map((a) => clone(a.snapshot)) }; },
    subscribe(handler) { everyone.add(handler); return () => everyone.delete(handler); },
    async create(options) { out({ call: 'agents.create', args: clone(options) }); throw new Error('the stand-in creates no agent for a plugin'); },
  },
  workspaces: unsupported('workspaces'),
  hosts: unsupported('hosts'),
};
const context = () => ({ paseo, signal: AbortSignal.timeout(30_000) });

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref());
let fired = 0;
async function fire(name, payload, n) {
  const list = [...(hooks.get(name) ?? [])];
  if (WAITS.has(name)) {
    let request = clone(payload.request);
    const ms = [];
    const errors = [];
    for (const handler of list) {
      const t0 = performance.now();
      try {
        const got = await Promise.race([handler({ ...payload, request: clone(request) }, context()), timeout(30_000)]);
        if (got !== undefined) request = clone(got);
      } catch (error) {
        errors.push(String(error?.stack ?? error));
        // Paseo: a waiting hook that throws fails the operation; later callbacks don't run.
        ms.push(performance.now() - t0);
        break;
      }
      ms.push(performance.now() - t0);
    }
    return { n, name, result: request, ms, errors, handlers: list.length };
  }
  const id = ++fired;
  if (n !== undefined) out({ n, name, started: list.length, fire: id });
  const ms = [];
  const errors = [];
  // Paseo doesn't wait: the next command runs while these handlers do.
  void Promise.all(list.map(async (handler) => {
    const t0 = performance.now();
    try { await Promise.race([handler(clone(payload), context()), timeout(30_000)]); } catch (error) { errors.push(String(error?.stack ?? error)); }
    ms.push(performance.now() - t0);
  })).then(() => out({ settled: id, name, ms, errors }));
  return undefined;
}

let cleanup;
async function command(c) {
  switch (c.op) {
    case 'load': {
      const mod = await import(pathToFileURL(ENTRY).href);
      if (typeof mod.default !== 'function') throw new Error(`${ENTRY} has no default export function`);
      cleanup = mod.default(server);
      return { hooks: [...hooks.entries()].filter(([, l]) => l.length).map(([name]) => name), legacy };
    }
    case 'agent': {
      const known = agents.get(c.agent.id);
      const a = known ?? { subscribers: new Set() };
      a.agent = clone(c.agent);
      a.snapshot = clone(c.snapshot);
      if (c.timeline) a.timeline = clone(c.timeline);
      else a.timeline ??= [];
      agents.set(c.agent.id, a);
      const update = { kind: 'upsert', agent: clone(a.snapshot), project: null };
      for (const h of [...everyone, ...a.subscribers]) { try { h(clone(update)); } catch (error) { out({ subscriberError: String(error) }); } }
      return {};
    }
    case 'fire': {
      const got = await fire(c.name, c.payload, c.n);
      return got;
    }
    case 'resolve': {
      const a = agents.get(c.agentId);
      const at = (a?.snapshot?.pendingPermissions ?? []).findIndex((p) => p.id === c.requestId);
      if (at < 0) throw new Error(`no pending ${c.requestId} on ${c.agentId}`);
      a.snapshot.pendingPermissions.splice(at, 1);
      void fire('agent.permission.after', { agent: clone(a.agent), requestId: c.requestId, resolution: clone(c.resolution) });
      return {};
    }
    case 'stop': {
      try { if (typeof cleanup === 'function') await cleanup(); } catch (error) { out({ cleanupError: String(error) }); }
      for (const list of hooks.values()) list.splice(0);
      out({ n: c.n, stopped: true });
      setTimeout(() => process.exit(0), 50);
      return undefined;
    }
    default: throw new Error(`no op ${c.op}`);
  }
}

process.on('unhandledRejection', (error) => out({ unhandled: String(error?.stack ?? error) }));
// One command at a time, in the order the test sent them, as paseo's daemon takes its own operations.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  queue = queue.then(() => command(c)).then((got) => { if (got !== undefined && c.op !== 'fire') out({ n: c.n, ...got }); else if (got !== undefined) out(got); }, (error) => out({ n: c.n, error: String(error?.stack ?? error) }));
});
process.stdin.on('end', () => { void queue.then(() => setTimeout(() => process.exit(0), 200)); });
