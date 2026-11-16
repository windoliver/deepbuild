// <deep-player>: the web player's element (issue #172; canvas primitives: Export: web player). It reads the bundle's
// manifest from the index page, fetches every file the bundle names with no cookie or credential and checks each
// against its SHA-256, and only then starts the player (the canvas core built for wasm32) on the document and its
// recorded input track. Until every file has matched, `ready` is false and it takes no play, seek or input; a file
// that doesn't match stops it before it's ready, naming the file. Once ready it seeks to the place its link names
// (`#t=<s>`, `#marker=<ID>`, `#stage=<ID>`) as setting `currentTime` or `stage` does; a fragment never sets a
// control, writes an input entry or reaches the piece's logic, and one it can't read opens at the start with a notice
// naming it. It runs on the page's one thread and takes nothing from a host page but play, pause, the clock and the
// stages.

const bundle = JSON.parse(document.getElementById('deep-bundle').textContent);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

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
    return p;
  }

  #notice(text) {
    const n = document.createElement('p');
    n.setAttribute('data-deep-notice', '');
    n.setAttribute('role', 'status');
    n.textContent = text;
    this.appendChild(n);
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
