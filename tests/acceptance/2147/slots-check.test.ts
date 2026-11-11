// #2147: the preflight's slot check, scripts/slots-check.mjs, passes on main (the library source slot has a kit
// with a planted wrong fill it refuses, and the channel kit's reference fill passes), and a slot added with no kit
// still fails it, naming the slot.
//
// The surface is the script itself (exit code and its `PASS slots` / `FAIL slots: ...` lines), run on the shipped
// contract or, with --api/--table, on temp copies with a planted row; and @deepbuild/conformance's public entry
// (slotKits, slotProblems) for the library row's kit. The real contract files are never edited.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { ApiEntry, HubSlot } from '../../../packages/contracts/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SLOTS_CHECK = join(REPO, 'scripts/slots-check.mjs');
const readApi = (): ApiEntry[] => JSON.parse(readFileSync(join(REPO, 'packages/contracts/extension-api.json'), 'utf8')) as ApiEntry[];
const readTable = (): HubSlot[] => JSON.parse(readFileSync(join(REPO, 'packages/contracts/hub-slots.json'), 'utf8')) as HubSlot[];
const conformance = () => import('../../../packages/conformance/src/index.ts');
const ZERO = `d1:${'0'.repeat(64)}`;

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

interface Checked { status: number | null; stdout: string; fails: string[] }
/** The slot check as the preflight runs it; with a contract given, on temp copies of it. */
function slotsCheck(contract?: { api: ApiEntry[]; table: HubSlot[] }): Checked {
  const args = [SLOTS_CHECK];
  if (contract) {
    const dir = realpathSync(mkdtempSync('/tmp/dh2147-slots-'));
    made.push(dir);
    writeFileSync(join(dir, 'extension-api.json'), JSON.stringify(contract.api, null, 2));
    writeFileSync(join(dir, 'hub-slots.json'), JSON.stringify(contract.table, null, 2));
    args.push('--api', join(dir, 'extension-api.json'), '--table', join(dir, 'hub-slots.json'));
  }
  const r = spawnSync(process.execPath, args, {
    cwd: REPO, encoding: 'utf8', timeout: 300_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1' },
  });
  const stdout = r.stdout ?? '';
  return { status: r.status, stdout: `${stdout}${r.stderr ?? ''}`, fails: stdout.split('\n').filter((line) => line.startsWith('FAIL slots')) };
}

describe('AC1 #2147.328da474 `node scripts/slots-check.mjs` exits 0 on main', () => {
  it('AC1 the slot check on the shipped contract exits 0 with its PASS line and no FAIL line', () => {
    const r = slotsCheck();
    expect(r.fails, r.stdout).toEqual([]);
    expect(r.stdout).toMatch(/^PASS slots/m);
    expect(r.status, r.stdout).toBe(0);
  }, 300_000);

  it('AC1 the library source slot names a kit the conformance package ships, with a planted wrong fill that kit refuses', async () => {
    const row = readTable().find((s) => s.method === 'deep.registerSource' && s.variant === 'library');
    expect(row, 'hub-slots.json has the deep.registerSource, library row').toBeDefined();
    expect(row!.interface).toBe('asset.library@1');
    expect(row!.kit, 'the library slot names a kit').toBeTruthy();
    expect(row!.planted.length, 'the library slot plants at least one wrong fill').toBeGreaterThan(0);
    const { slotKits, slotProblems } = await conformance();
    const kit = slotKits().find((k) => k.slot === row!.kit);
    expect(kit, `the conformance package ships the kit ${row!.kit}`).toBeDefined();
    for (const name of row!.planted) expect(kit!.planted.map((p) => p.name), `the kit plants ${name}`).toContain(name);
    const api = readApi().filter((e) => e.method === 'deep.registerSource');
    const problems = slotProblems(api, readTable().filter((s) => s.method === 'deep.registerSource'), slotKits())
      .filter((p) => p.variant === 'library');
    expect(problems, 'the library slot passes the slot check: its kit refuses each planted fill').toEqual([]);
  }, 300_000);

  it('AC1 neither the source slots nor the channel slot has a FAIL line from the shipped slot check', () => {
    const r = slotsCheck();
    expect(r.fails.filter((line) => line.includes('deep.registerChannel')), r.stdout).toEqual([]);
    expect(r.fails.filter((line) => line.includes('deep.registerSource')), r.stdout).toEqual([]);
  }, 300_000);
});

describe('AC2 #2147.6a9b3c54 A slot added with no kit still fails it, naming the slot', () => {
  it('AC2 a planted deep.registerFoo with no kit fails the slot check, naming deep.registerFoo and the missing kit', () => {
    const FOO = 'deep.registerFoo';
    const api: ApiEntry[] = [...readApi(), { method: FOO, variants: null, since: 'R1', stability: 'preview', digest: ZERO } as ApiEntry];
    const table: HubSlot[] = [...readTable(), { method: FOO, variant: null, interface: 'foo@1', digest: ZERO, fills: 'many', since: 'R1', kit: null, planted: [] } as HubSlot];
    const r = slotsCheck({ api, table });
    expect(r.status, r.stdout).toBe(1);
    const named = r.fails.filter((line) => line.includes(FOO));
    expect(named, `a FAIL line names ${FOO}: ${r.stdout}`).not.toEqual([]);
    expect(named.join('\n')).toMatch(/kit/);
    expect(r.stdout).not.toMatch(/^PASS slots/m);
  }, 300_000);

  it('AC2 a new variant of deep.registerSource added with no kit fails the slot check, naming that variant', () => {
    const api = readApi().map((e) => (e.method === 'deep.registerSource' ? { ...e, variants: [...(e.variants ?? []), 'planted2147'] } : e));
    const library = readTable().find((s) => s.method === 'deep.registerSource' && s.variant === 'library')!;
    const table: HubSlot[] = [...readTable(), { ...library, variant: 'planted2147', kit: null, planted: [] }];
    const r = slotsCheck({ api, table });
    expect(r.status, r.stdout).toBe(1);
    const named = r.fails.filter((line) => line.includes('deep.registerSource, planted2147'));
    expect(named, `a FAIL line names deep.registerSource, planted2147: ${r.stdout}`).not.toEqual([]);
    expect(named.join('\n')).toMatch(/kit/);
  }, 300_000);
});
