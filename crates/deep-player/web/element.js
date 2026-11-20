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
//
// Beside its canvas it keeps the document's accessibility tree as DOM (issue #1045): the tree the app gives its
// accessibility seam, read through the core (`tree()`), never written by the piece or a host page. The document's node
// carries the title and the description; each part, label and readout is one element marked data-deep-id with its
// name and role, in reading order, and each control is a Tab stop. A readout whose text changes in a frame is
// announced once through a polite live region, as the app's `see` announces it.
//
// It says why it stopped (issue #2856): a throw from the core while a piece plays stops the play where it is, paused
// with the canvas's last frame, and one notice names the step it held and the failure's first line. The index page's
// line that the player hasn't started, with its link to the fallback page, is for a page whose script never ran:
// removing it is the element's first act.

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

// Issue #1040: whether this browser can run the bundle, asked before anything loads. It needs WebGPU, an adapter,
// every feature the bundle's gpu_needs lists, one feature of each of its any_of sets and every limit it lists. The
// device request it answers asks for exactly those, the first feature of each set the adapter has; what it lacks it
// names, and the index page then opens the fallback page in the player's place, so the player never starts.
async function gate(needs) {
  if (!navigator.gpu) return { lacks: 'WebGPU' };
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  if (!adapter) return { lacks: 'a WebGPU adapter' };
  const features = [];
  for (const f of needs.features) {
    if (!adapter.features.has(f)) return { lacks: f };
    features.push(f);
  }
  for (const set of needs.any_of) {
    const f = set.find((x) => adapter.features.has(x));
    if (!f) return { lacks: set.join(' or ') };
    features.push(f);
  }
  for (const [k, v] of Object.entries(needs.limits)) {
    const has = adapter.limits[k];
    if (has === undefined || (k.startsWith('min') ? v < has : v > has)) return { lacks: k };
  }
  return { request: { features, any_of: [], limits: needs.limits } };
}

class DeepPlayer extends HTMLElement {
  #started = false;
  #player = null;
  #ready = false;
  #paused = true;
  #t = 0;
  #step = 0;
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
  #live = null;
  #said = new Map();
  #join = null;
  #socket = null;
  #waiting = null;
  // #2856: where a failure the player can't recover from stopped the play, `{step, message}`, or null.
  #stopped = null;

  connectedCallback() {
    // #2856: the index page's line saying the player hasn't started goes first, so only a page whose script never ran
    // shows it.
    this.querySelector('[data-deep-unstarted]')?.remove();
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
    if (!this.#ready || this.#stopped) return;
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
    // #860: on a piece that declares rewind, back is the reader's: a rewind to the stop before.
    if (this.#player.back()) {
      this.#draw();
      return;
    }
    const before = this.#stages.filter((x) => x.t < this.#t);
    this.#seek(before.length ? before[before.length - 1].t : 0);
  }

  /** What the player holds: its step, step and full-state hashes, backend, adapter and evaluated data. It reads only. */
  async probe() {
    if (!this.#player) return null;
    let p;
    try {
      p = JSON.parse(this.#player.probe());
    } catch (e) {
      // #2856: a core that failed while the piece played may answer nothing more; the player still says where it stopped.
      if (!this.#stopped) throw e;
      p = { step: this.#stopped.step };
    }
    p.stopped = this.#stopped;
    p.backend = this.#backend;
    p.adapter = this.#adapter;
    p.frames = this.#frames;
    p.first_frame_ms = this.#firstFrameMs;
    p.decoded = { ...this.#decoded };
    p.saves = (await this.#kept()).map(({ slot, step, deep_hash }) => ({ slot, step, deep_hash }));
    // The first player's link carries the match in its fragment, which the host serving the piece never sees.
    p.match ??= null;
    if (p.match?.fragment) p.match.link = `${location.href.split('#')[0]}#${p.match.fragment}`;
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

  /** The document's accessibility tree, kept as DOM beside the canvas, out of sight but read by assistive clients: the
   * document's node holding one element per node in reading order, and the live region. Text is set as text. */
  #keepTree() {
    const el = (tag, attrs) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== '') e.setAttribute(k, String(v));
      return e;
    };
    const unseen = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    const [root, ...nodes] = JSON.parse(this.#player.tree());
    if (!root) return;
    const doc = el('section', { 'data-deep-id': root.id, role: 'document', 'aria-label': root.name, 'aria-description': root.description, style: unseen });
    for (const n of nodes) {
      // A control is a Tab stop by its own role; a target a button after it; a part, label or readout an image of its role.
      if (n.control) doc.append(el('div', { 'data-deep-id': n.id, role: n.role || 'group', 'aria-label': n.name, tabindex: 0 }));
      else if (n.item !== undefined) doc.append(el('button', { 'data-deep-id': n.id, type: 'button', 'aria-label': n.name }));
      else doc.append(el('div', { 'data-deep-id': n.id, role: 'img', 'aria-roledescription': n.role, 'aria-label': n.name }));
    }
    this.#live = el('div', { 'aria-live': 'polite', role: 'status', style: unseen });
    this.append(doc, this.#live);
  }

  /** The readouts of the frame drawn: each whose text differs from what was last said for it is said once, through the
   * live region; a readout first shown is read with the tree. */
  #announce() {
    if (!this.#live) return;
    const said = [];
    for (const [id, text] of Object.entries(JSON.parse(this.#player.readouts()))) {
      const was = this.#said.get(id);
      if (was !== undefined && was !== text) said.push(text);
      this.#said.set(id, text);
    }
    if (said.length) this.#live.textContent = said.join('. ');
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
    const can = await gate(bundle.gpu_needs);
    if (can.lacks) {
      location.replace(`./${bundle.fallback.index}`);
      return;
    }
    const files = new Map();
    for (const f of bundle.files) files.set(f.sha256, await this.#fetch(f.path, f.sha256));
    const glue = await import('deep-player-glue');
    await glue.default({ module_or_path: files.get(bundle.player.wasm) });
    for (const f of bundle.fonts) glue.provide_font(f.file, files.get(f.sha256));
    const player = new glue.Player();
    for (const [sha, bytes] of files) player.add_file(sha, bytes);
    player.levels(JSON.stringify(bundle.images));
    player.load(bundle.document, bundle.track, JSON.stringify(bundle.logic));
    const gpu = await glue.open_gpu(this.#canvas, JSON.stringify(can.request));
    this.#backend = gpu.backend;
    this.#adapter = gpu.adapter;
    player.attach(gpu);
    this.#player = player;
    this.#keepTree();
    this.#duration = player.duration();
    this.#step = player.step();
    this.#stages = JSON.parse(player.stages());
    this.#markers = JSON.parse(player.markers());
    const saves = JSON.parse(player.saves());
    if (saves.slots) await this.#saves(saves);
    this.#seek(0);
    this.#decoded = JSON.parse(player.decoded());
    this.#ready = true;
    this.dispatchEvent(new Event('ready'));
    this.#link();
    this.#prompt();
  }

  /** The place the page's link names, once ready: a time, a marker or a stage; anything else opens at the start. */
  #link() {
    const fragment = decodeURIComponent(location.hash.replace(/^#/, ''));
    // A match's link names no place in the piece: its fragment is the Join's.
    if (!fragment || fragment.startsWith('match=')) return;
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

  /** The player's own Join prompt, for a piece whose net item declares a relay: drawn by the player, never the piece.
   * It names the relay host and says who sees the copy's network address; a refused Join says why on it. */
  #prompt() {
    const p = this.#player.join_prompt ? JSON.parse(this.#player.join_prompt()) : null;
    if (!p) return;
    if (!this.#join) {
      this.#join = document.createElement('div');
      this.#join.setAttribute('role', 'group');
      this.#join.setAttribute('style', 'position:fixed;left:12px;bottom:12px;max-width:560px;padding:10px 12px;background:#1b1b20;color:#e8e8ec;border:1px solid #55555f;border-radius:6px');
      const text = document.createElement('p');
      text.setAttribute('style', 'margin:0 0 8px');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Join';
      // Only a person's click joins: an event a script dispatched carries no user activation and is left alone.
      button.addEventListener('click', (e) => { if (e.isTrusted && navigator.userActivation?.isActive !== false) this.#joinMatch(); });
      this.#join.append(text, button);
      this.appendChild(this.#join);
    }
    this.#join.setAttribute('data-deep-join', p.state);
    this.#join.firstChild.textContent = p.text;
    this.#join.lastChild.hidden = p.state !== 'open';
  }

  /** A person clicked Join: the one connection the piece declares, the viewer's browser's own, with no credential. */
  #joinMatch() {
    if (this.#socket) return;
    const opened = JSON.parse(this.#player.join(location.href, crypto.getRandomValues(new Uint8Array(16))));
    this.#prompt();
    if (!opened.url) return;
    const ws = new WebSocket(opened.url);
    ws.binaryType = 'arraybuffer';
    this.#socket = ws;
    let timer = 0;
    const tick = () => {
      const now = performance.now();
      const frame = this.#player.net_tick(now);
      if (frame.length && ws.readyState === WebSocket.OPEN) ws.send(frame);
      this.#notify(this.#player.net_waiting(now));
      if (this.#player.net_ended()) { clearInterval(timer); ws.close(); this.#notify(0); this.#prompt(); }
    };
    ws.addEventListener('message', (e) => {
      const now = performance.now();
      if (typeof e.data === 'string') {
        const answer = JSON.parse(this.#player.net_control(e.data, now));
        if (answer.send) ws.send(answer.send);
        if (answer.close) ws.close();
        this.#prompt();
      } else {
        // What arrived may let steps run: their messages go out at once, one frame a match step at most.
        this.#player.net_receive(new Uint8Array(e.data), now);
        tick();
      }
    });
    ws.addEventListener('open', () => { timer = setInterval(tick, 8); });
    ws.addEventListener('close', () => { clearInterval(timer); this.#player.net_disconnected(); this.#notify(0); this.#prompt(); });
  }

  /** The waiting notice, the player's own: shown once this copy has waited 0.25 s for a player's message. */
  #notify(player) {
    if (!player) { this.#waiting?.remove(); this.#waiting = null; return; }
    if (!this.#waiting) {
      this.#waiting = document.createElement('p');
      this.#waiting.setAttribute('data-deep-waiting', '');
      this.#waiting.setAttribute('role', 'status');
      this.#waiting.setAttribute('style', 'position:fixed;right:12px;bottom:12px;margin:0;padding:6px 10px;background:#1b1b20;color:#e8e8ec;border:1px solid #55555f;border-radius:6px');
      this.appendChild(this.#waiting);
    }
    this.#waiting.textContent = `Waiting for player ${player}.`;
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
    this.#announce();
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
    try {
      this.#draw();
    } catch (e) {
      this.#stop(e);
      return;
    }
    this.dispatchEvent(new Event('timeupdate'));
    if (this.#t >= this.#duration) {
      this.#paused = true;
      this.dispatchEvent(new Event('ended'));
      return;
    }
    requestAnimationFrame((n) => this.#tick(n));
  }

  /** A throw from the core while the piece plays (#2856), which the player can't recover from: the play stops there,
   * paused, asking for no further frame and firing no `ended`, and the canvas keeps its last frame. One notice names
   * the step the player held and the failure's first line, and probe() reads them as `stopped`. */
  #stop(e) {
    this.#paused = true;
    this.#stopped = { step: this.#held(), message: String(e?.message ?? e).split('\n')[0] };
    this.#notice(`The piece stopped at step ${this.#stopped.step}: ${this.#stopped.message}`, 'stopped');
  }

  /** The step the player holds: the core's own count, or, from a core that no longer answers, the step of the time
   * the player last asked it for. */
  #held() {
    try {
      return JSON.parse(this.#player.probe()).step;
    } catch {
      return Math.floor(this.#t / this.#step + 1e-9);
    }
  }
}

customElements.define('deep-player', DeepPlayer);
