// The shipped slot kits (#314): one per hub slot whose fixtures and planted fills the core brings, each fresh
// per call so a test's spread of one never reaches another's. adapter@1's kit stays kits() (#313). #349 adds the
// resolver, panel, route and action kits, so every `deep.register*` slot has one; #65 adds the channel kit, #67 the state-source kit, #1922 the job-kind kit.
import type { SlotFill, SlotKit, SlotKitImpl } from '../slot-types.js';
import { actionKit } from './action.js';
import { channelKit } from './channel.js';
import { checkKindKit } from './check-kind.js';
import { environmentKit } from './environment.js';
import { jobKindKit } from './job-kind.js';
import { panelKit } from './panel.js';
import { resolverKit } from './resolver.js';
import { routeKit } from './route.js';
import { readingSourceKit } from './reading-source.js';
import { sourceKit } from './source.js';
import { stateSourceKit } from './state-source.js';
import { indexKit } from './wiki-index.js';

export const slotKits = (): SlotKit[] => [checkKindKit(), indexKit(), environmentKit(), sourceKit(), readingSourceKit(), resolverKit(), panelKit(), routeKit(), actionKit(), channelKit(), stateSourceKit(), jobKindKit()] as SlotKit[];

/** The kit's reference fills, one per variant the slot names, fresh. */
export function cleanFills<F extends SlotFill>(kit: SlotKit<F>): F[] {
  const impl = kit as Partial<SlotKitImpl<F>>;
  if (typeof impl.clean !== 'function') throw Error(`${kit.slot} is not a kit of slotKits(): it has no reference fill`);
  return impl.clean();
}
