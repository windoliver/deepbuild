// The one runner, two forms (#313, #314): adapter@1's kit runs synchronously on a Fill and reports as #313
// defined; every other slot's kit runs its fixed and seeded parts on a SlotFill and reports with its seed. The
// preflight's kit check takes either kit.
import type { SchemaEntry } from '@deepbuild/contracts';
import { kitProblems as adapterKitProblems, runKit as runAdapterKit } from './runner.js';
import { runSlotKit, slotKitProblems } from './slot-runner.js';
import { isSlotKit } from './slot-types.js';
import type { SlotFill, SlotKit, SlotReport, SlotRunOptions } from './slot-types.js';
import type { Fill, Kit, Problem, Report } from './types.js';

export function runKit(kit: Kit, fill: Fill, options: { headless: boolean }): Report;
export function runKit<F extends SlotFill>(kit: SlotKit<F>, fill: F, options?: SlotRunOptions): Promise<SlotReport>;
export function runKit(kit: Kit | SlotKit, fill: Fill | SlotFill, options?: { headless: boolean } | SlotRunOptions): Report | Promise<SlotReport> {
  if (isSlotKit(kit)) return runSlotKit(kit, fill as SlotFill, (options ?? {}) as SlotRunOptions);
  return runAdapterKit(kit, fill as Fill, options as { headless: boolean });
}

export function kitProblems(kit: Kit, schemas?: readonly SchemaEntry[]): Problem[];
export function kitProblems(kit: SlotKit): Problem[];
export function kitProblems(kit: Kit | SlotKit, schemas?: readonly SchemaEntry[]): Problem[] {
  return isSlotKit(kit) ? slotKitProblems(kit) : adapterKitProblems(kit, schemas);
}
