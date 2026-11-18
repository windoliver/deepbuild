// The `./unchecked` entry (#2655): the facts files, and the shipped adapters built from them with no registration
// check, so a thread that only reads an agent's facts, caps and replies loads no validator. Whatever maps hooks in the
// same process holds the same facts to the published shapes, through the full entry's registry. The hub's event loop
// reads its adapters here.
import { shippedIn } from './facts.js';
import type { Adapter, AdapterRegistry } from './types.js';

export { ADAPTERS, factsAdapter, readFacts } from './facts.js';
export type { Adapter, AdapterRegistry, HookRequestLine, JsonObject } from './types.js';

/** An empty registry that checks nothing at registration. */
export function registry(): AdapterRegistry {
  const adapters = new Map<string, Adapter>();
  const held = (name: string): Adapter => {
    const adapter = adapters.get(name);
    if (!adapter) throw Error(`No adapter is registered under ${JSON.stringify(name)}.`);
    return adapter;
  };
  return {
    register(name, adapter) { adapters.set(name, adapter); },
    names: () => [...adapters.keys()],
    get: held,
    mapHook(request, version, transcript) {
      const mapped = held(request.agent).mapHook(request, version, transcript);
      return { ...mapped, events: mapped.events.map((event) => ({ ...event, agent: request.agent })) };
    },
  };
}

/** The shipped adapters, each built from its facts at its first use and held to nothing. */
export const shipped = (): AdapterRegistry => shippedIn(registry(), () => undefined);
