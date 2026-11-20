// #2956: a soak's step limit counts on each of the design's reference Macs (design: The reference Macs), as
// scripts/benchmark.mjs's list names them, and on no other Mac. The machine is planted through sysctl, the boundary.
import { afterEach, expect, it, vi } from 'vitest';
import { references } from '../../../scripts/benchmark.mjs';

const machine: Record<string, string> = {};
vi.mock('node:child_process', async (actual) => ({
  ...(await actual<typeof import('node:child_process')>()),
  spawnSync: (command: string, args: string[]) => ({ stdout: command === 'sysctl' ? `${machine[args[1] ?? ''] ?? ''}\n` : '' }),
}));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.resetModules();
});

async function onMac(model: string, memoryBytes: number, cores: number): Promise<boolean> {
  Object.assign(machine, { 'hw.model': model, 'hw.memsize': String(memoryBytes), 'hw.ncpu': String(cores) });
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const { onReferenceMac } = await import('../playtest/soak.ts');
  return onReferenceMac();
}

for (const mac of references) {
  it(`counts a soak's step limit on the ${mac.name}`, async () => {
    expect(await onMac(mac.model, mac.memoryBytes, mac.cores)).toBe(true);
  });
}

it("doesn't count it on another Mac, or on a reference Mac's model with other memory", async () => {
  expect(await onMac('Mac14,2', 16 * 2 ** 30, 8)).toBe(false);
  expect(await onMac('Mac18,1', 16 * 2 ** 30, 12)).toBe(false);
});
