// AC5: a planted slot `deep.registerFoo` declared without a kit or a planted wrong fill fails the local preflight,
// naming the slot, and one whose kit admits its planted fill fails it, naming the fill.
//
// The preflight's check is scripts/slots-check.mjs over the published extension API and the hub-slot table
// (README, The surface under test); its function form, `slotProblems`, takes the kits too, so a kit the test derives
// (one that admits its planted fill, wrong.ts) can be put in front of it. The lint lane of scripts/lanes.mjs runs the
// script.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformance, REPO } from './helpers.ts';
import { readApi, readTable, runSlotsCheck, ZERO } from './slotting.ts';
import { admittingKit } from './wrong.ts';

const FOO = 'deep.registerFoo';
const fooEntry = { method: FOO, variants: null, since: 'R1', stability: 'preview' as const, digest: ZERO };
const fooRow = { method: FOO, variant: null, interface: 'foo@1', digest: ZERO, fills: 'many', since: 'R1' };

describe('AC5 #349.2eb6c029 a planted slot deep.registerFoo declared without a kit or a planted wrong fill fails the preflight naming the slot; one whose kit admits its planted fill fails it naming the fill', () => {
  it('AC5 the published contract passes the preflight\'s slot check, which the lint lane runs', () => {
    const real = runSlotsCheck(readApi(), readTable());
    expect(real.status, `${real.stdout}\n${real.stderr}`).toBe(0);
    expect(real.stdout).toMatch(/^PASS slots/m);
    expect(readFileSync(join(REPO, 'scripts/lanes.mjs'), 'utf8'), 'the local preflight runs the slot check').toContain('scripts/slots-check.mjs');
  }, 300_000);

  it('AC5 a planted deep.registerFoo declared with no kit fails the preflight, naming the slot and the missing kit', () => {
    const r = runSlotsCheck([...readApi(), fooEntry], [...readTable(), { ...fooRow, kit: null, planted: [] }]);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
    const named = r.fails.filter((line) => line.includes(FOO));
    expect(named, `the FAIL lines name ${FOO}: ${r.stdout}`).not.toEqual([]);
    expect(named.join('\n')).toMatch(/kit/);
  }, 300_000);

  it('AC5 a planted deep.registerFoo declared with a kit but no planted wrong fill fails the preflight, naming the slot and the missing planted fill', () => {
    const r = runSlotsCheck([...readApi(), fooEntry], [...readTable(), { ...fooRow, kit: 'check.kind@1', planted: [] }]);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(1);
    const named = r.fails.filter((line) => line.includes(FOO));
    expect(named, `the FAIL lines name ${FOO}: ${r.stdout}`).not.toEqual([]);
    expect(named.join('\n')).toMatch(/planted/);
  }, 300_000);

  it('AC5 (wrong program) a check.kind@1 kit that admits its planted fill crashed-suite fails the preflight\'s check, naming the fill; the shipped kit passes it', async () => {
    const { slotKits, slotProblems } = await conformance();
    const kit = slotKits().find((k) => k.slot === 'check.kind@1');
    expect(kit, 'the conformance package ships check.kind@1\'s kit').toBeDefined();
    const api = readApi().filter((e) => e.method === 'deep.registerCheck');
    const table = readTable().filter((row) => row.method === 'deep.registerCheck');
    expect(table.map((row) => row.kit), 'deep.registerCheck\'s row names check.kind@1\'s kit').toEqual(['check.kind@1']);
    expect(slotProblems(api, table, [kit!]), 'the shipped kit refuses each of its planted fills').toEqual([]);
    const problems = slotProblems(api, table, [await admittingKit(kit!, 'crashed-suite')]);
    const admitted = problems.filter((p) => p.fill === 'crashed-suite');
    expect(admitted, `the check names the admitted fill: ${JSON.stringify(problems)}`).not.toEqual([]);
    expect(admitted[0]!.method).toBe('deep.registerCheck');
    expect(admitted[0]!.reason).toContain('crashed-suite');
  }, 300_000);
});
