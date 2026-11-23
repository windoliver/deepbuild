// logic@1 in the web player (#531): the browser's own WebAssembly engine steps the bytes the app's
// sandbox module checked and rewrote, as crates/deep-logic/src/world.rs steps them in wasmtime:
// the same read region, step seeds, page bitmap, step and full-state hashes, checkpoints that keep
// the pages the bitmap marked, restores into a fresh instance that never run the start function or
// init again, and continuation probes. Nothing here checks or rewrites. `deep-logic web_runner`
// serves this file after sandbox@1's web runner (crates/deep-sandbox-wasmtime/web/runner.mjs), whose
// offset map, trap kinds and frame reading it uses, as one module with no imports.

const PAGE = 65536;
const PER_STEP = 16;

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const le = (bits, v) => { const b = new Uint8Array(bits / 8); const d = new DataView(b.buffer); if (bits === 64) d.setBigUint64(0, BigInt.asUintN(64, BigInt(v)), true); else d.setUint32(0, Number(v) >>> 0, true); return b; };

// The first 8 bytes of a sha256: the logic module's 64-bit hash, as 16 hex digits and a big-endian u64.
async function h64(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).subarray(0, 8);
  return { hex: hex(d), value: new DataView(d.buffer, d.byteOffset, 8).getBigUint64(0, false) };
}
// The seed of step k: hash(the document's seed, the logic ID, k).
async function stepSeed(doc, id, k) {
  const h = await h64(concat([le(64, doc), new TextEncoder().encode(id), new Uint8Array([0]), le(64, k)]));
  return BigInt.asIntN(64, h.value);
}

// #211: world pages, as crates/deep-logic/src/pages.rs keeps them: the requests and the slot table on
// the page region's first 64 KiB at pages_at, then one memory page per slot; moves queued after a step
// for step k + lead and run before it, ahead of the read region fill; the page map by hash with its
// root; the written cap; and the store in memory, up to web_max.
const NONE = 0xFFFFFFFF;
const MOVE_FUEL = 65536;
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const slotAt = (p, j) => p.at + PAGE * (1 + j);
const tableAt = (p) => p.at + 8 * p.moves;
const slotOf = (p, page) => { const first = p.at / PAGE + 1; return page >= first && page < first + p.slots ? page - first : null; };
async function pagesOf(item) {
  const p = item.world_pages;
  if (!p || p.ready) return p;
  p.store = new Map();
  p.first = new Map();
  for (const [page, b64] of p.init) {
    const b = bytesOf(b64);
    const h = await sha(b);
    p.store.set(hex(h), b);
    p.first.set(page, { hash: h, key: hex(h), written: false });
  }
  p.ready = true;
  return p;
}
function freshPaged(p) {
  return { map: new Map(p.first), slots: Array.from({ length: p.slots }, () => [NONE, 0]), dirty: new Set(), queue: [], changed: new Map(), moved: 0, late: 0, moves: 0 };
}
const copyPaged = (st) => ({ map: new Map(st.map), slots: st.slots.map((x) => x.slice()), dirty: new Set(st.dirty), queue: st.queue.map((m) => ({ ...m })), changed: new Map(st.changed), moved: 0, late: st.late, moves: st.moves });
async function root(map) {
  return sha(concat([...map].sort((a, b) => a[0] - b[0]).flatMap(([page, e]) => [le(32, page), e.hash])));
}
async function pagedHashed(st) {
  const parts = [await root(st.map)];
  for (const m of st.queue) parts.push(le(64, m.step), le(32, m.page), le(32, m.slot));
  for (const [page, fresh] of st.slots) parts.push(le(32, page), le(32, fresh));
  for (const s of [...st.dirty].sort((a, b) => a - b)) parts.push(le(32, s));
  return concat(parts);
}
const keptBytes = (k) => 36 * k.map.size + 8 * k.slots.length + 16 * k.queue.length + 4 * k.dirty.size;
function kept(st, whole) { return { whole, map: new Map(whole ? st.map : st.changed), slots: st.slots.map((x) => x.slice()), dirty: new Set(st.dirty), queue: st.queue.map((m) => ({ ...m })) }; }
function mergeKept(earlier, later) {
  if (!earlier) return later;
  if (!later) return earlier;
  if (later.whole) return later;
  return { ...later, whole: earlier.whole, map: new Map([...earlier.map, ...later.map]) };
}
// The moves queued for step k, in queue order, each writing back its slot's page when a step wrote it
// since it loaded and loading the requested page as the map gives it; the memory pages it wrote.
async function movesBefore(l, k) {
  const p = l.item.world_pages;
  const st = l.paged;
  st.moved = 0;
  let n = 0;
  while (n < st.queue.length && st.queue[n].step <= k) n++;
  if (n === 0) return [];
  const m = memoryOf(l);
  const touched = [p.at / PAGE];
  for (const mv of st.queue.splice(0, n)) {
    const at = slotAt(p, mv.slot);
    const [old] = st.slots[mv.slot];
    if (old !== NONE && st.dirty.has(mv.slot)) {
      const bytes = m.slice(at, at + PAGE);
      const h = await sha(bytes);
      const key = hex(h);
      if (!p.store.has(key)) p.store.set(key, bytes);
      const e = { hash: h, key, written: true };
      st.map.set(old, e);
      st.changed.set(old, e);
    }
    const e = st.map.get(mv.page);
    let fresh = 0;
    if (e) m.set(p.store.get(e.key), at); else { m.fill(0, at, at + PAGE); fresh = 1; }
    st.slots[mv.slot] = [mv.page, fresh];
    st.dirty.delete(mv.slot);
    st.moved++;
    st.moves++;
    touched.push(at / PAGE);
  }
  const d = new DataView(m.buffer);
  st.slots.forEach(([page, fresh], j) => { d.setUint32(tableAt(p) + 8 * j, page, true); d.setUint32(tableAt(p) + 8 * j + 4, fresh, true); });
  return touched;
}
// After a step that wrote memory pages `written`: the slots it wrote, the written cap, then the web
// store, in memory up to web_max; a trap's kind and fields, or null.
function afterStep(l, written) {
  const p = l.item.world_pages;
  const st = l.paged;
  for (const w of written) { const s = slotOf(p, w); if (s !== null && st.slots[s][0] !== NONE) st.dirty.add(s); }
  const pages = new Set();
  for (const [page, e] of st.map) if (e.written) pages.add(page);
  for (const s of st.dirty) pages.add(st.slots[s][0]);
  if (pages.size > p.written_max) return ['pages_full', { written: pages.size, written_max: p.written_max }];
  if (p.web_max != null && pages.size * PAGE > p.web_max) return ['pages_store', { written: pages.size, web_max: p.web_max }];
  return null;
}
// The requests after step k (−1: after init), queued for step k + lead (the program's: never written
// here); a trap or null.
function requests(l, k) {
  const p = l.item.world_pages;
  const st = l.paged;
  const d = new DataView(memoryOf(l).buffer);
  const asked = [];
  const named = new Set();
  for (let i = 0; i < p.moves; i++) {
    const page = d.getUint32(p.at + 8 * i, true);
    if (page === NONE) continue;
    const slot = d.getUint32(p.at + 8 * i + 4, true);
    let why = null;
    if (page >= p.max) why = `page ${page} is at or past max ${p.max}`;
    else if (slot >= p.slots) why = `slot ${slot} is at or past slots ${p.slots}`;
    else if (st.slots.some(([q]) => q === page)) why = `page ${page} is already in a slot`;
    else if (st.queue.some((m) => m.page === page) || asked.some((m) => m.page === page)) why = `page ${page} is already asked for`;
    else if (named.has(slot)) why = `slot ${slot} is named twice`;
    named.add(slot);
    if (why) return ['pages', { request: { index: i, page, slot }, why }];
    asked.push({ step: k + p.lead, page, slot });
  }
  st.queue.push(...asked);
  return null;
}

const TAG = { i32: 1, i64: 2, f32: 3, f64: 4 };
function encoded(live) {
  const parts = [];
  for (const [name, type] of live.item.globals) {
    const v = live.ex[name].value;
    const b = new Uint8Array(type === 'i64' || type === 'f64' ? 9 : 5);
    const d = new DataView(b.buffer);
    b[0] = TAG[type];
    if (type === 'i32') d.setInt32(1, v, true);
    else if (type === 'i64') d.setBigInt64(1, v, true);
    else if (type === 'f32') d.setFloat32(1, v, true);
    else d.setFloat64(1, v, true);
    parts.push(b);
  }
  return concat(parts);
}
const memoryOf = (live) => new Uint8Array(live.ex.memory.buffer);
// The step hash: globals, arrays, and each row emitted after its kind's index.
const stepHash = async (live, rows) => (await h64(concat([encoded(live), live.arrays, ...rows.flatMap(([j, r]) => [le(32, j), r])]))).hex;
async function deepHash(live) {
  let pending = 0;
  for (const q of live.pending.values()) pending += q.length;
  const paged = live.paged ? [await pagedHashed(live.paged)] : [];
  return (await h64(concat([le(64, live.next), le(32, pending), encoded(live), live.arrays, memoryOf(live), ...paged]))).hex;
}

function call(live, exp, args, fuel = live.item.fuel) {
  const ex = live.ex;
  ex['sandbox.fuel'].value = BigInt(Math.max(0, fuel));
  ex['sandbox.stack'].value = 0;
  ex['sandbox.stack_cap'].value = live.item.stack;
  ex['sandbox.trap'].value = 0;
  try {
    ex[exp](...args);
    return null;
  } catch (e) {
    if (!(e instanceof WebAssembly.RuntimeError) && !(e instanceof RangeError)) throw e;
    const frame = frameOf(e);
    if (!frame) throw e;
    const raised = RAISED[ex['sandbox.trap'].value];
    return { kind: raised ?? engineKind(e), function: frame[0], offset: locate(live.map, frame[1], true, raised !== undefined) };
  }
}

function value(type, b) {
  const d = new DataView(b.buffer, b.byteOffset, b.length);
  const f = (i) => d.getFloat64(8 * i, true);
  if (type === 'bool') return d.getUint32(0, true) !== 0;
  if (type === 'i32') return d.getInt32(0, true);
  if (type === 'f64') return f(0);
  return Array.from({ length: { vec2: 2, vec3: 3, quat: 4 }[type] }, (_, i) => f(i));
}
const SIZE = { bool: 4, i32: 4, f64: 8, vec2: 16, vec3: 24, quat: 32 };

// An emitted row as the occurrence list holds it: its kind, a, b and its fields by name.
function rowValue(e, r) {
  const d = new DataView(r.buffer, r.byteOffset, r.length);
  const fields = {};
  let at = 8;
  for (const [name, type] of e.fields) { fields[name] = value(type, r.subarray(at, at + SIZE[type])); at += SIZE[type]; }
  return { kind: e.kind, a: d.getUint32(0, true), b: d.getUint32(4, true), fields };
}

// The rows a step wrote to the emit region, each kind's sorted by (a, b) with ties in write order,
// or the first kind whose count passes its max_per_step.
function emitted(item, m) {
  const d = new DataView(m.buffer, m.byteOffset, m.length);
  const rows = [];
  let at = item.emits_at;
  for (const [j, e] of item.emits.entries()) {
    const count = d.getUint32(at, true);
    if (count > e.max) return { over: { occurrence: e.kind, count } };
    const kind = Array.from({ length: count }, (_, r) => m.slice(at + 4 + r * e.row, at + 4 + (r + 1) * e.row));
    const pair = (r) => { const v = new DataView(r.buffer); return [v.getUint32(0, true), v.getUint32(4, true)]; };
    kind.sort((x, y) => { const [a, b] = pair(x); const [c, e2] = pair(y); return a - c || b - e2; });
    for (const r of kind) rows.push([j, r]);
    at += e.size;
  }
  return { rows };
}

// A point entry's 248 B record at `o`, then a box release's unit keys (u32 n, u32 truncated,
// n × (u32 slot, u32 gen)), as crates/deep-logic/src/point.rs lays them out from the value the
// track holds (Control: point); its length. The codes are that file's: change them together.
const POINT = {
  phase: { press: 0, move: 1, release: 2 },
  button: { primary: 0, secondary: 1, middle: 2 },
  mods: { shift: 1, ctrl: 2, alt: 4, meta: 8 },
  flag: { cell: 1, ground: 2, hit: 4, corners: 8, surface: 16, uv: 32, ray: 64, units: 128 },
};
function pointRecord(d, o, v) {
  const put = (at, xs) => xs.forEach((x, i) => d.setFloat64(o + at + 8 * i, x, true));
  let flags = 0;
  if (v.cell != null) { flags |= POINT.flag.cell; put(8, [v.cell[0], v.cell[1], 0]); }
  if (v.ground != null) { flags |= POINT.flag.ground; put(8, v.ground); }
  if (v.hit != null) {
    flags |= POINT.flag.hit;
    d.setUint32(o + 32, v.hit.set, true);
    d.setBigInt64(o + 40, BigInt(v.hit.key[0]), true);
    d.setBigInt64(o + 48, BigInt(v.hit.key[1]), true);
  }
  if (v.corners != null) {
    // A corner whose ray met nothing stays zero; the flag only when all four met.
    if (v.corners.every((c) => c != null)) flags |= POINT.flag.corners;
    v.corners.forEach((c, i) => { if (c != null) put(56 + 24 * i, c); });
  }
  if (v.surface != null) {
    flags |= POINT.flag.surface;
    put(8, v.surface.point);
    if (v.surface.normal != null) put(152, v.surface.normal);
    if (v.surface.uv != null) { flags |= POINT.flag.uv; put(176, v.surface.uv); }
    if (v.surface.face != null) d.setUint32(o + 192, v.surface.face, true);
  }
  if (v.ray != null) { flags |= POINT.flag.ray; put(200, v.ray.origin); put(224, v.ray.dir); }
  let mods = 0;
  for (const [name, bit] of Object.entries(POINT.mods)) if (v.mods?.[name]) mods |= bit;
  d.setUint8(o, POINT.phase[v.phase]);
  d.setUint8(o + 1, POINT.button[v.button]);
  d.setUint8(o + 2, mods);
  let size = 248;
  if (v.units != null) {
    flags |= POINT.flag.units;
    d.setUint32(o + 248, v.units.keys.length, true);
    d.setUint32(o + 252, v.units.truncated ? 1 : 0, true);
    v.units.keys.forEach(([slot, gen], i) => { d.setUint32(o + 256 + 8 * i, slot, true); d.setUint32(o + 260 + 8 * i, gen, true); });
    size += 8 + 8 * v.units.keys.length;
  }
  d.setUint8(o + 3, flags);
  return size;
}

function trackOf(entries) {
  const out = new Map();
  for (const e of entries) { if (!out.has(e.control)) out.set(e.control, []); out.get(e.control).push(e); }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t || a.player - b.player || a.seq - b.seq);
  return out;
}

class Record {
  constructor() { this.steps = new Map(); this.checkpoints = {}; this.traps = []; }
  at(k) { if (!this.steps.has(k)) this.steps.set(k, { items: {}, arrays: {} }); return this.steps.get(k); }
  json(len) { return [...this.steps.entries()].sort((a, b) => a[0] - b[0]).map(([k, s]) => ({ step: k, t: k * len, items: s.items, arrays: s.arrays })); }
  report(live, k, hash, fuel, pages, rows = []) {
    const s = this.at(k);
    s.items[live.item.id] = { hash, fuel, failed: live.failed, pages };
    for (const w of live.item.writes) {
      const size = SIZE[w.type];
      s.arrays[`${live.item.id}.${w.name}`] = Array.from({ length: w.count }, (_, j) => value(w.type, live.arrays.subarray(w.offset + j * size, w.offset + (j + 1) * size)));
    }
    if (live.item.emits.length && hash !== null) s.arrays[`${live.item.id}.occurrences`] = rows.map(([j, r]) => rowValue(live.item.emits[j], r));
  }
}

async function instance(item) {
  if (!item.module) { item.module = await WebAssembly.compile(bytesOf(item.rewritten)); item.map = offsets(item.module); }
  const inst = await WebAssembly.instantiate(item.module, {});
  return { item, ex: inst.exports, map: item.map, failed: false, next: 0, arrays: new Uint8Array(item.writes_size), cursor: new Map(), pending: new Map(), dirty: new Set(), stored: [], checked: null, spacing: item.every };
}

// The ring past its byte budget: the spacing doubles, and each checkpoint off it is dropped, its pages
// merged into the next one kept or, past the last, into the pages the next checkpoint takes.
const storedBytes = (s) => (s.memory.whole ? s.memory.whole.length : s.memory.pages.length * PAGE) + s.arrays.length + 8 * s.globals.length + (s.paged ? keptBytes(s.paged) : 0);
function merge(earlier, later) {
  if (!earlier || later.whole) return later;
  if (earlier.whole) { const m = earlier.whole; for (const [p, b] of later.pages) m.set(b, p * PAGE); return { whole: m }; }
  const pages = new Map(earlier.pages);
  for (const [p, b] of later.pages) pages.set(p, b);
  return { pages: [...pages].sort((a, b) => a[0] - b[0]) };
}
function thin(live) {
  while (live.stored.length > 1 && live.stored.reduce((n, s) => n + storedBytes(s), 0) > live.item.ring) {
    live.spacing *= 2;
    const keptList = [];
    let carry = null;
    let carryMap = null;
    for (const s of live.stored) {
      if (s.step % live.spacing !== 0) { carry = merge(carry, s.memory); carryMap = mergeKept(carryMap, s.paged); continue; }
      if (carry) { s.memory = merge(carry, s.memory); carry = null; }
      s.paged = mergeKept(carryMap, s.paged);
      carryMap = null;
      keptList.push(s);
    }
    live.stored = keptList;
    if (carry?.whole) for (let p = 0; p < carry.whole.length / PAGE; p++) live.dirty.add(p);
    else if (carry) for (const [p] of carry.pages) live.dirty.add(p);
    if (carryMap && live.paged) live.paged.changed = new Map([...carryMap.map, ...live.paged.changed]);
  }
}

class World {
  static async create(req, rec) {
    const w = new World(req, trackOf(req.track), true);
    for (const item of req.items) {
      const live = await instance(item);
      // The data assets, copied once before the start function: then they're memory.
      if (item.assets) memoryOf(live).set(bytesOf(item.assets), item.assets_at);
      const calls = [];
      if (typeof live.ex['sandbox.start'] === 'function') calls.push(['sandbox.start', []]);
      calls.push(['init', [await stepSeed(req.seed, item.id, 0)]]);
      for (const [exp, args] of calls) {
        const t = call(live, exp, args);
        if (t) { rec.traps.push({ item: item.id, step: null, t: null, ...t, inputs: [] }); live.failed = true; break; }
      }
      // #211: the map from init, and the requests init wrote, for step lead − 1.
      if (await pagesOf(item)) {
        live.paged = freshPaged(item.world_pages);
        if (!live.failed) {
          const trap = requests(live, -1);
          if (trap) { rec.traps.push({ item: item.id, step: null, t: null, kind: trap[0], function: null, offset: null, inputs: [], ...trap[1] }); live.failed = true; }
        }
      }
      w.lives.push(live);
    }
    w.published = w.lives.map((l) => l.arrays.slice());
    return w;
  }
  constructor(req, track, store) { this.req = req; this.track = track; this.store = store; this.lives = []; this.published = []; }
  at() { const k = this.lives[0]?.next; return this.lives.every((l) => l.next === k) ? k : null; }

  async checkpoint(live, rec) {
    if (live.failed || live.next % live.spacing !== 0 || live.checked === live.next) return;
    live.checked = live.next;
    const deep = await deepHash(live);
    (rec.checkpoints[live.item.id] ??= []).push({ step: live.next, deep_hash: deep });
    if (!this.store) return;
    const m = memoryOf(live);
    const whole = live.stored.length % 8 === 0;
    const memory = whole
      ? { whole: m.slice() }
      : { pages: [...live.dirty].sort((a, b) => a - b).map((p) => [p, m.slice(p * PAGE, (p + 1) * PAGE)]) };
    // #211: the page map whole in the ring's first checkpoint, else its changes.
    const paged = live.paged ? kept(live.paged, live.stored.length === 0) : null;
    live.stored.push({ step: live.next, globals: live.item.globals.map(([n]) => live.ex[n].value), arrays: live.arrays.slice(), cursor: new Map(live.cursor), pending: new Map([...live.pending].map(([c, q]) => [c, q.slice()])), memory, paged });
    live.dirty.clear();
    if (live.paged) live.paged.changed.clear();
    thin(live);
  }

  async run(until, rec, before) {
    for (;;) {
      const times = this.lives.filter((l) => l.next < until).map((l) => l.next * l.item.step);
      const t = times.length ? Math.min(...times) : null;
      for (const l of this.lives) if (t === null || l.next * l.item.step === t) await this.checkpoint(l, rec);
      const k = this.at();
      if (k !== null && before) await before(this, k);
      if (t === null) break;
      const snapshot = this.published.map((a) => a.slice());
      for (let i = 0; i < this.lives.length; i++) {
        const l = this.lives[i];
        if (l.next < until && l.next * l.item.step === t) { await this.step(l, snapshot, rec); this.published[i] = l.arrays.slice(); }
      }
    }
  }

  async step(l, snapshot, rec) {
    const item = l.item;
    const k = l.next;
    const t = k * item.step;
    const taken = new Map();
    for (const r of item.regions.filter((e) => e.read === 'control')) {
      const list = this.track.get(r.name) ?? [];
      let c = l.cursor.get(r.name) ?? 0;
      const q = l.pending.get(r.name) ?? [];
      while (c < list.length && list[c].t <= t) q.push(list[c++]);
      l.cursor.set(r.name, c);
      taken.set(r.name, q.splice(0, PER_STEP));
      l.pending.set(r.name, q);
    }
    const inputs = [...[...taken.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).flatMap(([, v]) => v)];
    l.next = k + 1;
    if (l.failed) { rec.report(l, k, null, 0, []); return; }
    // #211: the moves queued for this step, ahead of the read region fill: the module's own writes.
    if (l.paged) for (const p of await movesBefore(l, k)) l.dirty.add(p);
    const size = item.reads_size;
    const region = new Uint8Array(size);
    const d = new DataView(region.buffer);
    for (const e of item.regions) {
      if (e.read === 'control' && e.type === 'text') {
        // A text commit's bytes come with its control kind (#542).
      } else if (e.read === 'control') {
        const list = taken.get(e.name);
        d.setUint32(e.offset, list.length, true);
        // Each entry a u32 player, 4 zero bytes and its value as the control's form lays it
        // out: a number's f64, a pick's u32 set, 4 zero bytes, i64 key[0], i64 key[1], or a
        // point's 248 B record.
        const stride = (e.size - 8) / PER_STEP;
        // #540: a point control's entries packed end to end, each its record and any unit keys.
        if (e.type === 'point') {
          let o = e.offset + 8;
          for (const x of list) {
            if (typeof x.value !== 'object' || x.value === null || !('phase' in x.value)) continue;
            d.setUint32(o, x.player, true);
            o += 8 + pointRecord(d, o + 8, x.value);
          }
          continue;
        }
        list.forEach((x, j) => {
          const o = e.offset + 8 + stride * j;
          d.setUint32(o, x.player, true);
          const object = typeof x.value === 'object' && x.value !== null;
          const point = object && 'phase' in x.value;
          const pick = object && !point;
          if (!object && stride === 16) d.setFloat64(o + 8, x.value, true);
          if (pick && stride === 32) {
            d.setUint32(o + 8, x.value.set, true);
            d.setBigInt64(o + 16, BigInt(x.value.key[0]), true);
            d.setBigInt64(o + 24, BigInt(x.value.key[1]), true);
          }
        });
      } else if (e.read === 'array') {
        region.set(snapshot[e.from].subarray(e.from_offset, e.from_offset + e.size), e.offset);
      } else if (e.read === 'seed') {
        d.setBigInt64(e.offset, await stepSeed(this.req.seed, item.id, k), true);
      }
    }
    const from = item.reads_at;
    if (from + size > memoryOf(l).length) {
      l.failed = true;
      rec.traps.push({ item: item.id, step: k, t, kind: 'bounds', region: 'reads', function: null, offset: null, inputs });
      rec.report(l, k, null, 0, []);
      return;
    }
    memoryOf(l).set(region, from);
    const words = item.pages.map(() => 0n);
    const mark = (p) => { if (p >> 6 < words.length) words[p >> 6] |= 1n << BigInt(p & 63); };
    if (size > 0) for (let p = Math.floor(from / PAGE); p <= Math.floor((from + size - 1) / PAGE); p++) mark(p);
    // Each emitted kind's count, zeroed before the step.
    let at = item.emits_at;
    for (const e of item.emits) { memoryOf(l).fill(0, at, at + 4); mark(Math.floor(at / PAGE)); at += e.size; }
    item.pages.forEach((n, i) => { l.ex[n].value = BigInt.asIntN(64, words[i]); });
    const trap = call(l, 'step', [BigInt(k)], item.fuel - (l.paged ? l.paged.moved * MOVE_FUEL : 0));
    const left = l.ex['sandbox.fuel'].value;
    const fuel = Number(BigInt(item.fuel) - left < 0n ? 0n : BigInt(item.fuel) - left > BigInt(item.fuel) ? BigInt(item.fuel) : BigInt(item.fuel) - left);
    const pages = [];
    item.pages.forEach((n, w) => { const bits = BigInt.asUintN(64, l.ex[n].value); for (let b = 0; b < 64; b++) if ((bits >> BigInt(b)) & 1n) pages.push(w * 64 + b); });
    for (const p of pages) l.dirty.add(p);
    if (trap) {
      l.failed = true;
      rec.traps.push({ item: item.id, step: k, t, ...trap, inputs });
      rec.report(l, k, null, fuel, pages);
      return;
    }
    // #211: the slots it wrote and the written cap, then the requests it left, for step k + lead.
    if (l.paged) {
      const failed = afterStep(l, pages) ?? requests(l, k);
      if (failed) {
        l.failed = true;
        rec.traps.push({ item: item.id, step: k, t, kind: failed[0], function: null, offset: null, inputs, ...failed[1] });
        rec.report(l, k, null, fuel, pages);
        return;
      }
    }
    const out = emitted(item, memoryOf(l));
    if (out.over) {
      l.failed = true;
      rec.traps.push({ item: item.id, step: k, t, kind: 'occurrences', ...out.over, function: null, offset: null, inputs });
      rec.report(l, k, null, fuel, pages);
      return;
    }
    l.arrays = memoryOf(l).slice(item.writes_at, item.writes_at + l.arrays.length);
    rec.report(l, k, await stepHash(l, out.rows), fuel, pages, out.rows);
  }

  async load(item, memory, globals) {
    const live = await instance(item);
    memoryOf(live).set(memory);
    item.globals.forEach(([n], i) => { live.ex[n].value = globals[i]; });
    for (let p = 0; p < memory.length / PAGE; p++) live.dirty.add(p);
    return live;
  }

  async restore(c) {
    const w = new World(this.req, this.track, false);
    for (const l of this.lives) {
      const j = l.stored.findIndex((s) => s.step === c);
      if (j < 0) throw Error(`${l.item.id} has no checkpoint at step ${c}`);
      let whole = j;
      while (!l.stored[whole].memory.whole) whole--;
      const memory = l.stored[whole].memory.whole.slice();
      for (const s of l.stored.slice(whole + 1, j + 1)) for (const [p, bytes] of s.memory.pages ?? []) memory.set(bytes, p * PAGE);
      const s = l.stored[j];
      const live = await w.load(l.item, memory, s.globals);
      Object.assign(live, { next: c, spacing: l.spacing, arrays: s.arrays.slice(), cursor: new Map(s.cursor), pending: new Map([...s.pending].map(([x, q]) => [x, q.slice()])) });
      // #211: the map from the last whole one at or before it and the changes after it.
      if (l.paged) {
        let from = j;
        while (from > 0 && !l.stored[from].paged.whole) from--;
        const map = new Map();
        for (const x of l.stored.slice(from, j + 1)) for (const [page, e] of x.paged.map) map.set(page, e);
        live.paged = { map, slots: s.paged.slots.map((x) => x.slice()), dirty: new Set(s.paged.dirty), queue: s.paged.queue.map((m) => ({ ...m })), changed: new Map(map), moved: 0, late: 0, moves: 0 };
      }
      w.lives.push(live);
    }
    w.published = w.lives.map((l) => l.arrays.slice());
    return w;
  }

  async fork(entries) {
    const k = this.at() ?? 0;
    const len = this.lives[0]?.item.step ?? 0;
    const kept = [...this.track.values()].flat().filter((e) => k > 0 && e.t <= (k - 1) * len);
    const w = new World(this.req, trackOf([...kept, ...entries]), false);
    for (const l of this.lives) {
      const live = await w.load(l.item, memoryOf(l).slice(), l.item.globals.map(([n]) => l.ex[n].value));
      Object.assign(live, { failed: l.failed, next: l.next, spacing: l.spacing, arrays: l.arrays.slice(), cursor: new Map(l.cursor), pending: new Map([...l.pending].map(([x, q]) => [x, q.slice()])) });
      if (l.paged) live.paged = copyPaged(l.paged);
      w.lives.push(live);
    }
    w.published = this.published.map((a) => a.slice());
    return w;
  }

  async deepHashes() { const out = {}; for (const l of this.lives) out[l.item.id] = await deepHash(l); return out; }
}

async function probe(w, p) {
  const at = w.at() ?? 0;
  const fork = await w.fork(p.entries ?? []);
  const rec = new Record();
  await fork.run(at + p.steps, rec, null);
  return { at, steps: rec.json(w.req.items[0]?.step ?? 0), deep_hash: await fork.deepHashes() };
}

export async function bake(req) {
  const len = req.items[0]?.step ?? 0;
  const rec = new Record();
  const world = await World.create(req, rec);
  const probed = [];
  await world.run(req.steps, rec, async (w, k) => {
    for (const [i, p] of req.probes.entries()) if (p.at === k) probed.push([i, await probe(w, p)]);
  });
  probed.sort((a, b) => a[0] - b[0]);
  const restores = [];
  for (const r of req.restores) {
    const w = await world.restore(r.from);
    const rr = new Record();
    const p = r.probe ? await probe(w, r.probe) : null;
    await w.run(r.from + r.steps, rr, null);
    restores.push({ from: r.from, checkpoints: rr.checkpoints, steps: rr.json(len), probe: p });
  }
  const peeks = req.peek.map(({ item, at, len: n }) => {
    const l = world.lives.find((x) => x.item.id === item);
    return { item, at, len: n, hex: hex(memoryOf(l).subarray(at, at + n)) };
  });
  return { ok: true, steps: rec.json(len), checkpoints: rec.checkpoints, traps: rec.traps, restores, probes: probed.map(([, r]) => r), peeks, track: req.track };
}
