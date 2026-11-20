// Test-side tools for the #2856 acceptance tests (README: The surface under test). What #172's suite already has is
// imported from ../172/helpers.ts, read only: the lab and its 600-step track, its web export through `deep-show run`,
// `deep-show` built per Cargo feature set, the bundle-against-receipt check, and Google Chrome headless with WebGPU on,
// driven over its DevTools protocol (`Chrome`, `Tab`). New here: the issue's test server, which can give one named file
// under another content type or with one byte changed; a page opened with this suite's test script installed before
// the page's own scripts (the shim: it counts the animation callbacks the page asks for and the `ended` events, keeps
// the page's text at the player's first view and at `ready`, and, when asked, makes the core's frame call throw at a
// step); the index page's element script, content-security policy and fallback page read from the bundle; and the
// merge base's `deep-show` for criterion 4's comparisons. Nothing here stands in for the export, the bundle, the
// player or the browser: every value a test compares comes from `deep-show`, the files it wrote or the browser, and
// every expected value from the issue's text.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect } from 'vitest';
import { Chrome, FULL, LAB_STEPS, REPO, blocked, isObject, secondsOf, show, type JsonValue, type Tab, type WebReceipt } from '../172/helpers.ts';

export {
  Chrome, FULL, LAB_STEPS, LOGIC, REPO, TIMEOUT, WORLD, blocked, bundleFailures, exportLab, failsNaming, inconclusive, isObject, none, sha256,
  show, useShow, useTemp,
} from '../172/helpers.ts';
export type { JsonObject, JsonValue, Tab, WebReceipt } from '../172/helpers.ts';

/** Each criterion's ID: `#2856.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #2856.4a55999e',
  2: 'AC2 #2856.7e832739',
  3: 'AC3 #2856.168ff773',
  4: 'AC4 #2856.f84ce6b9',
  5: 'AC5 #2856.a9fe9384',
} as const;

/** The planted wrong programs (README: Planted programs), chosen by the scenario's `planted` key. */
export const PLANTED = {
  /** Criterion 1: the player catches a throw from the core's frame or draw and plays on. */
  playsOn: 'web_plays_on_failure',
  /** Criterion 3: the element leaves the index page's line in place. */
  leavesLine: 'web_element_leaves_line',
} as const;

/** The step at which the shim makes the core's frame call throw (criterion 1), and the shim's message. The message
 * holds no digit, so a notice can name step 300 only by naming the step. */
export const STOP_STEP = 300;
export const SHIM_MESSAGE = 'deep test shim: the frame call failed on purpose';

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// The test server (the issue's "Runs on"; README: The test server). A child process of its own, as #172's server runs,
// serving the bundle folder as written, with #172's content types and cache headers and no cross-origin isolation
// headers; with `odd`, the one file at `odd.path` goes out under `odd.type` and/or with the byte at `odd.change.at`
// set to `odd.change.to`. Each response is logged as a JSON line: status, path, content type, SHA-256 of the body sent.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const [root, log, special] = process.argv.slice(1);
const odd = JSON.parse(special);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const s = http.createServer((q, r) => {
  const url = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { fs.appendFileSync(log, JSON.stringify({ status: 404, path: rel, type: '', sha: '' }) + '\\n'); r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  if (odd && odd.path === rel) {
    if (odd.type) type = odd.type;
    if (odd.change) { body = Buffer.from(body); body[odd.change.at] = odd.change.to; }
  }
  r.setHeader('content-type', type);
  r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
  fs.appendFileSync(log, JSON.stringify({ status: 200, path: rel, type, sha: crypto.createHash('sha256').update(body).digest('hex') }) + '\\n');
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

/** One file served otherwise: under another content type, and/or with one byte changed. */
export interface Odd { path: string; type?: string; change?: { at: number; to: number } }
export interface Served { status: number; path: string; type: string; sha: string }
export class TestServer {
  private child: ChildProcess | null = null;
  private dir = '';
  private log = '';
  origin = '';
  async start(root: string, odd: Odd | null): Promise<string> {
    this.dir = mkdtempSync(join(tmpdir(), 'deep-2856-server-'));
    this.log = join(this.dir, 'served.log');
    const child = spawn(process.execPath, ['-e', SERVER, root, this.log, JSON.stringify(odd)], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    this.origin = `http://127.0.0.1:${port}`;
    return this.origin;
  }
  served(): Served[] {
    if (!this.log || !existsSync(this.log)) return [];
    return readFileSync(this.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Served);
  }
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = ''; this.log = '';
  }
}
/** The byte criterion 2 changes in the element's script: its last, a final newline made a space (so the script is
 * still the same JavaScript and only its integrity hash refuses it), else that byte with its lowest bit flipped. */
export function oneByte(bytes: Buffer): { at: number; to: number } {
  const at = bytes.length - 1;
  return { at, to: bytes[at] === 0x0a ? 0x20 : (bytes[at]! ^ 0x01) };
}

// ---------------------------------------------------------------------------------------------------
// Pages: the bundle served by the test server and opened in #172's headless Chrome, with this suite's shim installed
// before the page's own scripts (`Page.addScriptToEvaluateOnNewDocument`, as #172's shim adapter is installed).

type Send = (method: string, params?: Record<string, unknown>, session?: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
/** #172's Tab and Chrome keep their DevTools connection to themselves; the few protocol calls this suite adds (a script
 * before the page's own, the navigation, a pointer's click, the browser's list of pages) go over that connection. */
const tabWire = (tab: Tab): { cdp: { send: Send }; session: string } => tab as unknown as { cdp: { send: Send }; session: string };
const chromeWire = (chrome: Chrome): { cdp: { send: Send } } => chrome as unknown as { cdp: { send: Send } };

export interface Page { server: TestServer; chrome: Chrome; tab: Tab; origin: string }
const closed = new WeakSet<Page>();
/** `folder` served by a fresh test server (with `odd`, one file served otherwise) and its index page opened in a fresh
 * headless Chrome at 1280 × 720, the shim installed first when given. */
export async function openPage(folder: string, o: { shim?: ShimConfig; odd?: Odd } = {}): Promise<Page> {
  const server = new TestServer();
  const origin = await server.start(folder, o.odd ?? null);
  let chrome: Chrome;
  try { chrome = await Chrome.open(); } catch (e) { await server.stop(); throw e; }
  const tab = await chrome.open('about:blank');
  const { cdp, session } = tabWire(tab);
  if (o.shim) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shimSource(o.shim) }, session);
  await cdp.send('Page.navigate', { url: `${origin}/index.html` }, session).catch(() => undefined);
  return { server, chrome, tab, origin };
}
export async function closePage(p: Page | undefined): Promise<void> {
  if (!p || closed.has(p)) return;
  closed.add(p);
  await p.chrome.close();
  await p.server.stop();
}
/** Pages left open by a test that failed, closed after the file. */
export function usePages(): (p: Page) => Page {
  const open: Page[] = [];
  afterAll(async () => { for (const p of open.splice(0)) await closePage(p); });
  return (p) => { open.push(p); return p; };
}
/** Polls `expression` in the page every 100 ms until it is truthy, at most `ms`: its value, or null. */
export async function waitFor<T>(tab: Tab, expression: string, ms: number): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await tab.evaluate<T | null>(expression).catch(() => null);
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(100);
  }
}
/** A pointer's left click at (x, y) in the page's viewport, as a person's click. */
export async function clickAt(tab: Tab, x: number, y: number): Promise<void> {
  const { cdp, session } = tabWire(tab);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, session);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, session);
}
/** The URL of every page the browser has open. */
export async function pagesOpen(chrome: Chrome): Promise<string[]> {
  const r = await chromeWire(chrome).cdp.send('Target.getTargets');
  return ((r['targetInfos'] ?? []) as { type?: string; url?: string }[]).filter((t) => t.type === 'page').map((t) => String(t.url ?? ''));
}

/** Page JavaScript, as text, that the shim and the tests' readings share: `collapse` (white space to one space, ends
 * trimmed); `textOf(node)`, the text of its text nodes outside script, style, template and noscript, joined by spaces
 * and collapsed (the page's text is `textOf(document.body)`); and `shown(node)`, whether its element is visible
 * (`checkVisibility` with visibility and opacity) and its contents have a box of some size. */
export const IN_PAGE = `
const collapse = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
const textNodes = (root) => { const out = []; if (!root) return out; const w = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (n.parentElement && n.parentElement.closest('script,style,template,noscript')) continue; out.push(n); } return out; };
const textOf = (root) => collapse(textNodes(root).map((n) => n.nodeValue).join(' '));
const shown = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; if (!e || !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const r = (n.ownerDocument || document).createRange(); r.selectNodeContents(n); return [...r.getClientRects()].some((b) => b.width > 0 && b.height > 0); };
`;

// ---------------------------------------------------------------------------------------------------
// The shim (README: The shim): test code in the page, installed before its scripts, read back as `window.__deep2856`.
//  - It counts each animation callback the page asks for (`requestAnimationFrame`, wrapped: `raf`, the time of each
//    ask) and each `ended` event (`ended`, a capture listener on the window).
//  - It keeps the page's text at the player's first view (`firstView`: right after the core's draw first reports a
//    frame drawn) and at `ready` (`atReady`: a capture listener on the window for the element's `ready`).
//  - With `stopAt`, once armed (`armed`, set by the test as it starts the play), the first frame call of the core
//    asked for a time at or past step `stopAt` steps the core to exactly that step and then throws
//    `WebAssembly.RuntimeError(SHIM_MESSAGE)`, as a trap in the core would (`thrown`: when, the time asked, the asks
//    counted so far). At the next display frame (an animation callback of its own, not counted) it reads the element's
//    `paused` and the notices the page shows (`next`).
// It reaches the core where the page glue instantiates the player's WebAssembly (`WebAssembly.instantiate` with the
// player's bytes) and wraps the instance's exports `player_frame` and `player_draw`, which the glue's `Player.frame`
// and `Player.draw` call; the logic programs' modules and everything else pass through untouched.

export interface ShimConfig { stopAt: number | null }
export interface Notice { kind: string | null; text: string; shown: boolean }
export interface ShimState {
  armed: boolean; raf: number[]; ended: number; draws: number;
  thrown: { at: number; asked: number; asks: number } | null;
  next: { at: number; paused: boolean | null; notices: Notice[] } | null;
  firstView: { at: number; text: string } | null;
  atReady: { at: number; text: string } | null;
}
export const shimSource = (c: ShimConfig): string => `(() => {
  ${IN_PAGE}
  const stopAt = ${c.stopAt === null ? 'null' : JSON.stringify(secondsOf(c.stopAt))};
  const message = ${JSON.stringify(SHIM_MESSAGE)};
  const state = { armed: false, raf: [], ended: 0, draws: 0, thrown: null, next: null, firstView: null, atReady: null };
  Object.defineProperty(window, '__deep2856', { value: state });
  const realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function requestAnimationFrame(callback) { state.raf.push(performance.now()); return realRaf(callback); };
  const notices = () => [...document.querySelectorAll('[data-deep-notice]')].map((e) => ({ kind: e.getAttribute('data-deep-notice'), text: collapse(e.textContent), shown: shown(e) }));
  window.addEventListener('ended', () => { state.ended += 1; }, true);
  window.addEventListener('ready', () => { if (!state.atReady) state.atReady = { at: performance.now(), text: textOf(document.body) }; }, true);
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async function (...args) {
    const made = await instantiate.apply(WebAssembly, args);
    const real = made && made.instance && made.instance.exports;
    if (!real || typeof real.player_frame !== 'function' || typeof real.player_draw !== 'function') return made;
    const exports = {};
    for (const k of Object.keys(real)) exports[k] = real[k];
    exports.player_frame = (ptr, seconds) => {
      if (stopAt !== null && state.armed && !state.thrown && seconds >= stopAt) {
        real.player_frame(ptr, stopAt);
        state.thrown = { at: performance.now(), asked: seconds, asks: state.raf.length };
        realRaf(() => { const p = document.querySelector('deep-player'); state.next = { at: performance.now(), paused: p ? p.paused : null, notices: notices() }; });
        throw new WebAssembly.RuntimeError(message);
      }
      return real.player_frame(ptr, seconds);
    };
    exports.player_draw = (ptr) => {
      const drew = real.player_draw(ptr);
      state.draws += 1;
      if (drew && !state.firstView) state.firstView = { at: performance.now(), text: textOf(document.body) };
      return drew;
    };
    return { module: made.module, instance: { exports } };
  };
})();`;
/** The shim's record, read back from the page. */
export const shimState = (tab: Tab): Promise<ShimState> => tab.evaluate<ShimState>('JSON.parse(JSON.stringify(window.__deep2856))');

// ---------------------------------------------------------------------------------------------------
// The bundle's index page and receipt

/** The index page's element script: the one module script with a `src` (its path in the bundle) and its integrity. */
export function elementScriptOf(html: string, what: string): { path: string; integrity: string } {
  const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\btype\s*=\s*["']?module\b/i.test(t) && /\bsrc\s*=/i.test(t));
  expect(tags.length, `${what}: the index page has one module script with a src (the element's script); it has ${tags.length}`).toBe(1);
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tags[0]!)?.[1] ?? '';
  const integrity = /\bintegrity\s*=\s*["']([^"']+)["']/i.exec(tags[0]!)?.[1] ?? '';
  return { path: src.replace(/^\.\//, ''), integrity };
}
/** The bundle's fallback page: the receipt's one file marked `fallback: "index"` (#1040), its path and SHA-256. */
export function fallbackPage(receipt: WebReceipt, what: string): { path: string; sha256: string } {
  const f = receipt.files.filter((x) => x.raw['fallback'] === 'index');
  expect(f.length, `${what}: the receipt marks one file as the fallback page's index page (fallback: "index"); it marks ${f.map((x) => x.path).join(', ') || 'none'}`).toBe(1);
  return { path: f[0]!.path, sha256: f[0]!.sha256 };
}
/** Every content-security policy the index page sets: each `<meta http-equiv="Content-Security-Policy">` tag's
 * `content` as written in the page's bytes, in order. */
export function policiesOf(html: string): string[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
    .filter((t) => /\bhttp-equiv\s*=\s*["']?content-security-policy["'\s>/]/i.test(t))
    .map((t) => { const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(t); return c?.[1] ?? c?.[2] ?? ''; });
}
/** The index page's policies against the merge base's, byte for byte; each failure names the content-security policy
 * and, for two that differ, the first byte offset where they do. */
export function policyFailures(here: readonly string[], there: readonly string[], what: string): string[] {
  if (here.length !== there.length) return [`${what}: the index page sets ${here.length} content-security policies, the merge base's ${there.length}: ${JSON.stringify(here)} against ${JSON.stringify(there)}`];
  const f: string[] = [];
  here.forEach((p, i) => {
    const a = Buffer.from(p, 'utf8'); const b = Buffer.from(there[i]!, 'utf8');
    if (a.equals(b)) return;
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    f.push(`${what}: the index page's content-security policy differs from the merge base's from byte ${k}: ${JSON.stringify(p)} against ${JSON.stringify(there[i])}`);
  });
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The merge base (README: The merge base): `git merge-base HEAD origin/main` (else main). Its `deep-show` is this
// checkout's build when the code that goes into it is the merge base's; else the merge base is taken whole with
// `git archive` into the git-ignored `target/acceptance-2856-base/<sha12>` (no .git, no worktree) and `deep-show`
// built there into its own target folder, as #1417's suite builds its merge base. git runs with no GIT_* variables.

const GIT_ENV: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (args: string[]): string => execFileSync('git', args, { cwd: REPO, env: GIT_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');

export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try { return git(['merge-base', 'HEAD', ref]); } catch { /* the next */ }
  }
  return blocked('this checkout has no merge base with origin/main or main to compare with. Unblock: fetch origin/main into it');
}
/** Whether the files `deep-show` is built from (everything outside tests/ and docs/, and the docs file a crate
 * embeds) are the merge base's here, with nothing untracked among them. */
function buildsAsBase(sha: string): boolean {
  const same = (paths: string[]): boolean => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO, env: GIT_ENV }).status === 0
    && git(['ls-files', '--others', '--exclude-standard', '--', ...paths]) === '';
  return same(['.', ':(exclude)tests', ':(exclude)docs']) && same(['docs/evidence/1903']);
}
/** The merge base's `deep-show` (`full`, debug) and how to name it; `current` is this checkout's build. */
export function mergeBaseShow(current: string): { bin: string; label: string; sha: string } {
  const sha = mergeBase();
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (buildsAsBase(sha)) return { bin: current, label: `${label} (this checkout's code is the merge base's, so its build is)`, sha };
  const dir = join(TARGET, 'acceptance-2856-base', sha.slice(0, 12));
  if (!existsSync(join(dir, '.exported'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = `${dir}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO, env: GIT_ENV });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(join(dir, '.exported'), `${sha}\n`);
  }
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', FULL, '--target-dir', join(dir, 'target')];
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  delete env['CARGO_TARGET_DIR'];
  const r = spawnSync('cargo', args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const error = r.error ? r.error.message : r.status === 0 ? '' : (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n').slice(-4000);
  expect(error, `${label}'s deep-show builds (cargo ${args.join(' ')} in ${dir})`).toBe('');
  return { bin: join(dir, 'target', 'debug', 'deep-show'), label, sha };
}

// ---------------------------------------------------------------------------------------------------
// The criteria's checks. Each takes a bundle folder and gives failures; a criterion's test and its planted twin run the
// same one (the twin must fail it, naming what the criterion names). `keep` registers the page for the file's cleanup.

const AT = `step ${STOP_STEP}`;
const namesTheStep = (text: string): boolean => new RegExp(`(^|\\D)${STOP_STEP}(\\D|$)`).test(text);

/** Criterion 1: the lab played from 0 with the shim's throw at step 300, and what the page does about it. Each failure
 * names the step. */
export async function stoppedFailures(out: string, what: string, keep: (p: Page) => Page): Promise<string[]> {
  const page = keep(await openPage(out, { shim: { stopAt: STOP_STEP } }));
  await page.tab.mustBeReady(what);
  await page.tab.evaluate(`(() => { window.__deep2856.armed = true; const p = document.querySelector('deep-player'); p.currentTime = 0; p.play(); })()`, 60_000, true);
  const next = await waitFor<boolean>(page.tab, 'window.__deep2856.next !== null', 180_000);
  const before = await shimState(page.tab);
  expect(before.thrown, `${what}: the shim made the core's frame call throw at ${AT} as the lab played past ${STOP_STEP / 60} s; page errors ${JSON.stringify(page.tab.errors.slice(0, 3))}`).not.toBeNull();
  expect(next, `${what}: a display frame came after the throw at ${AT}`).toBe(true);
  await page.tab.evaluate('new Promise((done) => setTimeout(() => done(true), 5000))', 60_000);
  const s = await shimState(page.tab);
  const now = await page.tab.evaluate<number>('performance.now()');
  const answer = await page.tab.evaluate<{ ok: boolean; value?: JsonValue; error?: string }>(`(async () => {
    try { const v = await document.querySelector('deep-player').probe(); return { ok: true, value: JSON.parse(JSON.stringify(v ?? null)) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`, 60_000);
  await closePage(page);

  const f: string[] = [];
  const thrown = s.thrown!; const at = s.next!;
  const asked = s.raf.length - thrown.asks;
  const span = ((now - thrown.at) / 1000).toFixed(1);
  console.log(`${what}: the frame call asked for ${thrown.asked.toFixed(4)} s threw at ${AT}; at the next display frame paused ${String(at.paused)}, notices ${JSON.stringify(at.notices)}; ${asked} animation callbacks asked for in the ${span} s after, ended ${s.ended}; probe() ${show((answer.ok ? answer.value : answer.error) ?? null, 400)}`);
  if (at.paused !== true) f.push(`${what}: after the core's frame call threw at ${AT}, paused reads ${String(at.paused)} at the next display frame, not true`);
  const stopped = at.notices.filter((n) => n.kind === 'stopped');
  if (stopped.length !== 1) f.push(`${what}: after the throw at ${AT}, the page shows ${stopped.length} notices of kind stopped at the next display frame, not one; its notices: ${JSON.stringify(at.notices)}`);
  for (const n of stopped) {
    if (!n.shown) f.push(`${what}: the stopped notice after the throw at ${AT} is in the page but not shown: "${n.text}"`);
    if (!namesTheStep(n.text)) f.push(`${what}: the stopped notice after the throw at ${AT} doesn't name ${AT}: "${n.text}"`);
    if (!n.text.includes(SHIM_MESSAGE)) f.push(`${what}: the stopped notice after the throw at ${AT} doesn't hold the shim's message "${SHIM_MESSAGE}": "${n.text}"`);
  }
  if (asked !== 0) f.push(`${what}: in the ${span} s after the throw at ${AT}, the page asked for ${asked} animation callbacks, not 0`);
  if (s.ended !== 0) f.push(`${what}: ended fired ${s.ended} time(s) after the throw at ${AT}`);
  if (!answer.ok) f.push(`${what}: after the throw at ${AT}, probe() doesn't answer: ${answer.error ?? ''}`);
  else {
    const field = isObject(answer.value) ? answer.value['stopped'] : undefined;
    if (!isObject(field) || field['step'] !== STOP_STEP) f.push(`${what}: after the throw at ${AT}, probe() answers stopped = ${show(field ?? null, 300)}, not one naming ${AT} ({step: ${STOP_STEP}, …})`);
  }
  return f;
}

interface Seen {
  defined: boolean; player: boolean; text: string; lines: string[]; shown: boolean;
  links: { href: string; text: string; shown: boolean }[];
  link: { shown: boolean; x: number; y: number; hit: boolean } | null;
}
/** What the page shows inside `<deep-player>`, and the link to `fallback` there: shown, and where its centre is. */
const lineReading = (fallback: string): string => `(() => {
  ${IN_PAGE}
  const p = document.querySelector('deep-player');
  const links = p ? [...p.querySelectorAll('a[href]')] : [];
  const link = links.find((a) => new URL(a.href, location.href).pathname === ${JSON.stringify(`/${fallback}`)}) || null;
  const centre = (a) => {
    a.scrollIntoView({ block: 'center', inline: 'center' });
    const b = [...a.getClientRects()].find((r) => r.width > 0 && r.height > 0);
    if (!b) return { x: 0, y: 0, hit: false };
    const x = b.left + b.width / 2, y = b.top + b.height / 2, e = document.elementFromPoint(x, y);
    return { x, y, hit: !!e && (e === a || a.contains(e)) };
  };
  return {
    defined: !!customElements.get('deep-player'), player: !!p, text: textOf(p),
    lines: p ? String(p.innerText || '').split('\\n').map(collapse).filter(Boolean) : [],
    shown: textNodes(p).some((n) => collapse(n.nodeValue) !== '' && shown(n)),
    links: links.map((a) => ({ href: a.href, text: collapse(a.textContent), shown: shown(a) })),
    link: link ? { shown: shown(link), ...centre(link) } : null,
  };
})()`;

/** Criterion 2, one run: the page with the element's script served as `odd` says (`original` its SHA-256 as written),
 * what it shows inside `<deep-player>` and where its link leads. */
export async function refusedFailures(out: string, odd: Odd, original: string, fallback: { path: string; sha256: string }, how: string, keep: (p: Page) => Page): Promise<string[]> {
  const what = `the page whose element script was ${how}`;
  const page = keep(await openPage(out, { odd }));
  const loaded = await waitFor<boolean>(page.tab, `document.readyState === 'complete'`, 60_000);
  expect(loaded, `${what}: the index page loads`).toBe(true);
  await sleep(1_000);
  const seen = await page.tab.evaluate<Seen>(lineReading(fallback.path));
  const sent = page.server.served().filter((s) => s.path === odd.path && s.status === 200);
  expect(sent.some((s) => (odd.type === undefined || s.type === odd.type) && (odd.change === undefined || s.sha !== original)),
    `${what}: the test server sent the element's script ${odd.path} so; it sent ${JSON.stringify(sent)}`).toBe(true);
  expect(seen.defined, `${what}: the browser refused the element's script, so <deep-player> stays undefined; page errors ${JSON.stringify(page.tab.errors.slice(0, 3))}`).toBe(false);
  console.log(`${what}: <deep-player> shows ${JSON.stringify(seen.text)} in ${seen.lines.length} line(s), links ${JSON.stringify(seen.links)}`);

  const f: string[] = [];
  if (!seen.player) f.push(`${what}: the page has no <deep-player>`);
  if (seen.text === '') f.push(`${what}: the page shows nothing inside <deep-player>: no line and no link`);
  else {
    if (!seen.shown) f.push(`${what}: the line "${seen.text}" is inside <deep-player> but not shown`);
    if (seen.lines.length !== 1) f.push(`${what}: <deep-player> shows ${seen.lines.length} lines of text, not one: ${JSON.stringify(seen.lines)}`);
    if (!seen.link) f.push(`${what}: the line holds no link to the bundle's fallback page /${fallback.path}; its links: ${JSON.stringify(seen.links)}`);
  }
  if (seen.link) {
    if (!seen.link.shown) f.push(`${what}: the link to the fallback page /${fallback.path} is not shown`);
    if (!seen.link.hit) f.push(`${what}: the link to the fallback page /${fallback.path} is covered at its centre, so a click doesn't reach it`);
    else {
      await clickAt(page.tab, seen.link.x, seen.link.y);
      const want = `/${fallback.path}`;
      const until = Date.now() + 30_000;
      let at = '';
      let landed = false;
      while (!landed && Date.now() < until) {
        const loc = await page.tab.evaluate<{ path: string; state: string }>('({ path: location.pathname, state: document.readyState })').catch(() => null);
        if (loc) at = loc.path;
        if (loc && loc.path === want && loc.state === 'complete') landed = true;
        else if ((await pagesOpen(page.chrome)).some((u) => u.startsWith(`${page.origin}/`) && new URL(u).pathname === want)) { landed = true; at = `${want}, in a page of its own`; }
        else await sleep(200);
      }
      console.log(`${what}: the link, clicked, led to ${at || 'nothing'}`);
      if (!landed) f.push(`${what}: following the link doesn't open the bundle's fallback page ${want} within 30 s; the tab shows ${at || 'nothing'}`);
      else if (!page.server.served().some((s) => s.status === 200 && s.path === fallback.path && s.sha === fallback.sha256)) {
        f.push(`${what}: the link opened ${at}, but the server never sent the fallback page ${fallback.path} with the receipt's SHA-256 ${fallback.sha256}`);
      }
    }
  }
  await closePage(page);
  return f;
}

/** Criterion 3: the bundle served untouched, the line its index page carries inside `<deep-player>` (its text as the
 * browser's parser reads the served page; it must carry one), and each time the page's text holds it. */
export async function lineFailures(out: string, what: string, keep: (p: Page) => Page): Promise<{ line: string; failures: string[] }> {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const page = keep(await openPage(out, { shim: { stopAt: null } }));
  await page.tab.mustBeReady(what);
  const line = await page.tab.evaluate<string>(`(() => { ${IN_PAGE}
    return textOf(new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html').querySelector('deep-player')); })()`);
  const s = await shimState(page.tab);
  await closePage(page);
  console.log(`${what}: the index page's line ${JSON.stringify(line)}; the page's text at the first view ${JSON.stringify(s.firstView?.text ?? null)}, at ready ${JSON.stringify(s.atReady?.text ?? null)}`);
  expect(line, `${what}: the index page carries a line of text inside <deep-player> (the line a page whose script never ran shows); it carries ${JSON.stringify(line)}`).not.toBe('');
  expect(s.firstView, `${what}: the player drew its first view`).not.toBeNull();
  expect(s.atReady, `${what}: the player fired ready`).not.toBeNull();
  const f: string[] = [];
  if (s.firstView!.text.includes(line)) f.push(`${what}: at the first view the page's text holds the line "${line}"`);
  if (s.atReady!.text.includes(line)) f.push(`${what}: at ready the page's text holds the line "${line}"`);
  return { line, failures: f };
}

/** Criterion 4: the bundle at `out` played live, to `ended` (probe()'s step, step hashes and checkpoint hashes there),
 * then seeked to each step 0 … 600 in turn (probe()'s step and step hashes after each, waiting up to 2 s for the step
 * the seek names). */
export interface Played {
  end: { step: number; step_hash: JsonValue; checkpoint_hashes: JsonValue };
  steps: { k: number; step: number; step_hash: JsonValue }[];
}
export async function playedLive(out: string, what: string, keep: (p: Page) => Page): Promise<Played> {
  const page = keep(await openPage(out));
  await page.tab.mustBeReady(what);
  await page.tab.playToEnd(what);
  const end = await page.tab.evaluate<Played['end']>(`(async () => { const v = JSON.parse(JSON.stringify(await document.querySelector('deep-player').probe()));
    return { step: v.step, step_hash: v.step_hash ?? null, checkpoint_hashes: v.checkpoint_hashes ?? null }; })()`, 60_000);
  const steps = await page.tab.evaluate<Played['steps']>(`(async () => {
    const p = document.querySelector('deep-player');
    const read = async () => JSON.parse(JSON.stringify(await p.probe()));
    const out = [];
    for (let k = 0; k <= ${LAB_STEPS}; k += 1) {
      p.currentTime = k / 60;
      let v = await read();
      for (let i = 0; v.step !== k && i < 100; i += 1) { await new Promise((done) => setTimeout(done, 20)); v = await read(); }
      out.push({ k, step: v.step, step_hash: v.step_hash ?? null });
    }
    return out;
  })()`, 1_800_000);
  await closePage(page);
  return { end, steps };
}
