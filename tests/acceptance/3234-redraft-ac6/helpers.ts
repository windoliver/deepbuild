// Test-side tools for the blind redraft of #3234's AC6 (README). Copied and trimmed from the first draft's
// tests/acceptance/3234/helpers.ts, never imported from it. One change of substance: the taste ask is pinned to a
// document revision, `{kind: "doc_revision", ref: "doc:<id>@<rev>"}`, whose canonical document (in the evidence store
// under `doc.patched`'s `hash`) lists the pictures as the first draft's manifest does, so the pictures can move by the
// document's own catalogued event, `doc.patched`, and no new `ask.*` kind is needed (README, The event).
//
// The world is a record a real hub made: a session, its task, the document's first revision as `doc.patched@2` from
// the agent's connection, the taste ask raised by the asks core as `deep_ask.taste`, seeded with the hub stopped
// (#26's `seed`), the pictures put in the hub's evidence store through its public entry (`@deepbuild/evidence`), then
// `deep hub run`. The window is the real `deep-drive` (#124) launched in the world's HOME with `launch.from:
// "record_copy"`, on its virtual clock, at the reference window.
//
// Reused by import: #16's homes, hub and PID cleanup; #26's seeding; #1463's `quiet`; #1461's snapshot readers and
// builds check; #1808's `deep-drive` client; #1101's build of `deep-drive`.
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { childEnv, makeHome, newSession, own, REPO, sha256, startHub, tempDir, type Hub } from '../16/helpers.ts';
import { seed, ulid, type Seeding } from '../26/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import { byId, cleanup, flat, FLICKS, needBuilds, runsIn, type Snapshot, type SNode } from '../1461/helpers.ts';
import { Replica } from '../1808/helpers.ts';
import { driveBin } from '../1101/helpers.ts';

export { cleanup, type Snapshot };
export const MIN = 60_000;
const DAY = 86_400_000;
export type Line = Record<string, any>;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

/** The criterion, by `#3234.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = { replaced: '#3234.23f156f5' } as const;

/** The reference window, in points, at 2× (`deep_replica::WINDOW`, `SCALE`). */
export const WINDOW = { width: 1512, height: 982, scale: 2 } as const;
/** `arm_after` (design: Question card). */
export const ARM_AFTER_MS = 500;
/** A taste call's two options: the recommended one accepts, the other sends the work back. */
export const ACCEPT = 'looks-right';
export const BACK = 'send-back';
/** The first draft's words for what's left, pinned (its README, Surfaces 3): `<left> of <all> not shown yet`. */
export const LEFT = /(\d+) of (\d+) not shown yet/;

// ---- Pictures: PNGs in the hub's evidence store, listed by hash in the document revision the ask is pinned to.

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
/**
 * A revision's canonical document (README, Readings 1): the first draft's manifest, `{"pictures": [{"sha256", "size"}, …]}`,
 * in the order the pictures are listed. Its keys are already in RFC 8785 order and its numbers integers, so these are its
 * canonical bytes.
 */
export const documentOf = (pictures: readonly Picture[]): Buffer => Buffer.from(JSON.stringify({ pictures: pictures.map((p) => ({ sha256: p.sha, size: p.size })) }));
type Put = (bytes: Buffer, kind: string) => Promise<string>;
async function evidenceOf(home: string): Promise<Put> {
  const store = await openEvidenceStore({ root: join(home, '.deepbuild', 'evidence') });
  const writer = store.connect({ role: 'deepbuild', via: 'render' });
  return async (bytes, kind) => {
    const r = await writer.put({ bytes, kind, source: 'tests/acceptance/3234-redraft-ac6', redaction: 'complete', license: { name: 'test fixture', allows: [] } });
    return r.status === 'stored' ? r.evidence.sha256 : blocked(`the evidence store refused a fixture ${kind}: ${r.reason}`);
  };
}

// ---- The world.

export interface AskSpec {
  key: string;
  question: string;
  /** Each picture's size in pixels, in the order the document lists them. */
  pictures: [number, number][];
  /** More pictures put in the store beside the ask's own (the replacement), listed by no revision yet. */
  spare: [number, number][];
}
export interface Ask {
  key: string; handle: string; session: string; question: string;
  /** The document the ask is pinned to, `doc:<id>`, at revision 1. */
  doc: string;
  pictures: Picture[]; spare: Picture[];
  /** The canonical document of each revision 2 the test may feed: the pictures with the one at index i replaced by the spare. */
  replaced: string[];
}
export interface World { home: string; hub: Hub; asks: Map<string, Ask> }
export const ulidNow = (): string => ulid(Date.now());
export const askOf = (w: World, key: string): Ask => w.asks.get(key) ?? blocked(`the world has no ask ${key}`);

/** A taste call as `ask.created@1` data: its two options, the accepting one recommended and the default, pinned to a document revision. */
export const tasteData = (question: string, revision: string, now: number): Line => ({
  kind: 'taste', question,
  options: [{ id: ACCEPT, label: 'Looks right', decision: 'none' }, { id: BACK, label: 'Send back', decision: 'none' }],
  recommended: ACCEPT, deadline: now + 3 * DAY, fallback: 'you', default: ACCEPT, provisional: false, owner: 'you',
  key: sha256(`taste:${question}`), pinned_to: { kind: 'doc_revision', ref: revision },
});
/** git's environment for a scratch folder: none of this process's GIT_* variables, so git never reaches a worktree's repository. */
const GIT_ENV = (home: string): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
const core = (session: string): Line => ({ writer: 'core', actor: 'you', scope: 'you', session, project: 'shop' });
/** The session's agent's connection, which records a revision its `deep_show` sent (packages/hub/src/hub-canvas.ts at the base). */
const agentOf = (session: string): Line => ({ writer: `mcp:${session}`, actor: 'you', scope: 'you', session, project: 'shop', agent: 'claude-code' });

/**
 * `doc.patched@2` for a whole revision the session's agent sent, as the base's hub records one: subject and `data.doc`
 * the document, `hash` its canonical document's SHA-256 in the evidence store, listed as the event's evidence too.
 * `seed` takes the connection's fields from `agentOf`; a feed adds them (`fedRevision`).
 */
export function revisionEvent(ask: Pick<Ask, 'doc' | 'session'>, rev: number, hash: string, ts: number): Line {
  return {
    v: 2, id: ulid(ts), kind: 'doc.patched', ts, subject: ask.doc, evidence: [hash],
    data: {
      doc: ask.doc, rev, patch: null, writer: 'agent',
      achieved: { created: {}, updated: rev === 1 ? 0 : 1, deleted: {}, unchanged: false },
      hash, layer: `agent-${sha256(`layer:${ask.session}`).slice(0, 12)}`, thread: ask.session,
    },
  };
}

/** The same revision as fed to a running replica: with the connection's fields the hub would have stamped on it. */
export const fedRevision = (ask: Pick<Ask, 'doc' | 'session'>, rev: number, hash: string, ts: number): Line => {
  const { writer, actor, scope } = agentOf(ask.session);
  return { ...revisionEvent(ask, rev, hash, ts), writer, actor, scope };
};

/**
 * Seeds `specs` (one session each), a minute apart: the session's start in `<base>/shop` (a git folder), its task, then
 * for each ask its document's revision 1 (`doc.patched`, from the agent's connection) and the ask raised by the asks
 * core as `deep_ask.taste`, pinned to `doc:<id>@1`; then setup finished and a real hub on its test clock.
 */
export async function makeWorld(specs: readonly { key: string; title: string; asks: AskSpec[] }[]): Promise<World> {
  needBuilds();
  const home = makeHome();
  const base = tempDir();
  const dir = join(base, 'shop');
  mkdirSync(dir, { recursive: true });
  await new Promise<void>((resolve, reject) => execFile('git', ['init', '-q'], { cwd: dir, env: GIT_ENV(dir) }, (e) => (e ? reject(e) : resolve())));
  const put = await evidenceOf(home);
  const w: World = { home, hub: undefined as unknown as Hub, asks: new Map() };
  const first = Date.now() - (specs.length + 5) * MIN;
  await seed(home, async (s: Seeding) => {
    for (const [i, spec] of specs.entries()) {
      const at = first + i * MIN;
      const id = newSession(home, 'claude-code', dir).id;
      s.at(at);
      await s.start(id, dir);
      await s.record.append({ writer: 'app', actor: 'you', scope: 'you', session: id, project: 'shop' } as never, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: id, owner: 'you', title: spec.title } } as never);
      for (const [k, a] of spec.asks.entries()) {
        const pictures: Picture[] = [];
        for (const size of a.pictures) pictures.push({ sha: await put(png(size[0], size[1]), 'screenshot'), size });
        const spare: Picture[] = [];
        for (const size of a.spare) spare.push({ sha: await put(png(size[0], size[1]), 'screenshot'), size });
        const doc = `doc:${ulid(at + 1000 + k)}`;
        const rev1 = await put(documentOf(pictures), 'canvas.revision');
        const replaced: string[] = [];
        for (const j of pictures.keys()) replaced.push(await put(documentOf(pictures.map((p, n) => (n === j ? spare[0]! : p))), 'canvas.revision'));
        s.at(at + 1500 + k * 1000);
        await s.record.append(agentOf(id) as never, revisionEvent({ doc, session: id }, 1, rev1, s.now()) as never);
        s.at(at + 2000 + k * 1000);
        const handle = await s.asks.raise(core(id) as never, 'deep_ask.taste', tasteData(a.question, `${doc}@1`, s.now()));
        w.asks.set(a.key, { key: a.key, handle, session: id, question: a.question, doc, pictures, spare, replaced });
      }
    }
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  w.hub = await startHub({ home, clock: Date.now(), env: { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_CLOCK_STEPS: '1' } }, 10 * MIN);
  await quiet(w.hub);
  return w;
}

// ---- The replica: #1808's client on #1101's build, in the world's HOME, at the reference window.

/** One replica on a copy of the world's record, at the reference window. */
export async function replicaOf(w: World): Promise<Replica> {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  const bin = await driveBin(false);
  const dir = tempDir();
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const confirm = join(dir, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(w.home, { DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  const r = new (Replica as unknown as new (c: ChildProcess) => Replica)(child);
  const ready = await (r as unknown as { next(ms: number): Promise<Line> }).next(600_000);
  if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)}`);
  await r.launch({ from: 'record_copy', size: [WINDOW.width, WINDOW.height] });
  return r;
}
export type { Replica };
/** The replica's clock, in ms since its launch. */
const msOf = (r: Replica): number => (r.t * 1000) / FLICKS;
/** `see`, with the replica's clock. */
export async function look(r: Replica): Promise<{ s: Snapshot; t: number }> {
  const seen = await r.see();
  return { s: seen.snapshot, t: msOf(r) };
}

// ---- Reading the window. Bounds are [x, y, w, h] in device pixels.

const windowBox = (s: Snapshot): number[] => [0, 0, s.window.size[0]! * s.window.scale, s.window.size[1]! * s.window.scale];
const within = (b: number[], box: number[]): boolean => b[2]! > 0 && b[3]! > 0 && b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
/** A picture as one snapshot draws it: whole inside the window or not, and its largest scale there (whole draws first). */
export interface Drawn { whole: boolean; scale: number; bounds: number[] }
/**
 * Each of `pictures` the snapshot draws: the nodes whose id is `picture:<sha256>`, the largest whole draw of each. Whole
 * is inside the window and inside each enclosing node with a size, as a scroll area's view.
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
/** An option's node on the card, `card-option:<id>` (#1462). */
export const optionOf = (s: Snapshot, id: string): SNode | undefined => byId(s, `card-option:${id}`);
/** Armed: the node's value is `armed`. */
export const isArmed = (n: SNode | undefined): boolean => n?.value === 'armed';
/** What's left, as the option says it: `[left, all]`, or undefined when it says no count. */
export function leftOf(s: Snapshot, n: SNode | undefined): [number, number] | undefined {
  const m = LEFT.exec(wordsOf(s, n));
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

// ---- The replica's trace of what was drawn: samples on the virtual clock, read as intervals (first draft, Readings 2).

/** Snapshots at known times on the replica's clock, one action between two. */
export class Trace {
  readonly samples: { t: number; drawn: Map<string, Drawn> }[] = [];
  constructor(readonly pictures: readonly Picture[]) {}
  add(t: number, s: Snapshot): Map<string, Drawn> {
    const drawn = drawnIn(s, this.pictures);
    this.samples.push({ t, drawn });
    return drawn;
  }
  private whole(i: number, sha: string): boolean {
    const d = this.samples[i]?.drawn.get(sha);
    return !!d && d.whole && d.scale >= 0.5;
  }
  /** Surely shown by now: whole at half its size or more across samples at least `ARM_AFTER_MS` apart, unbroken. */
  shown(sha: string): boolean {
    let from: number | undefined;
    for (const [i, x] of this.samples.entries()) {
      if (!this.whole(i, sha)) { from = undefined; continue; }
      from ??= x.t;
      if (x.t - from >= ARM_AFTER_MS) return true;
    }
    return false;
  }
}

/** How far one wheel turn moves the evidence, in points: a small step, so a picture comes whole into view before the next does. */
const STEP_PT = 100;
/**
 * The wheel over the evidence until `done` holds: each turn `STEP_PT` toward the end, over the drawn picture nearest the
 * window's middle, sampled after it; when a turn brings a picture whole into view that isn't shown yet, the arming
 * interval and a little more pass with no input, sampled after. Stops when a turn moves nothing.
 */
export async function scrollPictures(r: Replica, trace: Trace, done: () => boolean): Promise<Snapshot> {
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
    if ([...now.entries()].some(([p, d]) => d.whole && d.scale >= 0.5 && !trace.shown(p))) {
      await r.wait(ARM_AFTER_MS + 200);
      x = await look(r);
      trace.add(x.t, x.s);
    }
    s = x.s;
  }
  return s;
}

/** Opens an ask's page and waits on the replica's clock, up to 3 s, until it draws one of the trace's pictures: the first sample. */
export async function openOn(r: Replica, handle: string, trace: Trace): Promise<{ s: Snapshot; t: number }> {
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
export async function waitFor(r: Replica, ready: (s: Snapshot) => boolean, ms = 3000, step = 250): Promise<{ s: Snapshot; t: number }> {
  let x = await look(r);
  for (let waited = 0; waited < ms && !ready(x.s); waited += step) {
    await r.wait(step);
    x = await look(r);
  }
  return x;
}
