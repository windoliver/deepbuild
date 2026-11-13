// Test-side tools for the #239 acceptance tests (README: The surface under test): the two fixture films read from
// tests/fixtures/films/<name>/ (each a document and its assets, which this job doesn't write), what each must hold for
// its group, and the planted twins this suite makes from them; `deep-show` and `deep-gpu` built once per feature set
// when a test first needs them (a build that fails reads BLOCKED); `deep-show run` scenarios for `deep show`,
// `deep_show`, `determinism`, `export` and `verdict`; `deep-gpu run`'s `frame_budget`; the machine's own fingerprint
// and load; and the readers of the issues the checks raise. Nothing here stands in for a check, the export, the
// encode tool, the decode worker or the meter: each is read from what the binaries answer or write. JSON readers, the
// evidence store, the PNG reader and the reference-Mac gate are #501's helpers; the GPU pixel hash reader and the
// seeded generator #1897's; the MP4 box reader and the receipt's fidelity reader #157's; the frame-budget result
// reader and the stub fingerprints #1899's.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, expect } from 'vitest';
import { below, hash128, noGpu, seeded } from '../1897/helpers.ts';
import {
  FLICKS, REPO, TIMEOUT, arr, blocked, frameLength, int, isObject, obj, putEvidence, sha256, show, str, type JsonObject, type JsonValue, type Rate,
} from '../501/helpers.ts';

export {
  FLICKS, REPO, TIMEOUT, arr, blocked, decodePng, failsNaming, frameLength, hex64, inconclusive, int, isObject, none, num, obj, present as presentFromShell,
  putEvidence, receiptOf, referenceMacProblem, runShow, scenario as shellScenario, sha256, show, snapshotPicture, str, useTemp, DOC as SHELL_DOC,
  type JsonObject, type JsonValue, type Rate,
} from '../501/helpers.ts';
export { hash128, noGpu } from '../1897/helpers.ts';
export { H264_AAC, fidelityOf, meetsFloor, readMovie, samplesOf, trackOf } from '../157/helpers.ts';
export { ON_BATTERY, OTHER_MACHINE, REFERENCE, RUNS, budgetOf, type Budget, type Fingerprint } from '../1899/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #239.72f4af59',
  2: 'AC2 #239.a88a17ac',
  3: 'AC3 #239.7ded5bb7',
  4: 'AC4 #239.68acd310',
  5: 'AC5 #239.85750ec9',
} as const;

// ---------------------------------------------------------------------------------------------------
// The two films (README: The two films): the first two of #77's six, kept as its fixtures.

export const FILMS = ['strokes-and-paper', 'camera-and-transitions'] as const;
export type FilmName = (typeof FILMS)[number];
export const LABEL: Record<FilmName, string> = {
  'strokes-and-paper': 'the strokes and paper film',
  'camera-and-transitions': 'the camera and transitions film',
};
/** Where the implementer puts the films: `<name>/film.json` and `<name>/assets/`. */
export const FILMS_DIR = join(REPO, 'tests', 'fixtures', 'films');
/** Where the check run puts its screenshots, recordings and receipts (README: The taste call). */
export const EVIDENCE_239 = join(REPO, 'docs', 'evidence', '239');

export interface Film {
  name: FilmName; label: string; document: JsonObject; assets: Map<string, Buffer>; look: JsonObject;
  size: [number, number]; rate: Rate; frame: number; span: number; frames: number; sampleRate: number;
}

/** A time as the document writes it: whole flicks, or seconds as `"<n>s"` that land on a whole flick. */
export function flicksOf(v: JsonValue | undefined, what: string): number {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(v) : null;
  if (m) {
    const f = Math.round(Number(m[1]) * FLICKS);
    if (Math.abs(f - Number(m[1]) * FLICKS) < 1e-3) return f;
  }
  return expect.fail(`${what} is a time in whole flicks or "<n>s", got ${show(v ?? null)}`);
}

function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) { const p = join(dir, e); if (statSync(p).isDirectory()) out.push(...filesIn(p)); else out.push(p); }
  return out;
}
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * A delivered film: `tests/fixtures/films/<name>/film.json` and the files under `assets/`, each named in the document's
 * `assets` by its SHA-256. A missing document or asset reads BLOCKED; a document whose envelope a test can't read
 * fails, naming the field.
 */
export function film(name: FilmName): Film {
  const label = LABEL[name];
  const dir = join(FILMS_DIR, name);
  const path = join(dir, 'film.json');
  const rel = relative(REPO, path);
  if (!existsSync(path)) blocked(`${label} isn't delivered: ${rel} is missing (README: The two films)`);
  let parsed: JsonValue;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${rel} is not JSON: ${(e as Error).message}`); }
  const document = obj(parsed, `${label}: ${rel}`);
  const assets = new Map<string, Buffer>();
  for (const p of filesIn(join(dir, 'assets'))) { const b = readFileSync(p); assets.set(sha256(b), b); }
  const named = isObject(document['assets']) ? document['assets'] : {};
  const missing = Object.entries(named)
    .filter(([, a]) => !(isObject(a) && typeof a['sha256'] === 'string' && assets.has(a['sha256'])))
    .map(([id, a]) => `${id} (${show(isObject(a) ? a['sha256'] ?? null : a ?? null)})`);
  if (missing.length) blocked(`${label}'s assets aren't all delivered: ${relative(REPO, join(dir, 'assets'))}/ holds no file for ${missing.join(', ')}`);
  const lookRef = isObject(document['look']) ? document['look']['asset'] : undefined;
  expect(typeof lookRef === 'string' && /^[^@]+@\d+$/.test(lookRef), `${label}: look.asset names its look asset as "<id>@1", got ${show(lookRef ?? null)}`).toBe(true);
  const lookId = (lookRef as string).replace(/@\d+$/, '');
  const entry = obj(named[lookId], `${label}: assets.${lookId}, its look`);
  let look: JsonValue;
  try { look = JSON.parse(assets.get(str(entry['sha256'], `${label}: assets.${lookId}.sha256`))!.toString('utf8')) as JsonValue; } catch (e) { return expect.fail(`${label}: its look asset is not a look@1 JSON: ${(e as Error).message}`); }
  const size = arr(document['size'], `${label}: size`).map((v, i) => int(v, `${label}: size[${i}]`)) as [number, number];
  expect(size.length === 2 && size.every((v) => v > 0 && v % 2 === 0), `${label}: size is [w, h], each even, since H.264 is 4:2:0, got ${show(size)}`).toBe(true);
  const transport = obj(document['transport'], `${label}: transport`);
  const rate = arr(transport['frame_rate'], `${label}: transport.frame_rate`).map((v, i) => int(v, `${label}: transport.frame_rate[${i}]`)) as Rate;
  const frame = frameLength(rate);
  expect(frame !== null, `${label}: transport.frame_rate ${show(rate)} is a valid rate, a whole number of flicks a frame`).toBe(true);
  const span = flicksOf(transport['span'], `${label}: transport.span`);
  expect(span % Number(frame), `${label}: transport.span ${span} is a whole number of frames`).toBe(0);
  const sampleRate = transport['sample_rate'] === undefined ? 48_000 : int(transport['sample_rate'], `${label}: transport.sample_rate`);
  return { name, label, document, assets, look: obj(look, `${label}: its look`), size, rate, frame: Number(frame), span, frames: span / Number(frame), sampleRate };
}

/** Puts every asset of the film in an evidence store. */
export function stock(evidence: string, f: Film): void {
  for (const bytes of f.assets.values()) putEvidence(evidence, bytes);
}

const itemsOf = (d: JsonObject): [string, JsonObject][] =>
  Object.entries(isObject(d['items']) ? d['items'] : {}).filter((e): e is [string, JsonObject] => isObject(e[1]));
const paramsOf = (item: JsonObject): JsonObject => (isObject(item['params']) ? item['params'] : {});
const byOrder = (a: [string, JsonObject], b: [string, JsonObject]): number => {
  const oa = String(a[1]['order'] ?? ''); const ob = String(b[1]['order'] ?? '');
  return oa < ob ? -1 : oa > ob ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
};
/** Every `{target, keys}` channel anywhere in the document (its own channels and its clips'). */
function channelsIn(v: JsonValue, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(v)) for (const x of v) channelsIn(x, out);
  else if (isObject(v)) {
    if (typeof v['target'] === 'string' && isObject(v['keys'])) out.push(v);
    for (const x of Object.values(v)) channelsIn(x, out);
  }
  return out;
}
const keyValues = (c: JsonObject): Set<string> =>
  new Set(Object.values(isObject(c['keys']) ? c['keys'] : {}).filter(isObject).map((k) => JSON.stringify(k['value'] ?? null)));
/** A strip's source asset's SHA-256: `src` as a SHA-256 or an asset ID, or `{asset}` as either. */
function stripAsset(d: JsonObject, s: JsonObject): string | null {
  const named = isObject(d['assets']) ? d['assets'] : {};
  const ref = typeof s['src'] === 'string' ? s['src'] : isObject(s['src']) && typeof s['src']['asset'] === 'string' ? s['src']['asset'] : null;
  if (ref === null) return null;
  if (/^[0-9a-f]{64}$/.test(ref)) return ref;
  const a = named[ref];
  return isObject(a) && typeof a['sha256'] === 'string' ? a['sha256'] : null;
}

/** The film's first text@1 item with its words in `params.text`, by draw order: the one the film.audit twin edits. */
export function firstText(f: Film): { id: string; item: JsonObject } | null {
  const found = itemsOf(f.document).filter(([, i]) => i['kind'] === 'text@1' && typeof paramsOf(i)['text'] === 'string' && (paramsOf(i)['text'] as string).trim() !== '').sort(byOrder)[0];
  return found ? { id: found[0], item: found[1] } : null;
}

/**
 * What the film lacks for its group and for the checks it carries (README: The two films), one sentence each. Read
 * from the document and its look; nothing is drawn.
 */
export function groupFailures(f: Film): string[] {
  const d = f.document; const L = f.label; const out: string[] = [];
  const items = new Map(itemsOf(d));
  if (d['profile'] !== 'film') out.push(`${L}: profile is ${show(d['profile'] ?? null)}, not "film"`);
  const cam = typeof d['camera'] === 'string' ? items.get(d['camera']) : undefined;
  if (!cam || cam['kind'] !== 'camera@1') out.push(`${L}: camera ${show(d['camera'] ?? null)} names no camera@1 item`);
  const budget = isObject(d['budget']) ? d['budget']['class'] : undefined;
  if (typeof budget !== 'string' || budget === 'export') out.push(`${L}: budget.class is ${show(budget ?? null)}, not a class with a frame limit (a film shown full screen is a showpiece)`);
  if (!firstText(f)) out.push(`${L}: holds no text@1 with its words in params.text, so film.audit and film.layout would read nothing`);
  const markers = Object.values(isObject(d['markers']) ? d['markers'] : {}).filter(isObject);
  const shots = Object.entries(isObject(d['shots']) ? d['shots'] : {}).filter((e): e is [string, JsonObject] => isObject(e[1]));
  if (!markers.some((m) => ['cue', 'hold', 'shot'].includes(String(m['kind']))) && shots.length === 0) out.push(`${L}: has no cue, hold or shot marker and no shot, so film.layout's at: cues checks no time`);
  const strips = Object.values(isObject(d['strips']) ? d['strips'] : {}).filter(isObject);
  if (!strips.some((s) => { const h = stripAsset(d, s); return h !== null && f.assets.has(h); })) out.push(`${L}: no strip plays a delivered sound asset, so its delivery would carry no sound`);
  if (f.frames < 300) out.push(`${L}: ${f.frames} frames, under the 300 a frame-time p95 is taken over (Every task carries its own budgets)`);
  if (f.rate[0] % f.rate[1] !== 0) out.push(`${L}: frame_rate ${f.rate.join('/')} isn't a whole number of frames a second, which the frame-budget run takes as its fps`);

  if (f.name === 'strokes-and-paper') {
    const ground = isObject(f.look['ground']) ? f.look['ground'] : {};
    if (f.look['basis'] !== 'drawing') out.push(`${L}: its look's basis is ${show(f.look['basis'] ?? null)}, not "drawing"`);
    if (ground['kind'] !== 'paper') out.push(`${L}: its look's ground is ${show(ground['kind'] ?? null)}, not paper (Look look@1: paper)`);
    const trimmed = new Set([...items].filter(([, i]) => {
      const p = paramsOf(i);
      return Array.isArray(p['ops']) && p['ops'].some((o) => isObject(o) && isObject(o['trim'])) && isObject(p['paint']) && p['paint']['stroke'] !== undefined;
    }).map(([id]) => id));
    const drawnOn = channelsIn(d).some((c) => {
      const m = /^(?:items\/([^/]+)|slot:[^/]+)\/params\/ops\/\d+\/trim\/(?:start|end|offset)$/.exec(String(c['target']));
      return m !== null && (m[1] === undefined ? trimmed.size > 0 : trimmed.has(m[1])) && keyValues(c).size >= 2;
    });
    if (trimmed.size === 0) out.push(`${L}: no item strokes a path through a trim op (params.ops [{trim}] with params.paint.stroke)`);
    else if (!drawnOn) out.push(`${L}: no channel keys a stroked item's trim start, end or offset through two values or more, so no stroke is drawn on`);
  }
  if (f.name === 'camera-and-transitions') {
    const onCamera = shots.filter(([, s]) => s['camera'] === d['camera']);
    const moving = onCamera.filter(([, s]) => typeof s['move'] === 'string' && s['move'] !== 'hold');
    if (onCamera.length < 3 || moving.length < onCamera.length) out.push(`${L}: ${onCamera.length} shots on its camera, ${moving.length} with a move other than hold; it needs three or more, each moving`);
    if (new Set(moving.map(([, s]) => s['move'])).size < 2) out.push(`${L}: its shots' moves are ${show([...new Set(moving.map(([, s]) => s['move'] ?? null))])}, fewer than two kinds`);
    const kinds = new Set(Object.values(isObject(d['transitions']) ? d['transitions'] : {}).filter(isObject).map((t) => String(t['kind'])).filter((k) => k !== 'cut'));
    if (kinds.size < 2) out.push(`${L}: its transitions other than cuts are of ${kinds.size} kind(s) (${[...kinds].join(', ') || 'none'}); it needs two or more`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The planted twins this suite makes from a delivered film (README: Planted twins). Each is the film plus one fault.

/** An order key after every item's (base-62 keys compare as strings). */
function topOrder(d: JsonObject): string {
  const orders = itemsOf(d).map(([, i]) => (typeof i['order'] === 'string' ? i['order'] : '')).sort();
  return `${orders[orders.length - 1] ?? 'a'}z`;
}
/** The film's text font: its first text's, else its look's first font. */
function fontOf(f: Film): JsonValue | undefined {
  const t = firstText(f);
  if (t && paramsOf(t.item)['font'] !== undefined) return paramsOf(t.item)['font'];
  const fonts = isObject(f.look['fonts']) ? Object.keys(f.look['fonts']) : [];
  return fonts[0];
}

/** The tick grid's columns and rows: 16 × 16 over twice the document frame each way, around it. */
export const TICK_GRID = 16;
/**
 * The determinism twin's document: the film with a grid of #488's `test.tick@1` items over [−w/2, 3w/2) × [−h/2,
 * 3h/2), each w/48 × h/36, one every w/8 and h/8, so a view of the film at 0.5 s shows one wherever its camera looks.
 * A tick steps at 60 Hz with a checkpoint every 0.5 s and moves by its step count, so a seek that restores the wrong
 * checkpoint shows in the pixels. It needs the `full,test-tick` build.
 */
export function withTicks(f: Film): JsonObject {
  const d = clone(f.document); const [W, H] = f.size; const base = topOrder(d);
  const items = obj(d['items'], `${f.label}: items`);
  const w = Math.max(8, Math.round(W / 48)); const h = Math.max(6, Math.round(H / 36));
  for (let gy = 0, k = 0; gy < TICK_GRID; gy++) {
    for (let gx = 0; gx < TICK_GRID; gx++, k++) {
      const n = String(k).padStart(3, '0');
      items[`twin-tick-${n}`] = {
        id: `twin-tick-${n}`, kind: 'test.tick@1', name: `Twin tick ${n}`, order: `${base}${n}`,
        params: { box: [Math.round(-W / 2 + (gx * W) / 8), Math.round(-H / 2 + (gy * H) / 8), w, h] },
      };
    }
  }
  const req = isObject(d['requires']) ? d['requires'] : null;
  if (req && isObject(req['modules'])) req['modules']['test.tick'] = '^1';
  return d;
}

/**
 * The film.audit twin: the film whose first text holds far more words than any hold the film gives can read: at 15
 * graphemes a second plus the 1.5 s pad (Film audit: hold), 15 × (span + 2 s) letters need longer than the film lasts.
 */
export function longCopy(f: Film): { document: JsonObject; item: string } {
  const t = firstText(f);
  expect(t, `${f.label}: a text@1 the audit twin can lengthen`).not.toBeNull();
  const d = clone(f.document);
  const letters = Math.ceil(15 * (f.span / FLICKS + 2));
  const words = Array.from({ length: Math.ceil(letters / 5) }, () => 'drawn').join(' ');
  obj(obj(obj(d['items'], 'items')[t!.id], `items.${t!.id}`)['params'], `items.${t!.id}.params`)['text'] = words;
  return { document: d, item: t!.id };
}

/** The film.layout twin's item: a text the frame cuts on both sides at every time. */
export const CUT_TEXT = 'layout-twin';
/**
 * The film.layout twin: the film with one more text@1, `layout-twin`, one line of capitals at h/4 u centred on the
 * document frame's centre and about eight document widths long, so any view of the film narrower than six widths cuts
 * it at both sides (Film layout: `layout.cut`).
 */
export function cutText(f: Film): JsonObject {
  const d = clone(f.document); const [W, H] = f.size;
  const size = Math.max(16, Math.round(H / 4));
  const text = 'THE FRAME CUTS THIS LINE AT BOTH SIDES '.repeat(3).trim();
  const font = fontOf(f);
  const t = firstText(f);
  const paint = t ? paramsOf(t.item)['paint'] : undefined;
  obj(d['items'], `${f.label}: items`)[CUT_TEXT] = {
    id: CUT_TEXT, kind: 'text@1', name: 'Layout twin', order: topOrder(d),
    params: { text, ...(font !== undefined ? { font } : {}), size, box: { w: 12 * W, h: 2 * size }, align: 'center', ...(paint !== undefined ? { paint } : {}) },
    at: { pos: [W / 2 - 6 * W, H / 2 - size, 0] },
  };
  return d;
}

// ---------------------------------------------------------------------------------------------------
// Builds, made when a test first needs one and copied out of the target folder; a build that fails reads BLOCKED.

export type Build = 'deep-show full' | 'deep-show full,test-tick' | 'deep-gpu' | 'deep-gpu test-meter';
const BUILD_ARGS: Record<Build, string[]> = {
  'deep-show full': ['--bin', 'deep-show', '--no-default-features', '--features', 'full'],
  'deep-show full,test-tick': ['--bin', 'deep-show', '--no-default-features', '--features', 'full,test-tick'],
  'deep-gpu': ['--bin', 'deep-gpu'],
  'deep-gpu test-meter': ['--bin', 'deep-gpu', '--features', 'test-meter'],
};
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
function buildTo(b: Build, dir: string): { bin?: string; error?: string } {
  const args = ['build', '--locked', ...BUILD_ARGS[b]];
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { error: `cargo could not run (${r.error.message}); put the pinned toolchain on PATH (README: Run them)` };
  if (r.status !== 0) return { error: `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}` };
  const name = BUILD_ARGS[b][1]!;
  const bin = join(dir, `${name}-${b.replace(/[ ,]/g, '+')}`);
  copyFileSync(join(targetOf(), 'debug', process.platform === 'win32' ? `${name}.exe` : name), bin);
  return { bin };
}
/** The file's builds: `bin(b)` builds `b` the first time a test asks, then hands back the copy. */
export function useBuilds(): (b: Build) => string {
  let dir = '';
  const made = new Map<Build, { bin?: string; error?: string }>();
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (b) => {
    let e = made.get(b);
    if (!e) {
      if (!dir) dir = mkdtempSync(join(tmpdir(), 'deep-239-bins-'));
      e = buildTo(b, dir);
      made.set(b, e);
    }
    if (e.error) blocked(`${b} doesn't build here, so nothing it checks has run: ${e.error}`);
    return e.bin!;
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show run as the agent: one session, the film on its panel, a claim whose requirements are the core's check
// kinds (#403's form, as #1897's and #408's suites write it).

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB239D', 1);
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Test agent: the spine gate', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const CLAIM = `claim:${ulid('01JB239C', 1)}`;
export const REQ = { determinism: `req:${ulid('01JB239Q', 1)}`, audit: `req:${ulid('01JB239Q', 2)}`, layout: `req:${ulid('01JB239Q', 3)}` } as const;

/** A scenario: the evidence store, the agent's session and process tree, the document's panel, a claim, the calls. */
export function agentScenario(evidence: string, calls: JsonObject[], o: { planted?: string; requirements?: [string, JsonObject][] } = {}): JsonObject {
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
  if (o.planted) out['planted'] = o.planted;
  if (o.requirements) out['claims'] = { [CLAIM]: { session: ALPHA.id, deliverables: [DOC], requirements: o.requirements.map(([id, check]) => ({ id, check })) } };
  return out;
}
/** The agent's `deep_show` of a whole document (#393). */
export const showFilm = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document, include: ['issues'] });
export const VERDICT: JsonObject = { call: 'verdict', claim: CLAIM };

/** A reply's issues, each an object. */
export const issuesIn = (v: JsonObject): JsonObject[] => (Array.isArray(v['issues']) ? v['issues'].filter(isObject) : []);
/** The errors among them: an issue with no severity counts as one. */
export const errorsIn = (v: JsonObject): JsonObject[] => issuesIn(v).filter((i) => i['severity'] === undefined || i['severity'] === 'error');
/** Presented, with no error among its issues. */
export function presentedClean(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
  const errors = errorsIn(reply);
  expect(errors, `${what}: deep show raises no error: ${show(errors as JsonObject[], 2000)}`).toEqual([]);
}
/** The verdict's row for a requirement. */
export function rowOf(verdict: JsonObject, id: string, what: string): JsonObject {
  const rows = arr(verdict['requirements'], `${what}: requirements`).map((r, i) => obj(r, `${what}: requirements[${i}]`));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `${what}: a row for ${id}: ${show(verdict, 2000)}`).toBeDefined();
  return row!;
}
/** Whether an issue names an item: its ID in any of its fields. */
export const names = (i: JsonObject, id: string): boolean => JSON.stringify(i).includes(JSON.stringify(id));
/** An issue's first time, `t`, in flicks (whole flicks or `"<n>s"`), or null when it carries none this reads. */
export function tOf(i: JsonObject): number | null {
  const v = i['t'];
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(v) : null;
  return m ? Math.round(Number(m[1]) * FLICKS) : null;
}
/** One line per error issue: its code, the items it names and its time; what a planted twin's failure is read from. */
export function faultLines(row: JsonObject): string[] {
  return errorsIn(row).map((i) => `${String(i['code'])} ids=${JSON.stringify(i['ids'] ?? null)} t=${tOf(i) ?? JSON.stringify(i['t'] ?? null)}: ${JSON.stringify(i).slice(0, 400)}`);
}
/** A pattern for a fault line: its code, then the item's ID anywhere after it. */
export const faultNaming = (code: string, id: string): RegExp =>
  new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} .*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

// ---------------------------------------------------------------------------------------------------
// Seek against play (Determinism): 20 seeded off-grid times, each reached by a jump from a later time.

/** 20 distinct times in (0, span), none on a frame's start, from mulberry32 seeded 239. */
export function sampledTimes(f: Film, n = 20, seed = 239): number[] {
  const next = seeded(seed); const set = new Set<number>();
  while (set.size < n) { const t = below(next, f.span); if (t > 0 && t % f.frame !== 0) set.add(t); }
  return [...set].sort((a, b) => a - b);
}
export interface Compared { t: number; play: string; seek: string }
/** A same-machine `determinism` reply: each asked time's play and seek sides by their GPU pixel hashes. */
export function compared(reply: JsonObject, times: number[], what: string): Compared[] {
  if (noGpu(reply)) blocked(`no GPU to hash the canonical renders on here: ${show(reply)}`);
  expect(reply['outcome'], `${what} compared: ${show(reply)}`).toBe('compared');
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return {
      t: int(f['t'], `${what}: frames[${i}].t`),
      play: hash128(obj(f['play'], `${what}: frames[${i}].play`)['pixel_hash'], `${what}: frames[${i}].play.pixel_hash`),
      seek: hash128(obj(f['seek'], `${what}: frames[${i}].seek`)['pixel_hash'], `${what}: frames[${i}].seek.pixel_hash`),
    };
  });
  expect(frames.map((f) => f.t), `${what}: one comparison per time asked, ascending`).toEqual(times);
  return frames;
}
/** Seek against play by hash; each failure names the flick and both hashes. */
export const hashFailures = (frames: Compared[]): string[] =>
  frames.filter((f) => f.play !== f.seek).map((f) => `at ${f.t} flicks seeking to it hashes ${f.seek}, playing to it ${f.play}`);

// ---------------------------------------------------------------------------------------------------
// deep-gpu run (#377's binary): one scenario `{out, calls}` on stdin, one answer line, one reply per call.

export const WRITER = 'agent:alpha';
export function runGpu(bin: string, calls: JsonObject[], what: string, o: { noop?: boolean } = {}): JsonObject[] {
  const out = mkdtempSync(join(tmpdir(), 'deep-239-gpu-'));
  try {
    const args = ['run', ...(o.noop ? ['--backend', 'noop'] : [])];
    const shown = `deep-gpu ${args.join(' ')} (${what})`;
    const s = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    expect(timedOut, `${shown} finished within its timeout`).toBe(false);
    if (s.error) throw Error(`${shown}: ${s.error.message}`);
    expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
    const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
    expect(lines.length, `${shown}: one answer line`).toBe(1);
    let answer: JsonValue;
    try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
    const a = obj(answer, `${shown}: the answer`);
    expect(a['ok'], `${shown} accepted the scenario: ${show(a, 2000)}`).toBe(true);
    const replies = arr(a['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
    expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
    return replies;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
/** The film's document in a file, as the writer sends it, for `frame_budget`'s `doc`. */
export function docFile(dir: string, f: Film): string {
  const p = join(dir, `${f.name}.json`);
  writeFileSync(p, JSON.stringify(f.document));
  return p;
}
/** The frame-budget run of the film (#1899's call): its whole span at its own size and rate, under its look. */
export function budgetCall(f: Film, doc: string, extra: JsonObject = {}): JsonObject {
  return { call: 'frame_budget', look: f.look, writer: WRITER, doc, render: { seconds: f.span / FLICKS, pixels: f.size }, fps: f.rate[0] / f.rate[1], ...extra };
}
/** A stub meter whose every frame, warm-up included, reads `gpu_ms` of GPU and no CPU. */
export const flatMeter = (gpuMs: number): JsonObject => ({ frames: [{ from: 0, gpu_ms: gpuMs }] });
/** Why this machine is too loaded to judge a timing: its one-minute load above its core count, or null. */
export function loadProblem(): string | null {
  const [one] = loadavg(); const cores = availableParallelism();
  return one! > cores ? `the one-minute load is ${one!.toFixed(1)}, above the ${cores} cores` : null;
}
