// AC9 #194.04da1020: "The same three tables as JSON lines in a game project's repo pack to the same bytes as the CSV
// fixture and meet the same checks with the same results; a planted JSON reader that keeps the file's row order instead
// of sorting by ID hash packs other bytes and fails, naming the first table"
//
// The fixture's three tables (fixtures.ts) written as CSV in one folder and as JSON lines in a game project's repo
// (`content/catalog/<table>.jsonl`, the paths its brief, `brief.json`, names), each packed by `deep-catalog pack`, the
// format read from the path's extension: the same SHA-256, bytes and record. The five catalog kinds through the hub
// (refs; reach from the start kit and the loot table; economy with the value column and margin 5; bounds with hp's
// [1, 200]; copy for en and fr), on the clean catalog and on the twin whose golem has hp 400, in both forms: the same
// outcomes, counts, failures and findings. The planted `catalog_jsonl_file_order` packs the JSON lines in their files'
// order: other bytes; each of the five kinds, opening that catalog, fails with one failure whose message starts
// `catalog.layout:` and names the first table in directory order (by name hash) whose rows aren't in ID-hash order:
// recipes, as this suite works out from the files.
// The wrong programs: the base (no deep-catalog), a JSON lines reader that keeps file order, reads a list or an empty
// cell otherwise than the CSV reader, or a check that reads a catalog whose IDs aren't sorted.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, blocked, canon, failuresOf, fnv32a, names, openHub, packAll, packCall, prebuildCatalog, runCheck, scratch, show, shown, specOf, writeTables,
  type Hub, type Kind, type Obj, type Packed, type PackCall, type Result,
} from './helpers.ts';
import { HP_RANGE, MAKES, MARGIN, ROOTS, SCHEMA, catalog, copy, withCell, type Tables } from './fixtures.ts';

prebuildCatalog();

const KINDS5: [Kind, (c: Packed) => Obj][] = [
  ['catalog.refs', (c) => ({ catalog: c.sha256 })],
  ['catalog.reach', (c) => ({ catalog: c.sha256, roots: ROOTS, makes: MAKES, every: ['items', 'recipes'] })],
  ['catalog.economy', (c) => ({ catalog: c.sha256, makes: MAKES, value: { table: 'items', column: 'value' }, margin: MARGIN })],
  ['catalog.bounds', (c) => ({ catalog: c.sha256, ranges: { 'creatures.hp': HP_RANGE } })],
  ['catalog.copy', (c) => ({ catalog: c.sha256, shown: ['items.name', 'creatures.name'], locales: ['en', 'fr'], copy: copy() })],
];
/** A result as two routes must agree on it: its outcome, count, failures and findings (its time left out). */
const verdictOf = (r: Result): string => canon({ outcome: r.outcome, testsRun: r.testsRun, failures: r.failures.map((f) => [f.test, f.message]), found: r.catalog?.found ?? null });
async function results(hub: Hub, c: Packed): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [kind, input] of KINDS5) out[kind] = verdictOf(await runCheck(hub, specOf(kind, input(c), [c])));
  return out;
}
/** The game project's repo: its tables as JSON lines at the paths its brief names; the pack call built from the brief. */
function gameRepo(root: string, t: Tables, planted?: string): PackCall {
  const tables = writeTables(join(root, 'content', 'catalog'), t, 'jsonl');
  const brief = { catalog: { tables: Object.fromEntries(Object.entries(tables).map(([n, { path }]) => [n, path.slice(root.length + 1)])), schema: SCHEMA } };
  writeFileSync(join(root, 'brief.json'), JSON.stringify(brief, null, 2));
  return { op: 'pack', tables: Object.fromEntries(Object.entries(brief.catalog.tables).map(([n, p]) => [n, { path: join(root, p) }])), schema: SCHEMA, out: join(root, `pack${planted ? `-${planted}` : ''}.bin`), ...(planted ? { planted } : {}) };
}

describe(`${AC[9]} a game project's JSON lines tables meet the same probe and checks as the CSV fixture`, () => {
  it(`${AC[9]} the JSON lines pack to the CSV fixture's bytes and meet the same checks with the same results; the planted file-order reader packs other bytes and fails, naming the first table`, async () => {
    const t = catalog();
    const twin = withCell(t, 'creatures', 'golem', 'hp', 400);
    const dir = scratch('ac09');
    const [csv, jsonl, csvTwin, jsonlTwin, fileOrder] = packAll([
      packCall(dir, t, SCHEMA, 'csv'), gameRepo(join(dir, 'game'), t), packCall(dir, twin, SCHEMA, 'csv'), gameRepo(join(dir, 'game-twin'), twin),
      gameRepo(join(dir, 'game-planted'), t, 'catalog_jsonl_file_order'),
    ], 'the fixture as CSV and as a game project\'s JSON lines');
    expect(jsonl!.sha256, 'the JSON lines pack to the CSV fixture\'s SHA-256').toBe(csv!.sha256);
    expect(jsonl!.bytes.equals(csv!.bytes), 'byte for byte').toBe(true);
    expect(canon(jsonl!.record), 'with the same record').toBe(canon(csv!.record));
    expect(jsonlTwin!.sha256, 'and the hp 400 twin\'s JSON lines pack to its CSV\'s bytes').toBe(csvTwin!.sha256);

    const hub = await openHub();
    for (const [a, b, what] of [[csv!, jsonl!, 'the fixture'], [csvTwin!, jsonlTwin!, 'the hp 400 twin']] as const) {
      const [x, y] = [await results(hub, a), await results(hub, b)];
      for (const [kind] of KINDS5) expect(y[kind], `${what}: ${kind} gives the JSON lines route the CSV route's result`).toBe(x[kind]);
    }
    const twinBounds = JSON.parse((await results(hub, csvTwin!))['catalog.bounds']!) as Obj;
    expect(twinBounds['outcome'], `the twin's results are a failure, not only agreement: ${show(twinBounds)}`).toBe('failed');

    // The first table, in directory order (by name hash), whose file order isn't its ID-hash order.
    const byHash = Object.keys(SCHEMA).sort((x, y) => fnv32a(x) - fnv32a(y));
    const unsorted = (name: string): boolean => t[name]!.rows.some((r, i, rows) => i > 0 && fnv32a(String(r['id'])) < fnv32a(String(rows[i - 1]!['id'])));
    const first = byHash.find(unsorted) ?? blocked('every table\'s file already lies in ID-hash order, so a file-order reader would pack the same bytes');
    expect(first, 'by the files, the first table out of order is recipes').toBe('recipes');
    expect(fileOrder!.sha256, 'the planted reader that keeps file order packs other bytes').not.toBe(csv!.sha256);
    for (const [kind, input] of KINDS5) {
      const r = await runCheck(hub, specOf(kind, input(fileOrder!), [fileOrder!]));
      expect(r.outcome, `${kind} fails the file-order bytes: ${shown(r)}`).toBe('failed');
      const f = failuresOf(r, 'catalog.layout:');
      expect([f.length, r.failures.length], `${kind}: one failure, catalog.layout: ${shown(r)}`).toEqual([1, 1]);
      expect(names(f[0]!.message, first), `${kind}: its message names the first table, ${first}: ${f[0]!.message}`).toBe(true);
    }
  }, TIMEOUT);
});
