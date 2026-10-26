// #379.20ef578a: a test writer's meter count equals the sizes the device reports for its allocations.
//
// The test writer (`allocate` and `release`, `test-meter` build only) creates the criterion's four
// allocations on Metal: a 2048 × 2048 rgba8 texture with all 12 mips, a 512 × 512 rgba16float cube with all
// 10 mips, a 1920 × 1080 depth32 target and a 1920 × 1080 rgba8 4× MSAA color target marked transient. Its
// count must equal within 1% the sum of the sizes the device reports, and Metal's allocated size must move
// by that count within 1 MiB on creation and again on release. `--planted formula_count` (width × height ×
// bytes per texel × samples) must miss the first, second and fourth by at least 5 MiB each and fail, naming
// them. A resource the device can't size makes the writer's memory limit BLOCKED, never PASS. Off macOS:
// INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import { MIB, W, answered, arr, num, obj, requireMetal, run, str, useBuilds, useOut, type JsonObject, type Planted } from './helpers.ts';

const builds = useBuilds(['test-meter']);
const out = useOut();
const ID = '#379.20ef578a';

const RESOURCES: JsonObject[] = [
  { name: 'color-2048', kind: 'texture', size: [2048, 2048], format: 'rgba8unorm', mips: 'all' },
  { name: 'cube-512', kind: 'texture', size: [512, 512], format: 'rgba16float', mips: 'all', cube: true },
  { name: 'depth-1080p', kind: 'texture', size: [1920, 1080], format: 'depth32float', mips: 1 },
  { name: 'msaa-1080p', kind: 'texture', size: [1920, 1080], format: 'rgba8unorm', mips: 1, samples: 4, transient: true },
];
/** The least each allocation can hold: every mip, every face and every sample (memoryless: nothing). */
const chain = (w: number, levels: number): number => Array.from({ length: levels }, (_, i) => (w >> i) ** 2).reduce((a, b) => a + b, 0);
const MINIMUM: Record<string, number> = {
  'color-2048': chain(2048, 12) * 4,
  'cube-512': chain(512, 10) * 8 * 6,
  'depth-1080p': 1920 * 1080 * 4,
  'msaa-1080p': 0,
};
const LIMIT_BYTES = 256_000_000;

interface Allocated { resources: { name: string; device_bytes: number | null; count_bytes: number }[]; count_bytes: number; device_before: number; device_after: number; limit: JsonObject }
function allocated(reply: JsonObject, what: string): Allocated {
  answered(reply, what);
  return {
    resources: arr(reply['resources'], `${what}: resources`).map((r, i) => {
      const o = obj(r, `${what}: resources[${i}]`);
      return { name: str(o['name'], `${what}: resources[${i}].name`), device_bytes: o['device_bytes'] === null ? null : num(o['device_bytes'], `${what}: ${o['name']} device_bytes`), count_bytes: num(o['count_bytes'], `${what}: ${o['name']} count_bytes`) };
    }),
    count_bytes: num(reply['count_bytes'], `${what}: count_bytes`), device_before: num(reply['device_before'], `${what}: device_before`),
    device_after: num(reply['device_after'], `${what}: device_after`), limit: obj(reply['limit'], `${what}: limit`),
  };
}

function cycle(resources: JsonObject[], planted?: Planted): { made: Allocated; freed: JsonObject } {
  requireMetal();
  const [made, freed] = run(builds.bin('test-meter'), out(), [
    { call: 'allocate', writer: W.test, limit_bytes: LIMIT_BYTES, resources },
    { call: 'release', writer: W.test },
  ], planted ? { planted } : {});
  return { made: allocated(made!, 'allocate'), freed: answered(freed!, 'release') };
}

/** The resources whose count misses the device's size by at least 5 MiB, named. */
const missed = (a: Allocated): string[] => a.resources.filter((r) => r.device_bytes !== null && Math.abs(r.count_bytes - r.device_bytes) >= 5 * MIB).map((r) => `${r.name}: counted ${r.count_bytes} B, the device reports ${r.device_bytes} B`);
/** The criterion's check: the count within 1% of the device's sizes, summed; failures name the resources that miss. */
function countProblems(a: Allocated): string[] {
  const device = a.resources.reduce((s, r) => s + (r.device_bytes ?? 0), 0);
  if (Math.abs(a.count_bytes - device) <= 0.01 * device) return [];
  return [`the count ${a.count_bytes} B isn't within 1% of the device's ${device} B`, ...missed(a)];
}

describe(`${ID} the meter counts what the device allocates`, () => {
  it(`${ID} the test writer's count equals within 1% the sizes the device reports, and Metal's allocated size moves by it within 1 MiB on creation and on release`, () => {
    const { made, freed } = cycle(RESOURCES);
    expect(made.resources.map((r) => r.name), 'one row per allocation, in order').toEqual(RESOURCES.map((r) => r['name']));
    for (const r of made.resources) {
      expect(r.device_bytes, `${r.name}: the device sizes it`).not.toBeNull();
      expect(r.device_bytes!, `${r.name}: the device's size holds every mip, face and sample (at least ${MINIMUM[r.name]} B)`).toBeGreaterThanOrEqual(MINIMUM[r.name]!);
    }
    const msaa = made.resources.find((r) => r.name === 'msaa-1080p')!;
    expect(msaa.device_bytes, 'the transient MSAA target is memoryless on Metal: the device reports 0').toBe(0);
    expect(msaa.count_bytes, 'and the meter counts 0 for it').toBe(0);
    expect(made.count_bytes, 'the writer\'s count is the sum of its rows').toBe(made.resources.reduce((s, r) => s + r.count_bytes, 0));
    expect(countProblems(made), 'the count equals within 1% the sum of the device\'s sizes').toEqual([]);
    expect(Math.abs(made.device_after - made.device_before - made.count_bytes), `Metal's allocated size moves by the count on creation (${made.device_after - made.device_before} B against ${made.count_bytes} B), within 1 MiB`).toBeLessThanOrEqual(MIB);
    const before = num(freed['device_before'], 'release: device_before');
    const after = num(freed['device_after'], 'release: device_after');
    expect(num(freed['count_bytes'], 'release: count_bytes'), 'after release the writer counts nothing').toBe(0);
    expect(Math.abs(before - after - made.count_bytes), `and moves back by it on release (${before - after} B), within 1 MiB`).toBeLessThanOrEqual(MIB);
    expect(made.limit['result'], `the writer's memory limit of ${LIMIT_BYTES} B is judged on sized resources`).toBe('PASS');
  }, 600_000);

  it(`${ID} a planted count of width × height × bytes per texel × samples misses the mipped texture, the cube and the MSAA target by at least 5 MiB each, and fails naming them`, () => {
    const { made } = cycle(RESOURCES, 'formula_count');
    const problems = countProblems(made);
    expect(problems.length, 'the planted count fails the 1% check').toBeGreaterThan(0);
    const named = missed(made).map((m) => m.split(':')[0]);
    expect(named, 'it misses exactly the first, second and fourth by at least 5 MiB, named').toEqual(['color-2048', 'cube-512', 'msaa-1080p']);
    expect(problems.join('\n'), 'the failure names them').toMatch(/color-2048[\s\S]*cube-512[\s\S]*msaa-1080p/);
  }, 600_000);

  it(`${ID} a resource the device can't size makes the writer's memory limit BLOCKED, never PASS`, () => {
    const { made } = cycle([...RESOURCES.slice(0, 1), { name: 'unsized', kind: 'texture', size: [64, 64], format: 'rgba8unorm', mips: 1, unsizable: true }]);
    const unsized = made.resources.find((r) => r.name === 'unsized');
    expect(unsized?.device_bytes, 'the device reports no size for it').toBeNull();
    expect(made.limit['result'], 'the limit check is BLOCKED, though the sized resources fit far under it').toBe('BLOCKED');
    expect(JSON.stringify(made.limit), 'naming the resource it can\'t size').toContain('unsized');
  }, 600_000);
});
