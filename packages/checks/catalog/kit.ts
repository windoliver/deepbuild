// check.kind@1's kit for the catalog plug-in's six kinds (#194), run by the conformance package's runner from
// packages/checks/test and in the local preflight, as the playtest's are: one kit for the six kinds, passing each
// kind's clean catalog, failing each kind's planted twin with its code at the row or cycle the twin plants, and
// catching each kind's planted runner, which breaks that kind's rule alone, as every check kind ships a planted
// failure it catches (#68). A runner answers at once, so the preflight's synchronous kit check runs the kit too. The catalogs are this folder's
// fixtures, which deep-catalog packs (packages/checks/test/catalog.test.ts rebuilds them with DEEP_194_WRITE=1):
// fixtures/<name>/*.csv under fixtures/schema.json, a twin's folder holding only the tables it changes from clean's,
// each packed as fixtures/<name>/packed.bin beside its record.json; fixtures/copy.json is the kit's data.copy.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fail, Finding } from '@deepbuild/conformance';
import type { CheckResult, CheckRunnerFill, CheckSpec, Fixture, SlotCase, SlotKitImpl } from '@deepbuild/conformance';
import type { Carried, Kind, Makes } from './check.ts';
import type { Code } from './codes.ts';
import type { Copy } from './copy.ts';
import { KINDS } from './index.ts';

const SLOT = 'check.kind@1';
const MAKES: Makes[] = [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }];

interface Case {
  /** The kind's input on the catalog `asset`, the definition's, so no case's roots or ranges are the agent's. */
  input: (asset: string, copy: Copy) => object;
  /** The twin that plants the kind's code, and the test of the failure that must name what it plants. */
  twin: string; test: string; code: Code;
  /** The planted runner and the one rule it breaks. */
  planted: string; rule: { id: string; rule: string }; message: string;
}
const CASES: Record<Kind, Case> = {
  'catalog.refs': {
    input: (catalog) => ({ catalog }), twin: 'plank-oak', test: 'recipes.glue_cudgel', code: 'catalog.ref_missing',
    planted: 'refs_skips_lists', message: 'passed a refs list naming an ID no row holds',
    rule: { id: 'refs-in-lists', rule: 'Each ID a ref or a refs column names is a row of its table, or catalog.ref_missing names the table, the row, the column and the ID.' },
  },
  'catalog.reach': {
    input: (catalog) => ({ catalog, roots: [{ table: 'kits', column: 'items' }, { table: 'loot', column: 'drops' }, { table: 'creatures', column: 'drops' }], makes: MAKES, every: ['items', 'recipes'] }),
    twin: 'nails', test: 'recipes.nail_crate', code: 'catalog.unreachable',
    planted: 'reach_any_input', message: 'reached a recipe before all its inputs were',
    rule: { id: 'reach-every-need', rule: 'A recipe is reachable only once every row its inputs and tools name is.' },
  },
  'catalog.economy': {
    input: (catalog) => ({ catalog, makes: MAKES }), twin: 'plank-cycle', test: 'split_board → make_board', code: 'catalog.gain_cycle',
    planted: 'economy_gains_every_row', message: 'passed a cycle that gains a row',
    rule: { id: 'economy-net-gain', rule: 'A cycle made once around gains when it ends with no less of any row and more of one, or catalog.gain_cycle names the cycle and the row.' },
  },
  'catalog.bounds': {
    input: (catalog) => ({ catalog, ranges: { 'creatures.hp': [1, 200] } }), twin: 'bear-hp', test: 'creatures.bear', code: 'catalog.out_of_range',
    planted: 'bounds_schema_only', message: 'held a column to its schema\'s range over the brief\'s',
    rule: { id: 'bounds-brief-range', rule: 'A range the input gives a column holds in place of the schema\'s, or catalog.out_of_range names the row.' },
  },
  'catalog.copy': {
    input: (catalog, copy) => ({ catalog, shown: ['items.name'], locales: ['en', 'fr'], copy }), twin: 'lantern-fr', test: 'items.lantern', code: 'catalog.copy_missing',
    planted: 'copy_first_locale', message: 'passed a key with no copy in a later locale',
    rule: { id: 'copy-every-locale', rule: 'Each key a shown column holds has copy in every locale the input names, or catalog.copy_missing names the key and the locale.' },
  },
  'scenario.reach': {
    input: (catalog, copy) => ({ catalog, triggers: 'triggers', goals: ['victory'], turns: 20, copy, locales: ['en', 'fr'] }),
    twin: 'extractor-denied', test: 'triggers.victory', code: 'scenario.unreachable',
    planted: 'scenario_ignores_deny', message: 'built a kind denied at the start and never allowed',
    rule: { id: 'scenario-deny-holds', rule: 'A kind a start row denies is built only once a firing row allows it, or scenario.unreachable names the goal and the trigger.' },
  },
};

type Spec = CheckSpec & Record<string, unknown>;
interface Expected { outcome: 'passed' | 'failed'; test: string | null }
/** The kit's fill: it runs the kind its spec names; a planted one breaks its own kind's rule alone. */
export type CatalogFill = CheckRunnerFill;

const read = (path: string): Buffer => readFileSync(new URL(`./fixtures/${path}`, import.meta.url));

/** Each kind's clean catalog and its twin, the cases named `<kind>:<catalog>`. */
function fixtures(): Fixture[] {
  const copy = JSON.parse(read('copy.json').toString('utf8')) as Copy;
  return (Object.keys(CASES) as Kind[]).flatMap((kind) => {
    const c = CASES[kind];
    const spec = (name: string): Spec => {
      const bytes = read(`${name}/packed.bin`);
      const asset = createHash('sha256').update(bytes).digest('hex');
      const packed = { bytes: bytes.toString('base64'), record: JSON.parse(read(`${name}/record.json`).toString('utf8')) as unknown };
      return { kind, runner: 'deepbuild/catalog', inputs: [], depth: 'unit', oracle: 'code', contract: null, catalogs: { [asset]: packed }, [KINDS[kind].field]: c.input(asset, copy) };
    };
    const fixture = (name: string, expected: Expected): Fixture => ({ id: `${kind}:${name}`, input: { spec: spec(name) } as never, expected: expected as never });
    return [fixture('clean', { outcome: 'passed', test: null }), fixture(c.twin, { outcome: 'failed', test: c.test })];
  });
}

const CTX = { checkout: '', deadline: 60_000, now: Date.now };

/** A fill of the kit: the plug-in's own runner for the kind each spec names, or with `planted` that runner's twin. */
function fill(planted: string | null): CatalogFill {
  return {
    slot: SLOT, revision: 1, kind: 'catalog',
    run: (spec) => {
      const s = spec as Spec;
      const kind = s.kind as Kind;
      return KINDS[kind].run(s[KINDS[kind].field] as never, s['catalogs'] as Carried, planted === CASES[kind].planted);
    },
  };
}

/** check.kind@1's kit for the plug-in's six kinds, its reference the plug-in's own runners. */
export function catalogKit(): SlotKitImpl<CatalogFill> {
  function* judge(f: CatalogFill, k: SlotCase): Generator<() => unknown, void, unknown> {
    const { spec } = k.input as unknown as { spec: Spec };
    const c = CASES[spec.kind as Kind];
    const ex = k.expected as unknown as Expected;
    const r = (yield () => f.run(spec, CTX)) as CheckResult;
    if (ex.outcome === 'passed') {
      if (r.outcome !== 'passed') throw new Finding('FAIL', `the ${k.id} catalog reported ${r.outcome}: ${r.failures.map((x) => x.message).join('; ')}`, ['clean_failed']);
      return;
    }
    if (!r.failures.some((x) => x.test === ex.test && x.message.startsWith(`${c.code}:`))) throw fail(c.message, [c.code], `${k.id} reported ${r.outcome} without ${c.code} naming ${ex.test}`);
  }
  const cases = Object.values(CASES);
  return {
    slot: SLOT, fills: 'one', revision: 1, rules: cases.map((c) => c.rule), fixtures: fixtures(),
    planted: cases.map((c) => ({ name: c.planted, message: c.message, codes: [c.code], breaks: c.rule.id, fill: fill(c.planted) })),
    clean: () => [fill(null)], generate: () => [], judge,
  };
}
