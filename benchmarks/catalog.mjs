// #194's budgets, the `catalog-checks` mode of benchmarks/canvas.mjs, on a release build of deep-catalog and deep-logic
// and the catalog plug-in's own runners (packages/checks/catalog):
//   pack_10000x20_s: deep-catalog's own `ms` packing one table of 10,000 rows and 20 columns, the files' reads left out.
//   reach_5000_s: catalog.reach's own `catalog.ms` over a chain of 5,000 recipes, every item and recipe reached.
//   economy_5000_s: catalog.economy's own `catalog.ms` over 2,500 recipe-and-uncraft pairs, no cycle gaining.
//   frame_work: the steps of a 600-step bake at which a logic item naming the plug-in's clean kit catalog spends other
//     fuel than the same item naming none: the catalog is copied into memory once, before the first step, so a piece
//     that names one gains no work per step or per frame.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const RECIPES = { id: 'id', columns: { inputs: { type: 'refs items' }, tools: { type: 'refs items' }, outputs: { type: 'refs items' } } };
const MAKES = [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }];

/** One table of 10,000 rows: an ID and 19 columns of i32, f64, bool and copy keys, its values a function of the row. */
function wide(dir) {
  const cols = [...[0, 1, 2, 3, 4, 5].map((i) => [`i${i}`, 'i32']), ...[0, 1, 2, 3, 4, 5, 6].map((i) => [`f${i}`, 'f64']), ...[0, 1, 2].map((i) => [`b${i}`, 'bool']), ...[0, 1, 2].map((i) => [`k${i}`, 'copy labels'])];
  const cell = (type, r, i) => (type === 'f64' ? ((r * 31 + i) % 997) / 7 : type === 'bool' ? (r + i) % 2 === 0 : (r * 17 + i) % 100_000);
  const rows = Array.from({ length: 10_000 }, (_, r) => [`row${r}`, ...cols.map(([, type], i) => cell(type, r, i))].join(','));
  const path = join(dir, 'wide.csv');
  writeFileSync(path, `${['id', ...cols.map(([n]) => n)].join(',')}\n${rows.join('\n')}\n`);
  return { tables: { wide: { path } }, schema: { wide: { id: 'id', columns: Object.fromEntries(cols.map(([n, type]) => [n, { type }])) } } };
}
/** Recipes as a CSV beside their items: `make(k)` gives recipe k's [inputs, outputs]. */
function recipes(dir, name, items, n, make) {
  const it = join(dir, `${name}-items.csv`);
  const rs = join(dir, `${name}-recipes.csv`);
  writeFileSync(it, `id\n${items.join('\n')}\n`);
  writeFileSync(rs, `id,inputs,tools,outputs\n${Array.from({ length: n }, (_, k) => { const [i, o] = make(k); return `${o.id},${i.join(';')},,${o.out.join(';')}`; }).join('\n')}\n`);
  return { tables: { items: { path: it }, recipes: { path: rs } }, schema: { items: { id: 'id', columns: {} }, recipes: RECIPES } };
}
const chain = (dir) => recipes(dir, 'chain', Array.from({ length: 5_001 }, (_, k) => `a${k}`), 5_000, (k) => [[`a${k}`], { id: `r${k}`, out: [`a${k + 1}`] }]);
const pairs = (dir) => recipes(dir, 'pairs', Array.from({ length: 2_500 }, (_, k) => [`x${k}`, `y${k}`]).flat(), 5_000,
  (k) => (k % 2 === 0 ? [[`x${k / 2}`, `x${k / 2}`], { id: `c${k / 2}`, out: [`y${k / 2}`] }] : [[`y${(k - 1) / 2}`], { id: `u${(k - 1) / 2}`, out: [`x${(k - 1) / 2}`, `x${(k - 1) / 2}`] }]));

/** A packed catalog as a check's spec carries it. */
function packed(once, dir, name, catalog) {
  const out = join(dir, `${name}.bin`);
  const r = once('deep-catalog', ['pack'], { op: 'pack', ...catalog, out });
  if (!r.ok) throw Error(`deep-catalog refused ${name}: ${JSON.stringify(r)}`);
  const bytes = readFileSync(out);
  return { asset: r.sha256, ms: r.ms, carried: { [r.sha256]: { bytes: bytes.toString('base64'), record: r.record } } };
}

// The idle program: memory of one page, its regions' globals, an empty init and step (WebAssembly's binary form).
const leb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const name = (s) => [...leb(s.length), ...Buffer.from(s)];
const section = (id, items) => { const body = [...leb(items.length), ...items.flat()]; return [id, ...leb(body.length), ...body]; };
// A positive i32's signed LEB128 is its unsigned one, with a 0 byte after when its last byte's sign bit is set.
const sleb = (v) => { const u = leb(v); return u[u.length - 1] & 0x40 ? [...u.slice(0, -1), u[u.length - 1] | 0x80, 0] : u; };
const i32 = (v) => [0x7f, 0, 0x41, ...sleb(v), 0x0b];
const IDLE = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  ...section(1, [[0x60, 1, 0x7e, 0]]), ...section(3, [[0], [0]]), ...section(5, [[1, 1, 1]]),
  ...section(6, [i32(0), i32(1024), i32(4096)]),
  ...section(7, [[...name('memory'), 2, 0], [...name('reads_at'), 3, 0], [...name('writes_at'), 3, 1], [...name('assets_at'), 3, 2], [...name('init'), 0, 0], [...name('step'), 0, 1]]),
  ...section(10, [[2, 0, 0x0b], [2, 0, 0x0b]])]);

/** The steps of a 600-step bake at which the idle item naming `catalog` spends other fuel than naming none. */
function frameWork(once, catalog) {
  const program = sha256(IDLE);
  const bake = (assets) => {
    const params = { program, step_rate: 120, writes: { k: { type: 'i32' } }, ...(assets ? { assets: [catalog.sha] } : {}) };
    const r = once('deep-logic', [], { call: 'bake', steps: 600, piece: { seed: 194, items: { idle: { kind: 'logic@1', params } },
      assets: { [program]: IDLE.toString('base64'), ...(assets ? { [catalog.sha]: catalog.bytes.toString('base64') } : {}) } } });
    if (!r.ok) throw Error(`deep-logic refused the idle piece: ${JSON.stringify(r).slice(0, 1000)}`);
    return r.steps.map((s) => s.items?.idle?.fuel);
  };
  const [named, none] = [bake(true), bake(false)];
  return named.filter((f, k) => f !== none[k]).length + Math.abs(named.length - none.length);
}

export async function catalogChecks({ root, release, once }) {
  const fingerprint = release('deep-catalog', 'deep-catalog');
  release('deep-logic', 'deep-logic');
  const [{ runReach }, { runEconomy }] = await Promise.all([
    import(join(root, 'packages', 'checks', 'catalog', 'reach.ts')), import(join(root, 'packages', 'checks', 'catalog', 'economy.ts')),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'deep-catalog-bench-'));
  try {
    const kit = readFileSync(join(root, 'packages', 'checks', 'catalog', 'fixtures', 'clean', 'packed.bin'));
    const catalog = { sha: sha256(kit), bytes: kit };
    const [w, c, p] = [wide(dir), chain(dir), pairs(dir)];
    const run = () => {
      const pack = packed(once, dir, 'wide', w);
      const reached = packed(once, dir, 'chain', c);
      const r = runReach({ catalog: reached.asset, roots: [{ table: 'items', ids: ['a0'] }], makes: MAKES, every: ['items', 'recipes'] }, reached.carried);
      const paired = packed(once, dir, 'pairs', p);
      const e = runEconomy({ catalog: paired.asset, makes: MAKES }, paired.carried);
      if (r.outcome !== 'passed' || e.outcome !== 'passed') throw Error(`reach ${r.outcome}, economy ${e.outcome}: ${JSON.stringify([...r.failures, ...e.failures].slice(0, 3))}`);
      return { pack_10000x20_s: pack.ms / 1000, reach_5000_s: r.catalog.ms / 1000, economy_5000_s: e.catalog.ms / 1000, frame_work: frameWork(once, catalog) };
    };
    run();
    const runs = [];
    // Each run carries the one-minute load at its start and end, which canvas.mjs judge gives judgeLimit (#2870).
    for (let n = 0; n < 5; n++) {
      const loadStart = loadavg()[0];
      runs.push({ ...run(), loadStart, loadEnd: loadavg()[0] });
    }
    console.log(JSON.stringify({ task: 'catalog-checks', fingerprint, runs }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

