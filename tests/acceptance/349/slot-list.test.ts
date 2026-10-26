// AC8: the preflight takes the slot list from the published contract, one slot per `deep.register*` method and per
// variant its shape names, so `deep.registerSource` gives a stream, a polled source and a tool on an MCP server; a
// planted MCP variant with no row in the hub-slot table fails the preflight, naming the method and the variant, and
// a check that lists slots from the table itself passes it and fails this test.
//
// The published contract is `extensionApi()` (packages/contracts/extension-api.json), whose registerSource entry
// names its variants `stream`, `polled` and `mcp`; the table is `hubSlots()`. The planted twin is wrong.ts's
// `slotsFromTable`, which reads only the table (README, Readings: the slot list).
import { describe, expect, it } from 'vitest';
import { conformance, contracts, host } from './helpers.ts';
import { readApi, readTable, runSlotsCheck } from './slotting.ts';
import { slotsFromTable } from './wrong.ts';

const SOURCE = 'deep.registerSource';
const VARIANTS = ['stream', 'polled', 'mcp'];
const withoutMcp = () => readTable().filter((row) => !(row.method === SOURCE && row.variant === 'mcp'));
const namesMcp = (lines: string[]): void => {
  const found = lines.filter((line) => line.includes(SOURCE) && /\bmcp\b/.test(line));
  expect(found, `a finding names ${SOURCE} and its variant mcp: ${JSON.stringify(lines)}`).not.toEqual([]);
};

describe('AC8 #349.b8d8858e the preflight lists slots from the published contract, per register* method and variant; a planted MCP variant with no row fails it naming the method and the variant; a check listing slots from the table passes it and fails this test', () => {
  it('AC8 the published contract names every deep.register* method the host\'s API has, registerSource with a stream, a polled source and an MCP tool, and the table has a row for each', async () => {
    const { extensionApi, hubSlots, frozenDigests } = await contracts();
    const { EXTENSION_API } = await host();
    const api = extensionApi();
    const table = hubSlots();
    for (const m of EXTENSION_API.filter((m) => m.method.startsWith('deep.register'))) expect(api.map((e) => e.method), `the published contract lists ${m.method}`).toContain(m.method);
    const source = api.find((e) => e.method === SOURCE);
    expect(source?.variants ?? [], `${SOURCE}'s shape names its variants`).toEqual(expect.arrayContaining(VARIANTS));
    const frozen = frozenDigests();
    for (const variant of VARIANTS) {
      const rows = table.filter((row) => row.method === SOURCE && row.variant === variant);
      expect(rows, `one row for ${SOURCE}, ${variant}`).toHaveLength(1);
      const [row] = rows;
      expect(row!.interface).toMatch(/^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/);
      expect(row!.digest, `${row!.interface}'s frozen d1: digest`).toBe(frozen[row!.interface]);
      expect(row!.kit, 'its kit').toBeTruthy();
      expect(row!.planted.length, 'its planted wrong fill').toBeGreaterThanOrEqual(1);
    }
    expect(JSON.parse(JSON.stringify(readApi())), 'extensionApi() is the published file').toEqual(JSON.parse(JSON.stringify(api)));
  }, 60_000);

  it('AC8 a planted MCP variant of deep.registerSource with no row in the hub-slot table fails the preflight, naming the method and the variant', () => {
    const r = runSlotsCheck(readApi(), withoutMcp());
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
    namesMcp(r.fails);
  }, 300_000);

  it('AC8 (wrong program) a check that lists slots from the table itself passes the table with no MCP row, and fails this test', async () => {
    const { slotKits, kits } = await conformance();
    const kitNames = [...slotKits().map((k) => k.slot), ...kits().map((k) => k.name)];
    const problems = slotsFromTable(withoutMcp(), kitNames);
    expect(() => namesMcp(problems.map((p) => `${p.method}, ${p.variant ?? '-'}: ${p.reason}`))).toThrow(/deep\.registerSource/);
  }, 60_000);
});
