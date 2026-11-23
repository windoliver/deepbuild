// Writes the first-party pack packs/sense-1.0.0 (#959; canvas primitives: Logic: library interfaces: sense.lib@1):
// sense.lib@1, each side's sight over a terrain plate's heights with radar, jammers, cloak and last-seen ghosts, with
// its export, fixtures whose expected grids and rows are worked here from the rule by brute force (never from a
// library), its reference library sense.sight@1.0.0 with a fixture of its own, and a planted library that must fail
// one of the fixtures. The library is src/sense.rs, built by rustc into relocatable objects (the planted one with
// --cfg planted); the fixtures' program is WebAssembly text, assembled into relocatable objects by an assembler that
// takes `<out-dir> --program <file.wat>` (tests/acceptance/416/interfaces/wat builds one):
//
//   node scripts/sense-pack.mjs <assembler>
//
// objects/, fixtures/, data/, src/*.wat and pack.json are written whole each run; src/sense.rs is kept. A changed
// fixture or export changes sense.lib@1's digest, which takes a new major.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assembler = process.argv[2];
if (!assembler) throw Error('usage: node scripts/sense-pack.mjs <assembler>');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'packs', 'sense-1.0.0');
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
  if (!assets.some((a) => a.path === path)) assets.push({ path, sha256: sha, size: bytes.length });
  return sha;
}
function scratch(f) {
  const dir = mkdtempSync(join(tmpdir(), 'sense-pack-'));
  try { return f(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------------------------------
// The library: rustc's relocatable object of src/sense.rs, functions only, importing nothing but the caller's memory.

const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))[1];
const EXPORTS = [{ name: 'sight', params: ['i32', 'i64'], results: [] }];
function library(name, planted) {
  const bytes = scratch((dir) => {
    const out = join(dir, `${name}.o`);
    const run = spawnSync('rustc', [
      '--target', 'wasm32-unknown-unknown', '--crate-type=lib', '--crate-name', 'sense', '--edition', '2021', '--emit=obj',
      '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'target-cpu=mvp', '-C', 'debuginfo=0',
      '-C', 'target-feature=+bulk-memory,+sign-ext,+nontrapping-fptoint', '--check-cfg', 'cfg(planted)', ...(planted ? ['--cfg', 'planted'] : []),
      '-o', out, join(OUT, 'src', 'sense.rs'),
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
const reference = library('sense_sight', false);
const planted = library('sense_flat', true);

// ---------------------------------------------------------------------------------------------------
// The rule, by brute force over the rows as they stand at a call: every eye's ray to every sight cell of the rows the
// call rebuilds, every radar's and jammer's disc over every fog cell of those rows, then every unit and ghost row.
// Each number is a binary64 add, subtract, multiply, divide, floor, ceil, abs or comparison in the order written,
// which JavaScript and WebAssembly give alike.

const KIND = { none: 0, eye: 1, radar: 2, sonar: 3, jam: 4, detect: 5 };
const CLOAKED = 1, STRUCTURE = 2;
const UNSEEN = 0, RADAR = 1, SEEN = 2;
const NO_SENSOR = { x: 0, z: 0, height: 0, range: 0, kind: KIND.none, side: 0 };
const NO_UNIT = { x: 0, z: 0, decloak: 0, side: -1, kind: 0, flags: 0 };
/** A side's state in each of its players' two bits (bits 2(p − 1) and 2(p − 1) + 1 for player p). */
const inPlayers = (state, players) => { let v = 0; for (let p = 0; p < 16; p++) if ((players >> p) & 1) v |= state << (2 * p); return v; };

class World {
  /** plate: {cols, rows, spacing, x0, z0, heights}; header: {cell, radarCell, spread, players: [bits a side], seed: bigint}. */
  constructor(plate, header, sensors, units) {
    Object.assign(this, { plate, ...header });
    this.sides = header.players.length;
    this.gc = Math.floor((plate.cols - 1) / header.cell);
    this.gr = Math.floor((plate.rows - 1) / header.cell);
    this.q = Math.floor(header.cell / header.radarCell);
    this.fc = this.gc * this.q;
    this.fr = this.gr * this.q;
    this.sensors = Array.from({ length: sensors }, () => ({ ...NO_SENSOR }));
    this.units = Array.from({ length: units }, () => ({ ...NO_UNIT }));
    this.sees = header.players.map(() => new Uint8Array(this.gc * this.gr));
    this.state = header.players.map(() => new Uint8Array(this.fc * this.fr));
    this.fog = new Int32Array(this.fc * this.fr);
    this.known = Array.from({ length: units * this.sides }, () => null);
  }
  /** The coarse height of sight cell (cx, cz): the height sample at its centre. */
  height(cx, cz) {
    const half = Math.floor(this.cell / 2);
    return this.plate.heights[(cz * this.cell + half) * this.plate.cols + cx * this.cell + half];
  }
  /** Whether an eye sees sight cell (tx, tz): in its range, and the line from its eye above every height it crosses. */
  eyeSees(sn, tx, tz) {
    const m = this.plate.spacing * this.cell;
    const ex = (sn.x - this.plate.x0) / m, ez = (sn.z - this.plate.z0) / m;
    if (!(ex >= 0 && ex < this.gc && ez >= 0 && ez < this.gr)) return false;
    const rc = sn.range / m;
    const dx = tx + 0.5 - ex, dz = tz + 0.5 - ez;
    if (!(dx * dx + dz * dz <= rc * rc)) return false;
    const he = this.height(Math.floor(ex), Math.floor(ez)) + sn.height;
    const dh = this.height(tx, tz) - he;
    const n = Math.max(Math.ceil(Math.abs(dx)), Math.ceil(Math.abs(dz)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!(he + dh * t > this.height(Math.floor(ex + dx * t), Math.floor(ez + dz * t)))) return false;
    }
    return true;
  }
  /** Whether a radar's or a jammer's disc holds fog cell (fx, fz): its centre within the range, whatever the terrain. */
  holds(sn, fx, fz) {
    const mr = this.plate.spacing * this.radarCell;
    const dx = fx + 0.5 - (sn.x - this.plate.x0) / mr, dz = fz + 0.5 - (sn.z - this.plate.z0) / mr;
    const rr = sn.range / mr;
    return dx * dx + dz * dz <= rr * rr;
  }
  of(kind, side) { return this.sensors.filter((sn) => sn.kind === kind && sn.side >= 0 && sn.side < this.sides && (side === undefined || sn.side === side)); }
  fogCell(x, z) {
    const mr = this.plate.spacing * this.radarCell;
    const rx = (x - this.plate.x0) / mr, rz = (z - this.plate.z0) / mr;
    return rx >= 0 && rx < this.fc && rz >= 0 && rz < this.fr ? Math.floor(rz) * this.fc + Math.floor(rx) : -1;
  }
  stateAt(side, cell) { return cell < 0 ? UNSEEN : this.state[side][cell]; }
  /** The call of step k: the arrays it leaves. */
  sight(k) {
    const phase = k % this.spread;
    const from = Math.floor((this.gr * phase) / this.spread), to = Math.floor((this.gr * (phase + 1)) / this.spread);
    for (let s = 0; s < this.sides; s++) {
      const eyes = this.of(KIND.eye, s);
      for (let cz = from; cz < to; cz++) for (let cx = 0; cx < this.gc; cx++) this.sees[s][cz * this.gc + cx] = eyes.some((sn) => this.eyeSees(sn, cx, cz)) ? 1 : 0;
    }
    for (let fz = from * this.q; fz < to * this.q; fz++) {
      for (let fx = 0; fx < this.fc; fx++) {
        let value = 0;
        for (let s = 0; s < this.sides; s++) {
          let st = UNSEEN;
          if (this.sees[s][Math.floor(fz / this.q) * this.gc + Math.floor(fx / this.q)]) st = SEEN;
          else if (this.of(KIND.radar, s).some((sn) => this.holds(sn, fx, fz)) && !this.of(KIND.jam).some((sn) => sn.side !== s && this.holds(sn, fx, fz))) st = RADAR;
          this.state[s][fz * this.fc + fx] = st;
          value |= inPlayers(st, this.players[s]);
        }
        this.fog[fz * this.fc + fx] = value;
      }
    }
    const U = this.units.length, S = this.sides;
    const out = { fog: [...this.fog], seen: Array(U).fill(0), blip: Array(U).fill(0), blip_pos: [], ghost: Array(U * S).fill(0), ghost_kind: Array(U * S).fill(0), ghost_pos: [] };
    const m = this.plate.spacing * this.cell, mr = this.plate.spacing * this.radarCell;
    this.units.forEach((u, i) => {
      const there = u.side >= 0 && u.side < S;
      const cell = there ? this.fogCell(u.x, u.z) : -1;
      for (let s = 0; s < S; s++) {
        let sees = false;
        if (there && s === u.side) sees = true;
        else if (there) {
          const st = this.stateAt(s, cell);
          const detected = this.of(KIND.detect, s).some((sn) => {
            const dx = (sn.x - this.plate.x0) / m - (u.x - this.plate.x0) / m, dz = (sn.z - this.plate.z0) / m - (u.z - this.plate.z0) / m;
            return dx * dx + dz * dz <= u.decloak * u.decloak;
          });
          const hidden = (u.flags & CLOAKED) !== 0 && !detected;
          if (st === SEEN && !hidden) sees = true;
          if (st === RADAR && !hidden) out.blip[i] |= this.players[s];
        }
        if (sees) out.seen[i] |= this.players[s];
        const at = i * S + s;
        let place = [0, 0];
        if (there && s !== u.side && sees && (u.flags & STRUCTURE) !== 0) this.known[at] = { x: u.x, z: u.z, kind: u.kind };
        else if (this.known[at]) {
          const last = this.known[at];
          if (this.stateAt(s, this.fogCell(last.x, last.z)) === SEEN) this.known[at] = null;
          else { out.ghost[at] = this.players[s]; out.ghost_kind[at] = last.kind; place = [last.x, last.z]; }
        }
        out.ghost_pos.push(place);
      }
      // A blip's place: somewhere in the unit's fog cell, by a hash of the seed, the unit's row and the step.
      if (!there) { out.blip_pos.push([0, 0]); return; }
      const M = (1n << 64n) - 1n;
      let h = (BigInt.asUintN(64, this.seed) ^ ((BigInt(i) * 0x9e3779b97f4a7c15n) & M) ^ ((BigInt(k) * 0xc2b2ae3d27d4eb4fn) & M)) & M;
      h = ((h ^ (h >> 29n)) * 0xbf58476d1ce4e5b9n) & M;
      h ^= h >> 32n;
      out.blip_pos.push([
        this.plate.x0 + mr * (Math.floor((u.x - this.plate.x0) / mr) + Number(h >> 40n) / 16777216),
        this.plate.z0 + mr * (Math.floor((u.z - this.plate.z0) / mr) + Number((h >> 16n) & 0xffffffn) / 16777216),
      ]);
    });
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------
// The fixtures' program: a driver that plays a script of rows and calls `sight` once a step. Memory: its writes from
// 4096 in name order (blip, blip_pos, fog, ghost, ghost_kind, ghost_pos, seen), which the state's header points at, so
// the library writes the arrays in place; the 2 MiB state at 1 MiB; the sensor rows at 3 MiB and the unit rows 64 KiB
// on; its cursor; and its assets (the script, then the plate's heights as binary32, each after its u32 length). The
// script: a 128-byte header (u32 cols, rows, cell, radar cell, spread, sides, sensor rows, unit rows; f64 x0, z0,
// spacing; i64 seed; u32 × 8 each side's player bits), then 8-byte words (a code and a row), each step's ops closed
// by END (0) and the script by HALT (3): SENSOR (1) and UNIT (2) are each followed by the 40-byte row they set.

const WRITES_AT = 4096, STATE_AT = 1 << 20, SENSORS_AT = 3 << 20, UNITS_AT = SENSORS_AT + 65536, CURSOR_AT = UNITS_AT + 65536;
const ASSETS_AT = CURSOR_AT + 65536, SCRIPT_AT = ASSETS_AT + 4, PAGES = 64, ROW = 40;
const H = { heights: 0, cols: 4, sensors: 28, sensorCount: 32, units: 36, unitCount: 40, fog: 44, seen: 48, blip: 52, blipPos: 56, ghost: 60, ghostPos: 64, ghostKind: 68, x0: 72, players: 104 };
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
const S = (field) => `(i32.const ${STATE_AT + field})`;
/** The driver importing `sight` from `module`. */
const driver = (name, module) => program(name, `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
  (import "${module}" "sight" (func $sight (param i32 i64)))
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  ;; Takes n bytes, rounded up to 8, at the address held at 8: stores the address in the header's field and moves on.
  (func $array (param $field i32) (param $n i32)
    (i32.store (local.get $field) (i32.load (i32.const 8)))
    (i32.store (i32.const 8) (i32.add (i32.load (i32.const 8)) (i32.and (i32.add (local.get $n) (i32.const 7)) (i32.const -8)))))
  (func (export "init") (param $seed i64) (local $u i32) (local $us i32) (local $f i32) (local $i i32)
    (i32.store ${S(H.heights)} (i32.add (i32.add (i32.const ${SCRIPT_AT}) (i32.load (i32.const ${ASSETS_AT}))) (i32.const 4)))
    (memory.copy ${S(H.cols)} (i32.const ${SCRIPT_AT}) (i32.const 24))
    (i32.store ${S(H.sensors)} (i32.const ${SENSORS_AT}))
    (i32.store ${S(H.sensorCount)} (i32.load (i32.const ${SCRIPT_AT + 24})))
    (i32.store ${S(H.units)} (i32.const ${UNITS_AT}))
    (i32.store ${S(H.unitCount)} (i32.load (i32.const ${SCRIPT_AT + 28})))
    (memory.copy ${S(H.x0)} (i32.const ${SCRIPT_AT + 32}) (i32.const 32))
    (memory.copy ${S(H.players)} (i32.const ${SCRIPT_AT + 64}) (i32.const 32))
    (local.set $u (i32.load (i32.const ${SCRIPT_AT + 28})))
    (local.set $us (i32.mul (local.get $u) (i32.load (i32.const ${SCRIPT_AT + 20}))))
    ;; The fog grid's cells: the sight cells across and down, each cut into (cell ÷ radar cell)² fog cells.
    (local.set $f (i32.div_u (i32.load (i32.const ${SCRIPT_AT + 8})) (i32.load (i32.const ${SCRIPT_AT + 12}))))
    (local.set $f (i32.mul (i32.mul (local.get $f) (local.get $f)) (i32.mul
      (i32.div_u (i32.sub (i32.load (i32.const ${SCRIPT_AT})) (i32.const 1)) (i32.load (i32.const ${SCRIPT_AT + 8})))
      (i32.div_u (i32.sub (i32.load (i32.const ${SCRIPT_AT + 4})) (i32.const 1)) (i32.load (i32.const ${SCRIPT_AT + 8}))))))
    (i32.store (i32.const 8) (i32.const ${WRITES_AT}))
    (call $array ${S(H.blip)} (i32.shl (local.get $u) (i32.const 2)))
    (call $array ${S(H.blipPos)} (i32.shl (local.get $u) (i32.const 4)))
    (call $array ${S(H.fog)} (i32.shl (local.get $f) (i32.const 2)))
    (call $array ${S(H.ghost)} (i32.shl (local.get $us) (i32.const 2)))
    (call $array ${S(H.ghostKind)} (i32.shl (local.get $us) (i32.const 2)))
    (call $array ${S(H.ghostPos)} (i32.shl (local.get $us) (i32.const 4)))
    (call $array ${S(H.seen)} (i32.shl (local.get $u) (i32.const 2)))
    ;; Every unit row starts empty: its side −1.
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $u)))
      (i32.store offset=24 (i32.add (i32.const ${UNITS_AT}) (i32.mul (local.get $i) (i32.const ${ROW}))) (i32.const -1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each))))
  (func (export "step") (param $k i64) (local $p i32) (local $op i32)
    (local.set $p (i32.load (i32.const ${CURSOR_AT})))
    (block $done (loop $next
      (local.set $op (i32.load (local.get $p)))
      (br_if $done (i32.eq (local.get $op) (i32.const 3)))
      (local.set $p (i32.add (local.get $p) (i32.const 8)))
      (br_if $done (i32.eqz (local.get $op)))
      (memory.copy
        (i32.add (select (i32.const ${SENSORS_AT}) (i32.const ${UNITS_AT}) (i32.eq (local.get $op) (i32.const 1))) (i32.mul (i32.load (i32.sub (local.get $p) (i32.const 4))) (i32.const ${ROW})))
        (local.get $p) (i32.const ${ROW}))
      (local.set $p (i32.add (local.get $p) (i32.const ${ROW})))
      (br $next)))
    (i32.store (i32.const ${CURSOR_AT}) (local.get $p))
    (call $sight (i32.const ${STATE_AT}) (local.get $k)))
  (data (i32.const ${CURSOR_AT}) "${[0, 8, 16, 24].map((b) => `\\${(((SCRIPT_AT + 128) >>> b) & 255).toString(16).padStart(2, '0')}`).join('')}"))`);

function rowBytes(r, unit) {
  const b = Buffer.alloc(ROW);
  b.writeDoubleLE(r.x, 0);
  b.writeDoubleLE(r.z, 8);
  if (unit) {
    b.writeDoubleLE(r.decloak, 16);
    [r.side, r.kind, r.flags].forEach((v, i) => b.writeInt32LE(v, 24 + 4 * i));
  } else {
    b.writeDoubleLE(r.height, 16);
    b.writeDoubleLE(r.range, 24);
    b.writeInt32LE(r.kind, 32);
    b.writeInt32LE(r.side, 36);
  }
  return b;
}
const word = (code, i = 0) => { const b = Buffer.alloc(8); b.writeUInt32LE(code, 0); b.writeUInt32LE(i, 4); return b; };
function scriptBytes(plate, header, sensors, units, steps) {
  const h = Buffer.alloc(128);
  [plate.cols, plate.rows, header.cell, header.radarCell, header.spread, header.players.length, sensors, units].forEach((v, i) => h.writeUInt32LE(v, 4 * i));
  [plate.x0, plate.z0, plate.spacing].forEach((v, i) => h.writeDoubleLE(v, 32 + 8 * i));
  h.writeBigInt64LE(header.seed, 56);
  header.players.forEach((bits, s) => h.writeUInt32LE(bits, 64 + 4 * s));
  const parts = [h];
  for (const ops of steps) {
    for (const o of ops) parts.push(word('sensor' in o ? 1 : 2, o.i), rowBytes(o.sensor ?? o.unit, 'unit' in o));
    parts.push(word(0));
  }
  parts.push(word(3));
  return Buffer.concat(parts);
}
const heightsBytes = (plate) => { const b = Buffer.alloc(4 * plate.heights.length); plate.heights.forEach((v, i) => b.writeFloatLE(v, 4 * i)); return b; };
const fixture = (name, f) => put(`fixtures/${name}.json`, Buffer.from(`${JSON.stringify({ name, ...f }, null, 2)}\n`));
/**
 * A fixture: `steps` (each the rows it sets, as `{i, sensor}` or `{i, unit}`), the arrays `read` names expected at the
 * steps `at` lists, from the rule; `check(arrays by step, world)` holds the answer's own numbers to it.
 */
function scene(name, plate, header, sensors, units, steps, at, read, prog, answer, check, links) {
  const world = new World(plate, header, sensors, units);
  const arrays = {};
  const all = steps.map((ops, k) => {
    for (const o of ops) (o.sensor ? world.sensors : world.units)[o.i] = { ...(o.sensor ?? o.unit) };
    const out = world.sight(k);
    if (at.includes(k)) arrays[k] = Object.fromEntries(read.map((n) => [n, out[n]]));
    return out;
  });
  check?.(all, world);
  const U = units, US = units * header.players.length, F = world.fc * world.fr;
  const writes = {
    blip: { type: 'i32', count: U }, blip_pos: { type: 'vec2', count: U }, fog: { type: 'i32', count: F }, ghost: { type: 'i32', count: US },
    ghost_kind: { type: 'i32', count: US }, ghost_pos: { type: 'vec2', count: US }, seen: { type: 'i32', count: U },
  };
  const script = put(`data/${name}.bin`, scriptBytes(plate, header, sensors, units, steps));
  const heights = put(`data/${plate.name}.f32`, heightsBytes(plate));
  const end = ASSETS_AT + 4 + readFileSync(join(OUT, `data/${name}.bin`)).length + 4 + 4 * plate.heights.length;
  if (end > PAGES * 65536) throw Error(`${name}'s assets end at ${end}, past the driver's memory`);
  const params = { program: prog, writes, assets: [script, heights], budget: { fuel: 4_000_000, memory: PAGES / 16 }, ...(links ? { links } : {}) };
  return fixture(name, { item: { kind: 'logic@1', params }, track: [], steps: steps.length, expect: { arrays, tolerance: 'exact' }, answer });
}

/** A square plate of `metres` a side at 1 m spacing, centred on the origin. */
function plate(name, metres, height) {
  const n = metres + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = height(i - metres / 2, j - metres / 2);
  return { name, cols: n, rows: n, spacing: 1, x0: -metres / 2, z0: -metres / 2, heights };
}
const eye = (side, x, z, range, height = 2) => ({ x, z, height, range, kind: KIND.eye, side });
const radar = (side, x, z, range) => ({ x, z, height: 0, range, kind: KIND.radar, side });
const jam = (side, x, z, range) => ({ x, z, height: 0, range, kind: KIND.jam, side });
const detect = (side, x, z) => ({ x, z, height: 0, range: 0, kind: KIND.detect, side });
const unit = (side, x, z, more = {}) => ({ x, z, decloak: 0, side, kind: 1, flags: 0, ...more });
const header = (more = {}) => ({ cell: 8, radarCell: 4, spread: 1, players: [1, 2], seed: 959n, ...more });
/** Side `side`'s state at fog cell (fx, fz) of a 32 × 32 grid whose side s is player s + 1. */
const at32 = (fog, fx, fz, side) => (fog[fz * 32 + fx] >> (2 * side)) & 3;
const must = (ok, what) => { if (!ok) throw Error(`a fixture's answer doesn't hold: ${what}`); };

// A plate of 128 m (16 × 16 sight cells of 8 m, 32 × 32 fog cells of 4 m). A ridge 24 m high crosses it at −8 ≤ z < 0
// (sight row 7) and a tower 90 m high stands behind it at −40 ≤ z < −32, −32 ≤ x < −24 (sight cell (4, 3)); the rest is 0.
const ridged = plate('ridged', 128, (x, z) => (z >= -8 && z < 0 ? 24 : z >= -40 && z < -32 && x >= -32 && x < -24 ? 90 : 0));
const flat = plate('flat', 128, () => 0);
const by = driver('driver', 'lib:sense.lib@1');

const ridge = scene('ridge', ridged, header(), 1, 4, [
  [{ i: 0, sensor: eye(0, -28, 44, 80) }, { i: 0, unit: unit(0, -28, 44) }, { i: 1, unit: unit(1, -12, -28) }, { i: 2, unit: unit(1, -52, 28) }, { i: 3, unit: unit(1, 60, 44) }],
  [],
], [0, 1], ['fog', 'seen', 'blip'], by, 'A 128 m plate, 16 × 16 sight cells of 8 m: a ridge 24 m high fills sight row 7 and a tower 90 m high sight cell (4, 3) behind it. Side 0\'s eye stands 2 m over flat ground at (−28, 44), the centre of sight cell (4, 13), with a range of 80 m, 10 cells. In range, every flat cell on its side of the ridge is seen (the line falls from 2 m to 0 over ground at 0) and so is the ridge\'s row (the line rises to 24 m over ground at 0). Every flat cell behind the ridge is unseen: the line to it is under 2 m where it crosses the 24 m ridge. The tower, 10 cells away, is seen: the line to its 90 m top stands at 2 + 88 × 0.6 = 54.8 m over the ridge. On the eye\'s own row, sight cell (14, 13), 10 cells away, is seen and (15, 13), 11 cells away, is not. Unit 1 of side 1, on flat ground behind the ridge at (−12, −28), is seen by its own side only (2), as is unit 3, in front but past the range at (60, 44); unit 2, in front at (−52, 28), is seen by both (3). A library that reads every height as 0 sees the cells behind the ridge.', ([out]) => {
  must(at32(out.fog, 9, 27, 0) === SEEN && at32(out.fog, 8, 20, 0) === SEEN && at32(out.fog, 9, 14, 0) === SEEN, 'the eye\'s own cell, the flat ground in front and the ridge\'s row are seen');
  must(at32(out.fog, 9, 12, 0) === UNSEEN && at32(out.fog, 13, 9, 0) === UNSEEN, 'the flat ground behind the ridge is unseen');
  must(at32(out.fog, 8, 6, 0) === SEEN && at32(out.fog, 9, 7, 0) === SEEN && at32(out.fog, 10, 6, 0) === UNSEEN, 'the tower behind the ridge is seen, the cell beside it isn\'t');
  must(at32(out.fog, 28, 27, 0) === SEEN && at32(out.fog, 30, 27, 0) === UNSEEN && at32(out.fog, 9, 4, 0) === UNSEEN, 'a cell at the range is seen and a cell past it is not');
  must(JSON.stringify(out.seen) === '[1,2,3,2]' && JSON.stringify(out.blip) === '[0,0,0,0]', `the units' bits: ${JSON.stringify(out.seen)}`);
});

// Radar and a jammer on the flat plate. Side 0 is player 1; side 1 is players 2 and 3.
const radarScene = scene('radar', flat, header({ players: [1, 6] }), 3, 3, [
  [{ i: 0, sensor: radar(0, -24, 4, 44) }, { i: 1, sensor: jam(1, 12, 4, 20) }, { i: 2, sensor: radar(1, 24, 12, 12) },
    { i: 0, unit: unit(1, 6, 6) }, { i: 1, unit: unit(1, -34, 22) }, { i: 2, unit: unit(0, 22, 14) }],
  [],
  [{ i: 1, sensor: NO_SENSOR }],
  [],
], [0, 1, 2, 3], ['fog', 'seen', 'blip', 'blip_pos'], by, 'The flat 128 m plate, 32 × 32 fog cells of 4 m; side 0 is player 1 and side 1 players 2 and 3. Side 0\'s radar at (−24, 4) holds the fog cells whose centres lie within 44 m; side 1\'s jammer at (12, 4) clears it from those within 20 m of itself; side 1\'s own radar at (24, 12), range 12 m, lies inside its jammer and keeps its cells. Unit 0 of side 1 at (6, 6) is in the radar and in the jammer: unseen by side 0, no blip. Unit 1 of side 1 at (−34, 22) is in the radar alone: a blip for player 1 (blip 1), not seen. Unit 2 of side 0 at (22, 14) is a blip for side 1\'s players (blip 6). The jammer\'s row is gone from step 2, and from that step unit 0 is a blip too. A blip\'s place is somewhere in its unit\'s fog cell, by a hash of the seed, the unit\'s row and the step.', (outs) => {
  must(at32(outs[0].fog, 17, 17, 0) === UNSEEN && at32(outs[0].fog, 7, 21, 0) === RADAR, 'the jammed cell is unseen and the cell outside the jammer is radar for side 0');
  must(((outs[0].fog[19 * 32 + 21] >> 2) & 3) === RADAR && ((outs[0].fog[19 * 32 + 21] >> 4) & 3) === RADAR, 'side 1\'s radar under its own jammer holds, in both its players\' bits');
  must(JSON.stringify(outs.map((o) => o.blip)) === '[[0,1,6],[0,1,6],[1,1,6],[1,1,6]]', `the blips: ${JSON.stringify(outs.map((o) => o.blip))}`);
  must(JSON.stringify(outs.map((o) => o.seen)) === '[[6,6,1],[6,6,1],[6,6,1],[6,6,1]]', `the seen bits: ${JSON.stringify(outs.map((o) => o.seen))}`);
  must(at32(outs[2].fog, 17, 17, 0) === RADAR, 'the step after the jammer\'s last, its cells are radar again');
  must(outs[1].blip_pos.every(([x, z], i) => x >= -64 + 4 * Math.floor(([6, -34, 22][i] + 64) / 4) && x < -60 + 4 * Math.floor(([6, -34, 22][i] + 64) / 4) && Number.isFinite(z)), 'a blip\'s place lies in its unit\'s fog cell');
  must(JSON.stringify(outs[0].blip_pos) !== JSON.stringify(outs[1].blip_pos), 'a blip\'s place changes with the step');
});

// Cloak and a last-seen ghost on the flat plate. A detector comes 1 m a step nearer the cloaked unit; a second eye
// watches a structure at steps 1 to 3, is gone from step 4 and back at step 8; the structure is gone from step 5; a
// radar holds its cell from step 6.
const DETECTOR = (k) => detect(0, -28, -1.5 - k);
const WATCHER = eye(0, 28, 28, 40);
const ghost = scene('ghost', flat, header(), 4, 3, [
  [{ i: 0, sensor: eye(0, -40, -40, 40) }, { i: 1, sensor: DETECTOR(0) },
    { i: 0, unit: unit(1, -28, -36, { flags: CLOAKED, decloak: 4 }) }, { i: 1, unit: unit(1, -36, -28) }, { i: 2, unit: unit(1, 36, 20, { flags: STRUCTURE, kind: 7 }) }],
  [{ i: 1, sensor: DETECTOR(1) }, { i: 2, sensor: WATCHER }],
  [{ i: 1, sensor: DETECTOR(2) }],
  [{ i: 1, sensor: DETECTOR(3) }],
  [{ i: 1, sensor: DETECTOR(4) }, { i: 2, sensor: NO_SENSOR }],
  [{ i: 2, unit: NO_UNIT }],
  [{ i: 3, sensor: radar(0, 36, 28, 20) }],
  [],
  [{ i: 2, sensor: WATCHER }],
  [],
], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], ['seen', 'blip', 'ghost', 'ghost_kind', 'ghost_pos'], by, 'The flat 128 m plate; side 0 is player 1, side 1 player 2. Side 0\'s eye at (−40, −40) sees the cells around side 1\'s cloaked unit 0 at (−28, −36), whose decloak radius is 4 sight cells (32 m), and its plain unit 1. Side 0\'s detector stands 34.5 − k m from the cloaked unit at step k: 32.5 m (4.0625 cells) at step 2, 31.5 m (3.9375 cells) at step 3, so the cloaked unit is seen by side 0 from step 3 and not before, while the plain unit is seen from step 0. Side 1\'s structure, unit 2 of kind 7 at (36, 20), is seen by a second eye of side 0 at steps 1 to 3. That eye is gone from step 4: from then side 0 holds a ghost row (row 4: unit 2, side 0) at (36, 20) of kind 7. The structure itself is gone from step 5 and the ghost stays; a radar of side 0 holds its cell from step 6 and the ghost stays; the eye is back at step 8, the cell is seen, and the ghost row clears.', (outs) => {
  must(JSON.stringify(outs.map((o) => o.seen[0])) === '[2,2,2,3,3,3,3,3,3,3]', `the cloaked unit's seen bits by step: ${JSON.stringify(outs.map((o) => o.seen[0]))}`);
  must(outs.every((o) => o.seen[1] === 3), 'the plain unit beside it is seen at every step');
  must(JSON.stringify(outs.map((o) => o.seen[2])) === '[2,3,3,3,2,0,0,0,0,0]', `the structure's seen bits by step: ${JSON.stringify(outs.map((o) => o.seen[2]))}`);
  must(JSON.stringify(outs.map((o) => o.ghost[4])) === '[0,0,0,0,1,1,1,1,0,0]', `the ghost row by step: ${JSON.stringify(outs.map((o) => o.ghost[4]))}`);
  must(outs.every((o) => o.ghost.every((g, r) => r === 4 || g === 0)), 'no other ghost row');
  must(JSON.stringify(outs[6].ghost_pos[4]) === '[36,20]' && outs[6].ghost_kind[4] === 7 && JSON.stringify(outs[8].ghost_pos[4]) === '[0,0]', 'the ghost keeps the structure\'s place and kind, and holds neither once clear');
});

// A rebuild over 3 steps on the ridged plate: a call rebuilds sight rows 0 to 4, 5 to 9 or 10 to 15. The eye moves at
// step 3, and each row keeps what its last rebuild saw until its next.
const spread = scene('spread', ridged, header({ spread: 3 }), 1, 2, [
  [{ i: 0, sensor: eye(0, -28, 44, 80) }, { i: 0, unit: unit(1, -28, 28) }, { i: 1, unit: unit(1, -12, -52) }],
  [], [],
  [{ i: 0, sensor: eye(0, -28, -52, 80) }],
  [], [],
], [0, 1, 2, 3, 4, 5], ['fog', 'seen'], by, 'The ridge fixture\'s plate and eye, rebuilt over 3 steps: step k rebuilds the sight rows ⌊16 × (k mod 3) ÷ 3⌋ up to ⌊16 × (k mod 3 + 1) ÷ 3⌋, rows 0 to 4, then 5 to 9, then 10 to 15, and the fog rows they hold. At step 0 only rows 0 to 4 are built, where the eye sees the tower alone; the ridge\'s row is built at step 1 and the eye\'s own at step 2, when unit 0 of side 1 at (−28, 28), in sight row 11, is first seen by side 0. At step 3 the eye moves behind the ridge to (−28, −52): rows 0 to 4 are built again from there at once and unit 1 at (−12, −52) is seen from step 3, while rows 10 to 15 still hold what the eye saw from its first place until step 5 builds them again, when unit 0, now behind the ridge from the eye, is seen no more.', (outs) => {
  must(JSON.stringify(outs.map((o) => o.seen)) === '[[2,2],[2,2],[3,2],[3,3],[3,3],[2,3]]', `the units' seen bits by step: ${JSON.stringify(outs.map((o) => o.seen))}`);
  must(at32(outs[0].fog, 8, 6, 0) === SEEN && at32(outs[0].fog, 9, 14, 0) === UNSEEN && at32(outs[1].fog, 9, 14, 0) === SEEN && at32(outs[1].fog, 9, 27, 0) === UNSEEN && at32(outs[2].fog, 9, 27, 0) === SEEN, 'each share of the rows is built at its own step');
  must(at32(outs[4].fog, 9, 27, 0) === SEEN && at32(outs[5].fog, 9, 27, 0) === UNSEEN, 'a row keeps its last rebuild until its next');
});

// The reference library's own fixture (#190's rule): one eye on a flat 16 m plate sees all of it, linking the library
// by its own name.
const REF = 'sense.sight@1.0.0';
const small = plate('small', 16, () => 0);
const own = scene('sight_own', small, header({ players: [1] }), 1, 1, [
  [{ i: 0, sensor: eye(0, 0, 0, 100) }, { i: 0, unit: unit(0, 0, 0) }],
], [0], ['fog', 'seen'], driver('driver_own', 'lib:sense.sight'), 'A flat 16 m plate, 2 × 2 sight cells and 4 × 4 fog cells, one side of player 1, importing sense.sight by its own name: its eye at the centre, range 100 m, sees every cell (fog 2 throughout) and its own unit (seen 1).', ([out]) => {
  must(out.fog.length === 16 && out.fog.every((v) => v === 2) && out.seen[0] === 1, 'the eye sees the whole small plate');
}, [{ name: REF, asset: reference }]);

// ---------------------------------------------------------------------------------------------------

const fixtures = [ridge, radarScene, ghost, spread];
const manifest = {
  name: 'sense', version: '1.0.0', license: 'Apache-2.0',
  description: 'sense.lib@1 (#959): each side\'s sight over a terrain plate\'s heights on a coarse grid. An eye sees a sight cell in its range when the line from its eye to the cell\'s ground point stays above the coarse heights it crosses; a radar holds the fog cells in its range whatever the terrain; a jammer clears the other sides\' radar; a cloaked unit shows only to a side with a detect sensor within its decloak radius; a structure seen and lost stays a ghost row until its cell is seen again; a rebuild takes `spread` steps. It writes the fog grid (two bits a player: unseen, radar, seen) and each unit row\'s seen and blip bits. Its fixtures\' expected arrays are worked by brute force from the rule; its planted library reads every height as 0, sees behind the ridge and fails the ridge and spread fixtures. Strong defaults a piece takes unless its brief or catalog says otherwise: sight cells of 8 × 8 height samples, radar cells of 4 × 4, a rebuild over 3 steps, an eye 2 m above its unit\'s ground, and no sensor kind but eye. Written by scripts/sense-pack.mjs; the library is src/sense.rs and each program\'s text is in src/.',
  requires: { core: '>=0.0.0', modules: { logic: '>=0.0.0', sandbox: '>=0.0.0' } },
  interfaces: {
    'sense.lib@1': { exports: EXPORTS, fixtures, planted: [planted], digest: sha256(canonical({ exports: EXPORTS, layout: null, fixtures })) },
  },
  libs: { [REF]: { asset: reference, exports: EXPORTS.map((e) => e.name), fixtures: [own], implements: ['sense.lib@1'] } },
  assets,
};
writeFileSync(join(OUT, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}: ${assets.length} assets; sense.lib@1 digest ${manifest.interfaces['sense.lib@1'].digest}`);
