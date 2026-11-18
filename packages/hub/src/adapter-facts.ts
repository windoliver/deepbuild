// Adapter registration and facts shared by the core and parser, without the payload scrubber.
import { registry as emptyRegistry, shipped, type AdapterRegistry } from '@deepbuild/adapters';
import { adapterIn, widened } from './socket-adapters.js';

let adapters: AdapterRegistry | undefined;
/** The shipped adapters, or the test-only widened facts used by the live smoke tests. */
export const hubAdapters = (): AdapterRegistry => widened(shipped(), emptyRegistry);
/** The hub's adapters, validated once per thread. */
export const registry = (): AdapterRegistry => (adapters ??= hubAdapters());
/** The adapter an agent's hooks map through, whose caps and facts answer for it. */
export const adapterOf = adapterIn(registry);
