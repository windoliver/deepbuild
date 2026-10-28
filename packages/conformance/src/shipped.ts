// The fill of a shipped adapter (#18): the adapter the registry holds under an agent's name, read as the newest
// version its facts cover, on the first surface it lists, each driven operation answered unsupported as no driven
// surface ships. Its planted twins each turn on one wrong behavior: two hooks of one call mapped to one event ID, a
// late PostToolUse that opens a new turn, and a permission reply that takes allow from the option's label or from
// "yes" in your words.
import { shipped } from '@deepbuild/adapters';
import type { Adapter, PermissionAnswer } from '@deepbuild/adapters';
import { isObject } from './types.js';
import type { Delivery, Driven, Fill, JsonObject, Operation } from './types.js';

type ShippedPlant = 'duplicate-event-id' | 'event-after-stop' | 'allow-from-label' | 'allow-from-yes';

/** The kit revision a shipped adapter declares. */
const REVISION = 1;

export function shippedFill(agent: string, options: { planted?: ShippedPlant } = {}): Fill {
  // readUsage stays out until the kit has a case that drives it, as the runner asks of a method with no case.
  const { readUsage: _noCase, ...adapter }: Adapter = shipped().get(agent);
  const versions = ((adapter.facts as JsonObject).events as JsonObject).versions as JsonObject;
  const surface = Object.keys(adapter.unsupported)[0]!;
  const { mapHook, permissionReply } = adapter;
  const payloadOf = (payload: unknown): JsonObject => (isObject(payload) ? payload : {});
  if (options.planted === 'duplicate-event-id') {
    // Every hook of one call takes the ID of the call's first hook line.
    const first = new Map<string, string>();
    adapter.mapHook = (request, version, transcript) => {
      const mapped = mapHook(request, version, transcript);
      const payload = payloadOf(request.payload);
      if (typeof payload.tool_use_id !== 'string') return mapped;
      const call = `${String(payload.session_id)}/${payload.tool_use_id}`;
      const id = first.get(call) ?? first.set(call, request.id).get(call)!;
      return { ...mapped, events: mapped.events.map((event) => ({ ...event, data: { ...event.data, id } })) };
    };
  } else if (options.planted === 'event-after-stop') {
    // A PostToolUse of a stopped turn opens a new turn before its own event.
    const stopped = new Set<string>();
    adapter.mapHook = (request, version, transcript) => {
      const mapped = mapHook(request, version, transcript);
      const payload = payloadOf(request.payload);
      const turn = `${String(payload.session_id)}/${String(payload.prompt_id)}`;
      if (mapped.events.some((event) => event.kind === 'agent.stop')) stopped.add(turn);
      if (payload.hook_event_name !== 'PostToolUse' || !stopped.has(turn)) return mapped;
      const opened = { agent: request.agent, kind: 'user.ask', data: { session: String(payload.session_id), turn: String(payload.prompt_id), from: 'unknown' }, rule: '/mapping/PostToolUse' };
      return { ...mapped, events: [opened, ...mapped.events] };
    };
  } else if (permissionReply && (options.planted === 'allow-from-label' || options.planted === 'allow-from-yes')) {
    const allows = options.planted === 'allow-from-label' ? (a: PermissionAnswer) => a.label === 'Allow' : (a: PermissionAnswer) => /\byes\b/i.test(a.words ?? '');
    adapter.permissionReply = (answer, request) => permissionReply(allows(answer) ? { ...answer, decision: 'allow' } : answer, request);
  }
  const drive = (operation: Operation): Driven => ({ outcome: 'unsupported', operation, surface });
  // The answer goes back as the hook's reply; no transcript is read here, so there is no sign of its delivery.
  const deliver = (_answer: unknown, session: string): Delivery => ({ session, sign: null });
  return { adapter, version: Object.keys(versions).at(-1)!, revision: REVISION, surface, drive, deliver };
}
