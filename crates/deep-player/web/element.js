// <deep-player>: the web player's element (issue #172; canvas primitives: Export: web player). It reads the bundle's
// manifest from the index page, fetches every file the bundle names with no cookie or credential and checks each
// against its SHA-256, and only then starts the player (the canvas core built for wasm32) on the document and its
// recorded input track. Until every file has matched, `ready` is false and it takes no play, seek or input; a file
// that doesn't match stops it before it's ready, naming the file. Once ready it seeks to the place its link names
// (`#t=<s>`, `#marker=<ID>`, `#stage=<ID>`) as setting `currentTime` or `stage` does; a fragment never sets a
// control, writes an input entry or reaches the piece's logic, and one it can't read opens at the start with a notice
// naming it. It runs on the page's one thread and takes nothing from a host page but play, pause, the clock and the
// stages.
//
// A piece whose logic declares saves (issue #1041; canvas primitives: Logic: saves) keeps them in the browser's storage
// for the page's origin, under the piece's stable ID and the slot: each is written whole or not at all, so a write the
// browser refuses keeps the slot's last good save and says so. The piece's first save asks the browser to keep the
// origin's storage persistent, and the player says once when it isn't. The player's own controls open a slot's save,
// export it to a file and import one, which opens only as any save does.

const bundle = JSON.parse(document.getElementById('deep-bundle').textContent);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

/** The origin's store of saves in the browser's storage: one row a save, `{piece, slot, seq, hash, step, ended,
 * deep_hash, bytes}`, keyed by the piece, its slot and the save's number in it. */
const openStore = () => new Promise((done, fail) => {
  const open = indexedDB.open('deep-player', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('saves', { keyPath: ['piece', 'slot', 'seq'] });
  open.onsuccess = () => done(open.result);
  open.onerror = () => fail(open.error);
});
/** One transaction on the saves, whole or not at all: what `work`'s request read, once it is committed. */
const inStore = (db, mode, work) => new Promise((done, fail) => {
  const t = db.transaction('saves', mode);
  const asked = work(t.objectStore('saves'));
  t.oncomplete = () => done(asked?.result);
  t.onabort = () => fail(t.error);
});
/** Whether a stored save reads back whole: its bytes still have the SHA-256 that names it. */
const whole = async (row) => (await sha256(row.bytes)) === row.hash;
/** Why the player didn't open a save, in words. */
function refusal(e) {
  let r;
  try { r = JSON.parse(String(e)); } catch { return String(e); }
  if (typeof r !== 'object' || !r) return String(r);
  const save = r.save ?? r.damaged?.[0]?.hash;
  if (r.code === 'save_damaged') return `The save ${save} fails its hash, so it isn't opened.`;
  const differs = (r.differs ?? []).map((d) => (d.what === 'play' ? `the state this piece's recorded play holds at step ${d.step}` : `this piece's ${d.what}`));
  return `The save ${save} isn't opened: it doesn't match ${differs.join(', ') || 'this piece'}.`;
}

class DeepPlayer extends HTMLElement {
  #started = false;
  #player = null;
  #ready = false;
  #paused = true;
  #t = 0;
  #duration = NaN;
  #stages = [];
  #markers = [];
  #stage = null;
  #frames = 0;
  #firstFrameMs = null;
  #decoded = {};
  #last = 0;
  #canvas = null;
  #backend = 'none';
  #adapter = null;
  // The piece's saves: the store, the piece's stable ID that keys them in it, the slot the controls act on, each
  // slot's last save number, the writes still to do, and whether a save has asked for persistent storage.
  #db = null;
  #piece = '';
  #slot = 1;
  #seq = new Map();
  #writes = Promise.resolve();
  #asked = false;

  connectedCallback() {
    if (this.#started) return;
    this.#started = true;
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = bundle.size[0];
    this.#canvas.height = bundle.size[1];
    this.appendChild(this.#canvas);
    this.#load().catch((e) => this.#notice(String((e && e.message) || e)));
  }

  get ready() { return this.#ready; }
  get paused() { return this.#paused; }
  get duration() { return this.#duration; }
  get currentTime() { return this.#t; }
  set currentTime(s) { if (this.#ready) this.#seek(Number(s)); }
  get stage() { return this.#stage; }
  set stage(id) {
    const s = this.#ready && this.#stages.find((x) => x.id === String(id));
    if (s) this.#seek(s.t);
  }

  play() {
    if (!this.#ready) return;
    if (this.#t >= this.#duration) this.#seek(0);
    this.#paused = false;
    this.#last = performance.now();
    requestAnimationFrame((now) => this.#tick(now));
  }
  pause() { this.#paused = true; }
  next() {
    const s = this.#ready && this.#stages.find((x) => x.t > this.#t);
    if (s) this.#seek(s.t);
  }
  back() {
    if (!this.#ready) return;
    const before = this.#stages.filter((x) => x.t < this.#t);
    this.#seek(before.length ? before[before.length - 1].t : 0);
  }

  /** What the player holds: its step, step and full-state hashes, backend, adapter and evaluated data. It reads only. */
  async probe() {
    if (!this.#player) return null;
    const p = JSON.parse(this.#player.probe());
    p.backend = this.#backend;
    p.adapter = this.#adapter;
    p.frames = this.#frames;
    p.first_frame_ms = this.#firstFrameMs;
    p.decoded = { ...this.#decoded };
    p.saves = (await this.#kept()).map(({ slot, step, deep_hash }) => ({ slot, step, deep_hash }));
    return p;
  }

  /** A notice the page shows, marked with its kind when it has one. */
  #notice(text, kind = '') {
    const n = document.createElement('p');
    n.setAttribute('data-deep-notice', kind);
    n.setAttribute('role', 'status');
    n.textContent = text;
    this.appendChild(n);
  }

  /** The piece's saves: the origin's store, each slot's last save number there, and the player's own controls. */
  async #saves({ piece, slots }) {
    this.#piece = piece;
    try {
      this.#db = await openStore();
      const rows = await this.#rows();
      for (const r of rows) this.#seq.set(r.slot, Math.max(this.#seq.get(r.slot) ?? 0, r.seq));
      this.#asked = rows.length > 0;
    } catch (e) {
      this.#db = null;
      this.#notice(`This browser gives the page no storage (${e?.name ?? e}), so this piece's saves aren't kept.`, 'saves_unavailable');
      return;
    }
    const bar = document.createElement('div');
    bar.setAttribute('data-deep-saves', '');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Saves');
    if (slots > 1) {
      const pick = document.createElement('select');
      pick.setAttribute('aria-label', 'Slot');
      for (let n = 1; n <= slots; n += 1) pick.add(new Option(`Slot ${n}`, n));
      pick.addEventListener('change', () => { this.#slot = Number(pick.value); });
      bar.append(pick);
    }
    const file = document.createElement('input');
    file.type = 'file';
    file.hidden = true;
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) this.#import(f); });
    for (const [name, act] of [['Open save', () => this.#open()], ['Export save', () => this.#export()], ['Import save', () => file.click()]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.addEventListener('click', act);
      bar.append(b);
    }
    bar.append(file);
    this.append(bar);
  }

  /** The piece's saves in the browser's storage, of `slot` or of every slot, newest first in each. */
  async #rows(slot) {
    const from = slot === undefined ? [this.#piece] : [this.#piece, slot];
    return (await inStore(this.#db, 'readonly', (rows) => rows.getAll(IDBKeyRange.bound(from, [...from, Infinity])))).reverse();
  }

  /** Each slot's save as the viewer's open would open it: its newest that reads back whole. */
  async #kept() {
    const kept = new Map();
    for (const row of this.#db ? await this.#rows() : []) if (!kept.has(row.slot) && await whole(row)) kept.set(row.slot, row);
    return [...kept.values()].sort((a, b) => a.slot - b.slot);
  }

  /** The saves the steps the clock just reached asked for, each queued for the store as its slot's next save. */
  #due() {
    for (const s of JSON.parse(this.#player.saves_due())) this.#queue(s, (seq) => this.#player.save_bytes(s.at, seq));
  }

  /** A save queued for the store as its slot's next number, with the bytes it has under that number. */
  #queue(save, bytes) {
    const seq = (this.#seq.get(save.slot) ?? 0) + 1;
    this.#seq.set(save.slot, seq);
    const row = { ...save, seq, bytes: bytes(seq) };
    this.#writes = this.#writes.then(() => this.#write(row));
  }

  /** One save into its slot, whole or not at all: written, read back against its SHA-256, and only then the slot's
   * older saves but its last good one let go; an ended save leaves the slot only its end, and a slot that has ended
   * takes no later save. A write the browser refuses, for quota or any other reason, leaves the slot as it was. */
  async #write({ slot, seq, step, ended, deep_hash, bytes }) {
    try {
      const before = await this.#rows(slot);
      if (before[0]?.ended) return;
      if (!this.#asked) await this.#persist();
      const key = [this.#piece, slot, seq];
      const hash = await sha256(bytes);
      await inStore(this.#db, 'readwrite', (rows) => rows.put({ piece: this.#piece, slot, seq, hash, step, ended, deep_hash, bytes }));
      const back = await inStore(this.#db, 'readonly', (rows) => rows.get(key));
      if (!back || !(await whole(back))) {
        await inStore(this.#db, 'readwrite', (rows) => rows.delete(key));
        throw Error("it didn't read back whole");
      }
      let good = null;
      for (const row of before) if (!ended && !good && await whole(row)) good = row;
      await inStore(this.#db, 'readwrite', (rows) => { for (const row of before) if (row !== good) rows.delete([row.piece, row.slot, row.seq]); });
    } catch (e) {
      this.#notice(`The save of slot ${slot} at step ${step} wasn't written: the browser refused it (${[e?.name, e?.message].filter(Boolean).join(': ') || e}). The slot keeps its last good save.`, 'save_failed');
    }
  }

  /** The piece's first save asks the browser to keep the origin's storage persistent; the player says once when it isn't. */
  async #persist() {
    this.#asked = true;
    let kept = false;
    try { kept = await navigator.storage.persist(); } catch { /* a browser with no such ask keeps nothing persistent */ }
    if (!kept) this.#notice('Saves in this browser may be cleared. Export save keeps one in a file.', 'saves_not_persistent');
  }

  /** The viewer opens the slot's save: its newest that reads back whole. One that fails its hash is named, and the
   * slot's other save opens instead. */
  async #open() {
    for (const row of await this.#rows(this.#slot)) {
      if (await whole(row)) return this.#opened(row.hash, row.bytes);
      this.#notice(`The save ${row.hash} of slot ${row.slot} fails its hash, so it isn't opened.`, 'save_damaged');
    }
    this.#notice(`Slot ${this.#slot} holds no save in this browser.`, 'no_save');
    return null;
  }

  /** A save's bytes opened as any save opens (Logic: saves): the player then holds its state at its step, paused; a
   * save it refuses is named with what differs. */
  #opened(hash, bytes) {
    let at;
    try {
      at = JSON.parse(this.#player.open_save(hash, bytes));
    } catch (e) {
      this.#notice(refusal(e), 'save_refused');
      return null;
    }
    this.#paused = true;
    this.#seek(at.step * this.#player.step());
    return at;
  }

  /** The slot's save handed to the browser as a file, named by its SHA-256 as the app names one. */
  async #export() {
    for (const row of await this.#rows(this.#slot)) {
      if (!(await whole(row))) continue;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([row.bytes]));
      a.download = `${row.hash}.save`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      return;
    }
    this.#notice(`Slot ${this.#slot} holds no save in this browser.`, 'no_save');
  }

  /** A save from a file: opened as any save opens, then kept in its slot as its newest. A file named as an exported
   * save is held to the SHA-256 in its name. */
  async #import(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const at = this.#opened(/^([0-9a-f]{64})\.save$/.exec(file.name)?.[1] ?? await sha256(bytes), bytes);
    if (!at || !this.#db) return;
    const { slot, ended } = JSON.parse(new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(10))));
    this.#queue({ slot, step: at.step, ended, deep_hash: at.deep_hash }, () => bytes);
  }

  async #fetch(path, sha256) {
    const r = await fetch(path, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw Error(`the file ${path} (${sha256}) didn't arrive (${r.status}); the player doesn't start`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const got = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (got !== sha256) throw Error(`the file ${path} doesn't match its SHA-256 ${sha256} (it hashes to ${got}); the player doesn't start`);
    return bytes;
  }

  async #load() {
    const files = new Map();
    for (const f of bundle.files) files.set(f.sha256, await this.#fetch(f.path, f.sha256));
    const glue = await import('deep-player-glue');
    await glue.default({ module_or_path: files.get(bundle.player.wasm) });
    for (const f of bundle.fonts) glue.provide_font(f.file, files.get(f.sha256));
    const player = new glue.Player();
    for (const [sha, bytes] of files) player.add_file(sha, bytes);
    player.levels(JSON.stringify(bundle.images));
    player.load(bundle.document, bundle.track, JSON.stringify(bundle.logic));
    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify(bundle.gpu_needs));
    this.#backend = gpu.backend;
    this.#adapter = gpu.adapter;
    player.attach(gpu);
    this.#player = player;
    this.#duration = player.duration();
    this.#stages = JSON.parse(player.stages());
    this.#markers = JSON.parse(player.markers());
    const saves = JSON.parse(player.saves());
    if (saves.slots) await this.#saves(saves);
    this.#seek(0);
    this.#decoded = JSON.parse(player.decoded());
    this.#ready = true;
    this.dispatchEvent(new Event('ready'));
    this.#link();
  }

  /** The place the page's link names, once ready: a time, a marker or a stage; anything else opens at the start. */
  #link() {
    const fragment = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!fragment) return;
    const [key, value] = [fragment.slice(0, fragment.indexOf('=')), fragment.slice(fragment.indexOf('=') + 1)];
    const t = key === 't' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
    const at = t !== null && t <= this.#duration ? t
      : key === 'marker' ? this.#markers.find((m) => m.id === value)?.t
      : key === 'stage' ? this.#stages.find((s) => s.id === value)?.t
      : undefined;
    if (fragment.indexOf('=') < 0 || at === undefined || at === null) {
      this.#notice(`The link's fragment "${fragment}" isn't a time, a marker or a stage of this piece; it opens at the start.`);
      return;
    }
    this.#seek(at);
  }

  #seek(seconds) {
    const t = Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), this.#duration);
    this.#t = t;
    this.#draw();
    this.dispatchEvent(new Event('timeupdate'));
  }

  #draw() {
    this.#player.frame(this.#t);
    if (this.#db) this.#due();
    if (this.#player.draw()) {
      this.#frames += 1;
      if (this.#firstFrameMs === null) this.#firstFrameMs = performance.now();
    }
    const now = this.#stages.filter((s) => s.t <= this.#t).pop()?.id ?? null;
    if (now !== this.#stage) {
      this.#stage = now;
      this.dispatchEvent(new Event('stagechange'));
    }
  }

  #tick(now) {
    if (this.#paused) return;
    const dt = (now - this.#last) / 1000;
    this.#last = now;
    this.#t = Math.min(this.#t + dt, this.#duration);
    this.#draw();
    this.dispatchEvent(new Event('timeupdate'));
    if (this.#t >= this.#duration) {
      this.#paused = true;
      this.dispatchEvent(new Event('ended'));
      return;
    }
    requestAnimationFrame((n) => this.#tick(n));
  }
}

customElements.define('deep-player', DeepPlayer);
