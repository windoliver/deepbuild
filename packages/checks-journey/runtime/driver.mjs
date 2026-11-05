// The journey driver (#37): one process per run, started through host@1 by the journey check kind, which drives
// Playwright's Chromium through the steps of one journey against the stack it is given and writes everything it saw
// into the run's folder: a report (report.json), a screenshot per step and per end-state check, the video and the
// trace. It decides nothing: every expect's outcome, every error the page raised, every request, every animation and
// every control that changed is reported, and the check kind reads the report. Plain .mjs, since it runs on its own
// in the run's process, outside the hub.
//
//   DEEP_JOURNEY_JOB     the job file (JSON, the shape run.ts writes), read once
//   DEEP_JOURNEY_SECRET_<name>   a secret's value, by the name the journey references; never in the job file
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

// Started while the stack comes up, the driver waits for its job; a stop file instead means the stack never came up.
const JOB = process.env.DEEP_JOURNEY_JOB;
while (!existsSync(JOB)) {
  if (existsSync(`${JOB}.stop`)) process.exit(0);
  await new Promise((r) => setTimeout(r, 5));
}
const job = JSON.parse(readFileSync(JOB, 'utf8'));
const out = job.out;
mkdirSync(out, { recursive: true });
const secret = (name) => process.env[`DEEP_JOURNEY_SECRET_${name}`];
const first = (s) => String(s).split('\n')[0].slice(0, 500);
/** A failure the report places: the step and line, whether it is an expect's assertion failure, and what it looked at. */
const failure = (step, line, assertion, message, extra = {}) => ({ step: step.id, line: line ?? step.line ?? null, assertion, message: first(message), ...extra });

const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const report = {
  started: null, steps: [], endState: [], requests: [], errors: [], console: [], video: null, trace: null,
  redaction: { state: 'complete', since: null }, secretTyped: false, bundle: {}, ended: null, died: null, playwright: { started: 0, ended: 0, own: 0 },
};
let page, context, browser;
let t0 = 0;
const now = () => Date.now() - t0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Playwright's own time (AC16): what a plain Playwright script of this journey spends inside Playwright, loading it,
 * launching the browser, opening the context and its video, each step's navigation, action and expect, and closing.
 * Everything else the driver asks of the page (records, screenshots, snapshots) is the runner's, not counted here.
 */
async function own(work) {
  const started = performance.now();
  try { return await work(); } finally { report.playwright.own += performance.now() - started; }
}
/** The runner's own work inside a step's action or expect (a record, a box, a failure's screenshot): never Playwright's time. */
async function aside(work) {
  const started = performance.now();
  try { return await work(); } finally { report.playwright.own -= performance.now() - started; }
}
const flush = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report));
// A run that dies keeps what it captured: the report is written after every step, and once more on any exit.
process.on('uncaughtException', (e) => { report.died = String(e?.stack ?? e); flush(); process.exit(70); });
process.on('SIGTERM', () => { report.died = 'stopped'; flush(); process.exit(143); });

// ---- Locators: by role and name, label or test ID, within a named container; never a CSS path. A name alone is an
// accessible name (an aria-label, a label).
function locate(scope, l) {
  if (l.container) scope = locate(scope, l.container);
  if (l.testId) return scope.getByTestId(l.testId);
  if (l.label) return scope.getByLabel(l.label, { exact: l.exact ?? false });
  if (l.role) return scope.getByRole(l.role, l.name === undefined ? {} : { name: l.name, exact: l.exact ?? false });
  if (l.name) return scope.getByLabel(l.name, { exact: true });
  if (l.text) return scope.getByText(l.text, { exact: l.exact ?? false });
  throw Error(`a locator names a role and name, a label, a test ID or text: ${JSON.stringify(l)}`);
}
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** A locator as Playwright writes it: getByRole('button', { name: 'Export' }). */
const describe = (l) => {
  const own = l.testId ? `getByTestId(${q(l.testId)})` : l.label ? `getByLabel(${q(l.label)})` : l.role ? `getByRole(${q(l.role)}${l.name === undefined ? '' : `, { name: ${q(l.name)} }`})` : l.name ? `getByLabel(${q(l.name)}, { exact: true })` : `getByText(${q(l.text ?? '')})`;
  return l.container ? `${describe(l.container)}.${own}` : own;
};
/** The one element a locator names, or why not: none, or more than one. */
async function resolve(l) {
  const loc = locate(page, l);
  const n = await loc.count();
  if (n === 0) return { loc, count: n, error: `${describe(l)} matches nothing` };
  if (n > 1) return { loc, count: n, error: `${describe(l)} matches ${n} elements` };
  return { loc, count: n };
}
const round = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
const boxOf = async (loc) => { try { const b = await loc.boundingBox(); return b ? round(b) : null; } catch { return null; } };

// ---- What the page tells on its own: uncaught errors, failed asset requests, console errors, every request and its end.
const requests = new Map();
// The step whose page events these are: kept until the next step starts, since what a step's action set off (an error
// thrown a task later, a request it started) may land after its records are taken, and is still that step's.
let current = null;
const ASSETS = ['script', 'stylesheet', 'image', 'font', 'media'];
function watch() {
  page.on('pageerror', (e) => report.errors.push({ kind: 'uncaught', message: first(e?.message ?? e), at: now(), step: current?.id ?? null }));
  page.on('console', (m) => { if (m.type() === 'error') report.console.push({ text: first(m.text()), at: now(), step: current?.id ?? null }); });
  page.on('request', (r) => {
    const entry = { url: r.url(), method: r.method(), type: r.resourceType(), started: now(), ended: null, status: null, size: null, step: current?.id ?? null, failed: null, unfinished: false };
    requests.set(r, entry);
    report.requests.push(entry);
  });
  page.on('response', async (r) => {
    const entry = requests.get(r.request());
    if (!entry) return;
    entry.status = r.status();
    try { entry.size = (await r.body()).length; } catch { entry.size = null; }
    if (['script', 'stylesheet'].includes(entry.type) && entry.size !== null) report.bundle[new URL(entry.url).pathname] = entry.size;
    if (entry.status >= 400 && ASSETS.includes(entry.type)) report.errors.push({ kind: 'request', url: entry.url, status: entry.status, unfinished: false, at: now(), step: entry.step });
  });
  page.on('requestfinished', (r) => { const e = requests.get(r); if (e) e.ended = now(); });
  page.on('requestfailed', (r) => {
    const e = requests.get(r);
    if (!e) return;
    e.ended = now(); e.failed = r.failure()?.errorText ?? 'failed';
    if (ASSETS.includes(e.type) && !/ERR_ABORTED/.test(e.failed)) report.errors.push({ kind: 'request', url: e.url, status: null, unfinished: true, at: now(), step: e.step });
  });
}

// ---- The page's own animation list, read from inside: every animation that started, with its target, property,
// duration, delay and easing. A script moving an element frame by frame starts none, so it has no entry.
const ROLE_MAP = `({ A: 'link', BUTTON: 'button', IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', P: 'paragraph', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox', NAV: 'navigation', MAIN: 'main', ARTICLE: 'article', SECTION: 'region', LI: 'listitem', UL: 'list', DIALOG: 'dialog', FOOTER: 'contentinfo', HEADER: 'banner', FORM: 'form', TIME: 'time', TD: 'cell', TH: 'columnheader', LABEL: 'generic', SPAN: 'generic', DIV: 'generic' })`;
const IN_PAGE = `
  const roleOf = (el) => el.getAttribute('role') || (el.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button' })[el.type] || 'textbox' : ${ROLE_MAP}[el.tagName]) || 'generic';
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('alt') || (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('title') || el.getAttribute('placeholder') || (el.textContent || '')).trim().replace(/\\s+/g, ' ').slice(0, 80);
  const control = (el) => ({ role: roleOf(el), name: nameOf(el), testId: el.getAttribute('data-testid') });
`;
const RECORDER = `(() => {
  ${IN_PAGE}
  const seen = new WeakSet(); const log = []; window.__deepAnimations = log;
  const take = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue; seen.add(a);
      const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; const target = a.effect && a.effect.target;
      const frames = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
      const props = [...new Set(frames.flatMap((f) => Object.keys(f).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k))))];
      const easing = t.easing && t.easing !== 'linear' ? t.easing : (frames[0] && frames[0].easing) || t.easing || 'linear';
      for (const p of props) log.push({ at: performance.now(), target: target ? control(target) : null, property: p, from: String(frames[0] ? frames[0][p] : ''), to: String(frames.length ? frames[frames.length - 1][p] : ''), duration: t.duration == null ? null : Number(t.duration), delay: t.delay == null ? 0 : Number(t.delay), easing });
    }
    requestAnimationFrame(take);
  };
  take();
  document.addEventListener('animationstart', take, true); document.addEventListener('transitionstart', take, true);
})();`;
const since = (animations, mark) => animations.filter((a) => a.at >= mark).map(({ at, ...a }) => a);

// ---- The controls on the page, by role, name and test ID with their state; a step records which appeared, went
// away or changed state. The whole DOM, one line per element, so a claim's DOM diff names the element that changed.
const CONTROLS = `(() => {
  ${IN_PAGE}
  const out = [];
  for (const el of document.querySelectorAll('a[href],button,input,textarea,select,summary,[role]')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue;
    if (el.hidden || getComputedStyle(el).visibility === 'hidden') continue;
    out.push({ ...control(el), state: JSON.stringify([!!el.disabled || el.getAttribute('aria-disabled') === 'true', el.checked ?? el.getAttribute('aria-checked'), el.getAttribute('aria-expanded'), ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? String(el.value ?? '').length : null, document.activeElement === el]) });
  }
  return out;
})()`;
const DOM = `(() => {
  ${IN_PAGE}
  const lines = [];
  const walk = (el, depth) => {
    const id = el.id ? '#' + el.id : ''; const cls = el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 60);
    const attrs = [...el.attributes].filter((a) => !['id', 'class', 'style'].includes(a.name)).map((a) => a.name + '=' + JSON.stringify(a.value)).join(' ');
    lines.push(' '.repeat(depth) + el.tagName.toLowerCase() + id + cls + ' role=' + roleOf(el) + ' ' + JSON.stringify(nameOf(el)) + (attrs ? ' ' + attrs : '') + (text ? ' text=' + JSON.stringify(text) : ''));
    for (const c of el.children) if (c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE') walk(c, depth + 1);
  };
  walk(document.body, 0);
  return lines;
})()`;
/** Every visible element with its box, by role, name, label and test ID, so a region can be masked by the smallest element holding it. */
const ELEMENTS = `(() => {
  ${IN_PAGE}
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
    // Every pixel the element touches, a partly covered edge included.
    const x = Math.floor(r.x), y = Math.floor(r.y);
    out.push({ ...control(el), label: el.getAttribute('aria-label'), explicitRole: el.getAttribute('role'), tag: el.tagName.toLowerCase(), box: { x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y } });
    if (out.length >= 3000) break;
  }
  return out;
})()`;
const evaluate = async (script, fallback) => { try { return await page.evaluate(script); } catch { return fallback; } };
/** Each element's box over several frames: the union of where it was, so a box covers an element whose size changes (a clock's text). */
function spanning(frames) {
  const merged = new Map();
  for (const elements of frames) {
    const seen = new Map();
    for (const e of elements) {
      const id = `${e.tag}|${e.role}|${e.name}|${e.label ?? ''}|${e.testId ?? ''}`;
      const n = seen.get(id) ?? 0; seen.set(id, n + 1);
      const k = `${id}#${n}`, m = merged.get(k);
      if (!m) { merged.set(k, { ...e, box: { ...e.box } }); continue; }
      const x = Math.min(m.box.x, e.box.x), y = Math.min(m.box.y, e.box.y);
      m.box = { x, y, width: Math.max(m.box.x + m.box.width, e.box.x + e.box.width) - x, height: Math.max(m.box.y + m.box.height, e.box.y + e.box.height) - y };
    }
  }
  return [...merged.values()];
}
const key = (c) => `${c.role}|${c.name}|${c.testId ?? ''}`;
const bare = ({ role, name, testId }) => ({ role, name, ...(testId ? { testId } : {}) });
function changed(before, after) {
  const a = new Map(before.map((c) => [key(c), c])), b = new Map(after.map((c) => [key(c), c]));
  return {
    appeared: [...b.values()].filter((c) => !a.has(key(c))).map(bare),
    left: [...a.values()].filter((c) => !b.has(key(c))).map(bare),
    changed: [...b.values()].filter((c) => a.has(key(c)) && a.get(key(c)).state !== c.state).map(bare),
  };
}
/** The page's text snapshot: roles, names and values, as Playwright's aria snapshot writes them. */
const snapshot = async () => { try { return await page.locator('body').ariaSnapshot(); } catch { return ''; } };
/** The route with IDs, tokens and timestamps in the path or query read as one placeholder. */
function routeOf(url) {
  try {
    const u = new URL(url);
    const ph = (s) => (/^(?:\d{4}-\d\d-\d\dT[^/]*|\d{10,13})$/i.test(s) ? '{time}' : /^(?:[0-9a-f]{8,}|[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f-]{36}|\d{4,})$/i.test(s) ? '{id}' : /^[A-Za-z0-9_-]{20,}$/.test(s) ? '{token}' : s);
    const path = u.pathname.split('/').map(ph).join('/');
    const query = [...u.searchParams.keys()].sort().map((k) => `${k}=${ph(u.searchParams.get(k) ?? '')}`).join('&');
    return { path, query, raw: u.pathname + u.search };
  } catch { return { path: url, query: '', raw: url }; }
}

// ---- Screens: a screenshot, and a capture that holds still (fonts and images loaded, two frames in a row equal
// outside the masks). Frames are compared as pixels, so a PNG is decoded here (8-bit RGB or RGBA, which is what
// Playwright writes).
function decodePng(b) {
  let width = 0, height = 0, channels = 4;
  const idat = [];
  for (let at = 8; at < b.length;) {
    const length = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, pix = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, up = prev[i], c = i >= channels ? prev[i - channels] : 0, x = line[i];
      line[i] = f === 0 ? x : f === 1 ? x + a : f === 2 ? x + up : f === 3 ? x + ((a + up) >> 1) : x + paeth(a, up, c);
    }
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 4, i = x * channels; pix[o] = line[i]; pix[o + 1] = line[i + 1]; pix[o + 2] = line[i + 2]; pix[o + 3] = channels === 4 ? line[i + 3] : 255; }
    prev = line;
  }
  return { width, height, pix };
}
/** Where two frames differ outside the masks, as one box; null when nowhere. */
function differs(a, b, masks) {
  if (a.width !== b.width || a.height !== b.height) return { x: 0, y: 0, width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
  const masked = (x, y) => masks.some((m) => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
  let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const o = (y * a.width + x) * 4;
    if ((a.pix[o] !== b.pix[o] || a.pix[o + 1] !== b.pix[o + 1] || a.pix[o + 2] !== b.pix[o + 2] || a.pix[o + 3] !== b.pix[o + 3]) && !masked(x, y)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
let session = null;
const cdp = async () => (session ??= await context.newCDPSession(page));
async function shot(name) {
  const file = `${name}.png`;
  // Chromium's own capture, encoded for speed (the PNG is lossless either way); Playwright's when it can't.
  try {
    // Bounded as Playwright's own capture is: a page that never answers gets no screenshot, never a run that hangs.
    const capture = (await cdp()).send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const { data } = await Promise.race([capture, sleep(5000).then(() => { throw Error('the capture timed out'); })]);
    writeFileSync(join(out, file), Buffer.from(data, 'base64'));
    return file;
  } catch { /* fall through */ }
  try { await page.screenshot({ path: join(out, file), timeout: 5000 }); return file; } catch { return null; }
}
/** The masks' boxes on the page now, each by its selector, with how many elements it matched. */
async function maskBoxes() {
  const masks = [];
  for (const m of job.masks ?? []) {
    const { loc, count, error } = await resolve(m).catch(() => ({ loc: null, count: 0, error: 'unresolved' }));
    masks.push({ selector: describe(m), box: error || !loc ? null : await boxOf(loc), count });
  }
  return masks;
}
async function settled(name, masks) {
  try { await page.evaluate(() => document.fonts?.ready); } catch { /* no fonts API */ }
  try { await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })))); } catch { /* gone */ }
  const boxes = masks.flatMap((m) => (m.box ? [m.box] : []));
  const until = Date.now() + Math.max(300, job.settleMs ?? 3000);
  let last = null, lastPix = null, unstable = null;
  // The elements as each frame was taken, so a mask on one covers it in the frames compared, not at a later moment.
  const frames = [];
  while (Date.now() < until) {
    const bytes = await page.screenshot({ timeout: 5000 }).catch(() => null);
    if (!bytes) break;
    frames.push(await evaluate(ELEMENTS, []));
    const pix = decodePng(bytes);
    if (lastPix) {
      unstable = differs(lastPix, pix, boxes);
      if (!unstable) { writeFileSync(join(out, `${name}.png`), bytes); return { file: `${name}.png`, still: true, unstable: null, elements: spanning(frames.slice(-2)) }; }
    }
    last = bytes; lastPix = pix;
    await sleep(120);
  }
  if (last) writeFileSync(join(out, `${name}.png`), last);
  return { file: last ? `${name}.png` : null, still: false, unstable, elements: spanning(frames) };
}

// ---- One step: its actions, then its expects, under its deadline; an expect's timeout stays under the deadline.
// The page as the last step left it: the next step starts from it, so it is read once, not again before that step.
let carried = null;
async function runStep(step, index) {
  current = step;
  // One round trip each side of the step: the controls and the page's clock before, the controls and its animations after.
  const { controls: before, now: mark } = carried ?? await evaluate(`({ controls: ${CONTROLS}, now: performance.now() })`, { controls: [], now: 0 });
  carried = null;
  const timeout = step.timeoutMs;
  const entry = { id: step.id, index, startMs: now(), endMs: null, outcome: 'passed', failure: null, route: null, controls: null, screenshot: null, snapshot: '', dom: [], animations: [], firstFrame: null, masks: [], still: true, unstable: null, expects: [], elements: [] };
  report.steps.push(entry);
  let timer;
  const overran = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(`step ${step.id} overran its deadline of ${step.deadlineMs} ms`), { overran: true })), step.deadlineMs); });
  const body = (async () => {
    // The step's own navigation, actions and expects are Playwright's time; the records around them are the runner's.
    for (const a of step.actions ?? []) await own(() => act(step, a, timeout, entry));
    for (const e of step.expects ?? []) await own(() => expectOne(step, e, timeout, entry));
  })();
  try {
    await Promise.race([body, overran]);
  } catch (e) {
    if (e?.overran) { entry.outcome = 'overran'; entry.failure = failure(step, null, false, e.message); }
    else { entry.outcome = 'failed'; entry.failure = e?.failure ?? failure(step, null, false, e?.message ?? e); }
    body.catch(() => undefined);
  } finally {
    clearTimeout(timer);
  }
  // The route and the controls at once, as the step ends, before anything slower. A step that overran may hold a
  // navigation that never ends, where the page can't be asked anything: only its route and a screenshot are taken.
  entry.route = routeOf(page.url());
  entry.endMs = now();
  if (entry.outcome === 'overran') {
    entry.controls = { appeared: [], left: [], changed: [] };
    entry.screenshot = await shot(`step-${index + 1}-${step.id}`);
    flush();
    return false;
  }
  // The screenshot is taken while the controls are read: neither changes the page.
  const [after, file] = await Promise.all([
    evaluate(`({ controls: ${CONTROLS}, animations: window.__deepAnimations ?? [], now: performance.now() })`, { controls: [], animations: [], now: 0 }),
    job.settle ? Promise.resolve(null) : shot(`step-${index + 1}-${step.id}`),
  ]);
  entry.controls = changed(before, after.controls);
  entry.animations = since(after.animations, mark);
  carried = { controls: after.controls, now: after.now };
  if (job.settle) {
    // A screen compared with the merge base: settled, with its masks, elements and DOM, which only a comparison reads.
    entry.masks = await maskBoxes();
    const s = await settled(`step-${index + 1}-${step.id}`, entry.masks);
    entry.screenshot = s.file; entry.still = s.still; entry.unstable = s.unstable; entry.elements = s.elements;
    entry.dom = await evaluate(DOM, []);
    // What changed while the screen settled belongs to this step, so the next one starts from the page as it is now.
    const now = await evaluate(`({ controls: ${CONTROLS}, animations: window.__deepAnimations ?? [], now: performance.now() })`, after);
    entry.controls = changed(before, now.controls);
    entry.animations = since(now.animations, mark);
    carried = { controls: now.controls, now: now.now };
  } else entry.screenshot = file;
  flush();
  return entry.outcome === 'passed';
}
/** The motion target's computed opacity and transform on the first frame it appears, watched from before the scroll. */
async function watchFirstFrame(l) {
  const { loc, error } = await resolve(l);
  if (error) return null;
  const handle = await loc.elementHandle({ timeout: 2000 }).catch(() => null);
  if (!handle) return null;
  return handle.evaluate((el) => new Promise((done) => {
    const read = () => requestAnimationFrame(() => { const cs = getComputedStyle(el); done({ opacity: Number(cs.opacity), transform: cs.transform }); });
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); read(); } }, { rootMargin: '0px 0px -15% 0px', threshold: 0 });
    io.observe(el);
    setTimeout(() => { io.disconnect(); done(null); }, 8000);
  }));
}
async function act(step, a, timeout, entry) {
  const line = a.line;
  const target = a.click ?? a.fill ?? a.check ?? a.select ?? a.hover ?? a.scrollIntoView;
  try {
    // A navigation waits on the server, so only the step's deadline bounds it; a wait on an element is bounded under the deadline, as an expect is.
    if (a.goto !== undefined) { await page.goto(new URL(a.goto, job.url).href, { timeout: step.deadlineMs, waitUntil: 'load' }); return; }
    if (a.wait !== undefined) { await sleep(Math.min(a.wait, timeout)); return; }
    if (a.scroll !== undefined) { await page.mouse.wheel(0, a.scroll); return; }
    if (a.press !== undefined) { await page.keyboard.press(a.press, { timeout }); return; }
    if (a.scrollIntoView) {
      const seen = watchFirstFrame(target);
      const { loc, error } = await resolve(target);
      if (error) throw Object.assign(Error(error), { failure: failure(step, line, false, error, { selector: describe(target) }) });
      await loc.scrollIntoViewIfNeeded({ timeout });
      entry.firstFrame = await aside(() => Promise.race([seen, sleep(Math.min(timeout, 8000)).then(() => null)]));
      return;
    }
    const loc = locate(page, target);
    if (a.click) await loc.click({ timeout });
    else if (a.hover) await loc.hover({ timeout });
    else if (a.check) await loc.check({ timeout });
    else if (a.select) await loc.selectOption(a.text, { timeout });
    else if (a.fill) {
      const value = a.secret !== undefined ? secret(a.secret) : a.text;
      if (a.secret !== undefined && value === undefined) throw Object.assign(Error(`the secret ${a.secret} isn't leased to this run`), { failure: failure(step, line, false, `the secret ${a.secret} isn't leased to this run`, { outside: true }) });
      if (a.secret !== undefined) {
        report.secretTyped = true;
        const type = await aside(() => loc.evaluate((el) => (el.getAttribute('type') || 'text').toLowerCase(), { timeout }).catch(() => 'text'));
        if (type !== 'password' && report.redaction.state === 'complete') report.redaction = { state: 'incomplete', since: step.id, sinceMs: now(), field: describe(target), secret: a.secret };
      }
      await loc.fill(value ?? '', { timeout });
    }
  } catch (e) {
    if (e?.failure) throw e;
    const action = Object.keys(a).find((k) => !['line', 'secret', 'text'].includes(k));
    const timedOut = /timeout/i.test(String(e?.message));
    throw Object.assign(e instanceof Error ? e : Error(String(e)), { failure: failure(step, line, false, timedOut ? `${action}() on ${target ? describe(target) : a.goto ?? ''} timed out after ${timeout} ms: ${first(e.message)}` : e?.message ?? e, { action, selector: target ? describe(target) : undefined }) });
  }
}
/** An expect: a locator that times out inside it is the expect's assertion failure, with the selector and a screenshot; a toPass block fails by its last attempt. */
async function expectOne(step, e, timeout, entry) {
  const line = e.line;
  const result = { line: line ?? null, selector: e.locator ? describe(e.locator) : null, outcome: 'passed', box: null };
  entry.expects.push(result);
  const fail = async (message, assertion, extra = {}) => {
    result.outcome = 'failed';
    const file = await aside(() => shot(`expect-${step.id}-${entry.expects.length}`));
    throw Object.assign(Error(message), { failure: failure(step, line, assertion, message, { selector: result.selector, screenshot: file, box: result.box, ...extra }) });
  };
  if (e.until) {
    // expect.toPass: the block is tried until it holds or the timeout ends; what it reports is its last attempt's failure.
    const until = Date.now() + timeout;
    let last = null;
    for (;;) {
      try {
        const value = await page.evaluate(e.until.evaluate);
        if (String(value) === String(e.until.equals)) return;
        last = { assertion: true, message: `expect.toPass: ${JSON.stringify(e.until.evaluate)} gave ${JSON.stringify(value)}, expected ${JSON.stringify(e.until.equals)}`, stack: null };
      } catch (err) {
        last = { assertion: false, message: `expect.toPass: the last attempt threw ${first(err?.message ?? err)}`, stack: String(err?.stack ?? '') };
      }
      if (Date.now() >= until) await fail(last.message, last.assertion, { stack: last.stack });
      await sleep(100);
    }
  }
  const loc = locate(page, e.locator);
  try {
    if (e.visible === false) await loc.waitFor({ state: 'hidden', timeout });
    else {
      await loc.waitFor({ state: 'visible', timeout });
      if (e.text !== undefined) {
        const started = Date.now();
        let text = '';
        for (;;) {
          text = (await loc.first().textContent({ timeout: Math.max(50, timeout - (Date.now() - started)) })) ?? '';
          if (text.includes(e.text)) break;
          if (Date.now() - started >= timeout) throw Object.assign(Error(`expect(${result.selector}).toContainText(${q(e.text)}) failed: found ${q(text.trim().slice(0, 80))}`), { text: true });
          await sleep(100);
        }
      }
    }
    result.box = await aside(() => boxOf(loc.first()));
  } catch (err) {
    if (err?.text) await fail(err.message, true);
    const n = await loc.count().catch(() => 0);
    const why = /timeout/i.test(String(err?.message)) ? `expect(${result.selector}).toBe${e.visible === false ? 'Hidden' : 'Visible'}() failed: locator timed out after ${timeout} ms (${n} matching)` : first(err?.message ?? err);
    await fail(why, true);
  }
}
/** An end-state check with a code oracle records the selector and bounding box it looked at, with a screenshot; a model's gets the redacted screen. */
async function endState(c, index) {
  const entry = { id: c.id, line: c.line ?? null, oracle: c.oracle ?? 'code', outcome: 'passed', selector: c.locator ? describe(c.locator) : null, box: null, screenshot: null, message: null, value: null, snapshot: null };
  report.endState.push(entry);
  try {
    // A model's reading and a person's answer come after the run: the driver records the screen and never passes either.
    if (c.oracle === 'model' || c.oracle === 'person') { entry.snapshot = await snapshot(); entry.outcome = 'reading'; return; }
    if (!c.locator) throw Error(`end_state ${c.id} names nothing to look at: a locator, or a readback for an API journey`);
    {
      const { loc, error } = await resolve(c.locator);
      if (error) throw Error(error);
      await loc.waitFor({ state: c.visible === false ? 'hidden' : 'visible', timeout: c.timeoutMs ?? 2000 });
      entry.box = await boxOf(loc);
      if (c.text !== undefined) {
        const text = (await loc.textContent()) ?? '';
        entry.value = text.trim().slice(0, 200);
        if (!text.includes(c.text)) throw Error(`expect(${entry.selector}).toContainText(${q(c.text)}) failed: found ${q(entry.value)}`);
      }
    }
  } catch (e) {
    entry.outcome = 'failed';
    entry.message = first(e?.message ?? e);
  } finally {
    flush();
  }
}
/** With holds on, each step after the first waits for the kind's go file: the kind does its work between steps (a planted environment's swap). */
async function held(index) {
  if (!job.hold || index === 0) return;
  const file = join(out, `go-${index}`);
  while (!existsSync(file)) await sleep(50);
}

// ---- The run.
try {
  report.playwright.started = Date.now();
  const { chromium } = await own(() => import('playwright'));
  browser = await own(() => chromium.launch({ headless: true, args: ARGS }));
  const p = job.profile;
  context = await own(() => browser.newContext({
    viewport: { width: p.width, height: p.height }, locale: p.locale, timezoneId: p.timezone, colorScheme: p.colorScheme,
    reducedMotion: p.reducedMotion, serviceWorkers: 'block', deviceScaleFactor: 1,
  }));
  // The trace's actions, calls and requests; the video and each step's screenshot already hold the screen.
  if (job.trace) await context.tracing.start({ screenshots: false, snapshots: false });
  await context.addInitScript(RECORDER);
  page = await own(() => context.newPage());
  // The video at 720p and 15 fps (AC16), the frame the viewport is; its time 0 is the run's.
  if (job.video) await own(() => page.screencast.start({ path: join(out, 'video.webm'), size: { width: p.width, height: p.height }, fps: 15 }));
  t0 = Date.now();
  report.started = new Date(t0).toISOString();
  watch();
  let ok = true;
  for (const [i, step] of job.steps.entries()) {
    await held(i);
    ok = await runStep(step, i);
    if (!ok) break;
  }
  // The end state is read whatever the steps showed, so a reading or a readback stands beside a failed step; only a
  // step that overran, whose page may never answer, leaves it unread.
  if (ok || report.steps.at(-1)?.outcome === 'failed') {
    for (const [i, c] of (job.endState ?? []).entries()) await endState(c, i);
    // The end state's one screen, taken once the checks have read it: every check looked at this page, unchanged.
    if (report.endState.length) { const file = await shot('end-state'); for (const e of report.endState) e.screenshot = file; flush(); }
  }
  for (const e of report.requests) if (e.ended === null) e.unfinished = true;
  report.ended = now();
  if (job.trace) { await context.tracing.stop({ path: join(out, 'trace.zip') }); report.trace = 'trace.zip'; }
  if (job.video) { await own(() => page.screencast.stop()); if (existsSync(join(out, 'video.webm'))) report.video = 'video.webm'; }
  await own(() => context.close());
  await own(() => browser.close());
  report.playwright.ended = Date.now();
} catch (e) {
  report.died = String(e?.stack ?? e);
  try { await browser?.close(); } catch { /* gone */ }
}
flush();
// The report is whole: the kind may read it while this process exits.
writeFileSync(join(out, 'done'), '');
