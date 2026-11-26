// Test-side tools for #3234 (README). Every world is a record a real hub made: sessions, taste asks pinned to an
// evidence manifest of their pictures, and the events a criterion names, seeded through the record and the asks core
// with the hub stopped (#26's `seed`), the pictures put in the hub's evidence store through its public entry
// (`@deepbuild/evidence`), then `deep hub run`. The window is the real `deep-drive` (#124) launched in the world's HOME
// with `launch.from: "record_copy"`, so the app reads the pictures from that HOME's evidence store and the record from
// that hub, on its virtual clock, at the reference window.
//
// Reused by import: #16's homes, hub, socket, `deep` and PID cleanup; #26's seeding; #1463's `quiet`; #1461's snapshot
// readers and builds check; #1808's `deep-drive` client (its JSON-lines protocol), spawned here on #1101's build of
// `deep-drive` (keyed to this checkout, built once per source change, in a grant of the build throttle); #1101's signed
// app connection (`asApp`) that carries what the app sent its hub to the real hub, and its plant listing (`hubLists`).
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { allEvents, childEnv, control, deep, makeHome, newSession, own, REPO, sha256, startHub, tempDir, type Ev, type Hub } from '../16/helpers.ts';
import { seed, ulid, type Seeding } from '../26/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import { byId, cleanup, flat, FLICKS, needBuilds, runsIn, type Snapshot, type SNode } from '../1461/helpers.ts';
import { Replica } from '../1808/helpers.ts';
import { asApp, driveBin, hubLists, type World as AppWorld } from '../1101/helpers.ts';

export { byId, cleanup, deep, hubLists, REPO, sha256, tempDir, type Snapshot };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MIN = 60_000;
const DAY = 86_400_000;
export type Line = Record<string, any>;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

/** The criteria, by `#3234.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  fold: '#3234.3085aabe',
  small: '#3234.09622499',
  back: '#3234.c875f23b',
  record: '#3234.38958545',
  terminal: '#3234.660ee1b4',
  replaced: '#3234.23f156f5',
  batch: '#3234.5392d306',
  week: '#3234.432669e1',
  run: '#3234.f499fe58',
  budgets: '#3234.d6a29dc6',
  shown: '#3234.b4cd2f05',
} as const;

/** The planted wrong programs (README, Plants), each selected by DEEP_HUB_PLANT=<name>. */
export const PLANT = {
  /** AC1 (app): the accepting option arms on the interval alone, whatever pictures were shown. */
  armsAtPresentation: 'arms-at-presentation',
  /** AC2 (app): a picture counts as shown once drawn whole inside the window, at any size. */
  countsSmallDraw: 'counts-small-draw',
  /** AC3 (app): Send back is held like the accepting option: a press on it while a picture is left sends nothing. */
  refusesSendBack: 'refuses-send-back',
  /** AC4 (app): the answer's per-picture entries mark every picture shown. */
  marksAllShown: 'marks-all-shown',
  /** AC5 (hub and app): an answer given where nothing is drawn reads on each surface as an answer from the card does. */
  unseenReadsAsCard: 'unseen-reads-as-card',
  /** AC7 (app): once one row of a batched taste card arms, every row arms. */
  armsEveryRow: 'arms-every-row',
  /** AC8 (hub): Numbers counts every accepted taste call as seen. */
  foldsSeenUnseen: 'folds-seen-unseen',
  /** AC9 (hub): the run's reading gives the whole run's median for both of its halves. */
  oneMedianPerRun: 'one-median-per-run',
} as const;

/** The reference window, in points, at 2× (`deep_replica::WINDOW`, `SCALE`). */
export const WINDOW = { width: 1512, height: 982, scale: 2 } as const;
/** `arm_after` (design: Question card). */
export const ARM_AFTER_MS = 500;
/** A taste call's two options (README, The fixtures): the recommended one accepts, the other sends the work back. */
export const ACCEPT = 'looks-right';
export const BACK = 'send-back';
/** The issue's words for what's left, pinned (README, Pinned 3): `<left> of <all> not shown yet`. */
export const LEFT = /(\d+) of (\d+) not shown yet/;
/** The issue's words for an answer given where nothing is drawn. */
export const UNSEEN = 'answered unseen';

// ---- Pictures (README, Pinned 1): PNGs in the hub's evidence store, listed by hash in a manifest the ask is pinned to.

export interface Picture { sha: string; size: [number, number] }
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
let painted = 0;
/** An opaque 8-bit RGBA PNG, `w × h` pixels: its top half one colour and its bottom half another, a pair no other picture of this process has. */
export function png(w: number, h: number): Buffer {
  const n = ++painted;
  const top = [(n * 67) % 256, (n * 131 + 40) % 256, (n * 29 + 90) % 256, 255];
  const bottom = [(n * 23 + 160) % 256, (n * 97) % 256, (n * 53 + 20) % 256, 255];
  const line = (c: number[]): Buffer => { const b = Buffer.alloc(w * 4 + 1); for (let x = 0; x < w; x++) Buffer.from(c).copy(b, 1 + x * 4); return b; };
  const [a, b] = [line(top), line(bottom)];
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => (y < h / 2 ? a : b)));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** The manifest a taste ask is pinned to (README, Pinned 1), as its bytes. */
export const manifestOf = (pictures: readonly Picture[]): Buffer => Buffer.from(JSON.stringify({ pictures: pictures.map((p) => ({ sha256: p.sha, size: p.size })) }));
type Put = (bytes: Buffer, kind: string) => Promise<string>;
async function evidenceOf(home: string): Promise<Put> {
  const store = await openEvidenceStore({ root: join(home, '.deepbuild', 'evidence') });
  const writer = store.connect({ role: 'deepbuild', via: 'render' });
  return async (bytes, kind) => {
    const r = await writer.put({ bytes, kind, source: 'tests/acceptance/3234', redaction: 'complete', license: { name: 'test fixture', allows: [] } });
    return r.status === 'stored' ? r.evidence.sha256 : blocked(`the evidence store refused a fixture ${kind}: ${r.reason}`);
  };
}

// ---- The worlds (README, The fixtures).

export interface AskSpec {
  key: string;
  question: string;
  /** Each picture's size in pixels, in the order the manifest lists them. */
  pictures: [number, number][];
  /** More pictures put in the store beside the ask's own (AC6's replacement), listed by no manifest yet. */
  spare?: [number, number][];
}
export interface SessionSpec {
  key: string;
  title: string;
  asks?: AskSpec[];
  /** A claim on the session's task whose verdict holds a person's requirement on its first ask (AC5, AC11). */
  claim?: true;
}
export interface Ask { key: string; handle: string; session: string; question: string; manifest: string; pictures: Picture[]; spare: Picture[] }
export interface World {
  home: string;
  hub: Hub;
  sessions: Map<string, string>;
  asks: Map<string, Ask>;
  put: Put;
  /** #1101's signed app connection keeps its paired device and test.clock steps here. */
  device?: unknown;
  stepped: number;
}
export const ulidNow = (): string => ulid(Date.now());
export const askOf = (w: World, key: string): Ask => w.asks.get(key) ?? blocked(`the world has no ask ${key}`);
export const sessionOf = (w: World, key: string): string => w.sessions.get(key) ?? blocked(`the world has no session ${key}`);

/** A taste call as `ask.created@1` data: its two options, the accepting one recommended and the default, pinned to its manifest. */
export const tasteData = (question: string, manifest: string, now: number): Line => ({
  kind: 'taste', question,
  options: [{ id: ACCEPT, label: 'Looks right', decision: 'none' }, { id: BACK, label: 'Send back', decision: 'none' }],
  recommended: ACCEPT, deadline: now + 3 * DAY, fallback: 'you', default: ACCEPT, provisional: false, owner: 'you',
  key: sha256(`taste:${question}`), pinned_to: { kind: 'evidence', ref: manifest },
});
/** git's environment for a scratch folder: none of this process's GIT_* variables, so git never reaches a worktree's repository. */
export const GIT_ENV = (home: string): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
export const core = (session: string): Line => ({ writer: 'core', actor: 'you', scope: 'you', session, project: 'shop' });

/**
 * Seeds `specs` in order, a minute apart, the last a few minutes before now: each session's start in `<base>/shop` (a
 * git folder), its task, its asks raised by the asks core over the core's connection as `deep_ask.taste`, each pinned
 * to the manifest of its pictures in the evidence store; a claim and its verdict where asked; then `more` (the
 * fixture's own events); then setup finished and a real hub on its test clock (DEEP_HUB_TEST_CLOCK_STEPS, which
 * #1101's signed app connection reads), with the OS confirming you (DEEP_HUB_TEST_CONFIRM), given `plant`.
 */
export async function makeWorld(specs: readonly SessionSpec[], o: { plant?: string; more?: (s: Seeding, w: World) => Promise<void> } = {}): Promise<World> {
  needBuilds();
  const home = makeHome();
  const base = tempDir();
  const dir = join(base, 'shop');
  mkdirSync(dir, { recursive: true });
  await new Promise<void>((resolve, reject) => execFile('git', ['init', '-q'], { cwd: dir, env: GIT_ENV(dir) }, (e) => (e ? reject(e) : resolve())));
  const put = await evidenceOf(home);
  const w: World = { home, hub: undefined as unknown as Hub, sessions: new Map(), asks: new Map(), put, stepped: 0 };
  const first = Date.now() - (specs.length + 5) * MIN;
  await seed(home, async (s) => {
    for (const [i, spec] of specs.entries()) {
      const at = first + i * MIN;
      const id = newSession(home, 'claude-code', dir).id;
      w.sessions.set(spec.key, id);
      s.at(at);
      await s.start(id, dir);
      const task = `task:${ulid(at)}`;
      await s.record.append({ writer: 'app', actor: 'you', scope: 'you', session: id, project: 'shop' } as never, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: task, thread: id, owner: 'you', title: spec.title } } as never);
      for (const [k, a] of (spec.asks ?? []).entries()) {
        const pictures: Picture[] = [];
        for (const size of a.pictures) pictures.push({ sha: await put(png(size[0], size[1]), 'screenshot'), size });
        const spare: Picture[] = [];
        for (const size of a.spare ?? []) spare.push({ sha: await put(png(size[0], size[1]), 'screenshot'), size });
        const manifest = await put(manifestOf(pictures), 'taste.pictures');
        s.at(at + 2000 + k * 1000);
        const handle = await s.asks.raise(core(id) as never, 'deep_ask.taste', tasteData(a.question, manifest, s.now()));
        w.asks.set(a.key, { key: a.key, handle, session: id, question: a.question, manifest, pictures, spare });
      }
      if (spec.claim) {
        const ask = w.asks.get(spec.asks?.[0]?.key ?? '') ?? blocked(`${spec.key}'s claim names a call it doesn't have`);
        s.at(at + 30_000);
        const claim = ulid(s.now());
        const commit = sha256(`commit:${spec.key}`).slice(0, 40);
        await s.record.append(core(id) as never, { v: 2, id: claim, kind: 'claim.made', ts: s.now(), data: { task_ref: task, attempt: 1, commit, scope: 'session', predictions: [] } } as never);
        s.at(at + 31_000);
        const requirement = {
          req: `req:${claim}#R1`, outcome: 'pending', check: 'taste', depth: 'journey', oracle: 'person', runs: { clean: 0, needed: 0, counted: [] },
          smallest: null, points_to: null, evidence: [ask.manifest], proof: 'decision', ask: ask.handle,
        };
        await s.record.append(core(id) as never, {
          v: 2, id: ulid(s.now()), kind: 'verdict.made', ts: s.now(),
          data: { outcome: 'INCONCLUSIVE', verdict: `verdict:${ulid(s.now())}`, claim: `claim:${claim}`, reasons: [], requirements: [requirement], smallest: null, points_to: null, commit, key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'tests/acceptance/3234', tools: [] } },
        } as never);
      }
    }
    if (o.more) await o.more(s, w);
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  w.hub = await startHub({ home, clock: Date.now(), env: { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_PLANT: o.plant } }, 10 * MIN);
  await quiet(w.hub);
  return w;
}

export async function eventsOf(w: World): Promise<Ev[]> {
  const conn = await control(w.hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
/** The `ask.answered` events the hub recorded for an ask. */
export const answersOf = (all: readonly Ev[], handle: string): Ev[] => all.filter((e) => e.kind === 'ask.answered' && e.subject === handle);
/** What the app sent its hub, signed as the app signs it, to the real hub (#1101's `asApp`): its refusal, or undefined. */
export async function forward(w: World, params: Line): Promise<string | undefined> {
  const reply = await asApp(w as unknown as AppWorld, 'ask.answer', params);
  return reply.error ? said(reply.error, 600) : undefined;
}

// ---- The replica (README, Pinned 2): #1808's client on #1101's build, in the world's HOME, at the reference window.

/** One replica on a copy of the world's record, opened where the app opens, at the reference window; `plant` its DEEP_HUB_PLANT. */
export async function replicaOf(w: World, o: { plant?: string; dirty?: boolean; bin?: string } = {}): Promise<Replica> {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  const bin = o.bin ?? await driveBin(o.plant !== undefined);
  const dir = tempDir();
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const confirm = join(dir, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(w.home, { DEEP_HUB_PLANT: o.plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  // #1808's client, given this process; its first line is deep-drive's ready line.
  const r = new (Replica as unknown as new (c: ChildProcess) => Replica)(child);
  const ready = await (r as unknown as { next(ms: number): Promise<Line> }).next(600_000);
  if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)}`);
  await r.launch({ from: 'record_copy', size: [WINDOW.width, WINDOW.height], ...(o.dirty ? { frames: 'dirty', read_back: 'off' } : {}) });
  return r;
}
export type { Replica };
/** The replica's clock, in ms since its launch. */
export const msOf = (r: Replica): number => (r.t * 1000) / FLICKS;
/** A press as your hardware makes it (`act` click, `source: "hid"`). */
export const press = (r: Replica, locator: Line, what: string): Promise<Line> => r.must(what, { call: 'act', locator, act: { kind: 'click', source: 'hid' } });
/** Words typed where the keyboard is: on a presented card, its answer field (design: Question card). */
export const typeWords = (r: Replica, text: string): Promise<Line> => r.must(`typing "${text}"`, { call: 'act', act: { kind: 'type', text } });
/** `see`, with what the app sent its hub since launch. */
export async function look(r: Replica): Promise<{ s: Snapshot; hub: Line[]; t: number }> {
  const seen = await r.see();
  return { s: seen.snapshot, hub: seen.hub as Line[], t: msOf(r) };
}
/** The answers the app sent its hub for an ask (`ask.answer`'s params, unsigned: the app signs them on the way out). */
export const sent = (hub: readonly Line[], handle: string): Line[] => hub.filter((c) => c.method === 'ask.answer' && c.params?.ask === handle).map((c) => c.params as Line);

// ---- Reading the window (README, Pinned 2 and 3). Bounds are [x, y, w, h] in device pixels.

const windowBox = (s: Snapshot): number[] => [0, 0, s.window.size[0]! * s.window.scale, s.window.size[1]! * s.window.scale];
const within = (b: number[], box: number[]): boolean => b[2]! > 0 && b[3]! > 0 && b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
/** A picture as one snapshot draws it: whole inside the window or not, and its largest scale there (whole draws first). */
export interface Drawn { whole: boolean; scale: number; bounds: number[] }
/**
 * Each of `pictures` the snapshot draws: the nodes whose id is `picture:<sha256>`, the largest whole draw of each. Whole
 * is inside the window and inside each enclosing node with a size, as a scroll area's view, so a picture cut at its
 * area's edge, though inside the window, isn't drawn whole.
 */
export function drawnIn(s: Snapshot, pictures: readonly Picture[]): Map<string, Drawn> {
  const out = new Map<string, Drawn>();
  const walk = (n: SNode, clips: number[][]): void => {
    const sha = typeof n.id === 'string' && n.id.startsWith('picture:') ? n.id.slice('picture:'.length) : undefined;
    const p = sha ? pictures.find((x) => x.sha === sha) : undefined;
    if (p) {
      const d: Drawn = { whole: clips.every((c) => within(n.bounds, c)), scale: n.bounds[2]! / p.size[0], bounds: n.bounds };
      const had = out.get(p.sha);
      if (!had || (d.whole && (!had.whole || d.scale > had.scale)) || (!had.whole && !d.whole && d.scale > had.scale)) out.set(p.sha, d);
    }
    const inner = n.bounds[2]! > 0 && n.bounds[3]! > 0 ? [...clips, n.bounds] : clips;
    for (const c of n.children ?? []) walk(c, inner);
  };
  walk(s.tree, [windowBox(s)]);
  return out;
}
/** A node's words: its own and its descendants' names and string values, and the strings drawn inside its bounds. */
export function wordsOf(s: Snapshot, n: SNode | undefined): string {
  if (!n) return '';
  const own = flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : '']);
  return [...own, ...runsIn(s, n.bounds).map((r) => r.text)].filter(Boolean).join('\n');
}
/** Every name, string value and drawn string in the window. */
export const windowWords = (s: Snapshot): string => wordsOf(s, s.tree) + '\n' + (s.runs ?? []).map((r) => r.text).join('\n');
/** An option's node on the card, `card-option:<id>` (#1462). */
export const optionOf = (s: Snapshot, id: string): SNode | undefined => byId(s, `card-option:${id}`);
/** Armed: the node's value is `armed` (README, Pinned 3). */
export const isArmed = (n: SNode | undefined): boolean => n?.value === 'armed';
/** What's left, as the option says it: `[left, all]`, or undefined when it says no count. */
export function leftOf(s: Snapshot, n: SNode | undefined): [number, number] | undefined {
  const m = LEFT.exec(wordsOf(s, n));
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}
const short = (sha: string): string => sha.slice(0, 12);
export const named = (shas: readonly string[]): string => shas.map(short).join(', ');

// ---- The replica's trace of what was drawn (README, Readings 2): samples on the virtual clock, read as intervals.

/**
 * Snapshots at known times on the replica's clock. Between two samples only one thing happens (a wait, one scroll, a
 * press), so a picture drawn whole at both ends was drawn whole between them; at one end only, for part of it; at
 * neither, not at all. A picture is surely shown once a run of samples draws it whole at half its size or more over
 * at least the arming interval.
 */
export class Trace {
  readonly samples: { t: number; drawn: Map<string, Drawn> }[] = [];
  constructor(readonly pictures: readonly Picture[]) {}
  add(t: number, s: Snapshot): Map<string, Drawn> {
    const drawn = drawnIn(s, this.pictures);
    this.samples.push({ t, drawn });
    return drawn;
  }
  private whole(i: number, sha: string, half = false): boolean {
    const d = this.samples[i]?.drawn.get(sha);
    return !!d && d.whole && (!half || d.scale >= 0.5);
  }
  /** Surely shown by now: whole at half its size or more across samples at least `ARM_AFTER_MS` apart, unbroken. */
  shown(sha: string): boolean {
    let from: number | undefined;
    for (const [i, x] of this.samples.entries()) {
      if (!this.whole(i, sha, true)) { from = undefined; continue; }
      from ??= x.t;
      if (x.t - from >= ARM_AFTER_MS) return true;
    }
    return false;
  }
  /** Never drawn whole inside the window in any sample. */
  never(sha: string): boolean { return this.samples.every((_, i) => !this.whole(i, sha)); }
  /** Never drawn whole at half its size or more in any sample. */
  neverHalf(sha: string): boolean { return this.samples.every((_, i) => !this.whole(i, sha, true)); }
  /** The largest scale a sample draws it whole at; 0 when none does. */
  scale(sha: string): number { return Math.max(0, ...this.samples.map((x) => (x.drawn.get(sha)?.whole ? x.drawn.get(sha)!.scale : 0))); }
  /**
   * The ms it was drawn whole inside the window, as bounds from the samples, up to an answer pressed between `end.from`
   * and `end.to`: sure where both ends of an interval draw it whole, possible where one does.
   */
  ms(sha: string, end?: { from: number; to: number }): { lo: number; hi: number } {
    let lo = 0;
    let hi = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const [a, b] = [this.whole(i - 1, sha), this.whole(i, sha)];
      const dt = this.samples[i]!.t - this.samples[i - 1]!.t;
      if (a && b) { lo += dt; hi += dt; } else if (a || b) hi += dt;
    }
    const last = this.samples.length - 1;
    if (end && last >= 0 && this.whole(last, sha)) { lo += end.from - this.samples[last]!.t; hi += end.to - this.samples[last]!.t; }
    return { lo, hi };
  }
}

/** How far one wheel turn moves the evidence, in points: a small step, so a picture comes whole into view before the next does. */
const STEP_PT = 100;
/**
 * The wheel over the evidence until `done` holds: each turn `STEP_PT` toward the end, over the drawn picture nearest the
 * window's middle, sampled after it; when a turn brings a picture whole into view that isn't shown yet, the arming
 * interval and a little more pass with no input, sampled after. `between` reads each sample. Stops when a turn moves
 * nothing.
 */
export async function scrollPictures(r: Replica, trace: Trace, done: () => boolean, between: (s: Snapshot) => void = () => undefined): Promise<Snapshot> {
  let { s } = await look(r);
  let before = '';
  for (let turn = 0; turn < 80 && !done(); turn++) {
    const drawn = [...drawnIn(s, trace.pictures).entries()];
    const key = drawn.map(([sha, d]) => `${sha}@${d.bounds[1]}`).join(' ');
    if (!drawn.length || key === before) break;
    before = key;
    const middle = (s.window.size[1]! * s.window.scale) / 2;
    const [sha] = drawn.sort((a, b) => Math.abs(a[1].bounds[1]! + a[1].bounds[3]! / 2 - middle) - Math.abs(b[1].bounds[1]! + b[1].bounds[3]! / 2 - middle))[0]!;
    await r.scroll({ id: `picture:${sha}` }, STEP_PT);
    let x = await look(r);
    const now = trace.add(x.t, x.s);
    between(x.s);
    if ([...now.entries()].some(([p, d]) => d.whole && d.scale >= 0.5 && !trace.shown(p))) {
      await r.wait(ARM_AFTER_MS + 200);
      x = await look(r);
      trace.add(x.t, x.s);
      between(x.s);
    }
    s = x.s;
  }
  return s;
}

// ---- The surfaces an answer is read on (README, Pinned 5 and 6).

/**
 * The verdict line of a session's newest claim (#83), as `deep status` prints it under the session's row: the `verdict`
 * of the session's row the hub's `status.read` gives.
 */
export async function verdictLine(w: World, session: string): Promise<{ line: string | undefined; raw: string }> {
  const conn = await control(w.hub);
  try {
    const reply = await conn.call('status.read', {}, 120_000);
    if (reply.error) blocked(`status.read was refused: ${said(reply.error)}`);
    const row = ((reply.result?.rows ?? []) as Line[]).find((x) => x.id === session);
    return { line: typeof row?.verdict === 'string' ? row.verdict : undefined, raw: said(row ?? null, 1200) };
  } finally {
    conn.close();
  }
}
/** `deep numbers --json`'s rows (#45). */
export async function numbersRows(w: World): Promise<Line[]> {
  const r = await deep(w.home, ['numbers', '--json']);
  let parsed: Line | undefined;
  try { parsed = JSON.parse(r.stdout) as Line; } catch { parsed = undefined; }
  if (r.code !== 0 || !Array.isArray(parsed?.rows)) blocked(`deep numbers --json didn't answer with its rows: exit ${r.code}, ${r.stdout.slice(0, 300)} ${r.stderr.slice(-400)}`);
  return parsed!.rows as Line[];
}
/** The answer's per-picture entries as the record holds them, or undefined when it holds none (README, Pinned 4). */
export const entriesOf = (e: Ev | undefined): Line[] | undefined => (Array.isArray(e?.data?.pictures) ? (e!.data.pictures as Line[]) : undefined);

/** Opens an ask's page and waits on the replica's clock, up to 3 s, until it draws one of `pictures`: the trace's first sample. */
export async function openOn(r: Replica, handle: string, trace: Trace): Promise<{ s: Snapshot; hub: Line[]; t: number }> {
  await r.open(`ask/${handle.slice('ask:'.length)}`);
  let x = await look(r);
  for (let waited = 0; waited < 3000 && drawnIn(x.s, trace.pictures).size === 0; waited += 100) {
    await r.wait(100);
    x = await look(r);
  }
  trace.add(x.t, x.s);
  return x;
}
/** Waits on the replica's clock, up to `ms`, until `ready` holds of the window; the last look. */
export async function waitFor(r: Replica, ready: (s: Snapshot) => boolean, ms = 3000, step = 250): Promise<{ s: Snapshot; hub: Line[]; t: number }> {
  let x = await look(r);
  for (let waited = 0; waited < ms && !ready(x.s); waited += step) {
    await r.wait(step);
    x = await look(r);
  }
  return x;
}
