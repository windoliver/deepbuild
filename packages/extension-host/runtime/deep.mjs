// The extension's side of the host (#348), shared by the hub, where a release package runs in-process, and by the
// sandbox runner, where every other package runs: the extension API schema, the `deep` object a package gets, and
// the JSON-RPC 2.0 peer, one JSON object per line, that carries calls between a sandboxed package and the host.
// Plain JavaScript with Node's built-in modules only, so the sandbox needs to read nothing but this folder and Node.

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
  { method: 'deep.record.append', needs: 'record' },
  { method: 'deep.record.query', needs: 'record' },
  { method: 'deep.evidence.put', needs: 'files' },
  { method: 'deep.asks.create', needs: null },
  { method: 'deep.config.get', needs: null },
  { method: 'deep.notices.send', needs: 'notices' },
].map((m) => Object.freeze(m)));

/**
 * The package's side: its `deep`, each call going to the host through `call` with its functions left out and
 * kept here unless the host refuses the call; and `serve`, what the host asks of the package. `load` runs the
 * package's code with its `deep` and the host's `load` params.
 */
export function extensionSide(call, load) {
  const checks = new Map();
  const handlers = new Map();
  const routes = new Map();
  // Each returns how to drop what it kept.
  const keep = {
    'deep.registerCheck': (type, runner) => { checks.set(type, runner); return () => { if (checks.get(type) === runner) checks.delete(type); }; },
    'deep.registerRoute': (route, handler) => { routes.set(route, handler); return () => { if (routes.get(route) === handler) routes.delete(route); }; },
    'deep.on': (kind, handler) => {
      handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
      return () => handlers.set(kind, (handlers.get(kind) ?? []).filter((h) => h !== handler));
    },
  };
  const deep = {};
  for (const { method } of API) {
    const path = method.split('.').slice(1);
    let owner = deep;
    for (const key of path.slice(0, -1)) owner = owner[key] ??= {};
    owner[path[path.length - 1]] = (...args) => {
      // Kept before the host hears of it, so the host never asks for what isn't here yet; dropped if it refuses.
      const drop = keep[method]?.(...args);
      const made = Promise.resolve().then(() => call(method, args.filter((a) => typeof a !== 'function'))).catch((error) => {
        drop?.();
        throw error;
      });
      // A refusal the package doesn't await is no crash of the process it runs in.
      made.catch(() => undefined);
      return made;
    };
  }
  return {
    async serve(method, params) {
      if (method === 'load') return void (await load(deep, params));
      if (method === 'run') {
        const runner = checks.get(params?.type);
        if (!runner) throw Error(`no check kind ${params?.type} is registered here`);
        return await runner(params.spec, params.ctx);
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
      throw Error(`no method ${method}`);
    },
  };
}

/** The longest line either side reads, in bytes. */
const FRAME = 16 * 1024 * 1024;
/** A JSON-RPC 2.0 peer on a duplex stream: `serve(method, params)` answers the other side's requests. */
export function peer(stream, serve) {
  let next = 0;
  /** The bytes of a line not yet ended, and how many. */
  let held = [];
  let size = 0;
  const pending = new Map();
  const send = (message) => stream.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const answer = (id, body) => { if (id !== undefined && id !== null) send({ id, ...body }); };
  const receive = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (typeof m?.method === 'string') {
      Promise.resolve().then(() => serve(m.method, m.params)).then(
        (result) => answer(m.id, { result: result ?? null }),
        (error) => answer(m.id, { error: { code: -32000, message: String(error?.message ?? error) } }),
      );
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
    call(method, params) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, params });
      });
    },
  };
}
