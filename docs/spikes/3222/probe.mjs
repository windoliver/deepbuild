// #3222: loaded with `--import` into the measured `deep hub run` by harness.mjs, and active in its core's thread. It changes nothing the hub does: it
// wraps five methods of the hub's canvas side to note when each canvas call arrives and where it then spends its time,
// and appends one JSON line per mark to the file DEEP_SPIKE_3222_LOG names. Times are ms since the epoch, from this
// process's high-resolution clock (performance.timeOrigin + performance.now()).
//
// Marks, all under the tool call's own `id` (an AsyncLocalStorage store opened where the call arrives):
//   arrive    McpOperations.mcpCall for deep_show, deep_query or deep_kinds, or HubCanvas.showCli for `deep show`
//   show      HubCanvas.show begins (after binding)
//   join      Canvas.call: the call joins the one promise chain (`n` counts the core calls of one tool call)
//   write     Canvas.send writes a line to `deep-show canvas`: `line` is `world` or the call's name
//   line      the core answered that line: its `write` and `read` times (`read`: the answer arrived)
//   settle    Canvas.call's promise settles
//   end       the tool call returns to the hub's MCP or CLI side
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import { isMainThread, workerData } from 'node:worker_threads';

const LOG = process.env.DEEP_SPIKE_3222_LOG;
// The hub's core, canvas side included, runs in a worker thread of `deep hub run` (server.ts, core-worker.js), whose
// workerData holds `core`; NODE_OPTIONS' --import runs in each thread, and only that one is patched.
const coreWorker = !isMainThread && workerData && typeof workerData === 'object' && 'core' in workerData;
if (LOG && coreWorker) {
  const dist = new URL('../../../packages/hub/dist/', import.meta.url);
  const [{ McpOperations }, { HubCanvas }, { Canvas }] = await Promise.all(['mcp-operations.js', 'hub-canvas.js', 'canvas.js'].map((f) => import(new URL(f, dist).href)));
  const now = () => performance.timeOrigin + performance.now();
  const als = new AsyncLocalStorage();
  let seq = 0;
  const mark = (row) => appendFileSync(LOG, `${JSON.stringify(row)}\n`);
  mark({ id: null, mark: 'loaded', pid: process.pid, at: now() });
  const kindOf = (a) => (a.document != null ? (a.check === true ? 'check' : 'revision') : a.patch != null ? 'patch' : 'render_back');

  const arrive = (tool, args, run) => {
    const id = ++seq;
    const store = { id, core: 0 };
    mark({ id, mark: 'arrive', at: now(), tool, doc: typeof args.doc === 'string' ? args.doc : null, kind: tool === 'deep_show' || tool === 'deep show' ? kindOf(args) : tool, rev: args.rev ?? null });
    const ended = (outcome) => mark({ id, mark: 'end', at: now(), outcome });
    return als.run(store, () => run().then((v) => { ended(v && typeof v === 'object' && 'outcome' in v ? v.outcome : 'answered'); return v; }, (e) => { ended(`threw: ${String(e?.message ?? e).slice(0, 200)}`); throw e; }));
  };

  const mcpCall = McpOperations.prototype.mcpCall;
  McpOperations.prototype.mcpCall = function (params, context) {
    const tool = String(params?.tool);
    if (!['deep_show', 'deep_query', 'deep_kinds'].includes(tool)) return mcpCall.call(this, params, context);
    const args = params.arguments && typeof params.arguments === 'object' ? { ...params.arguments } : {};
    for (const k of ['document', 'patch']) if (typeof args[k] === 'string') args[k] = true;
    return arrive(tool, args, () => mcpCall.call(this, params, context));
  };
  const showCli = HubCanvas.prototype.showCli;
  HubCanvas.prototype.showCli = function (params, context) {
    return arrive('deep show', params ?? {}, () => showCli.call(this, params, context));
  };
  const show = HubCanvas.prototype.show;
  HubCanvas.prototype.show = function (as, call) {
    const store = als.getStore();
    if (store) mark({ id: store.id, mark: 'show', at: now() });
    return show.call(this, as, call);
  };
  const call = Canvas.prototype.call;
  Canvas.prototype.call = function (world, c) {
    const store = als.getStore();
    if (!store) return call.call(this, world, c);
    const n = ++store.core;
    mark({ id: store.id, mark: 'join', n, at: now(), call: String(c?.call) });
    const p = call.call(this, world, c);
    p.then(() => mark({ id: store.id, mark: 'settle', n, at: now() }), () => mark({ id: store.id, mark: 'settle', n, at: now(), failed: true }));
    return p;
  };
  const send = Canvas.prototype.send;
  Canvas.prototype.send = function (line) {
    const store = als.getStore();
    const what = 'world' in line ? 'world' : String(line.call?.call);
    const written = now();
    mark({ id: store?.id ?? null, mark: 'write', line: what, at: written });
    const p = send.call(this, line);
    p.then((answer) => mark({ id: store?.id ?? null, mark: 'line', line: what, write: written, read: now(), ok: answer?.ok === true, held: answer?.held ?? null }));
    return p;
  };
}
