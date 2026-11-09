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
const stepHash = async (live) => (await h64(concat([encoded(live), live.arrays]))).hex;
async function deepHash(live) {
  let pending = 0;
  for (const q of live.pending.values()) pending += q.length;
  return (await h64(concat([le(64, live.next), le(32, pending), encoded(live), live.arrays, memoryOf(live)]))).hex;
}

function call(live, exp, args) {
  const ex = live.ex;
  ex['sandbox.fuel'].value = BigInt(live.item.fuel);
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
  report(live, k, hash, fuel, pages) {
    const s = this.at(k);
    s.items[live.item.id] = { hash, fuel, failed: live.failed, pages };
    for (const w of live.item.writes) {
      const size = SIZE[w.type];
      s.arrays[`${live.item.id}.${w.name}`] = Array.from({ length: w.count }, (_, j) => value(w.type, live.arrays.subarray(w.offset + j * size, w.offset + (j + 1) * size)));
    }
  }
}

async function instance(item) {
  if (!item.module) { item.module = await WebAssembly.compile(bytesOf(item.rewritten)); item.map = offsets(item.module); }
  const inst = await WebAssembly.instantiate(item.module, {});
  return { item, ex: inst.exports, map: item.map, failed: false, next: 0, arrays: new Uint8Array(item.writes_size), cursor: new Map(), pending: new Map(), dirty: new Set(), stored: [], checked: null };
}

class World {
  static async create(req, rec) {
    const w = new World(req, trackOf(req.track), true);
    for (const item of req.items) {
      const live = await instance(item);
      const calls = [];
      if (typeof live.ex['sandbox.start'] === 'function') calls.push(['sandbox.start', []]);
      calls.push(['init', [await stepSeed(req.seed, item.id, 0)]]);
      for (const [exp, args] of calls) {
        const t = call(live, exp, args);
        if (t) { rec.traps.push({ item: item.id, step: null, t: null, ...t, inputs: [] }); live.failed = true; break; }
      }
      w.lives.push(live);
    }
    w.published = w.lives.map((l) => l.arrays.slice());
    return w;
  }
  constructor(req, track, store) { this.req = req; this.track = track; this.store = store; this.lives = []; this.published = []; }
  at() { const k = this.lives[0]?.next; return this.lives.every((l) => l.next === k) ? k : null; }

  async checkpoint(live, rec) {
    if (live.failed || live.next % live.item.every !== 0 || live.checked === live.next) return;
    live.checked = live.next;
    const deep = await deepHash(live);
    (rec.checkpoints[live.item.id] ??= []).push({ step: live.next, deep_hash: deep });
    if (!this.store) return;
    const m = memoryOf(live);
    const memory = live.stored.length % 8 === 0
      ? { whole: m.slice() }
      : { pages: [...live.dirty].sort((a, b) => a - b).map((p) => [p, m.slice(p * PAGE, (p + 1) * PAGE)]) };
    live.stored.push({ step: live.next, globals: live.item.globals.map(([n]) => live.ex[n].value), arrays: live.arrays.slice(), cursor: new Map(live.cursor), pending: new Map([...live.pending].map(([c, q]) => [c, q.slice()])), memory });
    live.dirty.clear();
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
    const size = item.reads_size;
    const region = new Uint8Array(size);
    const d = new DataView(region.buffer);
    for (const e of item.regions) {
      if (e.read === 'control') {
        const list = taken.get(e.name);
        d.setUint32(e.offset, list.length, true);
        list.forEach((x, j) => { d.setUint32(e.offset + 8 + 16 * j, x.player, true); d.setFloat64(e.offset + 16 + 16 * j, x.value, true); });
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
    if (size > 0) for (let p = Math.floor(from / PAGE); p <= Math.floor((from + size - 1) / PAGE); p++) words[p >> 6] |= 1n << BigInt(p & 63);
    item.pages.forEach((n, i) => { l.ex[n].value = BigInt.asIntN(64, words[i]); });
    const trap = call(l, 'step', [BigInt(k)]);
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
    l.arrays = memoryOf(l).slice(item.writes_at, item.writes_at + l.arrays.length);
    rec.report(l, k, await stepHash(l), fuel, pages);
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
      Object.assign(live, { next: c, arrays: s.arrays.slice(), cursor: new Map(s.cursor), pending: new Map([...s.pending].map(([x, q]) => [x, q.slice()])) });
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
      Object.assign(live, { failed: l.failed, next: l.next, arrays: l.arrays.slice(), cursor: new Map(l.cursor), pending: new Map([...l.pending].map(([x, q]) => [x, q.slice()])) });
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
