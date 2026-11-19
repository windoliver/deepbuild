// Test-side tools for #1498's blind acceptance tests (README). The replica is the real `deep-drive` of #124, built
// from the checkout with `--features env-plants` and copied out of the target folder, driven over its stdin as the
// hub's deep_drive tool drives it, with the calls and fields this suite adds (README, The contract). Nothing here
// stands in for the replica, the app or the canvas core: the documents, the record and a terminal program's output are
// fixtures, and what is judged is what the replica's own clipboard holds after its own ⌘C.
//
// Safety: every process gets HOME and TMPDIR in a folder of its own under /tmp/dd1498-*; a process is stopped only by
// the PID it was started with; nothing reads or writes the system pasteboard; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll } from 'vitest';

export const SUITE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(SUITE, '..', '..', '..');
const FIXTURES = join(SUITE, 'fixtures');
export const RECORD = join(FIXTURES, 'record.events.jsonl');
/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs). */
const FLICKS = 705_600_000;

/** The criteria, `#1498.<first 8 hex of SHA-256(text, trimmed, white space collapsed)>` (scripts/proof-change.mjs). */
export const TAG = {
  ac1: '#1498.6939e51f',
  ac2: '#1498.394750ea',
  ac3: '#1498.01d0c6fd',
  ac4: '#1498.34117c23',
  ac5: '#1498.0cea7471',
  ac6: '#1498.8c09539a',
  ac7: '#1498.cb27fa53',
  ac8: '#1498.26ac74e5',
  ac9: '#1498.0d8043dd',
} as const;

// A reply is loosely typed JSON: each helper checks the fields it reads and throws, naming the field, when one is missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;
export type Point = [number, number];
export type Box = [number, number, number, number];
/** Where an act comes from (README, `act.source`): `hid` stands for your hardware input and carries a gesture serial. */
export type Source = 'hid' | 'synthetic';

// ---- The fixture record (README, Fixtures): seven working sessions, the first with a failed check run.

interface Row { session_id: string; event: Obj }
const ROWS: Row[] = readFileSync(RECORD, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);

export const SESSION = {
  fail: '01DD1498FA0000000000000001',
  note: '01DD1498NT0000000000000002',
  labels: '01DD1498RD0000000000000003',
  map: '01DD1498MP0000000000000004',
  figure: '01DD1498FG0000000000000005',
  build: '01DD1498TM0000000000000006',
  row: '01DD1498QT0000000000000007',
} as const;

function fromRecord(kind: string, session: string, field: string): string {
  const value = ROWS.find((r) => r.session_id === session && r.event.kind === kind)?.event.data?.[field];
  if (typeof value !== 'string') throw Error(`fixtures/record.events.jsonl has no ${kind} with data.${field} for session ${session}`);
  return value;
}
/** The title of the session whose row AC5 drags over: drawn once, in the list, while another session's page shows. */
export const ROW_TITLE = fromRecord('task.created', SESSION.row, 'title');
/** The failed run's failure line, which session `fail`'s page shows. */
export const FAILURE_LINE = fromRecord('run.finished', SESSION.fail, 'actual');

// ---- The documents (README, Fixtures).

export type DocName = 'note' | 'labels' | 'map' | 'figure';
export function doc(name: DocName): Obj {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.doc.json`), 'utf8')) as Obj;
}
/** A text item's source text, as the document holds it. */
export function textOf(document: Obj, item: string): string {
  const text = document.items?.[item]?.params?.text;
  if (typeof text !== 'string') throw Error(`the fixture ${String(document.title)} has no plain text item ${item}`);
  return text;
}
/** Graphemes in `text`. The fixtures' texts hold one code point a grapheme, none astral and no marks, so a grapheme
 * offset, which the caret locator counts, is a string index; each test checks that before it counts. */
export function graphemes(text: string): number {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

// ---- The binary: built once per file, copied out of the target folder.

const BIN_DIR = `/tmp/dd1498-bin-${userInfo().uid}`;
let built: Promise<string> | undefined;
export function driveBinary(): Promise<string> {
  built ??= new Promise((resolve, reject) => {
    const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
    const args = ['build', '--locked', '-q', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'];
    execFile('cargo', args, { cwd: REPO, env, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(Error(`BLOCKED: cargo ${args.join(' ')} failed: ${String(stderr).trim().slice(-2000) || error.message}`));
        return;
      }
      try {
        mkdirSync(BIN_DIR, { recursive: true });
        const out = join(BIN_DIR, 'deep-drive');
        copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-drive'), out);
        resolve(out);
      } catch (e) {
        reject(e as Error);
      }
    });
  });
  return built;
}

const started: Replica[] = [];
const folders: string[] = [];
/** Builds deep-drive before the file's tests (a cold build under load takes most of an hour) and stops every replica
 * the file started, by PID, after them. */
export function useDrive(): void {
  beforeAll(async () => {
    await driveBinary();
  }, 3_600_000);
  afterAll(async () => {
    for (const r of started.splice(0)) await r.stop();
    for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
  }, 60_000);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** This process's environment, less any DEEP_ setting a parent left, so no plant is inherited. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('DEEP_')) env[key] = value;
  return env;
}

const point = (value: unknown, what: string): Point => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number')) throw Error(`${what} is no [x, y]: ${JSON.stringify(value)}`);
  return [value[0] as number, value[1] as number];
};
const box = (value: unknown, what: string): Box => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number')) throw Error(`${what} is no [x, y, w, h]: ${JSON.stringify(value)}`);
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
};
export const center = (b: Box): Point => [Math.round(b[0] + b[2] / 2), Math.round(b[1] + b[3] / 2)];
const inside = (p: Point, b: Box): boolean => p[0] >= b[0] - 1 && p[0] <= b[0] + b[2] + 1 && p[1] >= b[1] - 1 && p[1] <= b[1] + b[3] + 1;

/** One `deep-drive` process holding one replica launched on the fixture record, driven call by call. */
export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock: the `t` of its newest reply, in flicks since launch. */
  private t = 0;

  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Obj;
        try {
          parsed = JSON.parse(line) as Obj;
        } catch {
          parsed = { unparsed: line };
        }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => {
      this.err = (this.err + d).slice(-4000);
    });
    child.on('exit', () => {
      this.exited = true;
      for (const wake of this.waiting.splice(0)) wake({ exited: true });
    });
  }

  /** A fresh replica on the fixture record, honest or with `DEEP_DRIVE_PLANT=<plant>` (README, Planted programs). */
  static async launch(plant?: string): Promise<Replica> {
    if (process.platform !== 'darwin') throw Error('INCONCLUSIVE: the replica renders on macOS only (crates/deep-replica/src/deep_drive.rs); this test never passes elsewhere');
    const bin = await driveBinary();
    const dir = mkdtempSync('/tmp/dd1498-');
    folders.push(dir);
    const out = join(dir, 'out');
    const home = join(dir, 'home');
    mkdirSync(out);
    mkdirSync(home);
    const env: NodeJS.ProcessEnv = { ...cleanEnv(), HOME: home, TMPDIR: dir };
    if (plant) env.DEEP_DRIVE_PLANT = plant;
    const child = spawn(bin, ['--out', out], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const r = new Replica(child);
    started.push(r);
    const ready = await r.next(300_000);
    if (ready.ready !== true) {
      throw Error(`deep-drive didn't start${plant ? ` as the planted replica ${plant} (README, Planted programs)` : ''}: ${JSON.stringify(ready).slice(0, 300)} ${r.err.slice(-600)}`);
    }
    await r.must('launching on the fixture record', { call: 'launch', launch: { from: 'fixture', fixture: RECORD } });
    return r;
  }

  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  /** One call and its reply; BLOCKED when the process gives no JSON line back. */
  async call(args: Obj): Promise<Obj> {
    const reply = this.next(300_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) {
      throw Error(`BLOCKED: deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    }
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }

  /** One call that must answer `ok`; else a failure naming `what` and the replica's error. */
  async must(what: string, args: Obj): Promise<Obj> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: the replica answered ${JSON.stringify(reply.error ?? reply).slice(0, 700)} to ${JSON.stringify(args).slice(0, 300)}`);
    return reply;
  }

  // ---- The replica's own clipboard (README, `clipboard`).

  /** Puts `text` on the replica's own clipboard, as another app's copy would: the marker a later ⌘C replaces or not. */
  async mark(text: string): Promise<void> {
    const r = await this.must('putting a marker on the replica\'s own clipboard (README, clipboard)', { call: 'clipboard', clipboard: { write: text } });
    if (r.clipboard?.text !== text) throw Error(`the clipboard call wrote ${JSON.stringify(text)} but answers ${JSON.stringify(r.clipboard)}`);
  }
  async clipboard(): Promise<string | null> {
    const r = await this.must('reading the replica\'s own clipboard (README, clipboard)', { call: 'clipboard' });
    const text: unknown = r.clipboard?.text;
    if (text !== null && typeof text !== 'string') throw Error(`the clipboard call answers no clipboard.text: ${JSON.stringify(r).slice(0, 300)}`);
    return text;
  }
  /** ⌘C from `source`, then what the replica's clipboard holds once it no longer holds `marker`, or after a second of
   * the replica's clock when it still does. */
  async copy(source: Source, marker: string): Promise<string | null> {
    await this.press('cmd-c', source);
    let text = await this.clipboard();
    for (let i = 0; i < 20 && text === marker; i++) {
      await this.wait(50);
      text = await this.clipboard();
    }
    return text;
  }

  // ---- What the replica's copy of the hub holds (README, `show`, `terminal`, `stored`).

  async show(session: string, document: Obj): Promise<{ doc: string; rev: number; hash: string }> {
    const r = await this.must(`showing "${String(document.title)}" as session ${session}'s deep_show (README, show)`, { call: 'show', show: { session, document } });
    if (typeof r.doc !== 'string' || typeof r.rev !== 'number' || typeof r.hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.hash)) {
      throw Error(`show answers no {doc, rev, hash}: ${JSON.stringify(r).slice(0, 300)}`);
    }
    return { doc: r.doc, rev: r.rev, hash: r.hash };
  }
  /** Session `session`'s terminal: opened at `size` on the first call, its program writing `output`; what the terminal
   * has sent its program since it opened. */
  async terminal(session: string, fields: { size?: [number, number]; output?: string }): Promise<string> {
    const r = await this.must(`session ${session}'s terminal (README, terminal)`, { call: 'terminal', terminal: { session, ...fields } });
    const input: unknown = r.terminal?.input;
    if (typeof input !== 'string') throw Error(`terminal answers no terminal.input: ${JSON.stringify(r).slice(0, 300)}`);
    return input;
  }
  async stored(): Promise<{ events: Obj[]; documents: Obj[] }> {
    const r = await this.must('reading what the replica\'s copy of the hub stores (README, stored)', { call: 'stored' });
    if (!Array.isArray(r.events) || !Array.isArray(r.documents)) throw Error(`stored answers no events and documents lists: ${JSON.stringify(r).slice(0, 300)}`);
    return { events: r.events as Obj[], documents: r.documents as Obj[] };
  }

  // ---- Pages, locating and seeing (#124's surface, and the caret locator).

  async openSession(session: string): Promise<void> {
    const address = `session/${session}`;
    const r = await this.must(`opening ${address}`, { call: 'open', open: { address } });
    if (r.address !== address) throw Error(`opening ${address} shows ${JSON.stringify(r.address)}${r.said ? `: ${String(r.said)}` : ''}`);
  }
  async see(): Promise<Obj> {
    const r = await this.must('see', { call: 'see' });
    if (typeof r.snapshot !== 'object' || r.snapshot === null) throw Error(`see answers no snapshot: ${JSON.stringify(r).slice(0, 300)}`);
    return r;
  }
  async visible(locator: Obj, what: string): Promise<void> {
    await this.must(`waiting for ${what} to draw`, { call: 'wait_for', locator, wait_for: { state: 'visible' }, timeout: 10_000 });
  }
  async probe(locator: Obj, what: string): Promise<{ point: Point; box: Box }> {
    const r = await this.must(`probing ${what}`, { call: 'probe', locator });
    return { point: point(r.point, `probe's point for ${what}`), box: box(r.box, `probe's box for ${what}`) };
  }
  /** Where the caret before grapheme `offset` of text item `item` is drawn (README, the caret locator). */
  async caret(item: string, offset: number): Promise<Point> {
    const whole = (await this.probe({ item }, `the item ${item}`)).box;
    const at = (await this.probe({ item, offset }, `the caret at grapheme ${offset} of ${item}`)).point;
    if (!inside(at, whole)) throw Error(`the caret at grapheme ${offset} of ${item} is at ${JSON.stringify(at)}, outside the item's box ${JSON.stringify(whole)}`);
    return at;
  }
  /** Waits up to `ms` of the replica's clock. */
  async wait(ms: number): Promise<void> {
    await this.must(`waiting ${ms} ms of the replica's clock`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 5_000 });
  }

  // ---- Input. `hid` stands for your hardware input; no source is the replica's synthetic input (README, act.source).

  private act(what: string, act: Obj, source: Source): Promise<Obj> {
    return this.must(what, { call: 'act', act: { ...act, ...(source === 'hid' ? { source: 'hid' } : {}) } });
  }
  async drag(from: Point, to: Point, source: Source, mods: string[] = []): Promise<void> {
    await this.act(`a ${mods.length ? `${mods.join('+')}-` : ''}drag from ${JSON.stringify(from)} to ${JSON.stringify(to)}`, { kind: 'drag', point: from, to_point: to, ...(mods.length ? { mods } : {}) }, source);
  }
  async click(at: Point, source: Source): Promise<void> {
    await this.act(`a click at ${JSON.stringify(at)}`, { kind: 'click', point: at }, source);
  }
  async doubleClick(at: Point, source: Source): Promise<void> {
    await this.act(`a double press at ${JSON.stringify(at)}`, { kind: 'double_click', point: at }, source);
  }
  async hover(at: Point): Promise<void> {
    await this.act(`the pointer to ${JSON.stringify(at)}`, { kind: 'hover', point: at }, 'synthetic');
  }
  async press(keys: string, source: Source): Promise<void> {
    await this.act(`pressing ${keys}`, { kind: 'press', keys }, source);
  }

  async stop(): Promise<void> {
    try {
      this.child.stdin!.end();
    } catch {
      // closed already
    }
    const deadline = Date.now() + 5_000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited && this.child.pid) {
      try {
        process.kill(this.child.pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
  }
}

// ---- Drawn text: a drag over a whole drawn string, from just inside its first glyph to just inside its last.

/** The drawn string `text` (#124's `{text}` locator) and the drag across all of it. */
export async function acrossString(r: Replica, text: string): Promise<{ box: Box; from: Point; to: Point }> {
  const { box: b } = await r.probe({ text }, `the drawn string ${JSON.stringify(text)}`);
  const y = Math.round(b[1] + b[3] / 2);
  return { box: b, from: [b[0] + 1, y], to: [b[0] + b[2] - 1, y] };
}

/** A ⌥-drag across text items of a document, from the caret before grapheme `from` of `first` to the one before
 * grapheme `to` of `last`. */
export async function carets(r: Replica, first: string, from: number, last: string, to: number): Promise<{ from: Point; to: Point }> {
  return { from: await r.caret(first, from), to: await r.caret(last, to) };
}

// ---- The cell grid of a session's Terminal tab.

/** Opens the session's Terminal tab with your click on its button and waits for its cell grid to draw. */
export async function openTerminalTab(r: Replica): Promise<void> {
  const button = await r.probe({ role: 'button', name: 'Terminal' }, 'the session page\'s Terminal button');
  await r.click(button.point, 'hid');
  for (let i = 0; i < 40; i++) {
    if (await gridId(r)) return;
    await r.wait(50);
  }
  throw Error('the Terminal tab drew no cells@1 item within 2 s of the replica\'s clock after its button was clicked');
}
/** The ID of the one cells@1 item the frame drew (#402's grid records `kind: "cells@1"`), or null. */
export async function gridId(r: Replica): Promise<string | null> {
  const items = ((await r.see()).snapshot.items ?? []) as Obj[];
  const grids = items.filter((i) => i?.value?.kind === 'cells@1');
  if (grids.length > 1) throw Error(`the frame drew ${grids.length} cells@1 items: ${grids.map((g) => String(g.id)).join(', ')}`);
  return grids.length ? String(grids[0]!.id) : null;
}
/** The rows the grid draws now, as its item's value lists them. */
export async function gridRows(r: Replica): Promise<string[]> {
  const items = ((await r.see()).snapshot.items ?? []) as Obj[];
  const rows: unknown = items.find((i) => i?.value?.kind === 'cells@1')?.value?.text;
  if (!Array.isArray(rows)) throw Error('the cells@1 item has no text rows');
  return rows.map(String);
}
/** Waits until the grid's row `row` reads `text` (the tab reads its grid again every 250 ms). */
export async function gridShows(r: Replica, row: number, text: string): Promise<void> {
  let rows: string[] = [];
  for (let i = 0; i < 40; i++) {
    rows = await gridRows(r);
    if (rows[row]?.trimEnd() === text) return;
    await r.wait(50);
  }
  throw Error(`the grid's row ${row} never read ${JSON.stringify(text)}; its rows: ${JSON.stringify(rows)}`);
}
/** Where cell `col`, `row` of a `cols` × `rows` grid is: a quarter of a cell in from its left edge (`at: "start"`) or
 * three quarters (`at: "end"`), half way down, so a drag between two such points covers both cells under every rule of
 * which cell a point picks. The grid's item box is its cells, edge to edge (crates/deep-app/src/cells.rs). */
export async function cellPoint(r: Replica, size: [number, number], col: number, row: number, at: 'start' | 'end'): Promise<Point> {
  const id = await gridId(r);
  if (!id) throw Error('no cell grid is drawn');
  const b = (await r.probe({ item: id }, 'the cell grid')).box;
  const [w, h] = [b[2] / size[0], b[3] / size[1]];
  return [Math.round(b[0] + (col + (at === 'start' ? 0.25 : 0.75)) * w), Math.round(b[1] + (row + 0.5) * h)];
}

// ---- Judges. Each returns null, or the failure in words.

/** Where `copied` first differs from `expected`, in string offsets (graphemes, for the fixtures' texts); null when equal. */
export function firstDifference(expected: string, copied: string): number | null {
  if (expected === copied) return null;
  let i = 0;
  while (i < expected.length && i < copied.length && expected[i] === copied[i]) i++;
  return i;
}
/** What's wrong with a copy that should be `expected`, the source text in logical order; it names the first offset where
 * the clipboard differs, and that offset in the text item's source when `sourceAt` gives where the copy starts there. */
export function copyFailure(what: string, expected: string, copied: string | null, sourceAt?: number): string | null {
  if (copied === null) return `${what}: the clipboard holds no text; expected ${JSON.stringify(expected)}`;
  const at = firstDifference(expected, copied);
  if (at === null) return null;
  const source = sourceAt === undefined ? '' : ` (offset ${sourceAt + at} of the item's source text)`;
  return `${what}: the clipboard differs from the source text in logical order at offset ${at}${source}: expected ${JSON.stringify(expected.slice(at, at + 16))}, got ${JSON.stringify(copied.slice(at, at + 16))}; whole copy ${JSON.stringify(copied)}, expected ${JSON.stringify(expected)}`;
}
/** What's wrong when a ⌘C that should write nothing replaced the marker. */
export function wroteFailure(what: string, marker: string, copied: string | null): string | null {
  return copied === marker ? null : `${what}: the clipboard holds ${JSON.stringify(copied)}, not the marker ${JSON.stringify(marker)} put there before`;
}
/** The first path where two JSON values differ, or null. */
export function jsonDifference(a: unknown, b: unknown, at = ''): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at || '/'} has ${a.length} entries, then ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = jsonDifference(a[i], b[i], `${at}/${i}`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const d = jsonDifference((a as Obj)[key], (b as Obj)[key], `${at}/${key}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at || '/'} was ${JSON.stringify(a)?.slice(0, 200)}, then ${JSON.stringify(b)?.slice(0, 200)}`;
}
/** JSON text with every object's keys sorted, and its SHA-256. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Obj)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
