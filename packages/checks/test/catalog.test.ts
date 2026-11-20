// The catalog plug-in (#194): its kits run as the local preflight runs them, on the catalogs deep-catalog packs into
// the plug-in's fixtures (rebuilt with DEEP_194_WRITE=1, else held equal to a fresh pack), each kind's clean catalog
// passing, its twin failing with its code and its planted runner caught; and each kind on small catalogs packed here,
// failing on what the issue names and passing once it is fixed.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kitProblems, runKit } from '@deepbuild/conformance';
import { runBounds } from '../catalog/bounds.ts';
import type { CatalogResult } from '../catalog/check.ts';
import { runCopy } from '../catalog/copy.ts';
import { runEconomy } from '../catalog/economy.ts';
import register, { catalogSource } from '../catalog/index.ts';
import { catalogKit } from '../catalog/kit.ts';
import type { Packed } from '../catalog/layout.ts';
import { runReach } from '../catalog/reach.ts';
import { runRefs } from '../catalog/refs.ts';
import { runScenario } from '../catalog/scenario.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-catalog');
const FIXTURES = join(import.meta.dirname, '..', 'catalog', 'fixtures');
const out = mkdtempSync(join(tmpdir(), 'deep-catalog-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));
beforeAll(() => {
  const built = spawnSync('cargo', ['build', '--locked', '-p', 'deep-catalog', '--bin', 'deep-catalog'], { cwd: REPO, stdio: 'inherit' });
  expect(built.status, 'deep-catalog builds').toBe(0);
}, 600_000);

/** deep-catalog pack's answer to one line. */
function pack(line: Record<string, unknown>): { ok: boolean; sha256: string; record: Packed['record'] } {
  const r = spawnSync(BIN, ['pack'], { input: `${JSON.stringify(line)}\n`, encoding: 'utf8' });
  return JSON.parse(r.stdout) as never;
}

let made = 0;
/** A small catalog packed from CSV tables, as a check's spec carries it. */
function catalog(csv: Record<string, string>, schema: Record<string, unknown>): { catalog: string; carried: Record<string, Packed> } {
  const dir = join(out, `c${made++}`);
  mkdirSync(dir);
  const tables = Object.fromEntries(Object.entries(csv).map(([t, text]) => {
    writeFileSync(join(dir, `${t}.csv`), text);
    return [t, { path: join(dir, `${t}.csv`) }];
  }));
  const a = pack({ op: 'pack', tables, schema, out: join(dir, 'packed.bin') });
  expect(a.ok, JSON.stringify(a)).toBe(true);
  return { catalog: a.sha256, carried: { [a.sha256]: { bytes: readFileSync(join(dir, 'packed.bin')).toString('base64'), record: a.record } } };
}

const found = (r: CatalogResult): unknown[] => r.catalog.found;

describe('the catalog kits', () => {
  it('pack the kit\'s catalogs to the bytes and records the fixtures hold', () => {
    const schema = JSON.parse(readFileSync(join(FIXTURES, 'schema.json'), 'utf8')) as Record<string, unknown>;
    const names = readdirSync(FIXTURES).filter((f) => !f.includes('.'));
    expect(names).toContain('clean');
    for (const name of names) {
      // A twin's folder holds only the tables it changes; the rest are clean's.
      const tables = Object.fromEntries(Object.keys(schema).map((t) => {
        const own = join(FIXTURES, name, `${t}.csv`);
        return [t, { path: existsSync(own) ? own : join(FIXTURES, 'clean', `${t}.csv`) }];
      }));
      const fresh = join(out, `${name}.bin`);
      const a = pack({ op: 'pack', tables, schema, out: fresh });
      expect(a.ok, `${name} packs: ${JSON.stringify(a)}`).toBe(true);
      if (process.env['DEEP_194_WRITE'] === '1') {
        copyFileSync(fresh, join(FIXTURES, name, 'packed.bin'));
        writeFileSync(join(FIXTURES, name, 'record.json'), `${JSON.stringify(a.record)}\n`);
      }
      expect(readFileSync(fresh).equals(readFileSync(join(FIXTURES, name, 'packed.bin'))), `${name}'s packed bytes`).toBe(true);
      expect(a.record, `${name}'s record`).toEqual(JSON.parse(readFileSync(join(FIXTURES, name, 'record.json'), 'utf8')));
    }
  });

  it('passes each kind\'s clean catalog, fails its twin with its code and catches each kind\'s planted runner', async () => {
    const kit = catalogKit();
    expect(kitProblems(kit), 'the kit as the preflight checks it').toEqual([]);
    const clean = await runKit(kit, kit.clean()[0]!, { parts: ['fixed'] });
    expect(clean.cases.filter((c) => c.outcome !== 'PASS'), 'the reference passes every case').toEqual([]);
    expect(kit.planted.map((p) => p.name)).toEqual(['refs_skips_lists', 'reach_any_input', 'economy_gains_every_row', 'bounds_schema_only', 'copy_first_locale', 'scenario_ignores_deny']);
    for (const p of kit.planted) {
      const report = await runKit(kit, p.fill, { parts: ['fixed'] });
      expect(report.verdict, `${p.name} is caught`).toBe('FAIL');
      const failed = report.cases.filter((c) => c.outcome === 'FAIL');
      expect(failed.length, `${p.name} is caught on its own kind's twin alone`).toBe(1);
      expect(failed[0]!.message, `${p.name} is caught by its rule, naming its fixture`).toContain(p.message);
      expect(failed[0]!.message).toContain(failed[0]!.id);
      expect(failed[0]!.codes).toEqual(p.codes);
    }
  });
});

describe('the catalog kinds', () => {
  const ITEMS = { id: 'id', columns: {} };
  const MAKES = [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }];
  const RECIPES = { id: 'id', columns: { inputs: { type: 'refs items' }, tools: { type: 'refs items' }, outputs: { type: 'refs items' } } };

  it('refs: a recipe naming plank_oak, which no item holds, fails naming the recipe, the column and plank_oak', () => {
    const recipes = 'id,inputs,tools,outputs\nbuild_board,plank_oak;plank,,board\n';
    const twin = catalog({ items: 'id\nplank\nboard\n', recipes }, { items: ITEMS, recipes: RECIPES });
    const r = runRefs({ catalog: twin.catalog }, twin.carried);
    expect(r.outcome).toBe('failed');
    expect(found(r)).toEqual([{ code: 'catalog.ref_missing', table: 'recipes', row: 'build_board', column: 'inputs', ref: 'plank_oak' }]);
    expect(r.failures).toMatchObject([{ test: 'recipes.build_board', assertion: true }]);
    expect(r.failures[0]!.message).toMatch(/^catalog\.ref_missing: .*build_board.*inputs.*plank_oak/);
    expect(r.evidence).toEqual([twin.catalog]);
    const fixed = catalog({ items: 'id\nplank\nboard\nplank_oak\n', recipes }, { items: ITEMS, recipes: RECIPES });
    expect(runRefs({ catalog: fixed.catalog }, fixed.carried)).toMatchObject({ outcome: 'passed', testsRun: 1, failures: [] });
  });

  it('reach: a recipe needing nails, which nothing yields, fails naming the recipe and nails', () => {
    const recipes = 'id,inputs,tools,outputs\nsaw_log,log,knife,plank;plank\nnail_box,plank;nails,knife,box\n';
    const input = (c: string) => ({ catalog: c, roots: [{ table: 'kits', column: 'items' }], makes: MAKES, every: ['items', 'recipes'] });
    const schema = { items: ITEMS, recipes: RECIPES, kits: { id: 'id', columns: { items: { type: 'refs items' } } } };
    const twin = catalog({ items: 'id\nlog\nknife\nplank\nnails\nbox\n', recipes, kits: 'id,items\nstart,log;knife\n' }, schema);
    const r = runReach(input(twin.catalog), twin.carried);
    expect(r.outcome).toBe('failed');
    expect(r.testsRun).toBe(7);
    expect(found(r)).toContainEqual({ code: 'catalog.unreachable', table: 'recipes', row: 'nail_box', input: 'nails' });
    expect(found(r)).toContainEqual({ code: 'catalog.unreachable', table: 'items', row: 'nails', input: null });
    expect(r.failures.find((f) => f.test === 'recipes.nail_box')!.message).toMatch(/^catalog\.unreachable: recipes\.nail_box .*nails/);
    // A planted reach that takes a recipe once any one input is reaches nail_box through its plank.
    expect(found(runReach(input(twin.catalog), twin.carried, true))).not.toContainEqual(expect.objectContaining({ row: 'nail_box' }));
    const fixed = catalog({ items: 'id\nlog\nknife\nplank\nnails\nbox\n', recipes, kits: 'id,items\nstart,log;knife;nails\n' }, schema);
    expect(runReach(input(fixed.catalog), fixed.carried)).toMatchObject({ outcome: 'passed', failures: [] });
  });

  it('economy: 2 planks to a board and back to 3 fails naming the cycle and plank, back to 2 passes; a recipe past its margin fails', () => {
    const items = 'id\nplank\nboard\n';
    const recipes = (back: number) => `id,inputs,tools,outputs\nmake_board,plank;plank,,board\nsplit_board,board,,${Array(back).fill('plank').join(';')}\n`;
    const three = catalog({ items, recipes: recipes(3) }, { items: ITEMS, recipes: RECIPES });
    const r = runEconomy({ catalog: three.catalog, makes: MAKES }, three.carried);
    expect(r.outcome).toBe('failed');
    expect(found(r)).toEqual([{ code: 'catalog.gain_cycle', cycle: expect.arrayContaining(['make_board', 'split_board']), row: 'plank', gain: 1 }]);
    expect(r.failures[0]!.test).toMatch(/^(make_board → split_board|split_board → make_board)$/);
    expect(r.failures[0]!.message).toMatch(/^catalog\.gain_cycle: .*plank/);
    const two = catalog({ items, recipes: recipes(2) }, { items: ITEMS, recipes: RECIPES });
    expect(runEconomy({ catalog: two.catalog, makes: MAKES }, two.carried)).toMatchObject({ outcome: 'passed', testsRun: 2 });
    const valued = catalog({ items: 'id,value\nore,10\ngold,30\n', recipes: 'id,inputs,tools,outputs\nsmelt,ore,,gold\n' }, { items: { id: 'id', columns: { value: { type: 'f64' } } }, recipes: RECIPES });
    const v = runEconomy({ catalog: valued.catalog, makes: MAKES, value: { table: 'items', column: 'value' }, margin: 5 }, valued.carried);
    expect(found(v)).toEqual([{ code: 'catalog.gain_cycle', recipe: 'smelt', inputs: 10, outputs: 30, margin: 5 }]);
    expect(v.failures[0]).toMatchObject({ test: 'recipes.smelt', message: expect.stringMatching(/^catalog\.gain_cycle: recipes\.smelt/) });
    expect(runEconomy({ catalog: valued.catalog, makes: MAKES, value: { table: 'items', column: 'value' }, margin: 20 }, valued.carried).outcome).toBe('passed');
  });

  it('economy: past 100,000 elementary cycles fails unsettled, never passes', () => {
    // 9 recipes, each taking 8 of its own row and making one of each other's: every recipe leads to every other, so they
    // hold 125,664 elementary cycles, and none gains, each losing its own rows.
    const ids = Array.from({ length: 9 }, (_, i) => `r${i}`);
    const recipes = `id,inputs,tools,outputs\n${ids.map((id) => `${id},${Array(8).fill(`x_${id}`).join(';')},,${ids.filter((o) => o !== id).map((o) => `x_${o}`).join(';')}`).join('\n')}\n`;
    const items = `id\n${ids.map((id) => `x_${id}`).join('\n')}\n`;
    const c = catalog({ items, recipes }, { items: ITEMS, recipes: RECIPES });
    const r = runEconomy({ catalog: c.catalog, makes: MAKES }, c.carried);
    expect(r.outcome).toBe('failed');
    expect(r.failures).toMatchObject([{ assertion: false, message: expect.stringMatching(/^unsettled: /) }]);
  });

  it('bounds: a creature with hp 400 against [1, 200] fails naming the creature and hp', () => {
    const c = catalog({ creatures: 'id,hp\nwolf,30\nogre,400\n' }, { creatures: { id: 'id', columns: { hp: { type: 'i32', range: [1, 1000] } } } });
    const r = runBounds({ catalog: c.catalog, ranges: { 'creatures.hp': [1, 200] } }, c.carried);
    expect(found(r)).toEqual([{ code: 'catalog.out_of_range', table: 'creatures', row: 'ogre', column: 'hp', value: 400, range: [1, 200] }]);
    expect(r.failures).toMatchObject([{ test: 'creatures.ogre', message: expect.stringMatching(/^catalog\.out_of_range: creatures\.ogre's hp, 400/) }]);
    // The schema's range holds where the input gives none.
    expect(runBounds({ catalog: c.catalog, ranges: {} }, c.carried)).toMatchObject({ outcome: 'passed', testsRun: 2 });
  });

  it('copy: an item name key with English copy and no French fails for [en, fr], naming the key and fr', () => {
    const c = catalog({ items: 'id,name\ncudgel,1042\n' }, { items: { id: 'id', columns: { name: { type: 'copy items' } } } });
    const input = (fr: Record<string, string>) => ({ catalog: c.catalog, shown: ['items.name'], locales: ['en', 'fr'], copy: { en: { items: { 1042: 'Cudgel' } }, fr: { items: fr } } });
    const r = runCopy(input({}), c.carried);
    expect(found(r)).toEqual([{ code: 'catalog.copy_missing', table: 'items', row: 'cudgel', column: 'name', key: 1042, locale: 'fr', copy: 'items' }]);
    expect(r.failures[0]!.message).toMatch(/^catalog\.copy_missing: .*1042.*fr/);
    expect(runCopy(input({ 1042: 'Gourdin' }), c.carried)).toMatchObject({ outcome: 'passed', testsRun: 1 });
  });

  describe('scenario.reach', () => {
    const FORMS = 'id\nturn\nflag\nenter\ndefeated\nbuilt\nkilled\nstored\ntime\n';
    const schema = {
      forms: { id: 'id' }, flags: { id: 'id' }, sides: { id: 'id' }, kinds: { id: 'id' },
      messages: { id: 'id', columns: { text: { type: 'copy messages' } } },
      cells: { id: 'id', columns: { x: { type: 'i32' }, y: { type: 'i32' }, open: { type: 'bool' }, side: { type: 'ref sides' } } },
      triggers: { id: 'id', columns: {
        trigger: { type: 'ref forms' }, n: { type: 'i32' }, flag: { type: 'ref flags' }, side: { type: 'ref sides' }, cells: { type: 'refs cells' }, kind: { type: 'ref kinds' },
        sets: { type: 'refs flags' }, shows: { type: 'refs messages' }, allow: { type: 'refs kinds' }, deny: { type: 'refs kinds' },
      } },
    };
    // A 3 × 2 map split by a river at x 1; `ford` opens one of its cells.
    const cells = (ford: boolean) => `id,x,y,open,side\nc00,0,0,true,self\nc01,0,1,true,\nc10,1,0,false,\nc11,1,1,${ford},\nc20,2,0,true,\nc21,2,1,true,\n`;
    const head = 'id,trigger,n,flag,side,cells,kind,sets,shows,allow,deny\n';
    const scenario = (rows: string, o: { ford?: boolean; goals?: string[]; copy?: Record<string, string> } = {}): CatalogResult => {
      const c = catalog({ forms: FORMS, flags: 'id\nbridge_burned\n', sides: 'id\nself\nenemy\n', kinds: 'id\nextractor\n', messages: 'id,text\nwon,3001\n', cells: cells(o.ford ?? false), triggers: head + rows }, schema);
      const copy = { en: { messages: o.copy ?? { 3001: 'Victory' } }, fr: { messages: o.copy ?? { 3001: 'Victoire' } } };
      return runScenario({ catalog: c.catalog, triggers: 'triggers', map: 'cells', goals: o.goals ?? ['victory'], turns: 20, copy, locales: ['en', 'fr'] }, c.carried);
    };

    it('fails a victory needing the flag bridge_burned, which no row sets, naming the victory and the flag', () => {
      const r = scenario('start,turn,0,,,,,,,,\nvictory,flag,,bridge_burned,,,,,,,\n');
      expect(found(r)).toEqual([{ code: 'scenario.unreachable', row: 'victory', why: 'flag bridge_burned' }]);
      expect(r.failures).toMatchObject([{ test: 'triggers.victory', message: expect.stringMatching(/^scenario\.unreachable: triggers\.victory .*flag bridge_burned/) }]);
      expect(scenario('start,turn,0,,,,,,,,\nburn,turn,3,,,,,bridge_burned,,,\nvictory,flag,,bridge_burned,,,,,,,\n')).toMatchObject({ outcome: 'passed', testsRun: 3 });
    });

    it('fails an ambush on cells across a river no side can cross, naming the ambush and its cells', () => {
      const rows = 'ambush,enter,,,self,c20;c21,,,,,\n';
      expect(found(scenario(rows, { goals: ['ambush'] }))).toEqual([{ code: 'scenario.unreachable', row: 'ambush', why: 'enter c20, c21' }]);
      expect(scenario(rows, { goals: ['ambush'], ford: true }).outcome).toBe('passed');
    });

    it('fails a victory that shows a message key with no copy, naming the key', () => {
      const r = scenario('victory,turn,5,,,,,,won,,\n', { copy: {} });
      expect(found(r)).toEqual([{ code: 'scenario.unreachable', row: 'victory', key: 3001, locale: 'en' }, { code: 'scenario.unreachable', row: 'victory', key: 3001, locale: 'fr' }]);
      expect(r.failures[0]!.message).toMatch(/^scenario\.unreachable: .*3001/);
    });

    it('fails built extractor denied at the start and never allowed, naming built and extractor; allowed at time 60 passes', () => {
      const denied = 'start,time,0,,,,,,,,extractor\nvictory,built,3,,self,,extractor,,,,\n';
      const r = scenario(denied);
      expect(found(r)).toEqual([{ code: 'scenario.unreachable', row: 'victory', why: 'built extractor' }]);
      expect(r.failures[0]!.message).toMatch(/^scenario\.unreachable: triggers\.victory .*built extractor/);
      expect(scenario(`${denied}mines,time,60,,,,,,,extractor,\n`).outcome).toBe('passed');
    });
  });

  it('refuses a catalog whose record isn\'t its directory, naming the first table, and one the spec doesn\'t carry', () => {
    const c = catalog({ items: 'id\nplank\n' }, { items: ITEMS });
    const packed = c.carried[c.catalog]!;
    const record = { ...packed.record, tables: packed.record.tables.map((t) => ({ ...t, rows: t.rows + 1 })) };
    const r = runRefs({ catalog: c.catalog }, { [c.catalog]: { ...packed, record } });
    expect(r).toMatchObject({ outcome: 'failed', testsRun: 0, failures: [{ assertion: false, message: expect.stringMatching(/^catalog\.layout: .*table items/) }] });
    expect(runRefs({ catalog: c.catalog }, {}).outcome).toBe('missing');
  });

  it('registers the six kinds, answers ran_nothing for a spec without its input, and binds an agent\'s input only to its own checks', async () => {
    const kinds = new Map<string, (spec: object) => Promise<{ outcome: string }>>();
    register({ registerCheck: (type, runner) => void kinds.set(type, runner as never) });
    expect([...kinds.keys()]).toEqual(['catalog.refs', 'catalog.reach', 'catalog.economy', 'catalog.bounds', 'catalog.copy', 'scenario.reach']);
    expect((await kinds.get('catalog.reach')!({})).outcome).toBe('ran_nothing');
    const c = catalog({ items: 'id\nplank\n' }, { items: ITEMS });
    expect((await kinds.get('catalog.bounds')!({ bounds: { catalog: c.catalog, ranges: {} }, catalogs: c.carried })).outcome).toBe('passed');
    expect(catalogSource({ by: 'agent' })).toBe('own');
    expect(catalogSource({})).toBe('definition');
  });
});
