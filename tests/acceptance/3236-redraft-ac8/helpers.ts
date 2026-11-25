// Test-side tools for #3236's criterion 8 (README): the platform gates, the two Swift programs compiled into a temporary
// folder (the assistive client and the unit checks' stand-in), a window's process read and heard from outside it, the
// judge of a live read against the replica's, and the fixture scatter with its calls. The build and `deep-show run` come
// from ../539/helpers.ts by import. Nothing here stands in for the window, its accessibility tree or its announcements,
// and no expected text is written here: the replica's `see` gives each one.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach } from 'vitest';
import { REPO, Script, show, type JsonObject, type JsonValue } from '../539/helpers.ts';

/** Criterion 8 (scripts/proof-change.mjs, criterionId). */
export const AC = 'AC8 #3236.b9b04201';

const HERE = join(REPO, 'tests', 'acceptance', '3236-redraft-ac8');
/** `BLOCKED:` and where it stopped: never a pass. */
export const blocked = (where: string): never => { throw Error(`BLOCKED: ${where}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// The Swift programs, compiled once a file with swiftc into a temporary folder.

let binDir = '';
const compiled = new Map<string, { path: string; error: string }>();
/** Compiles `<name>.swift`; `error` names what stopped it, '' when nothing did. */
export function compile(name: 'client' | 'standin'): { path: string; error: string } {
  const known = compiled.get(name);
  if (known) return known;
  if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-3236-ac8-'));
  const path = join(binDir, name);
  // A compile of one small file that hangs is stopped, and reads as one that could not run.
  const r = spawnSync('swiftc', ['-O', '-o', path, join(HERE, `${name}.swift`)], { encoding: 'utf8', timeout: 900_000, killSignal: 'SIGKILL' });
  const error = r.error ? `swiftc could not run: ${r.error.message}` : r.status === 0 ? '' : `swiftc could not compile ${name}.swift: ${r.stderr.slice(-1500)}`;
  const out = { path, error };
  compiled.set(name, out);
  return out;
}
afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; compiled.clear(); });

// ---------------------------------------------------------------------------------------------------
// The platform gates, each naming where it stopped, or null.

interface Gates { trusted: boolean; locked: boolean; asleep: boolean }
/** What a screen that can't be read says, or null. */
export function screenProblem(g: Pick<Gates, 'locked' | 'asleep'>): string | null {
  if (g.locked) return 'the screen is locked (or no login session is on the console), where AppKit shows no window';
  if (g.asleep) return 'the display is asleep, where nothing draws a window';
  return null;
}
/** What the session says now, through the client; or why it says nothing. */
function gates(): Gates | string {
  const r = spawnSync(compile('client').path, ['gates'], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  return r.status === 0 ? (JSON.parse(r.stdout) as Gates) : `the assistive client's gates didn't answer (${r.error?.message ?? r.stderr.slice(-300)})`;
}
/** Why the screen can't be read now, or null. */
export function screenNow(): string | null {
  const g = gates();
  return typeof g === 'string' ? g : screenProblem(g);
}
/** Off macOS, off a reference Mac (when asked), no swiftc, no Accessibility trust, a locked screen or a sleeping display. */
export async function platformProblem(o: { reference: boolean }): Promise<string | null> {
  if (process.platform !== 'darwin') return `AppKit is macOS's; this is ${process.platform}`;
  if (o.reference) {
    type Mac = { model: string | null; chip: string | null; memoryBytes: number | null };
    const { fingerprint, references } = (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as { fingerprint(): Mac; references: (Mac & { name: string })[] };
    const m = fingerprint();
    if (!references.some((r) => r.model === m.model && r.chip === m.chip && r.memoryBytes === m.memoryBytes)) {
      return `not a reference Mac (${references.map((r) => r.name).join(', ')}): this is ${m.model} / ${m.chip} / ${m.memoryBytes} bytes`;
    }
  }
  const { error } = compile('client');
  if (error) return error;
  const g = gates();
  if (typeof g === 'string') return g;
  if (!g.trusted) return 'the Accessibility API serves no process here (AXIsProcessTrusted is false): allow the app that runs the tests under Privacy & Security, Accessibility';
  return screenProblem(g);
}

// ---------------------------------------------------------------------------------------------------
// A window's process, read and heard from outside it. Only what this file starts is stopped, by its own PID.

const owned = new Set<ChildProcess>();
function start(command: string, args: string[], input: string | null): ChildProcess {
  const child = spawn(command, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  owned.add(child);
  child.on('exit', () => owned.delete(child));
  child.stdin!.on('error', () => { /* the process went before it read its input; its exit says so */ });
  child.stdin!.end(input ?? '');
  return child;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  child.kill('SIGTERM');
  // deadline: a process that ignores SIGTERM for 5 s is killed
  const hard = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await gone;
  clearTimeout(hard);
}
afterEach(async () => { await Promise.all([...owned].map(stop)); });

/** `what`, or null once `ms` have passed; `what` keeps its own rejection. */
function within<T>(what: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    // deadline: bounds a wait for one line or one exit; a wait that runs out is named by its caller
    const timer = setTimeout(() => resolve(null), ms);
    what.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e as Error); });
  });
}

/** An element with an AXIdentifier, as the client reads it; a text it gives none of is null. */
export interface Element { identifier: string; role: string | null; title: string | null; description: string | null; value: string | null }
/** A stretch of the listening, in ms from the window's listing. */
export type Stretch = [from: number, to: number];
/** What the client read and heard of a process's window (client.swift). */
export interface Live { listed: boolean; ended: 'heard' | 'cap' | 'gone' | 'unlisted'; ms: number; elements: Element[]; said: string[]; at: number[]; locked: boolean; asleep: boolean; hidden: Stretch[] }
/** How long to listen, in seconds: at least `least` from the window's listing, then until every one expected came and none for `quiet`, never past `most`. */
export interface Listen { expect: number; least: number; most: number; quiet: number }

/** How long a window may take to list once its process answered (the criterion's own gate), and the answer itself. */
export const LISTED_WITHIN = 30_000;
const ANSWER_WITHIN = 1_800_000;

/**
 * Starts `command`, which answers one JSON line and opens a window, and reads it with the client: started right behind
 * it, so it takes announcements from as early as AppKit answers. `answer` is that line (null: none came), `live` what
 * the client read (null when the process refused, or ended before AppKit listed a window: `ended` then says how).
 */
export async function readWindow(command: string, args: string[], input: string | null, identifier: string, listen: Listen): Promise<{ answer: JsonObject | null; ended: string | null; stderr: string; live: Live | null }> {
  const app = start(command, args, input);
  if (app.pid === undefined) throw Error(`${command} could not start`);
  let stderr = '';
  app.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-4000); });
  const answered = new Promise<JsonObject | null>((resolve) => {
    const lines = createInterface({ input: app.stdout! });
    lines.on('line', (l) => {
      let v: JsonValue;
      try { v = JSON.parse(l) as JsonValue; } catch { return; }
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) resolve(v);
    });
    lines.on('close', () => resolve(null));
  });

  const client = start(compile('client').path, ['read', String(app.pid), identifier, String(listen.expect), String(listen.least), String(listen.most), String(listen.quiet)], null);
  let complaint = '';
  client.stderr!.setEncoding('utf8').on('data', (d: string) => { complaint += d; });
  let isListed: (() => void) | undefined;
  const listed = new Promise<true>((resolve) => { isListed = () => resolve(true); });
  const done = new Promise<Omit<Live, 'listed'>>((resolve, reject) => {
    const lines = createInterface({ input: client.stdout! });
    let last: Omit<Live, 'listed'> | undefined;
    lines.on('line', (l) => {
      const e = JSON.parse(l) as { event: string };
      if (e.event === 'listed') isListed!();
      if (e.event === 'done') last = e as unknown as Omit<Live, 'listed'>;
    });
    lines.on('close', () => { if (last) resolve(last); else reject(Error(`BLOCKED: the assistive client ended with no reading: ${complaint.slice(-500)}; this is not a pass`)); });
  });
  done.catch(() => undefined); // a client stopped below is read no further

  try {
    const answer = await within(answered, ANSWER_WITHIN);
    const gone = (): string | null => (app.exitCode === null && app.signalCode === null ? null : `exit ${app.exitCode ?? app.signalCode}`);
    if (!answer || answer['ok'] !== true) return { answer, ended: gone(), stderr, live: null };
    const seen = await within(Promise.race([listed, done.then(() => null)]), LISTED_WITHIN);
    if (!seen && gone()) return { answer, ended: gone(), stderr, live: null };
    if (!seen) return { answer, ended: null, stderr, live: { listed: false, ended: 'unlisted', ms: 0, elements: [], said: [], at: [], locked: false, asleep: false, hidden: [] } };
    const read = await within(done, listen.most * 1000 + 180_000);
    if (!read) return blocked(`the assistive client listened past its cap of ${listen.most} s and gave no reading`);
    return { answer, ended: gone(), stderr, live: { ...read, listed: true } };
  } finally {
    await Promise.all([stop(client), stop(app)]);
  }
}

// ---------------------------------------------------------------------------------------------------
// The judge: a live read against the replica's `see`, and nothing else.

/** The replica's side: the item, its node's value, and every announcement's text in order. */
export interface Replica { id: string; value: string; said: string[] }
export interface Judged { verdict: 'PASS' | 'FAIL' | 'BLOCKED'; why: string[] }

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const quoted = (s: string): string => JSON.stringify(s);

/** How the announcements asked for differ from the replica's: each text as many times, then the order. */
function saidFailures(want: readonly string[], got: readonly string[]): string[] {
  const count = (list: readonly string[], t: string): number => list.filter((x) => x === t).length;
  const out: string[] = [];
  for (const t of new Set([...want, ...got])) {
    const [w, g] = [count(want, t), count(got, t)];
    if (w !== g) out.push(`the window asks for ${quoted(t)} ${g} time(s), the replica announces it ${w} time(s)`);
  }
  if (!out.length) {
    const at = want.findIndex((t, i) => t !== got[i]);
    if (at >= 0) out.push(`announcement ${at + 1} the window asks for is ${quoted(got[at]!)}, the replica's is ${quoted(want[at]!)}`);
  }
  return out.length ? [...out, `the window asked for ${show(got, 1500)}; the replica announces ${show(want, 1500)}`] : [];
}

/**
 * When each announcement of `want` that `got` lacks could have come: from the one heard before it to the one heard after
 * it, or the listening's start and end. Null unless `got` is `want` with some of it missing and nothing else changed,
 * which is all a window nothing redraws can do to what it would have said.
 */
function missing(want: readonly string[], got: readonly string[], at: readonly number[], end: number): Stretch[] | null {
  const out: Stretch[] = [];
  let k = 0;
  for (const t of want) {
    if (got[k] === t) k++;
    else out.push([k > 0 ? at[k - 1]! : 0, k < got.length ? at[k]! : end]);
  }
  return k === got.length ? out : null;
}

/**
 * Criterion 8 of one live read. BLOCKED, naming where it stopped, when the platform couldn't be read: the screen locked
 * or the display asleep at any sample, no window listed, or no element of it identified as any of the document's items
 * (`ids`). Else FAIL unless every element identified as the item gives the replica's value, white space collapsed, as
 * its AXValue, AXDescription or AXTitle, and the announcements are the replica's: the same texts, as many times each,
 * in the same order. When announcements are only missing, and each could have come while nothing redrew the window (it
 * was off the screen, or wholly behind others), that is BLOCKED too: its silence says nothing of what it would have said
 * shown. One missing while it was shown throughout, said too often, out of order or not the replica's is a FAIL.
 */
export function judge(replica: Replica, live: Live, ids: readonly string[]): Judged {
  const screen = screenProblem(live);
  if (screen) return { verdict: 'BLOCKED', why: [`while the window was read, ${screen}`] };
  if (!live.listed) return { verdict: 'BLOCKED', why: [`AppKit listed no window of the process within ${LISTED_WITHIN / 1000} s of its answer`] };
  const ours = live.elements.filter((e) => ids.includes(e.identifier));
  if (!ours.length) {
    return { verdict: 'BLOCKED', why: [`the window lists, but no element in its tree carries the identifier of an item of the document (${ids.join(', ')}); the identifiers it holds: ${live.elements.map((e) => e.identifier).join(', ') || 'none'}`] };
  }
  const why: string[] = [];
  const nodes = ours.filter((e) => e.identifier === replica.id);
  if (!nodes.length) why.push(`the live tree holds no element identified ${replica.id}; it identifies ${ours.map((e) => e.identifier).join(', ')}`);
  for (const n of nodes) {
    const texts = [n.value, n.description, n.title].map((t) => (t === null ? null : collapse(t)));
    if (!texts.includes(collapse(replica.value))) {
      why.push(`the element identified ${replica.id} gives value ${show(n.value)}, description ${show(n.description)} and title ${show(n.title)}; the replica's node holds the value ${quoted(replica.value)}`);
    }
  }
  const [want, got] = [replica.said.map(collapse), live.said.map(collapse)];
  const said = saidFailures(want, got);
  const gaps = missing(want, got, live.at, live.ms);
  if (gaps?.length && !why.length && gaps.every(([from, to]) => live.hidden.some((h) => h[0] <= to && h[1] >= from))) {
    return { verdict: 'BLOCKED', why: [`the window was off the screen or wholly behind other windows (${show(live.hidden)} ms) whenever an announcement that wasn't heard could have come (${got.length} of ${want.length} heard)`, ...said] };
  }
  why.push(...said);
  return { verdict: why.length ? 'FAIL' : 'PASS', why };
}

// ---------------------------------------------------------------------------------------------------
// The fixture (README): the issue's 12-row scatter, and the walk's calls.

export const SCATTER = 'scatter';
/** The panel's and the page's size: a small window. */
export const PAGE: [number, number] = [480, 270];
/** 12 rows: x in seconds 0 to 11, y in metres 2 to 40, the sixth row missing its y. */
const X = Array.from({ length: 12 }, (_, i) => i);
const Y = [2, 5, 9, 4, 12, Number.NaN, 18, 15, 22, 40, 27, 33];
/** The rows that draw: every one but the missing one. */
export const DRAWN = Y.filter((y) => !Number.isNaN(y)).length;

/** An f64 column in its unit, its bytes little-endian (Mark set and columns: `data`); a NaN is a missing value. */
function f64(values: readonly number[], unit: string): JsonObject {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return { dtype: 'f64', len: values.length, data: b.toString('base64'), unit };
}
const scale = (id: string, name: string, order: string, domain: [number, number], range: [number, number]): JsonObject =>
  ({ id, kind: 'scale@1', name, order, params: { type: 'linear', domain, range, nice: false } });

/** A figure with no control: two scales, the scatter (`role: data`) and a caption, `y` as given (the fixture's unless). */
export function scatterDoc(y: readonly number[] = Y): JsonObject {
  return {
    format: 1, id: 'scatter-3236', profile: 'figure', title: 'Distance over time', description: 'A scatter of distance over time, with a gap where a reading is missing.', size: PAGE,
    items: {
      xs: scale('xs', 'Time scale', 'a0', [0, 12], [32, 448]),
      ys: scale('ys', 'Distance scale', 'a1', [0, 60], [236, 48]),
      [SCATTER]: {
        id: SCATTER, kind: 'marks@1', name: 'Distance over time', role: 'data', order: 'a2',
        params: {
          mark: 'point', n: X.length, columns: { x: f64(X, 'seconds'), y: f64(y, 'metres') },
          encode: { x: { column: 'x', scale: 'xs' }, y: { column: 'y', scale: 'ys' } }, paint: { fill: { role: 'ink' } },
        },
      },
      caption: { id: 'caption', kind: 'text@1', name: 'Caption', role: 'label', order: 'a3', params: { text: 'Distance grows with time', font: 'body', size: 13, box: { w: 240, h: 20 } }, at: { pos: [16, 12, 0] } },
    },
  };
}
/** The items a live element may be identified as: those an assistive client hears. */
export const IDS = [SCATTER, 'caption'] as const;

/** The walk: the document presented, Tab, Right once for each drawn row, then `see`; the index of `see`. */
export function walk(doc: string, document: JsonObject = scatterDoc()): { calls: JsonObject[]; see: number } {
  const s = new Script();
  s.present(doc, document);
  s.scope();
  s.key('Tab');
  for (let k = 0; k < DRAWN; k++) s.key('ArrowRight');
  const see = s.see();
  return { calls: s.calls, see };
}
