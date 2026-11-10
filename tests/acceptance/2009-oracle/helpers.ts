// The #2009 Oracle lane's tools: the #2009 suite's surface (`deep-physics`, its world documents and readers), reused as
// it stands so both lanes ask the same program the same way, plus the upstream tests' world: Rapier's defaults that the
// pinned tests leave as they are (README: Sources), written as our world document.
import { world, type JsonObject, type WorldParts } from '../2009/helpers.ts';

export * from '../2009/helpers.ts';

/** Upstream's PhysicsWorld / IntegrationParameters defaults as our fields: 60 Hz, 4 solver iterations (our substeps). */
export const UPSTREAM_RATE = 60;
export function upstreamWorld(parts: WorldParts): JsonObject {
  return world({ step_rate: UPSTREAM_RATE, substeps: 4, ...parts });
}
/** Rapier's collider density default (1 kg/m³) and friction default (0.5), as a contact material. */
export const upstreamMaterial = (extra: JsonObject = {}): JsonObject => ({ friction: 0.5, restitution: 0, density: 1, ...extra });
