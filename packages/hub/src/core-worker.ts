// The core's worker thread: the core answers each request the event loop forwards, in order, and streams
// appended events back for subscribers.
import { parentPort, workerData } from 'node:worker_threads';
import { Core, type CallContext } from './core.js';
import { shedStartup } from './settle.js';
import { Refused, refusal, type CoreOptions, type Draft, type Gated, type HookMeta } from './wire.js';

export type CoreRequest =
  | { op: 'call'; method: string; params: unknown; context: CallContext }
  | { op: 'mcp-hello'; parent: { pid: number; start: string } }
  | { op: 'health' }
  | { op: 'extension-hook'; data: unknown }
  | { op: 'hook-reply'; meta: HookMeta; until: number }
  | { op: 'tool-gate'; meta: HookMeta; call: Gated }
  | { op: 'permission'; meta: HookMeta }
  | { op: 'subscribe'; sub: string; after: number }
  | { op: 'stop'; reason: string };
export type CoreMessage =
  | { op: 'hook'; drafts: Draft[]; meta: HookMeta; writer: string }
  | { op: 'waiter-gone'; key: number }
  | { op: 'hook-gone'; id: string; session: string }
  | { op: 'unsubscribe'; sub: string }
  | (CoreRequest & { n: number });

/** Runs one request against the core: the core's answer, or the refusal to write back. */
export async function answer(core: Core, request: CoreRequest): Promise<unknown> {
  switch (request.op) {
    case 'call': return core.call(request.method, request.params, request.context);
    case 'mcp-hello': return core.mcpHello(request.parent);
    case 'health': return core.health();
    case 'extension-hook': return core.extensionHook(request.data);
    case 'hook-reply': return core.hookReply(request.meta, request.until);
    case 'tool-gate': return core.toolGate(request.meta, request.call);
    case 'permission': return core.permission(request.meta);
    case 'subscribe': return core.subscribe(request.sub, request.after);
    case 'stop': return core.stop(request.reason);
  }
}
export const asRefusal = (error: unknown) => (error instanceof Refused ? error.refusal : refusal('unavailable', '', error instanceof Error ? error.message : String(error), '', true));

if (parentPort && workerData?.core) {
  const port = parentPort;
  const core = new Core(workerData.core as CoreOptions, (sub, event) => port.postMessage({ op: 'frame', sub, event }), (sessions, judged) => port.postMessage({ op: 'asking', sessions, judged }));
  core.started().then(
    () => { shedStartup(); port.postMessage({ op: 'started', hooks: core.hooks() }); },
    (error: unknown) => port.postMessage({ op: 'fatal', message: error instanceof Error ? error.stack ?? error.message : String(error) }),
  );
  port.on('message', (message: CoreMessage) => {
    if (message.op === 'hook') return void core.hook(message.drafts, message.meta, message.writer).catch(() => undefined);
    if (message.op === 'waiter-gone') return core.waiterGone(message.key);
    if (message.op === 'hook-gone') return core.hookGone(message.id, message.session);
    if (message.op === 'unsubscribe') return core.unsubscribe(message.sub);
    const { n } = message;
    answer(core, message).then((result) => port.postMessage({ n, result }), (error: unknown) => port.postMessage({ n, error: asRefusal(error) }));
  });
}
