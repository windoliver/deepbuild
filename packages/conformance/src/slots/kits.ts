// The shipped slot kits (#314): one per hub slot whose fixtures and planted fills the core brings, each fresh
// per call so a test's spread of one never reaches another's. adapter@1's kit stays kits() (#313).
import type { SlotFill, SlotKit, SlotKitImpl } from '../slot-types.js';
import { checkKindKit } from './check-kind.js';
import { environmentKit } from './environment.js';
import { readingSourceKit } from './reading-source.js';
import { sourceKit } from './source.js';
import { indexKit } from './wiki-index.js';

export const slotKits = (): SlotKit[] => [checkKindKit(), indexKit(), environmentKit(), sourceKit(), readingSourceKit()] as SlotKit[];

/** The kit's reference fills, one per variant the slot names, fresh. */
export function cleanFills<F extends SlotFill>(kit: SlotKit<F>): F[] {
  const impl = kit as Partial<SlotKitImpl<F>>;
  if (typeof impl.clean !== 'function') throw Error(`${kit.slot} is not a kit of slotKits(): it has no reference fill`);
  return impl.clean();
}
