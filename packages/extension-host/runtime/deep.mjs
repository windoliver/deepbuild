// The extension's side of the host (#348), shared by the hub, where a release package runs in-process, and by the
// sandbox runner, where every other package runs: the extension API schema, the `deep` object a package gets, and
// the JSON-RPC 2.0 peer, one JSON object per line, that carries calls between a sandboxed package and the host.
// Plain JavaScript with Node's built-in modules only, so the sandbox needs to read nothing but this folder and Node.
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The extension API schema: each method a package can call, and the grant a call needs, or null. A grant is an
 * access word the package's manifest asks for and you approved at install, or `notices`, the manifest's notices
 * block (notices are a block, not an access word).
 */
export const API = Object.freeze([
  { method: 'deep.on', needs: 'record' },
  { method: 'deep.registerCheck', needs: null },
  { method: 'deep.registerResolver', needs: null },
  { method: 'deep.registerSource', needs: null },
  { method: 'deep.registerEnvironment', needs: null },
  { method: 'deep.registerView', needs: null },
  { method: 'deep.registerAdapter', needs: null },
  { method: 'deep.registerRoute', needs: null },
  // #355: the wiki's index, in place of the shipped one.
  { method: 'deep.registerIndex', needs: null },
  { method: 'deep.record.append', needs: 'record' },
  { method: 'deep.record.query', needs: 'record' },
  { method: 'deep.evidence.put', needs: 'files' },
  { method: 'deep.asks.create', needs: null },
  { method: 'deep.config.get', needs: null },
  { method: 'deep.notices.send', needs: 'notices' },
  // #350: actions, outside calls the host makes for the package, and the outputs pieces provide and use.
  { method: 'deep.registerAction', needs: null },
  { method: 'deep.fetch', needs: 'hosts' },
  { method: 'deep.provide', needs: null },
  { method: 'deep.use', needs: null },
  { method: 'deep.read', needs: null },
  // #363: the piece's store, its items kept in the record under kinds its manifest declares. `deep.store` comes before
  // its methods, which hang off it.
  { method: 'deep.store', needs: null },
  { method: 'deep.store.put', needs: null },
  { method: 'deep.store.get', needs: null },
  { method: 'deep.store.list', needs: null },
  // #44: a lease from the kernel's one table, held by the package itself.
  { method: 'deep.lease', needs: null },
  // #104: terminals the hub hosts for a piece you approved run-as-you for. None writes a terminal's input: that comes
  // only from the panel you focused, through the app.
  { method: 'deep.terminal.open', needs: 'run_as_you' },
  { method: 'deep.terminal.list', needs: 'run_as_you' },
  { method: 'deep.terminal.read', needs: 'run_as_you' },
].map((m) => Object.freeze(m)));

/**
 * The package's side: its `deep`, each call going to the host through `call` with its functions left out and
 * kept here unless the host refuses the call; and `serve`, what the host asks of the package. `load` runs the
 * package's code with its `deep` and the host's `load` params. Every call made while the package serves an action
 * goes with that action call's scope, the token the host gave it, across every await, so the host acts for that
 * call's caller and no other.
 */
export function extensionSide(call, load) {
  const checks = new Map();
  const handlers = new Map();
  const routes = new Map();
  const actions = new Map();
  const outputs = new Map();
  // Each store's migration to the generation it declares (#363), asked by the host at its load.
  const migrations = new Map();
  // Its environments by name (#331): their up and down stay here, asked by the host at the kit and at a stack's start.
  const environments = new Map();
  const scope = new AsyncLocalStorage();
  const keeper = (map) => (name, fn) => { map.set(name, fn); return () => { if (map.get(name) === fn) map.delete(name); }; };
  // The package's resolvers in order, and its adapters by name: their functions stay here (#349).
  let resolvers = [];
  const adapters = new Map();
  // Its index's methods stay here too (#355); the host asks for each call by name.
  const indexes = new Map();
  // Each returns how to drop what it kept.
  const keep = {
    'deep.registerCheck': keeper(checks),
    'deep.registerRoute': keeper(routes),
    'deep.registerAction': (name, _declared, fn) => keeper(actions)(name, fn),
    'deep.provide': (name, _kind, _schema, fn) => keeper(outputs)(name, fn),
    'deep.store': (kind, _declared, migrate) => (typeof migrate === 'function' ? keeper(migrations)(kind, migrate) : undefined),
    'deep.registerResolver': (resolver) => { resolvers = [...resolvers, resolver]; return () => { resolvers = resolvers.filter((r) => r !== resolver); }; },
    'deep.registerIndex': keeper(indexes),
    'deep.registerAdapter': (name, adapter) => { adapters.set(name, adapter); return () => { if (adapters.get(name) === adapter) adapters.delete(name); }; },
    'deep.registerEnvironment': keeper(environments),
    'deep.on': (kind, handler) => {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
      return () => handlers.set(kind, (handlers.get(kind) ?? []).filter((h) => h !== handler));
    },
  };
  const deep = {};
  const add = (method) => {
    const path = method.split('.').slice(1);
    let owner = deep;
    for (const key of path.slice(0, -1)) owner = owner[key] ??= {};
    owner[path[path.length - 1]] = (...args) => {
      // Kept before the host hears of it, so the host never asks for what isn't here yet; dropped if it refuses.
      const drop = keep[method]?.(...args);
      const within = scope.getStore();
      const made = Promise.resolve().then(() => call(method, args.filter((a) => typeof a !== 'function'), within)).catch((error) => {
        drop?.();
        throw error;
      });
      // A refusal the package doesn't await is no crash of the process it runs in.
      made.catch(() => undefined);
      return made;
    };
  };
  for (const { method } of API) add(method);
  return {
    async serve(method, params) {
      // A planted host's methods beyond the schema (tests only), before the package's code runs. What the package's
      // code returned at its load comes back as JSON: a release's fixture package returns its calls' results (#139).
      if (method === 'load') {
        for (const planted of params?.planted ?? []) add(planted);
        return (await load(deep, params)) ?? null;
      }
      if (method === 'run') {
        const runner = checks.get(params?.type);
        if (!runner) throw Error(`no check kind ${params?.type} is registered here`);
        return await runner(params.spec, params.ctx);
      }
      if (method === 'env.up' || method === 'env.down') {
        const env = environments.get(params?.name);
        if (!env) throw Error(`no environment ${params?.name} is registered here`);
        return method === 'env.up' ? await env.up(params.spec, params.lease, params.checkout) : (await env.down(params.handle)) ?? null;
      }
      if (method === 'deliver') {
        for (const event of params.events) for (const handler of handlers.get(event.kind) ?? []) await handler(event);
        return null;
      }
      if (method === 'route') {
        const handler = routes.get(params?.route);
        if (!handler) throw Error(`no route ${params?.route} is registered here`);
        return await handler(params.request);
      }
      // The first resolver with an answer answers; none, and the ask goes on.
      if (method === 'resolve') {
        for (const resolver of resolvers) {
          const answer = await resolver(params.ask);
          if (answer !== undefined && answer !== null) return answer;
        }
        return undefined;
      }
      if (method === 'adapter.mapHook' || method === 'adapter.deliver') {
        const adapter = adapters.get(params?.name);
        if (!adapter) throw Error(`no adapter ${params?.name} is registered here`);
        return method === 'adapter.mapHook' ? await adapter.mapHook(params.request, params.version) : await adapter.deliver(params.answer, params.session, params.route);
      }
      // A hook: each handler of its kind replies, in the order they registered. One that throws or misses the
      // deadline gives a marker in its place, so its siblings' replies (a deny among them) still reach the host.
      if (method === 'hook') {
        const deadline = params?.deadline ?? 0;
        const start = Date.now();
        return Promise.all((handlers.get(params?.kind) ?? []).map((handler) => {
          let timer;
          const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ $handler: 'late' }), deadline); });
          // A reply that comes after the deadline, even one that never yielded to the timer, is late all the same.
          const replied = Promise.resolve().then(() => handler(params.request))
            .then((r) => (Date.now() - start > deadline ? { $handler: 'late' } : r ?? null), () => ({ $handler: 'threw' }));
          return Promise.race([replied, late]).finally(() => clearTimeout(timer));
        }));
      }
      if (method === 'index') {
        const index = indexes.get(params?.name);
        if (!index || !['rebuild', 'upsert', 'search', 'dropSource'].includes(params?.op)) throw Error(`no index ${params?.name} with ${params?.op} is registered here`);
        return (await index[params.op](...(params.args ?? []))) ?? null;
      }
      if (method === 'action') {
        const fn = actions.get(params?.name);
        if (!fn) throw Error(`no action ${params?.name} is registered here`);
        return (await scope.run(params.scope, () => fn(params.input, params.ctx))) ?? null;
      }
      if (method === 'migrate') {
        const fn = migrations.get(params?.kind);
        if (!fn) throw Error(`no migration of ${params?.kind} is declared here`);
        return (await fn(params.from, params.value)) ?? null;
      }
      if (method === 'output') {
        const fn = outputs.get(params?.name);
        if (!fn) throw Error(`no output ${params?.name} is provided here`);
        return (await fn()) ?? null;
      }
      throw Error(`no method ${method}`);
    },
  };
}

/** The longest line either side reads, in bytes. */
const FRAME = 16 * 1024 * 1024;
/** The most requests from the other side left unanswered at once. */
const INFLIGHT = 256;
/** A JSON-RPC 2.0 peer on a duplex stream: `serve(method, params)` answers the other side's requests. */
export function peer(stream, serve) {
  let next = 0;
  /** The bytes of a line not yet ended, and how many. */
  let held = [];
  let size = 0;
  let inflight = 0;
  const pending = new Map();
  const send = (message) => stream.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const answer = (id, body) => { if (id !== undefined && id !== null) send({ id, ...body }); };
  const receive = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (typeof m?.method === 'string') {
      // A side asking faster than it is answered is cut off rather than queued without end.
      if (inflight >= INFLIGHT) return void stream.destroy();
      inflight++;
      Promise.resolve().then(() => serve(m.method, m.params, typeof m.scope === 'string' ? m.scope : undefined)).then(
        (result) => answer(m.id, { result: result ?? null }),
        (error) => answer(m.id, { error: { code: -32000, message: String(error?.message ?? error) } }),
      ).finally(() => { inflight--; });
    } else if (pending.has(m?.id)) {
      const waiting = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) waiting.reject(Error(String(m.error.message ?? 'error')));
      else waiting.resolve(m.result);
    }
  };
  stream.on('data', (chunk) => {
    let start = 0;
    for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10, start)) {
      // A line no message needs: the other side is cut off rather than held in memory.
      if (size + at - start > FRAME) return void stream.destroy();
      held.push(chunk.subarray(start, at));
      const line = Buffer.concat(held).toString('utf8');
      held = [];
      size = 0;
      start = at + 1;
      if (line.trim()) receive(line);
      if (stream.destroyed) return;
    }
    held.push(chunk.subarray(start));
    size += chunk.length - start;
    if (size > FRAME) stream.destroy();
  });
  stream.on('error', () => undefined);
  stream.on('close', () => {
    for (const waiting of pending.values()) waiting.reject(Error('the connection closed'));
    pending.clear();
  });
  return {
    /** `scope`, when given, is the action call a request is made for (extensionSide). */
    call(method, params, scope) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, params, ...(typeof scope === 'string' ? { scope } : {}) });
      });
    },
  };
}
