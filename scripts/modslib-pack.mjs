// Writes the first-party pack packs/modslib-1.0.0 (#953; canvas primitives: Logic: library interfaces: mods.lib@1):
// mods.lib@1, stat modifiers on a tree of nodes, with its exports, fixtures whose expected totals are recomputed here
// from the whole tree after every edit (never from a library), its reference library mods.tree@1.0.0 with a fixture of
// its own, and a planted library that must fail one of the fixtures. The library is src/mods.rs, built by rustc into
// relocatable objects (the planted one with --cfg planted); the fixtures' programs are WebAssembly text, assembled into
// relocatable objects by an assembler that takes `<out-dir> --program <file.wat>` (tests/acceptance/190/wat builds one):
//
//   node scripts/modslib-pack.mjs <assembler>
//
// objects/, fixtures/, data/, src/*.wat and pack.json are written whole each run; src/mods.rs is kept. A changed fixture
// or export changes mods.lib@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/modslib-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'modslib-1.0.0');
for (const d of ['objects', 'fixtures', 'data']) rmSync(join(OUT, d), { recursive: true, force: true });
for (const f of readdirSync(join(OUT, 'src'))) if (f.endsWith('.wat')) rmSync(join(OUT, 'src', f));

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
/** One canonical form before a hash: sorted keys, no white space (the values here hold no floats). */
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const assets = [];
function put(path, bytes) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), bytes);
  const sha = sha256(bytes);
  assets.push({ path, sha256: sha, size: bytes.length });
  return sha;
}
function scratch(f) {
  const dir = mkdtempSync(join(tmpdir(), 'modslib-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/mods.rs, functions only, importing nothing but the caller's memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const EXPORTS = [
  { name: 'attach', params: ['i32', 'i32', 'i32', 'i32'], results: [] },
  { name: 'detach', params: ['i32', 'i32'], results: [] },
  { name: 'add', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'remove', params: ['i32', 'i32'], results: [] },
  { name: 'tick', params: ['i32', 'i32'], results: [] },
  { name: 'total', params: ['i32', 'i32', 'i32'], results: ['i64'] },
];
function library(name, planted) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'mods', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', '--check-cfg', 'cfg(planted)', ...(planted ? ['--cfg', 'planted'] : []),
      '-o', out, join(OUT, 'src', 'mods.rs'),
    ], { encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: channel } });
    if (run.status !== 0) throw Error(`${name} doesn't build: ${run.stderr}`);
    return readFileSync(out);
  });
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
  if (JSON.stringify(imports) !== JSON.stringify([{ module: 'env', name: '__linear_memory', kind: 'memory' }])) {
    throw Error(`${name} imports ${JSON.stringify(imports)}: a library imports only the caller's memory`);
  }
  return put(`objects/${name}.wasm`, bytes);
}
const reference = library('mods_tree', false);
const planted = library('mods_stale', true);

// ---------------------------------------------------------------------------------------------------
// The catalog the fixtures' nodes take their rows from: one table.layout@1 table, `units`, laid out as #194's packer lays
// one out (columns by their name hashes, the ID column an i32 column of its own name holding each row's ID hash, rows by
// that hash, values after the directory in directory order, the empty refs pool at the end).

const fnv1a = (text) => {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
};
const TABLE = 'units';
const COLUMNS = ['kind', 'level', 'attack', 'defense'];
const KIND = { archer: 1, swordsman: 2, pikeman: 3, hero: 9, side: 20 };
const ROWS = {
  side_red: { kind: KIND.side, level: 0, attack: 0, defense: 0 },
  side_blue: { kind: KIND.side, level: 0, attack: 0, defense: 0 },
  hero: { kind: KIND.hero, level: 5, attack: 5, defense: 4 },
  archer: { kind: KIND.archer, level: 2, attack: 10, defense: 3 },
  swordsman: { kind: KIND.swordsman, level: 3, attack: 12, defense: 8 },
  pikeman: { kind: KIND.pikeman, level: 1, attack: 8, defense: -2 },
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`unit${i}`, { kind: 1 + (i % 3), level: 1 + ((i * 5) % 7), attack: (i * 7) % 19, defense: ((i * 11) % 15) - 4 }])),
};
function catalogBytes() {
  const names = ['id', ...COLUMNS].sort((a, b) => fnv1a(a) - fnv1a(b));
  const ids = Object.keys(ROWS).sort((a, b) => fnv1a(a) - fnv1a(b));
  if (new Set(names.map(fnv1a)).size !== names.length || new Set(ids.map(fnv1a)).size !== ids.length) throw Error('a hash collision in the catalog');
  const dir = 20 + 12 + 16 * names.length;
  const end = dir + 4 * ids.length * names.length;
  const b = Buffer.alloc(end);
  b.write('TBLE', 0, 'latin1');
  b.writeUInt32LE(1, 4);
  b.writeUInt32LE(1, 8);
  b.writeUInt32LE(end, 12);
  b.writeUInt32LE(fnv1a(TABLE), 20);
  b.writeUInt32LE(ids.length, 24);
  b.writeUInt32LE(names.length, 28);
  names.forEach((c, j) => {
    const at = dir + 4 * ids.length * j;
    b.writeUInt32LE(fnv1a(c), 32 + 16 * j);
    b.writeUInt32LE(at, 40 + 16 * j);
    ids.forEach((id, k) => (c === 'id' ? b.writeUInt32LE(fnv1a(id), at + 4 * k) : b.writeInt32LE(ROWS[id][c], at + 4 * k)));
  });
  return b;
}
const catalog = put('data/units.bin', catalogBytes());

// ---------------------------------------------------------------------------------------------------
// The rule, worked from the whole tree as it stands after each edit: which rows reach a node, which of their filters hold
// on the node's own catalog row, then (base + Σ add) × (100 + Σ percent) or 100 × the last set by (source, id), the
// lowest cap × 100 if lower, and one division by 100 toward zero.

const OP = { add: 0, percent: 1, set: 2, cap: 3 };
const REACH = { down: 0, side: 1, all: 2 };
const CMP = { eq: 0, ge: 1, le: 2 };
const UNIT = { none: 0, turns: 1, rounds: 2 };
class World {
  constructor(stats) { this.stats = stats; this.state = []; this.parent = []; this.rowOf = []; this.rows = []; }
  /** n's parent chain, n first, through nodes attached or not. */
  chain(n) { const out = [n]; for (let p = this.parent[n] ?? -1; p >= 0; p = this.parent[p] ?? -1) out.push(p); return out; }
  live(n) { const c = this.chain(n); return c.every((x) => this.state[x] === 1); }
  apply(e) {
    if (e.op === 'attach') {
      if (e.parent >= 0 && this.chain(e.parent).includes(e.node)) throw Error(`the fixture attaches ${e.node} under its own subtree`);
      this.state[e.node] = 1; this.parent[e.node] = e.parent; this.rowOf[e.node] = e.row;
    } else if (e.op === 'detach') {
      if (this.state[e.node] !== 1) throw Error(`the fixture detaches ${e.node}, which isn't attached`);
      this.state[e.node] = 2; this.parent[e.node] = -1;
    } else if (e.op === 'add') {
      this.rows.push({ ...e.row, alive: true, left: e.row.count ?? 0 });
      return this.rows.length - 1;
    } else if (e.op === 'remove') {
      this.rows[e.id].alive = false;
    } else {
      for (const r of this.rows) if (r.alive && r.unit === e.boundary + 1 && --r.left === 0) r.alive = false;
    }
    return null;
  }
  cell(n, column) { const r = this.state[n] ? ROWS[this.rowOf[n]] : undefined; return r && column in r ? r[column] : null; }
  total(n, s) {
    const base = this.cell(n, this.stats[s]) ?? 0;
    if (!this.live(n)) return base;
    const side = this.chain(n).at(-1);
    let add = 0, pct = 0, set = null, cap = null;
    this.rows.forEach((r, id) => {
      if (!r.alive || r.stat !== s || !this.live(r.source)) return;
      const reaches = r.reach === REACH.down ? this.chain(n).slice(1).includes(r.source)
        : r.reach === REACH.side ? this.chain(r.source).at(-1) === side && n !== side : true;
      if (!reaches) return;
      for (const f of r.filters ?? []) {
        const v = this.cell(n, f.column);
        if (v === null || (f.cmp === CMP.eq ? v !== f.value : f.cmp === CMP.ge ? v < f.value : v > f.value)) return;
      }
      if (r.op === OP.add) add += r.value;
      else if (r.op === OP.percent) pct += r.value;
      else if (r.op === OP.set) { const key = r.source * 4096 + id; if (set === null || key > set.key) set = { key, value: r.value }; }
      else if (cap === null || r.value < cap) cap = r.value;
    });
    let x = set ? set.value * 100 : (base + add) * (100 + pct);
    if (cap !== null && cap * 100 < x) x = cap * 100;
    return Math.trunc(x / 100);
  }
}

// ---------------------------------------------------------------------------------------------------
// The fixtures' program: a driver that plays a script of mods.lib@1 calls. Memory: writes at 4096 (`totals`, f64 × R, then
// `last`, the latest add's id), the tree at 65536, the item's assets (the script, then the catalog, each after its u32
// length) at assets_at. The script, i32 words: the tree's 128-byte header (its catalog address the driver's to fill), then
// ops, END (0) closing each step and HALT (7) the script: ATTACH (1) node parent row-hash, DETACH (2) node, ADD (3) and
// the 104-byte row, REMOVE (4) id, TICK (5) boundary, READ (6) first count: every stat of each node in turn.

const WRITES_AT = 4096, VARS_AT = 32768, TREE_AT = 65536, ASSETS_AT = TREE_AT + (1 << 20) + 65536, PAGES = 24;
const SCRIPT_AT = ASSETS_AT + 4;
const sig = (e) => `${e.params.length ? `(param ${e.params.join(' ')})` : ''}${e.results.length ? ` (result ${e.results.join(' ')})` : ''}`;
function program(name, text) {
  writeFileSync(join(OUT, 'src', `${name}.wat`), text.trimStart());
  const bytes = scratch((dir) => {
    writeFileSync(join(dir, `${name}.wat`), text);
    const run = spawnSync(assembler, [dir, '--program', join(dir, `${name}.wat`)], { encoding: 'utf8' });
    if (run.status !== 0) throw Error(`${name} doesn't assemble: ${run.stderr}`);
    return readFileSync(join(dir, `${name}.wasm`));
  });
  return put(`objects/${name}.wasm`, bytes);
}
/** The driver importing mods.lib@1's exports from `module`, its writes `totals` R × f64 at 4096 and `last` after them. */
const driver = (name, module, reads) => program(name, `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${EXPORTS.map((e) => `  (import "${module}" "${e.name}" (func $${e.name} ${sig(e)}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func (export "init") (param $seed i64)
    (memory.copy (i32.const ${TREE_AT}) (i32.const ${SCRIPT_AT}) (i32.const 128))
    (i32.store (i32.const ${TREE_AT}) (i32.add (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${ASSETS_AT}))) (i32.const 4)))
    (i32.store (i32.const ${VARS_AT}) (i32.const ${SCRIPT_AT + 128}))
    (i32.store (i32.const ${WRITES_AT + 8 * reads}) (i32.const -1)))
  (func (export "step") (param $k i64) (local $p i32) (local $op i32) (local $r i32) (local $n i32) (local $end i32) (local $s i32)
    (local.set $p (i32.load (i32.const ${VARS_AT})))
    (block $done (loop $next
      (local.set $op (i32.load (local.get $p)))
      (br_if $done (i32.eq (local.get $op) (i32.const 7)))
      (local.set $p (i32.add (local.get $p) (i32.const 4)))
      (br_if $done (i32.eqz (local.get $op)))
      (if (i32.eq (local.get $op) (i32.const 1)) (then
        (call $attach (i32.const ${TREE_AT}) (i32.load (local.get $p)) (i32.load offset=4 (local.get $p)) (i32.load offset=8 (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 12)))))
      (if (i32.eq (local.get $op) (i32.const 2)) (then
        (call $detach (i32.const ${TREE_AT}) (i32.load (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))))
      (if (i32.eq (local.get $op) (i32.const 3)) (then
        (i32.store (i32.const ${WRITES_AT + 8 * reads}) (call $add (i32.const ${TREE_AT}) (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 104)))))
      (if (i32.eq (local.get $op) (i32.const 4)) (then
        (call $remove (i32.const ${TREE_AT}) (i32.load (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))))
      (if (i32.eq (local.get $op) (i32.const 5)) (then
        (call $tick (i32.const ${TREE_AT}) (i32.load (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 4)))))
      (if (i32.eq (local.get $op) (i32.const 6)) (then
        (local.set $n (i32.load (local.get $p)))
        (local.set $end (i32.add (local.get $n) (i32.load offset=4 (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (block $nodes (loop $node
          (br_if $nodes (i32.ge_s (local.get $n) (local.get $end)))
          (local.set $s (i32.const 0))
          (block $stats (loop $stat
            (br_if $stats (i32.ge_u (local.get $s) (i32.load offset=12 (i32.const ${TREE_AT}))))
            (f64.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $r) (i32.const 3)))
              (f64.convert_i64_s (call $total (i32.const ${TREE_AT}) (local.get $n) (local.get $s))))
            (local.set $r (i32.add (local.get $r) (i32.const 1)))
            (local.set $s (i32.add (local.get $s) (i32.const 1)))
            (br $stat)))
          (local.set $n (i32.add (local.get $n) (i32.const 1)))
          (br $node)))))
      (br $next)))
    (i32.store (i32.const ${VARS_AT}) (local.get $p)))
  (data (i32.const ${VARS_AT}) "\\00"))`);

const words = (...xs) => { const b = Buffer.alloc(4 * xs.length); xs.forEach((x, i) => b.writeInt32LE(x | 0, 4 * i)); return b; };
function rowBytes(r) {
  const b = Buffer.alloc(104);
  [r.source, r.stat, r.op, r.reach].forEach((x, i) => b.writeInt32LE(x, 4 * i));
  b.writeBigInt64LE(BigInt(r.value), 16);
  b.writeInt32LE(r.unit ?? 0, 24);
  b.writeInt32LE(r.count ?? 0, 28);
  b.writeInt32LE((r.filters ?? []).length, 32);
  (r.filters ?? []).forEach((f, i) => {
    b.writeUInt32LE(fnv1a(f.column), 40 + 16 * i);
    b.writeInt32LE(f.cmp, 44 + 16 * i);
    b.writeBigInt64LE(BigInt(f.value), 48 + 16 * i);
  });
  return b;
}
function scriptBytes(stats, steps) {
  const header = Buffer.alloc(128);
  header.writeUInt32LE(fnv1a(TABLE), 4);
  header.writeUInt32LE(fnv1a('id'), 8);
  header.writeUInt32LE(stats.length, 12);
  stats.forEach((s, i) => header.writeUInt32LE(fnv1a(s), 16 + 4 * i));
  const parts = [header];
  for (const step of steps) {
    for (const e of step.edits) {
      if (e.op === 'attach') parts.push(words(1, e.node, e.parent, fnv1a(e.row)));
      else if (e.op === 'detach') parts.push(words(2, e.node));
      else if (e.op === 'add') parts.push(words(3), rowBytes(e.row));
      else if (e.op === 'remove') parts.push(words(4, e.id));
      else parts.push(words(5, e.boundary));
    }
    parts.push(words(6, 0, step.nodes), words(0));
  }
  parts.push(words(7));
  return Buffer.concat(parts);
}
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
/** A fixture of `steps` (each its edits, then every stat of its first `nodes` nodes read), its totals from the rule. */
function scene(name, stats, nodes, steps, module, answer, links) {
  const world = new World(stats);
  const arrays = {};
  let last = -1;
  steps.forEach((step, k) => {
    for (const e of step.edits) { const id = world.apply(e); if (e.op === 'add') last = id; }
    const totals = [];
    for (let n = 0; n < nodes; n++) for (let s = 0; s < stats.length; s++) totals.push(world.total(n, s));
    arrays[k] = { totals, last: [last] };
  });
  const reads = nodes * stats.length;
  const prog = driver(name, module, reads);
  const script = put(`data/${name}.bin`, scriptBytes(stats, steps.map((s) => ({ ...s, nodes }))));
  const params = { program: prog, writes: { totals: { type: 'f64', count: reads }, last: { type: 'i32' } }, assets: [script, catalog], ...(links ? { links } : {}) };
  return { fixture: fixture(name, { item: { kind: 'logic@1', params }, track: [], steps: steps.length, expect: { arrays }, answer }), arrays };
}
const attach = (node, parent, row) => ({ op: 'attach', node, parent, row });
const add = (row) => ({ op: 'add', row: { filters: [], ...row } });

// The stacking order: side 0 (side_red) holds hero 1 with archer 2 and swordsman 3, and pikeman 4; side 5 (side_blue)
// holds archer 6. Hero 1's rows reach down: attack +5, +20%, a cap of 16 for archers (kind = 1) only; so archer 2 reads
// (10 + 5) × 1.2 = 18, capped to 16, swordsman 3 (12 + 5) × 1.2 = 20.4, 20. Without the cap the archer reads 18. Then a set
// of 7 from side 0 with reach side and one of 9 from hero 1: the greater source wins where both reach (nodes 2 and 3), the
// side's elsewhere under it (1 and 4), none on side blue. A later set from hero 1 beats its first. A −13 add on the
// swordsman's defense, with −50%, rounds toward zero once: (8 − 13) × 0.5 = −2.5, −2. An all-reach +2 attack for 2 turns
// from archer 6 lasts through a round's boundary and ends at the second turn's; −1 at level ≥ 3 from pikeman 4 on all
// reaches the hero and the swordsman only; a node detached keeps its row's base.
const STACK = ['attack', 'defense'];
const stack = scene('stack', STACK, 7, [
  { edits: [attach(0, -1, 'side_red'), attach(1, 0, 'hero'), attach(2, 1, 'archer'), attach(3, 1, 'swordsman'), attach(4, 0, 'pikeman'), attach(5, -1, 'side_blue'), attach(6, 5, 'archer'),
    add({ source: 1, stat: 0, op: OP.add, reach: REACH.down, value: 5 }), add({ source: 1, stat: 0, op: OP.percent, reach: REACH.down, value: 20 }),
    add({ source: 1, stat: 0, op: OP.cap, reach: REACH.down, value: 16, filters: [{ column: 'kind', cmp: CMP.eq, value: KIND.archer }] })] },
  { edits: [{ op: 'remove', id: 2 }] },
  { edits: [add({ source: 0, stat: 0, op: OP.set, reach: REACH.side, value: 7 }), add({ source: 1, stat: 0, op: OP.set, reach: REACH.down, value: 9 })] },
  { edits: [add({ source: 1, stat: 0, op: OP.set, reach: REACH.down, value: 11 })] },
  { edits: [add({ source: 3, stat: 1, op: OP.add, reach: REACH.all, value: -13, filters: [{ column: 'kind', cmp: CMP.eq, value: KIND.swordsman }] }),
    add({ source: 3, stat: 1, op: OP.percent, reach: REACH.all, value: -50, filters: [{ column: 'kind', cmp: CMP.eq, value: KIND.swordsman }] })] },
  { edits: [add({ source: 6, stat: 0, op: OP.add, reach: REACH.all, value: 2, unit: UNIT.turns, count: 2 }),
    add({ source: 4, stat: 1, op: OP.add, reach: REACH.all, value: -1, filters: [{ column: 'level', cmp: CMP.ge, value: 3 }, { column: 'defense', cmp: CMP.le, value: 10 }] })] },
  { edits: [{ op: 'tick', boundary: 0 }, { op: 'tick', boundary: 1 }] },
  { edits: [{ op: 'tick', boundary: 0 }] },
  { edits: [{ op: 'detach', node: 3 }] },
], 'lib:mods.lib@1', 'Side 0 holds hero 1 (archer 2, swordsman 3) and pikeman 4; side 5 holds archer 6. Step 0: hero 1\'s +5, +20% and archers\' cap 16 on attack, reach down: archer 2 reads 16, swordsman 3 20. Step 1 removes the cap: archer 2 reads 18. Step 2: a set 7 from side 0 (reach side) and 9 from hero 1 (reach down): nodes 2 and 3 read 9 (source 1 beats source 0), 1 and 4 read 7, side blue its bases. Step 3: a later set 11 from hero 1 beats its first. Step 4: swordsmen\'s defense −13 and −50% from all: (8 − 13) × 0.5 = −2.5 reads −2. Step 5: +2 attack to all for 2 turns, and −1 defense to all at level ≥ 3 and defense ≤ 10 (hero, swordsman). Step 6: a turn and a round pass; the +2 holds. Step 7: the second turn ends it. Step 8: swordsman 3 detached reads its bases, 12 and 8.');
if (stack.arrays[0].totals[4] !== 16 || stack.arrays[0].totals[6] !== 20 || stack.arrays[1].totals[4] !== 18 || stack.arrays[4].totals[7] !== -2) {
  throw Error(`the stacking fixture's totals: ${JSON.stringify(stack.arrays)}`);
}

// Seeded edits of a 24-node tree with two sides: moves of nodes with their subtrees, detaches and reattaches, adds,
// removes and boundaries, every total read after each; the planted library, which leaves a moved node's descendants'
// totals as they were, fails it.
function seeded(seed, nodes, rows, edits) {
  let x = seed >>> 0;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (xs) => xs[Math.floor(next() * xs.length)];
  const names = Object.keys(ROWS).filter((r) => r.startsWith('unit') || r === 'hero' || r === 'archer');
  const rowOf = Array.from({ length: nodes }, () => (next() < 0.9 ? pick(names) : 'nobody'));
  const world = new World(['attack', 'defense', 'morale']);
  const step0 = [attach(0, -1, 'side_red'), attach(1, -1, 'side_blue')];
  for (let n = 2; n < nodes; n++) step0.push(attach(n, int(0, n - 1), rowOf[n]));
  const row = () => {
    const op = pick([OP.add, OP.add, OP.percent, OP.set, OP.cap]);
    const value = op === OP.add ? int(-9, 9) : op === OP.percent ? int(-40, 80) : op === OP.set ? int(-5, 30) : int(0, 25);
    const filters = Array.from({ length: next() < 0.6 ? 0 : int(1, 2) }, () => ({ column: pick(['kind', 'level', 'attack', 'rarity']), cmp: int(0, 2), value: int(0, 8) }));
    const unit = next() < 0.8 ? UNIT.none : pick([UNIT.turns, UNIT.rounds]);
    return { source: int(0, nodes - 1), stat: int(0, 2), op, reach: pick([REACH.down, REACH.down, REACH.side, REACH.all]), value, filters, unit, count: unit ? int(1, 3) : 0 };
  };
  for (let i = 0; i < rows; i++) step0.push(add(row()));
  for (const e of step0) world.apply(e);
  const steps = [{ edits: step0 }];
  for (let k = 0; k < edits; k++) {
    const attached = [...Array(nodes).keys()].filter((n) => world.state[n] === 1);
    const out = [...Array(nodes).keys()].filter((n) => world.state[n] !== 1);
    const alive = world.rows.flatMap((r, id) => (r.alive ? [id] : []));
    const movable = attached.filter((m) => m > 1);
    const u = next();
    let e;
    if (u < 0.4 && movable.length) {
      const n = pick(movable);
      const parents = attached.filter((p) => !world.chain(p).includes(n) && p !== world.parent[n]);
      e = attach(n, parents.length && next() < 0.9 ? pick(parents) : -1, rowOf[n]);
    } else if (u < 0.5 && out.length) {
      const n = pick(out);
      e = attach(n, pick(attached.filter((p) => !world.chain(p).includes(n))), rowOf[n]);
    } else if (u < 0.6 && movable.length) {
      e = { op: 'detach', node: pick(movable) };
    } else if (u < 0.75 || !alive.length) {
      e = add(row());
    } else if (u < 0.9) {
      e = { op: 'remove', id: pick(alive) };
    } else {
      e = { op: 'tick', boundary: int(0, 1) };
    }
    world.apply(e);
    steps.push({ edits: [e] });
  }
  return steps;
}
const edits = scene('edits', ['attack', 'defense', 'morale'], 24, seeded(953, 24, 60, 40), 'lib:mods.lib@1', 'A 24-node tree, sides 0 and 1, each other node attached under an earlier one with a row of the catalog (or none), and 60 seeded rows on attack, defense and morale (a column the table lacks, so its base is 0), some lasting turns or rounds; then 40 seeded edits, one a step: moves (with their subtrees), detaches, reattaches, adds, removes and boundaries. Every total of every node, after every step, is recomputed from the whole tree as it stands: (base + Σ add) × (100 + Σ percent), or 100 × the last set by (source, id), then the lowest cap × 100 if lower, divided by 100 toward zero once.');

// The reference library's own fixture (#190's rule): a lone archer, then +5 from its side, linking it by its own name.
const REF = 'mods.tree@1.0.0';
const own = scene('archer_own', ['attack'], 2, [
  { edits: [attach(0, -1, 'side_red'), attach(1, 0, 'archer')] },
  { edits: [add({ source: 0, stat: 0, op: OP.add, reach: REACH.down, value: 5 })] },
], 'lib:mods.tree', 'Side 0 with archer 1 under it, importing mods.tree by its own name: the archer reads its base 10, then 15 after a +5 attack from the side, reach down.', [{ name: REF, asset: reference }]);

// ---------------------------------------------------------------------------------------------------

const fixtures = [stack.fixture, edits.fixture];
const manifest = {
  name: 'modslib', version: '1.0.0', license: 'Apache-2.0',
  description: 'mods.lib@1 (#953): stat modifiers on a tree of nodes with reach down, side or all, filters on the receiving node\'s catalog row, (base + adds) × (1 + percents ÷ 100), the last set by source and row, the lowest cap and one rounding toward zero, kept in cached totals that a change marks only where it can reach. Its fixtures\' expected totals are recomputed from the whole tree after every edit; its planted library leaves a moved node\'s descendants\' totals stale, and fails the seeded edits. Written by scripts/modslib-pack.mjs; the library is src/mods.rs and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'mods.lib@1': { exports: EXPORTS, fixtures, planted: [planted], digest: sha256(canonical({ exports: EXPORTS, layout: null, fixtures })) },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [own.fixture], implements: ['mods.lib@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; mods.lib@1 digest ${manifest.interfaces['mods.lib@1'].digest}`);
